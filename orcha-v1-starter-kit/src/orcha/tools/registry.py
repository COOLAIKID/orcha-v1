"""A small typed registry that translates role capabilities to SandboxManager calls."""

from __future__ import annotations

from pydantic import BaseModel, Field

from orcha.sandbox.contracts import SandboxCommand


class ToolCall(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_.-]{1,63}$")
    arguments: dict = Field(default_factory=dict)


class ToolResult(BaseModel):
    name: str
    ok: bool
    summary: str
    data: dict = Field(default_factory=dict)


class ToolDenied(RuntimeError):
    pass


class ToolRegistry:
    """Only registered typed tools can reach the workspace boundary."""

    def __init__(self, sandbox):
        self.sandbox = sandbox

    @staticmethod
    def names_for(capabilities: list[str]) -> list[str]:
        return sorted(set(capabilities))

    def execute(self, company_id: str, capabilities: list[str], call: ToolCall) -> ToolResult:
        if call.name not in capabilities:
            raise ToolDenied(f"{call.name} is not permitted for this agent")
        args = call.arguments
        if call.name == "workspace.read_file":
            path = self._path(args)
            result = self.sandbox.read_file(company_id, path)
            return self._result(call.name, result, f"Read {path}")
        if call.name == "workspace.write_file":
            path = self._path(args)
            content = args.get("content")
            if not isinstance(content, str) or len(content.encode("utf-8")) > 300_000:
                raise ToolDenied("workspace.write_file requires bounded string content")
            result = self.sandbox.write_file(company_id, path, content)
            return self._result(call.name, result, f"Saved {path}")
        if call.name == "workspace.list_files":
            path = args.get("path")
            if path is not None and not isinstance(path, str):
                raise ToolDenied("workspace.list_files path must be a string")
            result = self.sandbox.list_files(company_id, path)
            return self._result(call.name, result, "Listed company files")
        if call.name == "workspace.mkdir":
            path = self._path(args)
            result = self.sandbox.execute(SandboxCommand(company_id=company_id, action="mkdir", path=path))
            return self._result(call.name, result, f"Created {path}")
        if call.name == "git.status":
            result = self.sandbox.execute(SandboxCommand(company_id=company_id, action="git_status"))
            return self._result(call.name, result, "Read repository status")
        if call.name == "git.diff":
            result = self.sandbox.execute(SandboxCommand(company_id=company_id, action="git_diff"))
            return self._result(call.name, result, "Read repository diff")
        if call.name == "preview.start":
            result = self.sandbox.start_preview(company_id)
            return self._result(call.name, result, "Started private preview")
        if call.name == "preview.stop":
            result = self.sandbox.stop_preview(company_id)
            return self._result(call.name, result, "Stopped private preview")
        if call.name == "browser.snapshot":
            viewport = args.get("viewport", "desktop")
            if viewport not in {"desktop", "mobile"}:
                raise ToolDenied("browser.snapshot viewport must be desktop or mobile")
            result = self.sandbox.browser_snapshot(company_id, viewport)
            return self._result(call.name, result, f"Captured {viewport} preview")
        raise ToolDenied(f"{call.name} is not a registered tool")

    @staticmethod
    def _path(arguments: dict) -> str:
        path = arguments.get("path")
        if not isinstance(path, str) or not path.strip() or len(path) > 512:
            raise ToolDenied("Tool requires a bounded relative path")
        return path

    @staticmethod
    def _result(name: str, result, summary: str) -> ToolResult:
        ok = bool(result.ok)
        data = dict(result.result) if isinstance(result.result, dict) else {}
        if "stdout" not in data:
            files = data.get("files")
            if isinstance(files, list) and files:
                data["stdout"] = "\n".join(str(item) for item in files[:80])
        return ToolResult(
            name=name,
            ok=ok,
            summary=summary if ok else f"{summary} failed",
            data=data,
        )
