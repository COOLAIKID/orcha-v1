"""A deliberately small localhost worker with a confined filesystem contract."""

from __future__ import annotations

import os
import secrets
import signal
import shutil
import socket
import subprocess
import sys
from pathlib import Path, PurePosixPath
from threading import Lock

from fastapi import FastAPI, Header, HTTPException

from orcha.sandbox.contracts import SandboxActivity, SandboxCommand, SandboxResult
from orcha.sandbox.line_stats import line_delta

RUNTIME_VERSION = "0.1.0"
MAX_OUTPUT = 64_000
MAX_FILE_BYTES = 1_000_000


def _worker_auth_config() -> tuple[str, bool]:
    """Return the worker secret and whether shared-deployment auth is mandatory."""
    expected_token = os.getenv("ORCHA_WORKER_AUTH_TOKEN", "")
    required = os.getenv("ORCHA_REQUIRE_WORKER_AUTH", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    return expected_token, required


def _without_windows_extended_prefix(value: str) -> str:
    """Keep resolved Windows paths comparable across concurrent filesystem calls."""
    if value.startswith("\\\\?\\UNC\\"):
        return "\\\\" + value[8:]
    if value.startswith("\\\\?\\"):
        return value[4:]
    return value


def _canonical_path(value: Path | str) -> Path:
    resolved = Path(value).resolve()
    normalized = os.path.normpath(_without_windows_extended_prefix(os.fspath(resolved)))
    return Path(normalized)


def _is_within(candidate: Path, parent: Path) -> bool:
    """Compare paths with Windows case/prefix rules without weakening containment."""
    try:
        candidate_key = os.path.normcase(os.fspath(candidate))
        parent_key = os.path.normcase(os.fspath(parent))
        return os.path.commonpath([candidate_key, parent_key]) == parent_key
    except ValueError:
        # Different drives (or malformed paths) can never be a safe child.
        return False


class WorkerRuntime:
    def __init__(self, workspace_root: Path | str | None = None):
        self.workspace_root = _canonical_path(workspace_root or os.getenv("ORCHA_WORKSPACE_ROOT", "/home/orcha/workspaces"))
        self.children: dict[int, tuple[str, subprocess.Popen[str]]] = {}
        self.previews: dict[str, tuple[int, subprocess.Popen[str]]] = {}
        self.lock = Lock()

    def workspace(self, company_id: str) -> Path:
        root = _canonical_path(self.workspace_root / company_id)
        if not _is_within(root, self.workspace_root):
            raise ValueError("Invalid company workspace")
        root.mkdir(parents=True, exist_ok=True)
        return root

    def resolve(self, company_id: str, raw_path: str | None) -> tuple[Path, Path]:
        root = self.workspace(company_id)
        value = raw_path or "."
        pure = PurePosixPath(value)
        if pure.is_absolute() or ".." in pure.parts:
            raise ValueError("Path must remain inside the company workspace")
        target = _canonical_path(root / Path(*pure.parts))
        if not _is_within(target, root):
            raise ValueError("Path must remain inside the company workspace")
        return root, target

    def execute(self, command: SandboxCommand) -> SandboxResult:
        try:
            if command.action == "stop_all":
                return self.stop_all(command.company_id)
            if command.action == "destroy_workspace":
                return self.destroy_workspace(command.company_id)
            if command.action == "preview_start":
                return self.start_preview(command.company_id)
            if command.action == "preview_stop":
                return self.stop_preview(command.company_id)
            if command.action == "browser_snapshot":
                return self.browser_snapshot(command.company_id, command.args[0] if command.args else "desktop")
            root, target = self.resolve(command.company_id, command.path)
            if command.action == "mkdir":
                target.mkdir(parents=True, exist_ok=True)
                return SandboxResult(result={"path": str(target.relative_to(root))}, activities=[SandboxActivity(event_type="tool.completed", summary=f"Created workspace directory {target.relative_to(root)}")])
            if command.action == "write_file":
                if command.content is None:
                    raise ValueError("File content is required")
                existed = target.exists()
                if existed and target.stat().st_size > MAX_FILE_BYTES:
                    raise ValueError("Existing file is too large to update")
                before = target.read_text(encoding="utf-8") if existed else None
                relative = str(target.relative_to(root))
                if existed and before == command.content:
                    return SandboxResult(
                        result={"path": relative, "unchanged": True, **line_delta(before, command.content)},
                        activities=[],
                    )
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(command.content, encoding="utf-8")
                stats = line_delta(before, command.content)
                event_type = "file.changed" if existed else "file.created"
                verb = "Updated" if existed else "Created"
                return SandboxResult(
                    result={"path": relative, **stats},
                    activities=[SandboxActivity(event_type=event_type, summary=f"{verb} {relative}", data={"artifact": relative, **stats})],
                )
            if command.action == "read_file":
                if not target.is_file():
                    raise ValueError("File does not exist")
                # Bound the read itself, not just the JSON response. Generated
                # workspaces are untrusted input to this control plane; a
                # large artifact must not be loaded in full merely to return a
                # 64 KiB preview.
                with target.open("r", encoding="utf-8") as source:
                    content = source.read(MAX_OUTPUT)
                return SandboxResult(result={"path": str(target.relative_to(root)), "content": content}, activities=[SandboxActivity(event_type="tool.completed", summary=f"Read {target.relative_to(root)}")])
            if command.action == "list_files":
                if not target.is_dir():
                    raise ValueError("Directory does not exist")
                files = [str(item.relative_to(root)) for item in sorted(target.rglob("*")) if item.is_file()][:500]
                return SandboxResult(result={"files": files}, activities=[SandboxActivity(event_type="tool.completed", summary="Listed workspace files")])
            if command.action == "run":
                return self.run(root, command)
            if command.action in {"git_status", "git_diff"}:
                return self.git(root, command.action)
            raise ValueError("Unsupported workspace action")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    def run(self, root: Path, command: SandboxCommand) -> SandboxResult:
        argv = command.args
        if not argv:
            raise ValueError("Command arguments are required")
        executable, *args = argv
        allowed = {
            "pwd": lambda value: not value,
            "ls": lambda value: not value,
            "false": lambda value: not value,
            "sleep": lambda value: len(value) == 1 and value[0].isdigit() and 0 <= int(value[0]) <= 30,
            # A portable, test-only logical command. It is mapped internally and never runs user code.
            "wait": lambda value: len(value) == 1 and value[0].isdigit() and 0 <= int(value[0]) <= 30,
        }
        if executable not in allowed or not allowed[executable](args):
            raise ValueError("Command is not permitted in the Local Workspace")
        # Logical commands are mapped to known child programs. This keeps the v1
        # protocol portable for tests while avoiding arbitrary executable paths.
        virtual = {
            "pwd": "import os; print(os.getcwd())",
            "ls": "import os; print('\\n'.join(sorted(os.listdir())))",
            "false": "raise SystemExit(1)",
            "sleep": f"import time; time.sleep({int(args[0])})" if args else "",
            "wait": f"import time; time.sleep({int(args[0])})" if args else "",
        }
        exec_argv = [sys.executable, "-c", virtual[executable]]
        proc = subprocess.Popen(
            exec_argv,
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=os.name != "nt",
        )
        with self.lock:
            self.children[proc.pid] = (command.company_id, proc)
        started = SandboxActivity(event_type="command.started", summary=f"Ran {executable}", data={"command": executable})
        try:
            stdout, stderr = proc.communicate(timeout=command.timeout_seconds)
        except subprocess.TimeoutExpired:
            self._terminate(proc)
            raise ValueError("Command exceeded its time limit")
        finally:
            with self.lock:
                self.children.pop(proc.pid, None)
        completed = SandboxActivity(
            event_type="command.completed",
            summary=f"{executable} exited with code {proc.returncode}",
            data={
                "command": executable,
                "exitCode": proc.returncode,
                "stdout": (stdout or "")[:MAX_OUTPUT],
                "stderr": (stderr or "")[:MAX_OUTPUT],
            },
        )
        return SandboxResult(
            ok=proc.returncode == 0,
            result={"exitCode": proc.returncode, "stdout": stdout[:MAX_OUTPUT], "stderr": stderr[:MAX_OUTPUT]},
            activities=[started, completed],
        )

    def git(self, root: Path, action: str) -> SandboxResult:
        argv = ["git", "status", "--short"] if action == "git_status" else ["git", "diff", "--no-ext-diff", "--", "."]
        try:
            proc = subprocess.run(argv, cwd=root, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError("Git inspection is unavailable in the Local Workspace") from exc
        summary = "Read repository status" if action == "git_status" else "Read repository diff"
        stdout = (proc.stdout or "")[:MAX_OUTPUT]
        stderr = (proc.stderr or "")[:MAX_OUTPUT]
        return SandboxResult(
            ok=proc.returncode == 0,
            result={"exitCode": proc.returncode, "stdout": stdout, "stderr": stderr},
            activities=[SandboxActivity(event_type="tool.completed", summary=summary, data={"stdout": stdout, "exitCode": proc.returncode})],
        )

    def start_preview(self, company_id: str) -> SandboxResult:
        root = self.workspace(company_id)
        app_root = root / "app"
        if not (app_root / "index.html").is_file():
            raise ValueError("Preview requires app/index.html")
        existing = self.previews.get(company_id)
        if existing and existing[1].poll() is None:
            return SandboxResult(result={"port": existing[0], "url": f"http://127.0.0.1:{existing[0]}/"}, activities=[SandboxActivity(event_type="preview.ready", summary="Preview is already running")])
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = int(reservation.getsockname()[1])
        script = (
            "import http.server; "
            f"server=http.server.ThreadingHTTPServer(('127.0.0.1',{port}), lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory={str(app_root)!r}, **k)); "
            "print('ready', flush=True); server.serve_forever()"
        )
        proc = subprocess.Popen([sys.executable, "-u", "-c", script], cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=os.name != "nt")
        try:
            ready = proc.stdout.readline().strip() if proc.stdout else ""
        except OSError:
            ready = ""
        if ready != "ready" or proc.poll() is not None:
            self._terminate(proc)
            raise ValueError("Preview could not start")
        with self.lock:
            self.children[proc.pid] = (company_id, proc)
            self.previews[company_id] = (port, proc)
        return SandboxResult(result={"port": port, "url": f"http://127.0.0.1:{port}/"}, activities=[SandboxActivity(event_type="preview.ready", summary="Started confined company preview")])

    def stop_preview(self, company_id: str) -> SandboxResult:
        preview = self.previews.pop(company_id, None)
        if not preview:
            return SandboxResult(result={"stopped": 0}, activities=[SandboxActivity(event_type="preview.stopped", summary="No company preview was running")])
        self._terminate(preview[1])
        with self.lock:
            self.children.pop(preview[1].pid, None)
        return SandboxResult(result={"stopped": 1}, activities=[SandboxActivity(event_type="preview.stopped", summary="Stopped confined company preview")])

    def browser_snapshot(self, company_id: str, viewport: str) -> SandboxResult:
        if viewport not in {"desktop", "mobile"}:
            raise ValueError("Browser viewport is not permitted")
        preview = self.start_preview(company_id).result
        size = {"desktop": {"width": 1440, "height": 900}, "mobile": {"width": 375, "height": 812}}[viewport]
        script = (
            "import json, sys; from playwright.sync_api import sync_playwright; "
            "url=sys.argv[1]; width=int(sys.argv[2]); height=int(sys.argv[3]); "
            "p=sync_playwright().start(); b=p.chromium.launch(headless=True); page=b.new_page(viewport={'width':width,'height':height}); "
            "response=page.goto(url, wait_until='networkidle', timeout=15000); "
            "print(json.dumps({'status':response.status if response else 0,'title':page.title()[:200],'text':page.locator('body').inner_text()[:4000],'width':page.evaluate('document.documentElement.scrollWidth'),'clientWidth':page.evaluate('document.documentElement.clientWidth'),'overflow':page.evaluate('document.documentElement.scrollWidth>document.documentElement.clientWidth+8'),'viewport':width})); b.close(); p.stop()"
        )
        try:
            proc = subprocess.run([sys.executable, "-c", script, str(preview["url"]), str(size["width"]), str(size["height"])], cwd=self.workspace(company_id), stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=25, check=False)
            if proc.returncode != 0:
                raise ValueError("Browser QA is unavailable or the preview did not load")
            payload = __import__("json").loads(proc.stdout)
        except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
            if isinstance(exc, ValueError):
                raise
            raise ValueError("Browser QA is unavailable or the preview did not load") from exc
        if not isinstance(payload, dict) or int(payload.get("status", 0)) >= 400:
            raise ValueError("Browser QA could not load the preview")
        return SandboxResult(result=payload, activities=[SandboxActivity(event_type="browser.snapshot", summary=f"Captured {viewport} preview evidence")])

    def _terminate(self, proc: subprocess.Popen[str]) -> None:
        if proc.poll() is not None:
            return
        if os.name != "nt":
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                return
        else:
            proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()

    def stop_all(self, company_id: str | None = None) -> SandboxResult:
        # The HTTP command schema requires a company_id even for a global
        # stop. The local/cloud managers use the reserved runtime sentinel for
        # that case; generated company ids are always prefixed with `co_`.
        global_stop = company_id is None or company_id == "runtime"
        with self.lock:
            selected = [
                (pid, proc)
                for pid, (owner, proc) in self.children.items()
                if (global_stop or owner == company_id) and proc.poll() is None
            ]
            stale_ids = [
                pid
                for pid, (owner, proc) in self.children.items()
                if (global_stop or owner == company_id) and proc.poll() is not None
            ]
        for _, proc in selected:
            self._terminate(proc)
        with self.lock:
            # A preview has no worker thread whose finally block can remove its
            # child entry. Remove both newly stopped and already-stale entries
            # here, while guarding identity in case the OS recycled a PID.
            for pid, proc in selected:
                if self.children.get(pid, (None, None))[1] is proc:
                    self.children.pop(pid, None)
            for pid in stale_ids:
                self.children.pop(pid, None)
            for key, (_, proc) in list(self.previews.items()):
                if global_stop or key == company_id or proc.poll() is not None:
                    self.previews.pop(key, None)
        count = len(selected)
        return SandboxResult(result={"stopped": count}, activities=[SandboxActivity(event_type="sandbox.stopped", summary=f"Stopped {count} running child process(es)")])

    def destroy_workspace(self, company_id: str) -> SandboxResult:
        """Permanently remove one validated company workspace and its scoped children."""
        root = _canonical_path(self.workspace_root / company_id)
        if not _is_within(root, self.workspace_root) or root.parent != self.workspace_root:
            raise ValueError("Workspace deletion target is invalid")
        stopped = self.stop_all(company_id).result.get("stopped", 0)
        existed = root.exists()
        if existed:
            shutil.rmtree(root)
        return SandboxResult(
            result={"workspaceRemoved": existed, "stopped": stopped},
            activities=[SandboxActivity(event_type="workspace.destroyed", summary="Destroyed the company workspace")],
        )


def create_worker_app(workspace_root: Path | str | None = None) -> FastAPI:
    runtime = WorkerRuntime(workspace_root)
    app = FastAPI(title="orcha-worker", version=RUNTIME_VERSION)
    app.state.runtime = runtime

    @app.get("/health")
    def health():
        try:
            runtime.workspace_root.mkdir(parents=True, exist_ok=True)
        except OSError:
            return {"status": "starting", "runtimeVersion": RUNTIME_VERSION, "workspace": "unavailable"}
        return {"status": "ready", "runtimeVersion": RUNTIME_VERSION, "workspace": "ready"}

    @app.post("/execute", response_model=SandboxResult)
    def execute(command: SandboxCommand, x_orcha_worker_token: str | None = Header(default=None)):
        expected_token, required = _worker_auth_config()
        if required and not expected_token:
            # A shared worker must never silently downgrade to unauthenticated
            # execution because secret injection failed during deployment.
            raise HTTPException(status_code=503, detail="Worker authentication is not configured")
        if expected_token and not secrets.compare_digest(x_orcha_worker_token or "", expected_token):
            raise HTTPException(status_code=403, detail="Worker request is not authorized")
        return runtime.execute(command)

    return app


app = create_worker_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("orcha.worker.app:app", host="127.0.0.1", port=8765, reload=False)
