"""Provider-neutral contracts for local and future cloud sandboxes."""

from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel, Field


class SandboxHealth(BaseModel):
    status: Literal["ready", "starting", "offline"]
    runtime_version: str | None = None
    workspace: str | None = None
    provider: str = "local_wsl"
    detail: str | None = None


class SandboxCommand(BaseModel):
    company_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    action: Literal[
        "mkdir", "write_file", "read_file", "list_files", "run", "stop_all", "destroy_workspace",
        "git_status", "git_diff", "preview_start", "preview_stop", "browser_snapshot",
    ]
    path: str | None = Field(default=None, max_length=512)
    content: str | None = Field(default=None, max_length=1_000_000)
    args: list[str] = Field(default_factory=list, max_length=8)
    timeout_seconds: int = Field(default=30, ge=1, le=30)


class SandboxActivity(BaseModel):
    event_type: str
    summary: str = Field(max_length=300)
    data: dict = Field(default_factory=dict)


class SandboxResult(BaseModel):
    ok: bool = True
    result: dict = Field(default_factory=dict)
    activities: list[SandboxActivity] = Field(default_factory=list)


class SandboxManager(Protocol):
    """Execution provider boundary. CloudSandboxManager can implement this unchanged."""

    def health(self) -> SandboxHealth: ...

    def create_workspace(self, company_id: str) -> SandboxResult: ...

    def execute(self, command: SandboxCommand) -> SandboxResult: ...

    def read_file(self, company_id: str, path: str) -> SandboxResult: ...

    def write_file(self, company_id: str, path: str, content: str) -> SandboxResult: ...

    def list_files(self, company_id: str, path: str | None = None) -> SandboxResult: ...

    def stop_all(self, company_id: str | None = None) -> SandboxResult: ...

    def destroy_workspace(self, company_id: str) -> SandboxResult: ...

    def start_preview(self, company_id: str) -> SandboxResult: ...

    def stop_preview(self, company_id: str) -> SandboxResult: ...

    def browser_snapshot(self, company_id: str, viewport: str = "desktop") -> SandboxResult: ...
