"""Network client for a private, container/VM-hosted orcha-worker service.

It implements the same narrow SandboxManager contract as LocalWslSandboxManager
so the API and agents remain independent of the execution location.
"""

from __future__ import annotations

import os

import httpx

from .contracts import SandboxCommand, SandboxHealth, SandboxManager, SandboxResult
from .local_wsl import SandboxUnavailable


def _worker_auth_required() -> bool:
    return os.getenv("ORCHA_REQUIRE_WORKER_AUTH", "false").strip().lower() in {
        "1", "true", "yes", "on"
    }


class CloudSandboxManager(SandboxManager):
    def __init__(self, base_url: str | None = None, client: httpx.Client | None = None):
        self.base_url = (base_url or os.getenv("ORCHA_WORKER_URL", "http://worker:8765")).rstrip("/")
        # Keep one connection pool for a long-lived API process. The injected
        # client seam remains available to tests and hosted transports; the
        # default client is owned and closed by this manager.
        self._client = client or httpx.Client(
            base_url=self.base_url,
            timeout=35.0,
            limits=httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
                keepalive_expiry=30.0,
            ),
        )
        self._closed = False

    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        try:
            if self._closed:
                raise SandboxUnavailable("Company Worker client is closed.")
            token = os.getenv("ORCHA_WORKER_AUTH_TOKEN", "")
            headers = {"X-Orcha-Worker-Token": token} if token else None
            response = self._client.request(method, path, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError, OSError) as exc:
            raise SandboxUnavailable("Company Worker is offline. Restore the worker and try again.") from exc

    def close(self) -> None:
        """Release the owned or injected persistent worker client at shutdown."""
        if self._closed:
            return
        self._closed = True
        client, self._client = self._client, None
        if client is not None:
            try:
                client.close()
            except Exception:
                pass

    def health(self) -> SandboxHealth:
        if _worker_auth_required() and not os.getenv("ORCHA_WORKER_AUTH_TOKEN", ""):
            # The worker intentionally keeps /health cheap for container
            # supervision, but a control plane in required-auth mode must not
            # advertise readiness when every execution would be rejected.
            return SandboxHealth(
                status="offline",
                provider="cloud",
                workspace="unavailable",
                detail="Worker authentication is not configured",
            )
        try:
            body = self._request("GET", "/health")
        except SandboxUnavailable as exc:
            return SandboxHealth(status="offline", provider="cloud", detail=str(exc))
        reported = body.get("status")
        health_status = reported if reported in {"ready", "starting", "offline"} else "starting"
        return SandboxHealth(
            status=health_status,
            runtime_version=body.get("runtimeVersion") or body.get("runtime_version"),
            workspace=body.get("workspace"),
            provider="cloud",
            detail=body.get("detail"),
        )

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
