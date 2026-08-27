"""Minimal provider-neutral model gateway for specialized agent work.

The first implementation reads a key only from the API process environment. It
supports OpenAI-compatible provider endpoints (OpenAI, Groq, and OpenRouter),
which lets an operator use a temporary free-tier key without ever placing it in
the web app, task record, event feed, or agent prompt.
"""

from __future__ import annotations

import os
import inspect
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

AGENT_MAX_TOKENS = 4096
AGENT_MAX_CHARS = 60_000
DEFAULT_KEY_COOLDOWN_SECONDS = 60.0


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    base_url: str
    key: str
    model: str
    key_slot: int = 0


@dataclass(frozen=True)
class ModelOutput:
    content: str
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_usd: float = 0
    fallback_from: str | None = None
    duration_ms: int = 0


class EnvironmentModelGateway:
    def __init__(
        self,
        client: httpx.Client | None = None,
        *,
        scoped_client_factory: Callable[[], httpx.Client] | None = None,
    ):
        self.client = client if client is not None else httpx.Client(timeout=60)
        self._scoped_client_factory = scoped_client_factory or (lambda: httpx.Client(timeout=60))
        self._client_lock = threading.Lock()
        self._cancel_generation = 0
        self._scope_generations: dict[str, int] = {}
        self._active_scoped_clients: dict[str, set[httpx.Client]] = {}
        self._closed = False
        self._key_state_lock = threading.Lock()
        self._key_cooldowns: dict[tuple[str, int], float] = {}

    def cancel(self, scope: str | None = None) -> None:
        """Cancel one company scope, or all requests for process shutdown.

        Scoped runs use one short-lived client per company request. Closing
        those clients interrupts the blocking HTTP call without disturbing a
        different company's request. The no-argument form preserves the
        existing process-wide Stop All/shutdown contract.
        """
        with self._client_lock:
            if self._closed:
                return
        if scope is not None:
            with self._client_lock:
                if self._closed:
                    return
                self._scope_generations[scope] = self._scope_generations.get(scope, 0) + 1
                clients = tuple(self._active_scoped_clients.get(scope, set()))
            for client in clients:
                self._close_client(client)
            return

        # Drop every in-flight provider request so process shutdown can take
        # effect.
        # Do not clear a shared cancellation flag while an older request may
        # still be unwinding. Each generate() captures this generation and
        # cannot fall through to another provider after a later cancel().
        with self._client_lock:
            if self._closed:
                return
            self._cancel_generation += 1
            client = self.client
            self.client = httpx.Client(timeout=60)
            scoped_clients = tuple(
                active
                for clients in self._active_scoped_clients.values()
                for active in clients
            )
        try:
            client.close()
        except Exception:
            pass
        for scoped_client in scoped_clients:
            self._close_client(scoped_client)

    def close(self) -> None:
        """Close every HTTP client without allocating a replacement.

        ``cancel()`` intentionally replaces the shared client because the
        gateway remains usable after a company-level stop. API shutdown is
        different: no later request can be accepted, so allocating a fresh
        client there would leak an otherwise idle connection pool.
        """
        with self._client_lock:
            if self._closed:
                return
            self._closed = True
            self._cancel_generation += 1
            client = self.client
            scoped_clients = tuple(
                active
                for clients in self._active_scoped_clients.values()
                for active in clients
            )
            self._active_scoped_clients.clear()
        self._close_client(client)
        for scoped_client in scoped_clients:
            self._close_client(scoped_client)

    def _generation(self, scope: str | None = None) -> tuple[int, int]:
        with self._client_lock:
            scope_generation = self._scope_generations.get(scope, 0) if scope is not None else 0
            return self._cancel_generation, scope_generation

    def _was_cancelled(self, generation: tuple[int, int], scope: str | None = None) -> bool:
        with self._client_lock:
            return (
                generation[0] != self._cancel_generation
                or scope is not None and generation[1] != self._scope_generations.get(scope, 0)
            )

    @staticmethod
    def _close_client(client: httpx.Client) -> None:
        try:
            client.close()
        except Exception:
            pass

    def _acquire_client(self, scope: str | None) -> tuple[httpx.Client, bool]:
        if scope is None:
            with self._client_lock:
                if self._closed:
                    raise RuntimeError("The model gateway is closed.")
                return self.client, False
        client = self._scoped_client_factory()
        with self._client_lock:
            if self._closed:
                self._close_client(client)
                raise RuntimeError("The model gateway is closed.")
            self._active_scoped_clients.setdefault(scope, set()).add(client)
        return client, True

    def _release_client(self, scope: str | None, client: httpx.Client, managed: bool) -> None:
        if not managed:
            return
        with self._client_lock:
            clients = self._active_scoped_clients.get(scope or "")
            if clients is not None:
                clients.discard(client)
                if not clients:
                    self._active_scoped_clients.pop(scope or "", None)
        self._close_client(client)

    def configs(self) -> list[ProviderConfig]:
        explicit = os.getenv("ORCHA_AGENT_PROVIDER", "").strip().lower()
        configured_fallbacks = [item.strip().lower() for item in os.getenv("ORCHA_AGENT_FALLBACK_PROVIDERS", "").split(",") if item.strip()]
        candidates = ([explicit] if explicit else []) + configured_fallbacks + ["openrouter", "gemini", "groq", "openai"]
        configs: list[ProviderConfig] = []
        seen: set[str] = set()
        base_urls = {
            "openrouter": "https://openrouter.ai/api/v1",
            "gemini": "https://generativelanguage.googleapis.com/v1beta",
            "groq": "https://api.groq.com/openai/v1",
            "openai": "https://api.openai.com/v1",
        }
        for provider in candidates:
            if provider in seen:
                continue
            seen.add(provider)
            base_url = base_urls.get(provider)
            model = self._model_for(provider) if base_url else ""
            if not base_url or not model:
                continue
            for key_slot, key in enumerate(self._keys_for(provider)):
                configs.append(ProviderConfig(provider, base_url, key, model, key_slot))
        return configs

    @staticmethod
    def _keys_for(provider: str) -> list[str]:
        """Read an ordered, deduplicated server-side key pool.

        The singular variables remain the compatibility path. The plural
        variables let an operator keep several temporary free-tier keys in a
        private API-host environment; a failed key falls through to the next
        one without exposing key material to events, prompts, or the browser.
        """
        prefix = provider.upper()
        names = (
            f"ORCHA_AGENT_{prefix}_API_KEYS",
            f"{prefix}_API_KEYS",
            f"{prefix}_API_KEY",
        )
        values: list[str] = []
        for name in names:
            raw = os.getenv(name, "")
            values.extend(item.strip() for item in raw.split(",") if item.strip())
        return list(dict.fromkeys(values))

    @staticmethod
    def _model_for(provider: str) -> str:
        """Resolve a provider-specific model before the legacy shared model.

        A fallback chain commonly needs different model identifiers. The
        shared setting remains supported so existing single-provider installs
        keep working, while the per-provider settings make a mixed
        Gemini/Groq/OpenRouter setup explicit and safe.
        """
        provider_key = f"ORCHA_AGENT_{provider.upper()}_MODEL"
        legacy_key = f"{provider.upper()}_MODEL"
        return (
            os.getenv(provider_key, "").strip()
            or os.getenv(legacy_key, "").strip()
            or os.getenv("ORCHA_AGENT_MODEL", "").strip()
        )

    def config(self) -> ProviderConfig | None:
        return self.configs()[0] if self.configs() else None

    def is_available(self) -> bool:
        return self.config() is not None

    def health(self) -> list[dict[str, str]]:
        active = {config.name: config for config in self.configs()}
        preferred = os.getenv("ORCHA_AGENT_PROVIDER", "openrouter").strip().lower() or "openrouter"
        names = [preferred, "openrouter", "gemini", "groq", "openai"]
        states: list[dict[str, str]] = []
        for name in dict.fromkeys(names):
            config = active.get(name)
            # A key being present is not proof that an upstream provider is live.
            # A real request changes this to an observed outcome in the event log.
            states.append({"provider": name, "status": "configured" if config else "unconfigured", "model": config.model if config else ""})
        return states

    @staticmethod
    def _rate(name: str) -> float:
        try:
            return max(0.0, float(os.getenv(name, "0")))
        except ValueError:
            return 0.0

    @staticmethod
    def _key_cooldown_seconds() -> float:
        try:
            # Keep a malformed or accidentally huge operator setting from
            # making a temporary provider failure permanent for this process.
            return min(3600.0, max(0.05, float(os.getenv("ORCHA_AGENT_KEY_COOLDOWN_SECONDS", str(DEFAULT_KEY_COOLDOWN_SECONDS)))))
        except ValueError:
            return DEFAULT_KEY_COOLDOWN_SECONDS

    def _eligible_configs(self, configs: list[ProviderConfig]) -> list[ProviderConfig]:
        """Skip recently failed keys while preserving a recovery attempt.

        This state is intentionally process-local. It is a small backoff for
        expiring/rate-limited free keys, not a credential store or a health
        claim. If every configured key is cooling down, retry the full ordered
        list so a recovered provider can become usable without restarting API.
        """
        now = time.monotonic()
        with self._key_state_lock:
            self._key_cooldowns = {
                identity: until
                for identity, until in self._key_cooldowns.items()
                if until > now
            }
            eligible = [
                config
                for config in configs
                if self._key_cooldowns.get((config.name, config.key_slot), 0) <= now
            ]
        return eligible or configs

    def _cooldown_key(self, config: ProviderConfig) -> None:
        with self._key_state_lock:
            self._key_cooldowns[(config.name, config.key_slot)] = time.monotonic() + self._key_cooldown_seconds()

    def _clear_key_cooldown(self, config: ProviderConfig) -> None:
        with self._key_state_lock:
            self._key_cooldowns.pop((config.name, config.key_slot), None)

    def generate(
        self,
        system: str,
        prompt: str,
        max_tokens: int | None = None,
        cancellation_scope: str | None = None,
    ) -> ModelOutput:
        configured = self.configs()
        if not configured:
            raise RuntimeError("No server-side AI provider is configured.")
        generation = self._generation(cancellation_scope)
        configs = self._eligible_configs(configured)
        failures: list[str] = []
        client, managed = self._acquire_client(cancellation_scope)
        try:
            for config in configs:
                if self._was_cancelled(generation, cancellation_scope):
                    raise RuntimeError("Company runtime was stopped by the owner.")
                try:
                    started = time.perf_counter()
                    output = self._generate_with(
                        config,
                        system,
                        prompt,
                        max_tokens or AGENT_MAX_TOKENS,
                        generation,
                        cancellation_scope,
                        client,
                    )
                    if self._was_cancelled(generation, cancellation_scope):
                        raise RuntimeError("Company runtime was stopped by the owner.")
                    self._clear_key_cooldown(config)
                    duration_ms = max(0, int((time.perf_counter() - started) * 1000))
                    return ModelOutput(
                        content=output.content,
                        provider=output.provider,
                        model=output.model,
                        input_tokens=output.input_tokens,
                        output_tokens=output.output_tokens,
                        estimated_usd=output.estimated_usd,
                        fallback_from=configured[0].name if config.name != configured[0].name else None,
                        duration_ms=output.duration_ms or duration_ms,
                    )
                except RuntimeError as exc:
                    if self._was_cancelled(generation, cancellation_scope) or "stopped by the owner" in str(exc):
                        raise
                    self._cooldown_key(config)
                    failures.append(config.name)
                except httpx.HTTPError as exc:
                    if self._was_cancelled(generation, cancellation_scope):
                        raise RuntimeError("Company runtime was stopped by the owner.") from exc
                    self._cooldown_key(config)
                    failures.append(config.name)
                except (AttributeError, IndexError, KeyError, TypeError, ValueError):
                    # A provider can return a 200 with malformed JSON or an
                    # unexpected shape. Treat that as a provider-local failure so
                    # the configured fallback chain can still serve the task.
                    self._cooldown_key(config)
                    failures.append(config.name)
            raise RuntimeError("Configured AI providers are temporarily unavailable: " + ", ".join(failures))
        finally:
            self._release_client(cancellation_scope, client, managed)

    def _generate_with(
        self,
        config: ProviderConfig,
        system: str,
        prompt: str,
        max_tokens: int,
        generation: tuple[int, int],
        scope: str | None,
        client: httpx.Client,
    ) -> ModelOutput:
        if self._was_cancelled(generation, scope):
            raise RuntimeError("Company runtime was stopped by the owner.")
        if config.name == "gemini":
            return self._generate_gemini(config, system, prompt, max_tokens, generation, scope, client)
        response = client.post(
            f"{config.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {config.key}", "Content-Type": "application/json"},
            json={
                "model": config.model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": max_tokens,
            },
        )
        if self._was_cancelled(generation, scope):
            raise RuntimeError("Company runtime was stopped by the owner.")
        if response.status_code >= 400:
            raise RuntimeError("The configured AI provider rejected this agent run.")
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("The configured AI provider returned an invalid response.")
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise RuntimeError("The configured AI provider returned no usable agent response.")
        message = choices[0].get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("The configured AI provider returned no usable agent response.")
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        input_tokens = int(usage.get("prompt_tokens", 0) or 0)
        output_tokens = int(usage.get("completion_tokens", 0) or 0)
        estimated_usd = (
            input_tokens * self._rate("ORCHA_AGENT_INPUT_USD_PER_1K") / 1000
            + output_tokens * self._rate("ORCHA_AGENT_OUTPUT_USD_PER_1K") / 1000
        )
        return ModelOutput(content.strip()[:AGENT_MAX_CHARS], config.name, config.model, input_tokens, output_tokens, estimated_usd)

    def _generate_gemini(
        self,
        config: ProviderConfig,
        system: str,
        prompt: str,
        max_tokens: int,
        generation: tuple[int, int],
        scope: str | None,
        client: httpx.Client,
    ) -> ModelOutput:
        if self._was_cancelled(generation, scope):
            raise RuntimeError("Company runtime was stopped by the owner.")
        response = client.post(
            f"{config.base_url}/models/{config.model}:generateContent",
            params={"key": config.key},
            json={
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens},
            },
        )
        if self._was_cancelled(generation, scope):
            raise RuntimeError("Company runtime was stopped by the owner.")
        if response.status_code >= 400:
            raise RuntimeError("The configured AI provider rejected this agent run.")
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("The configured AI provider returned an invalid response.")
        candidates = payload.get("candidates") if isinstance(payload.get("candidates"), list) else []
        first = candidates[0] if candidates and isinstance(candidates[0], dict) else {}
        content_body = first.get("content") if isinstance(first, dict) else {}
        parts = content_body.get("parts", []) if isinstance(content_body, dict) else []
        content = "".join(part.get("text", "") for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str))
        if not content.strip():
            raise RuntimeError("The configured AI provider returned no usable agent response.")
        usage = payload.get("usageMetadata") if isinstance(payload.get("usageMetadata"), dict) else {}
        input_tokens = int(usage.get("promptTokenCount", 0) or 0)
        output_tokens = int(usage.get("candidatesTokenCount", 0) or 0)
        estimated_usd = (
            input_tokens * self._rate("ORCHA_AGENT_INPUT_USD_PER_1K") / 1000
            + output_tokens * self._rate("ORCHA_AGENT_OUTPUT_USD_PER_1K") / 1000
        )
        return ModelOutput(content.strip()[:AGENT_MAX_CHARS], config.name, config.model, input_tokens, output_tokens, estimated_usd)


def _accepts_keyword(method, name: str) -> bool:
    try:
        parameters = inspect.signature(method).parameters.values()
    except (TypeError, ValueError):
        return False
    return any(parameter.name == name or parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters)


def generate_with_options(
    gateway,
    system: str,
    prompt: str,
    *,
    max_tokens: int | None = None,
    cancellation_scope: str | None = None,
):
    """Call provider gateways across the legacy injected-gateway boundary.

    Test and replacement gateways from the original scaffold may only accept
    ``(system, prompt)``. Production gateways can opt into bounded output and
    company-scoped cancellation without forcing every fake or future adapter
    to change at once.
    """
    kwargs = {}
    if max_tokens is not None and _accepts_keyword(gateway.generate, "max_tokens"):
        kwargs["max_tokens"] = max_tokens
    if cancellation_scope is not None and _accepts_keyword(gateway.generate, "cancellation_scope"):
        kwargs["cancellation_scope"] = cancellation_scope
    return gateway.generate(system, prompt, **kwargs)


def cancel_with_scope(gateway, scope: str | None = None) -> None:
    """Use scoped cancellation when an injected gateway supports it."""
    cancel = getattr(gateway, "cancel", None)
    if not callable(cancel):
        return
    if scope is not None:
        if _accepts_keyword(cancel, "scope"):
            cancel(scope=scope)
            return
        if _accepts_keyword(cancel, "cancellation_scope"):
            cancel(cancellation_scope=scope)
            return
    cancel()


def close_model_gateway(gateway) -> None:
    """Close a gateway when it exposes lifecycle cleanup, with legacy fallback."""
    close = getattr(gateway, "close", None)
    if callable(close):
        close()
        return
    cancel_with_scope(gateway)
