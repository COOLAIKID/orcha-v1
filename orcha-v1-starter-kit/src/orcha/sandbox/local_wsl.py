"""The Windows control plane's localhost client for orcha-worker in WSL."""

from __future__ import annotations

import os
import json
import subprocess
import threading
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from .contracts import SandboxCommand, SandboxHealth, SandboxManager, SandboxResult


class SandboxUnavailable(RuntimeError):
    """The local worker cannot be reached; callers must never turn this into fake success."""


class LocalWslSandboxManager(SandboxManager):
    def __init__(self, base_url: str | None = None, client: httpx.Client | None = None):
        self.base_url = self._local_worker_url(base_url or os.getenv("ORCHA_WORKER_URL", "http://127.0.0.1:8765"))
        self._client = client
        self._closed = False
        self.distro = os.getenv("ORCHA_WSL_DISTRO", "orcha-worker")
        # This is an API-host secret. It is sent only to the localhost worker,
        # never emitted in an event, result, or browser-facing response.
        self.worker_token = os.getenv("ORCHA_WORKER_AUTH_TOKEN", "")
        self._health_lock = threading.Lock()
        self._health_cache: SandboxHealth | None = None
        self._health_checked_at = 0.0
        self._health_probe: threading.Thread | None = None
        self._health_stop = threading.Event()
        # Some Windows hosts do not expose a WSL loopback service through the
        # localhost forwarder. Once that path has failed, do not turn every
        # successful bridge health result into a permanent-looking
        # ``starting`` state; the bridge result remains authoritative while
        # its normal TTL is fresh and refreshes in the background.
        self._fast_health_unavailable = False
        try:
            configured_ttl = float(os.getenv("ORCHA_WORKER_HEALTH_TTL_SECONDS", "30"))
        except ValueError:
            configured_ttl = 5.0
        self._health_ttl = max(1.0, configured_ttl)

    @staticmethod
    def _local_worker_url(value: str) -> str:
        """Reject remote or ambiguous URLs at the local-provider boundary."""
        candidate = value.rstrip("/")
        try:
            parsed = urlparse(candidate)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("LocalWslSandboxManager requires http://127.0.0.1:8765") from exc
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or port != 8765
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("LocalWslSandboxManager requires http://127.0.0.1:8765")
        return "http://127.0.0.1:8765"

    @staticmethod
    def _bridge_script() -> str:
        return (
            "import json, os, sys, time, urllib.request; "
            # Request bodies are read from stdin so workspace contents do not
            # appear in the visible wsl.exe argument list.
            "method,path=sys.argv[1:3]; payload=sys.stdin.read(); token=os.environ.get('ORCHA_WORKER_BRIDGE_TOKEN',''); data=payload.encode() if payload else None; "
            "headers={'Content-Type':'application/json'}; "
            "headers.update({'X-Orcha-Worker-Token':token} if token else {}); "
            "req=urllib.request.Request('http://127.0.0.1:8765'+path,data=data,method=method,headers=headers); "
            "last=None; "
            "\nfor _ in range(12):\n"
            "  try:\n"
            "    with urllib.request.urlopen(req, timeout=3) as response: print(response.read().decode()); raise SystemExit(0)\n"
            "  except Exception as exc: last=exc; time.sleep(.35)\n"
            "raise SystemExit(str(last))"
        )

    @staticmethod
    def _bridge_environment(token: str) -> dict[str, str]:
        """Keep WSL startup deterministic and avoid importing host tool paths."""
        system_root = os.environ.get("SystemRoot") or os.environ.get("WINDIR") or r"C:\Windows"
        return {
            "SystemRoot": system_root,
            "WINDIR": os.environ.get("WINDIR", system_root),
            "PATH": os.path.join(system_root, "System32"),
            "ORCHA_WORKER_BRIDGE_TOKEN": token,
        }

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        bridge_timeout: float | None = None,
    ) -> dict[str, Any]:
        try:
            if self._closed:
                raise SandboxUnavailable("Local Workspace client is closed.")
            if self._client is not None:
                headers = {"X-Orcha-Worker-Token": self.worker_token} if self.worker_token else None
                response = self._client.request(method, path, json=payload, headers=headers)
                response.raise_for_status()
                return response.json()
            if os.name == "nt":
                command = [
                    "wsl.exe", "-d", self.distro, "-u", "orcha", "--",
                    "/opt/orcha/.venv/bin/python", "-c", self._bridge_script(), method, path,
                ]
                response = subprocess.run(
                    command,
                    input=json.dumps(payload) if payload else "",
                    capture_output=True,
                    text=True,
                    # Keep the optional secret out of the visible wsl.exe
                    # command line and avoid importing arbitrary host PATHs.
                    env=self._bridge_environment(self.worker_token),
                    timeout=bridge_timeout or 40,
                    check=False,
                )
                if response.returncode != 0:
                    raise SandboxUnavailable("Local Workspace is offline. Start orcha-worker and try again.")
                return json.loads(response.stdout)
            else:
                with httpx.Client(base_url=self.base_url, timeout=35.0) as client:
                    headers = {"X-Orcha-Worker-Token": self.worker_token} if self.worker_token else None
                    response = client.request(method, path, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError, OSError, subprocess.SubprocessError) as exc:
            raise SandboxUnavailable("Local Workspace is offline. Start orcha-worker and try again.") from exc

    def health(self) -> SandboxHealth:
        if self._closed:
            return SandboxHealth(status="offline", provider="local_wsl", detail="Local Workspace client is closed.")
        if self._client is not None or os.name != "nt":
            try:
                return self._remember_health(self._health_from_body(self._request("GET", "/health")))
            except SandboxUnavailable as exc:
                return SandboxHealth(status="offline", provider="local_wsl", detail=str(exc))

        # A Windows -> WSL bridge request launches a short-lived process and
        # can take several seconds on a cold WSL host. The UI needs an
        # immediate, truthful state while that probe is in flight, so use the
        # OS localhost forwarder when available and otherwise refresh in the
        # background. Mutating requests remain synchronous and fail closed.
        with self._health_lock:
            cached = self._health_cache
            age = time.monotonic() - self._health_checked_at
            probe_active = self._health_probe is not None and self._health_probe.is_alive()

        if cached is not None and age < self._health_ttl:
            # A cached ready result must not hide a worker that disappeared
            # between UI polls. The Windows forwarder is a cheap read-only
            # probe, so verify cached readiness before returning it. If that
            # probe fails, expose starting while the bounded WSL bridge makes
            # the final ready/offline determination.
            if cached.status != "ready" or not self._can_use_fast_health() or self._fast_health_unavailable:
                return cached.model_copy(deep=True)
            body = self._fast_health()
            if body:
                self._fast_health_unavailable = False
                return self._remember_health(self._health_from_body(body))
            with self._health_lock:
                self._fast_health_unavailable = True
                if not (self._health_probe is not None and self._health_probe.is_alive()):
                    self._start_health_probe_locked()
            return SandboxHealth(
                status="starting",
                runtime_version=cached.runtime_version,
                workspace=cached.workspace,
                provider="local_wsl",
                detail="Checking Local Workspace…",
            )

        if probe_active:
            return SandboxHealth(
                status="starting",
                runtime_version=cached.runtime_version if cached else None,
                workspace=cached.workspace if cached else None,
                provider="local_wsl",
                detail="Checking Local Workspace…",
            )

        try:
            body = self._fast_health()
        except SandboxUnavailable as exc:
            body = None
        if body:
            self._fast_health_unavailable = False
            return self._remember_health(self._health_from_body(body))

        with self._health_lock:
            self._fast_health_unavailable = True
            if not probe_active:
                self._start_health_probe_locked()
            # A stale result must not be reported as ready while it is being
            # refreshed. The eventual background result decides ready/offline.
            return SandboxHealth(
                status="starting",
                runtime_version=cached.runtime_version if cached else None,
                workspace=cached.workspace if cached else None,
                provider="local_wsl",
                detail="Checking Local Workspace…",
            )

    @staticmethod
    def _health_from_body(body: dict[str, Any]) -> SandboxHealth:
        reported = body.get("status")
        status = reported if reported in {"ready", "starting", "offline"} else "starting"
        return SandboxHealth(
            status=status,
            runtime_version=body.get("runtimeVersion"),
            workspace=body.get("workspace"),
            provider="local_wsl",
        )

    def _remember_health(self, health: SandboxHealth) -> SandboxHealth:
        with self._health_lock:
            self._health_cache = health
            self._health_checked_at = time.monotonic()
            self._health_probe = None
        return health.model_copy(deep=True)

    def _start_health_probe_locked(self) -> None:
        if self._health_probe is not None and self._health_probe.is_alive():
            return
        self._health_stop.clear()
        self._health_probe = threading.Thread(
            target=self._refresh_health,
            name="orcha-worker-health",
            daemon=True,
        )
        self._health_probe.start()

    def _refresh_health(self) -> None:
        try:
            # The foreground call already attempted the cheap Windows
            # forwarder. Do not pay that timeout twice in the background path.
            body = self._request("GET", "/health", bridge_timeout=20)
            health = self._health_from_body(body)
        except SandboxUnavailable as exc:
            health = SandboxHealth(status="offline", provider="local_wsl", detail=str(exc))
        except Exception:
            health = SandboxHealth(
                status="offline",
                provider="local_wsl",
                detail="Local Workspace is offline. Start orcha-worker and try again.",
            )
        if self._health_stop.is_set():
            return
        with self._health_lock:
            self._health_cache = health
            self._health_checked_at = time.monotonic()
            self._health_probe = None

    def close(self) -> None:
        """Stop health refresh and release an injected client on API shutdown."""
        if self._closed:
            return
        self._closed = True
        self._health_stop.set()
        client, self._client = self._client, None
        if client is not None:
            try:
                client.close()
            except Exception:
                pass

    def _fast_health(self) -> dict[str, Any] | None:
        """Use the Windows localhost forwarder for a cheap, read-only probe.

        Python's Windows socket path cannot reach the WSL loopback on every
        host, while the OS curl forwarder can. Health is safe to retry, so use
        it only for this probe and keep all mutating calls on the distro bridge.
        A configured worker token also stays on the existing bridge path rather
        than being exposed as a process argument.
        """
        if not self._can_use_fast_health():
            return None
        try:
            response = subprocess.run(
                [
                    "curl.exe",
                    "--silent",
                    "--show-error",
                    "--fail",
                    "--noproxy",
                    "*",
                    "--connect-timeout",
                    "1",
                    "--max-time",
                    "2",
                    f"{self.base_url}/health",
                ],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            if response.returncode != 0:
                return None
            body = json.loads(response.stdout)
            return body if isinstance(body, dict) else None
        except (OSError, subprocess.SubprocessError, ValueError):
            return None

    def _can_use_fast_health(self) -> bool:
        return os.name == "nt" and self._client is None and not self.worker_token and self._is_loopback_url()

    def _is_loopback_url(self) -> bool:
        return urlparse(self.base_url).hostname in {"127.0.0.1", "localhost", "::1"}

    def execute(self, command: SandboxCommand) -> SandboxResult:
        return SandboxResult.model_validate(self._request("POST", "/execute", command.model_dump(mode="json")))

    def create_workspace(self, company_id: str) -> SandboxResult:
        return self.execute(SandboxCommand(company_id=company_id, action="mkdir", path="."))

    def read_file(self, company_id: str, path: str) -> SandboxResult:
        return self.execute(SandboxCommand(company_id=company_id, action="read_file", path=path))

    def write_file(self, company_id: str, path: str, content: str) -> SandboxResult:
        return self.execute(SandboxCommand(company_id=company_id, action="write_file", path=path, content=content))

    def list_files(self, company_id: str, path: str | None = None) -> SandboxResult:
        return self.execute(SandboxCommand(company_id=company_id, action="list_files", path=path))

    def stop_all(self, company_id: str | None = None) -> SandboxResult:
        return self.execute(SandboxCommand(company_id=company_id or "runtime", action="stop_all"))

    def destroy_workspace(self, company_id: str) -> SandboxResult:
        return self.execute(SandboxCommand(company_id=company_id, action="destroy_workspace"))

    def start_preview(self, company_id: str) -> SandboxResult:
        return self.execute(SandboxCommand(company_id=company_id, action="preview_start"))

    def stop_preview(self, company_id: str) -> SandboxResult:
        return self.execute(SandboxCommand(company_id=company_id, action="preview_stop"))

    def browser_snapshot(self, company_id: str, viewport: str = "desktop") -> SandboxResult:
        return self.execute(SandboxCommand(company_id=company_id, action="browser_snapshot", args=[viewport]))
