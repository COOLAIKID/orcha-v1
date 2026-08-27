from __future__ import annotations

import time
import json
import hashlib
import threading
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from orcha.api.app import create_app
from orcha.agents.runner import AgentBlocked, LocalAgentRunner
from orcha.domain.models import Agent, AgentMessage, AgentStatus, Artifact, Company, CompanyRun, CompanyStatus, HireState, Objective, Task, TeamId, team_snapshots
from orcha.feedback.service import FeedbackPayload, LocalFeedbackSink, make_feedback_record, sanitize_text
from orcha.models.gateway import EnvironmentModelGateway, ModelOutput
from orcha.persistence import SQLiteStateStore
from orcha.runtime.orchestrator import Orchestrator
from orcha.runtime.planner import ROLE_CAPABILITIES, RuntimePlanner
from orcha.runtime.policy import RuntimePolicy
from orcha.runtime.scheduler import PersistentScheduler
from orcha.sandbox.contracts import SandboxCommand, SandboxHealth, SandboxResult
from orcha.sandbox.cloud import CloudSandboxManager
from orcha.sandbox.local_wsl import LocalWslSandboxManager
from orcha.worker.app import WorkerRuntime, create_worker_app


class FakeSandbox:
    def __init__(self, status: str = "ready"):
        self.status = status
        self.writes: list[tuple[str, str, str]] = []
        self.files: dict[tuple[str, str], str] = {}
        self.stopped = False
        self.destroyed: list[str] = []
        self.reads: list[tuple[str, str]] = []

    def health(self):
        return SandboxHealth(status=self.status, runtime_version="test-worker", workspace="ready")

    def create_workspace(self, company_id):
        return SandboxResult()

    def execute(self, command):
        if command.action == "mkdir":
            return SandboxResult(result={"path": command.path})
        return self.write_file(command.company_id, command.path or "", command.content or "")

    def read_file(self, company_id, path):
        self.reads.append((company_id, path))
        return SandboxResult(result={"path": path, "content": self.files.get((company_id, path), "")})

    def write_file(self, company_id, path, content):
        self.writes.append((company_id, path, content))
        from orcha.sandbox.contracts import SandboxActivity
        from orcha.sandbox.line_stats import line_delta
        existed = (company_id, path) in self.files
        before = self.files.get((company_id, path))
        self.files[(company_id, path)] = content
        stats = line_delta(before, content)
        event_type = "file.changed" if existed else "file.created"
        verb = "Updated" if existed else "Created"
        return SandboxResult(
            result={"path": path, **stats},
            activities=[SandboxActivity(event_type=event_type, summary=f"{verb} {path}", data={"artifact": path, **stats})],
        )

    def list_files(self, company_id, path=None):
        prefix = f"{path.rstrip('/')}/" if path else ""
        return SandboxResult(result={"files": [file for saved_company, file in self.files if saved_company == company_id and file.startswith(prefix)]})

    def stop_all(self, company_id=None):
        self.stopped = True
        return SandboxResult(result={"stopped": 0})

    def destroy_workspace(self, company_id):
        self.destroyed.append(company_id)
        self.files = {(saved_company, path): content for (saved_company, path), content in self.files.items() if saved_company != company_id}
        return SandboxResult(result={"workspaceRemoved": True, "stopped": 0})

    def start_preview(self, company_id):
        return SandboxResult(result={"port": 8766, "url": "http://127.0.0.1:8766/"})

    def stop_preview(self, company_id):
        return SandboxResult(result={"stopped": 1})

    def browser_snapshot(self, company_id, viewport="desktop"):
        width = 375 if viewport == "mobile" else 1440
        viewport_width = 375 if viewport == "mobile" else 1440
        return SandboxResult(result={
            "status": 200,
            "title": "Preview",
            "text": self.files.get((company_id, "app/index.html"), ""),
            "width": width,
            "clientWidth": viewport_width,
            "viewport": viewport_width,
            "overflow": False,
        })


class FakeRuntime:
    def __init__(self):
        self.started: list[str] = []
        self.stopped: list[str] = []
        self.closed = False
        self.health_reads = 0

    def health(self):
        self.health_reads += 1
        return SandboxHealth(status="ready", provider="fake", runtime_version="fake-runtime", workspace="ready")

    def start_workspace_check(self, company):
        from orcha.runtime.local_runtime import RuntimeJob
        job = RuntimeJob(company_id=company.id, task_id="task_fake_workspace")
        self.started.append(company.id)
        return job

    def stop(self, company):
        self.stopped.append(company.id)
        return {"stopped": 0}

    def close(self):
        self.closed = True


class TaskControlScheduler:
    """Small scheduler seam for API control tests; no worker thread needed."""

    def __init__(self):
        self.starts = 0
        self.stops = 0
        self.in_flight: set[str] = set()

    def start(self):
        self.starts += 1

    def stop(self):
        self.stops += 1

    def task_is_in_flight(self, task_id: str):
        return task_id in self.in_flight


class FakeModelGateway:
    def __init__(self):
        self.prompts = []

    def is_available(self):
        return True

    def generate(self, system, prompt, max_tokens=None):
        assert "Orcha company" in system
        assert "Company objective:" in prompt
        self.prompts.append(prompt)
        if "static web-product slice" in system:
            return '{"summary":"Built a small first screen.","files":[{"path":"app/index.html","content":"<main>Ready</main>"}]}'
        return "# Work note\n\nEvidence: generated by the approved test gateway."


class BuildModelGateway(FakeModelGateway):
    def generate(self, system, prompt):
        self.prompts.append(prompt)
        if "static web-product slice" in system:
            return (
                '{"summary":"Built a small first screen.","files":['
                '{"path":"app/index.html","content":"<main>StudyFlow</main>"},'
                '{"path":"app/styles.css","content":"main { color: #111; }"},'
                '{"path":"../outside.txt","content":"blocked"}]}'
            )
        return "# Work note\n\nEvidence: generated by the approved test gateway."


class RevisionSandbox(FakeSandbox):
    def __init__(self):
        super().__init__()
        self.mobile_checks = 0

    def browser_snapshot(self, company_id, viewport="desktop"):
        if viewport == "mobile":
            self.mobile_checks += 1
            overflow = self.mobile_checks == 1
            width = 480 if overflow else 375
        else:
            overflow = False
            width = 1440
        viewport_width = 375 if viewport == "mobile" else 1440
        return SandboxResult(result={
            "status": 200,
            "title": "StudyFlow",
            "text": self.files.get((company_id, "app/index.html"), ""),
            "width": width,
            "clientWidth": viewport_width,
            "viewport": viewport_width,
            "overflow": overflow,
        })


class RevisionBuildGateway(BuildModelGateway):
    def generate(self, system, prompt):
        self.prompts.append(prompt)
        if "orchestration planner" in system:
            return "not valid planning JSON"
        if "static web-product slice" in system:
            return '{"summary":"Built a responsive StudyFlow landing page.","files":[{"path":"app/index.html","content":"<main><h1>StudyFlow</h1><button>Start learning</button></main>"}]}'
        return "# Work note\n\nEvidence: generated by the approved test gateway."


class SlowGateway(FakeModelGateway):
    def __init__(self):
        super().__init__()
        import threading
        self.started = threading.Event()
        self.release = threading.Event()

    def generate(self, system, prompt):
        if "orchestration planner" in system:
            return "not valid planning JSON"
        self.started.set()
        self.release.wait(2)
        return "# Work note\n\nEvidence: late output."


class BlockingPlannerGateway:
    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()

    def is_available(self):
        return True

    def generate(self, system, prompt, max_tokens=None):
        if "orchestration planner" in system:
            self.started.set()
            self.release.wait(4)
            return "not valid planning JSON"
        return "# Work note\n\nEvidence: generated after the plan."


class StructuredPlanGateway:
    def is_available(self):
        return True

    def generate(self, system, prompt):
        return ModelOutput(
            '{"summary":"A small valid plan.","tasks":['
            '{"key":"research","role":"research","title":"Research audience","instruction":"Identify the audience.","depends_on":[],"acceptance_criteria":["Audience is explicit"]},'
            '{"key":"engineering","role":"engineering","title":"Build page","instruction":"Build the static page.","depends_on":["research"],"acceptance_criteria":["Page loads"]},'
            '{"key":"qa","role":"qa","title":"Check page","instruction":"Verify the page.","depends_on":["engineering"],"acceptance_criteria":["Mobile is checked"]}]}' ,
            "fallback", "free-model", fallback_from="primary"
        )


def worker(tmp_path: Path) -> TestClient:
    return TestClient(create_worker_app(tmp_path / "workspaces"))


def test_worker_health_and_workspace_files(tmp_path):
    client = worker(tmp_path)
    assert client.get("/health").json()["status"] == "ready"
    write = client.post("/execute", json={"company_id": "co_test", "action": "write_file", "path": "test.txt", "content": "hello from orcha"})
    assert write.status_code == 200
    assert write.json()["activities"][0]["event_type"] == "file.created"
    same = client.post("/execute", json={"company_id": "co_test", "action": "write_file", "path": "test.txt", "content": "hello from orcha"})
    assert same.status_code == 200
    assert same.json()["result"]["unchanged"] is True
    assert same.json()["activities"] == []
    read = client.post("/execute", json={"company_id": "co_test", "action": "read_file", "path": "test.txt"})
    assert read.json()["result"]["content"] == "hello from orcha"
    listed = client.post("/execute", json={"company_id": "co_test", "action": "list_files"})
    assert listed.json()["result"]["files"] == ["test.txt"]
    large = client.post("/execute", json={"company_id": "co_test", "action": "write_file", "path": "large.txt", "content": "x" * 70_000})
    assert large.status_code == 200
    bounded = client.post("/execute", json={"company_id": "co_test", "action": "read_file", "path": "large.txt"})
    assert bounded.status_code == 200
    assert len(bounded.json()["result"]["content"]) == 64_000


def test_worker_rejects_path_escape_and_limits_commands(tmp_path):
    client = worker(tmp_path)
    escaped = client.post("/execute", json={"company_id": "co_test", "action": "write_file", "path": "../../outside.txt", "content": "no"})
    assert escaped.status_code == 400
    assert client.post("/execute", json={"company_id": "co_test", "action": "run", "args": ["pwd"]}).json()["ok"] is True
    assert client.post("/execute", json={"company_id": "co_test", "action": "run", "args": ["false"]}).json()["ok"] is False
    assert client.post("/execute", json={"company_id": "co_test", "action": "run", "args": ["rm", "-rf", "/"]}).status_code == 400
    timeout = client.post("/execute", json={"company_id": "co_test", "action": "run", "args": ["wait", "2"], "timeout_seconds": 1})
    assert timeout.status_code == 400
    stopped = client.post("/execute", json={"company_id": "co_test", "action": "stop_all"})
    assert stopped.json()["activities"][0]["event_type"] == "sandbox.stopped"


def test_worker_run_activity_includes_observed_stdout(tmp_path):
    client = worker(tmp_path)
    ran = client.post("/execute", json={"company_id": "co_test", "action": "run", "args": ["pwd"]}).json()
    completed = next(item for item in ran["activities"] if item["event_type"] == "command.completed")
    assert completed["data"]["command"] == "pwd"
    assert completed["data"]["exitCode"] == 0
    assert completed["data"]["stdout"]



def test_worker_stop_all_terminates_a_tracked_process_group(tmp_path):
    runtime = WorkerRuntime(tmp_path / "workspaces")
    command = SandboxCommand(company_id="co_stop", action="run", args=["wait", "30"], timeout_seconds=30)
    result_holder = {}

    def execute():
        result_holder["result"] = runtime.execute(command)

    thread = threading.Thread(target=execute)
    thread.start()
    for _ in range(100):
        with runtime.lock:
            if runtime.children:
                break
        time.sleep(0.01)
    stopped = runtime.stop_all("co_stop")
    thread.join(timeout=3)

    assert stopped.result["stopped"] == 1
    assert not thread.is_alive()
    assert result_holder["result"].ok is False
    assert runtime.children == {}


def test_worker_runtime_sentinel_stops_children_from_every_company(tmp_path):
    runtime = WorkerRuntime(tmp_path / "workspaces")
    commands = [
        SandboxCommand(company_id="co_first", action="run", args=["wait", "30"], timeout_seconds=30),
        SandboxCommand(company_id="co_second", action="run", args=["wait", "30"], timeout_seconds=30),
    ]
    results = []

    threads = [
        threading.Thread(target=lambda command=command: results.append(runtime.execute(command)))
        for command in commands
    ]
    for thread in threads:
        thread.start()
    for _ in range(100):
        with runtime.lock:
            if len(runtime.children) == 2:
                break
        time.sleep(0.01)

    stopped = runtime.stop_all("runtime")
    for thread in threads:
        thread.join(timeout=3)

    assert stopped.result["stopped"] == 2
    assert all(not thread.is_alive() for thread in threads)
    assert len(results) == 2
    assert all(result.ok is False for result in results)
    assert runtime.children == {}


def test_worker_starts_and_stops_a_private_static_preview(tmp_path):
    client = worker(tmp_path)
    assert client.post("/execute", json={"company_id": "co_preview", "action": "write_file", "path": "app/index.html", "content": "<h1>StudyFlow</h1>"}).status_code == 200
    preview = client.post("/execute", json={"company_id": "co_preview", "action": "preview_start"})
    assert preview.status_code == 200
    assert preview.json()["result"]["url"].startswith("http://127.0.0.1:")
    stopped = client.post("/execute", json={"company_id": "co_preview", "action": "preview_stop"})
    assert stopped.json()["result"]["stopped"] == 1


def test_worker_global_stop_clears_a_confined_preview_bookkeeping(tmp_path):
    runtime = WorkerRuntime(tmp_path / "workspaces")
    runtime.execute(SandboxCommand(company_id="co_preview", action="write_file", path="app/index.html", content="<h1>StudyFlow</h1>"))
    preview = runtime.start_preview("co_preview")
    assert preview.result["url"].startswith("http://127.0.0.1:")
    assert runtime.children
    assert runtime.previews

    stopped = runtime.stop_all("runtime")

    assert stopped.result["stopped"] == 1
    assert runtime.children == {}
    assert runtime.previews == {}
    assert runtime.stop_all("runtime").result["stopped"] == 0


def test_worker_destroys_only_the_confirmed_company_workspace(tmp_path):
    client = worker(tmp_path)
    for company_id in ("co_keep", "co_delete"):
        response = client.post("/execute", json={"company_id": company_id, "action": "write_file", "path": "artifact.txt", "content": company_id})
        assert response.status_code == 200
    destroyed = client.post("/execute", json={"company_id": "co_delete", "action": "destroy_workspace"})
    assert destroyed.status_code == 200
    assert destroyed.json()["result"]["workspaceRemoved"] is True
    assert not (tmp_path / "workspaces" / "co_delete").exists()
    kept = client.post("/execute", json={"company_id": "co_keep", "action": "read_file", "path": "artifact.txt"})
    assert kept.json()["result"]["content"] == "co_keep"


def test_worker_can_require_a_private_control_plane_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCHA_WORKER_AUTH_TOKEN", "worker-test-token")
    client = worker(tmp_path)
    payload = {"company_id": "co_test", "action": "write_file", "path": "safe.txt", "content": "safe"}
    assert client.post("/execute", json=payload).status_code == 403
    assert client.post("/execute", json=payload, headers={"X-Orcha-Worker-Token": "worker-test-token"}).status_code == 200


def test_worker_shared_mode_fails_closed_when_secret_injection_is_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCHA_REQUIRE_WORKER_AUTH", "true")
    monkeypatch.delenv("ORCHA_WORKER_AUTH_TOKEN", raising=False)
    client = worker(tmp_path)
    payload = {"company_id": "co_test", "action": "write_file", "path": "safe.txt", "content": "safe"}

    assert client.get("/health").json()["status"] == "ready"
    response = client.post("/execute", json=payload)

    assert response.status_code == 503
    assert response.json()["detail"] == "Worker authentication is not configured"

    monkeypatch.setenv("ORCHA_WORKER_AUTH_TOKEN", "worker-test-token")
    assert client.post("/execute", json=payload).status_code == 403
    assert client.post("/execute", json=payload, headers={"X-Orcha-Worker-Token": "worker-test-token"}).status_code == 200


def test_api_readiness_probe_requires_the_workspace_provider(tmp_path):
    api = TestClient(create_app(
        sandbox=FakeSandbox("offline"),
        scheduler=TaskControlScheduler(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "readiness.db",
    ))

    assert api.get("/health").json() == {"status": "ok", "service": "orcha-api"}
    response = api.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
    assert response.json()["worker"]["status"] == "offline"


def test_api_readiness_probe_is_ready_without_a_model_provider(tmp_path):
    api = TestClient(create_app(
        sandbox=FakeSandbox("ready"),
        scheduler=TaskControlScheduler(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "ready.db",
    ))

    response = api.get("/health/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert response.json()["worker"]["status"] == "ready"


def test_api_readiness_probe_rejects_a_stranded_scheduler(tmp_path):
    class OfflineScheduler(TaskControlScheduler):
        def health(self):
            return {"status": "offline", "thread": "stopped", "activeTasks": 0, "activeCompanies": 0}

    api = TestClient(create_app(
        sandbox=FakeSandbox("ready"),
        scheduler=OfflineScheduler(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "scheduler-not-ready.db",
    ))

    response = api.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
    assert response.json()["worker"]["status"] == "ready"
    assert response.json()["scheduler"]["status"] == "offline"


def test_cloud_sandbox_manager_uses_the_same_typed_worker_contract():
    def worker_protocol(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "ready", "runtimeVersion": "test-cloud", "workspace": "ready"})
        assert request.url.path == "/execute"
        body = request.read().decode()
        assert '"action":"write_file"' in body
        return httpx.Response(200, json={"ok": True, "result": {"path": "artifact.md"}, "activities": [{"event_type": "file.created", "summary": "Created artifact.md"}]})

    manager = CloudSandboxManager(client=httpx.Client(transport=httpx.MockTransport(worker_protocol), base_url="http://worker:8765"))
    assert manager.health().provider == "cloud"
    result = manager.write_file("co_test", "artifact.md", "hello")
    assert result.activities[0].event_type == "file.created"


def test_cloud_sandbox_manager_forwards_the_private_worker_token(monkeypatch):
    monkeypatch.setenv("ORCHA_WORKER_AUTH_TOKEN", "cloud-worker-token")

    def worker_protocol(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/health"
        assert request.headers["x-orcha-worker-token"] == "cloud-worker-token"
        return httpx.Response(200, json={"status": "ready", "workspace": "ready"})

    manager = CloudSandboxManager(client=httpx.Client(
        transport=httpx.MockTransport(worker_protocol),
        base_url="http://worker:8765",
    ))
    assert manager.health().status == "ready"


def test_cloud_sandbox_manager_readiness_fails_closed_without_required_auth(monkeypatch):
    monkeypatch.setenv("ORCHA_REQUIRE_WORKER_AUTH", "true")
    monkeypatch.delenv("ORCHA_WORKER_AUTH_TOKEN", raising=False)

    def worker_protocol(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("required-auth readiness must fail before probing the worker")

    manager = CloudSandboxManager(client=httpx.Client(
        transport=httpx.MockTransport(worker_protocol),
        base_url="http://worker:8765",
    ))
    health = manager.health()
    assert health.status == "offline"
    assert health.workspace == "unavailable"
    assert health.detail == "Worker authentication is not configured"


def test_cloud_sandbox_manager_preserves_explicit_worker_offline_health():
    def worker_protocol(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/health"
        return httpx.Response(200, json={
            "status": "offline",
            "runtime_version": "test-cloud",
            "workspace": "unavailable",
            "detail": "Worker is draining",
        })

    manager = CloudSandboxManager(client=httpx.Client(
        transport=httpx.MockTransport(worker_protocol),
        base_url="http://worker:8765",
    ))
    health = manager.health()
    assert health.status == "offline"
    assert health.runtime_version == "test-cloud"
    assert health.detail == "Worker is draining"


def test_cloud_sandbox_manager_closes_injected_client_idempotently():
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200)))
    manager = CloudSandboxManager(client=client)

    manager.close()
    manager.close()

    assert client.is_closed
    assert manager.health().status == "offline"


def test_cloud_sandbox_manager_owns_and_closes_a_default_client():
    manager = CloudSandboxManager(base_url="http://worker:8765")
    client = manager._client
    assert client is not None and client.is_closed is False

    manager.close()

    assert client.is_closed is True
    assert manager._client is None


def test_local_wsl_manager_forwards_the_private_worker_token(monkeypatch):
    monkeypatch.setenv("ORCHA_WORKER_AUTH_TOKEN", "worker-test-token")

    def worker_protocol(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-orcha-worker-token"] == "worker-test-token"
        return httpx.Response(200, json={"ok": True, "result": {"path": "safe.txt"}, "activities": []})

    manager = LocalWslSandboxManager(client=httpx.Client(transport=httpx.MockTransport(worker_protocol), base_url="http://127.0.0.1:8765"))
    assert manager.write_file("co_test", "safe.txt", "safe").ok is True


def test_local_wsl_bridge_does_not_put_the_worker_token_in_process_args(monkeypatch):
    import orcha.sandbox.local_wsl as local_wsl
    from types import SimpleNamespace

    monkeypatch.setenv("ORCHA_WORKER_AUTH_TOKEN", "worker-test-token")
    monkeypatch.setattr(local_wsl.os, "name", "nt")
    observed = {}

    def fake_run(command, **kwargs):
        observed["command"] = command
        observed["env"] = kwargs["env"]
        observed["input"] = kwargs["input"]
        return SimpleNamespace(returncode=0, stdout='{"status":"ready","runtimeVersion":"bridge-worker","workspace":"ready"}')

    monkeypatch.setattr(local_wsl.subprocess, "run", fake_run)
    manager = LocalWslSandboxManager(base_url="http://127.0.0.1:8765")
    body = manager._request("GET", "/health")

    assert body["status"] == "ready"
    assert "worker-test-token" not in observed["command"]
    assert observed["input"] == ""
    assert observed["env"]["ORCHA_WORKER_BRIDGE_TOKEN"] == "worker-test-token"
    assert observed["env"]["PATH"].endswith("System32")
    assert "ORCHA_WORKER_AUTH_TOKEN" not in observed["env"]


def test_local_wsl_bridge_keeps_write_payload_out_of_process_args(monkeypatch):
    import orcha.sandbox.local_wsl as local_wsl
    from types import SimpleNamespace

    monkeypatch.setattr(local_wsl.os, "name", "nt")
    observed = {}

    def fake_run(command, **kwargs):
        observed["command"] = command
        observed["input"] = kwargs["input"]
        return SimpleNamespace(returncode=0, stdout='{"ok":true,"result":{},"activities":[]}')

    monkeypatch.setattr(local_wsl.subprocess, "run", fake_run)
    manager = LocalWslSandboxManager(base_url="http://127.0.0.1:8765")
    manager.write_file("co_test", "private.txt", "private workspace content")

    command_text = " ".join(str(part) for part in observed["command"])
    assert "private workspace content" not in command_text
    assert '"private.txt"' not in command_text
    assert "private.txt" in observed["input"]
    assert "private workspace content" in observed["input"]


def test_local_wsl_manager_rejects_a_remote_worker_url():
    try:
        LocalWslSandboxManager(base_url="http://worker.internal:8765")
    except ValueError as exc:
        assert "127.0.0.1:8765" in str(exc)
    else:
        raise AssertionError("The local WSL provider must reject remote worker URLs")


def test_local_wsl_manager_closes_injected_client_idempotently():
    client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200)))
    manager = LocalWslSandboxManager(client=client, base_url="http://127.0.0.1:8765")

    manager.close()
    manager.close()

    assert client.is_closed
    assert manager.health().status == "offline"


def test_local_wsl_health_uses_a_loopback_fast_path_without_exposing_tokens(monkeypatch):
    from types import SimpleNamespace
    import orcha.sandbox.local_wsl as local_wsl

    monkeypatch.setattr(local_wsl.os, "name", "nt")
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0, stdout='{"status":"ready","runtimeVersion":"fast-worker","workspace":"ready"}')

    monkeypatch.setattr(local_wsl.subprocess, "run", fake_run)
    manager = local_wsl.LocalWslSandboxManager(base_url="http://127.0.0.1:8765")
    health = manager.health()

    assert health.status == "ready"
    assert health.runtime_version == "fast-worker"
    assert calls[0][0][0] == "curl.exe"
    assert "--noproxy" in calls[0][0]
    assert calls[0][1]["timeout"] == 3


def test_local_wsl_health_returns_starting_while_the_bridge_refreshes(monkeypatch):
    import orcha.sandbox.local_wsl as local_wsl

    monkeypatch.setattr(local_wsl.os, "name", "nt")
    monkeypatch.setattr(
        local_wsl.subprocess,
        "run",
        lambda *args, **kwargs: type("Result", (), {"returncode": 7, "stdout": ""})(),
    )
    manager = local_wsl.LocalWslSandboxManager(base_url="http://127.0.0.1:8765")
    manager._request = lambda *args, **kwargs: {"status": "ready", "runtimeVersion": "bridge-worker", "workspace": "ready"}

    first = manager.health()
    assert first.status == "starting"
    for _ in range(20):
        if manager.health().status == "ready":
            break
        time.sleep(0.01)
    assert manager.health().runtime_version == "bridge-worker"
    # Once the bridge has proved the worker is ready, a host without the
    # Windows localhost forwarder should not report perpetual ``starting`` on
    # every health poll.
    assert manager.health().status == "ready"
    manager.close()


def test_local_wsl_health_does_not_hide_a_worker_that_left_after_ready(monkeypatch):
    from threading import Event
    from types import SimpleNamespace
    import orcha.sandbox.local_wsl as local_wsl

    monkeypatch.setattr(local_wsl.os, "name", "nt")
    fast_calls = 0

    def fake_run(command, **kwargs):
        nonlocal fast_calls
        fast_calls += 1
        if fast_calls == 1:
            return SimpleNamespace(returncode=0, stdout='{"status":"ready","runtimeVersion":"fast-worker","workspace":"ready"}')
        return SimpleNamespace(returncode=7, stdout="")

    probe_started = Event()
    release_probe = Event()

    monkeypatch.setattr(local_wsl.subprocess, "run", fake_run)
    manager = local_wsl.LocalWslSandboxManager(base_url="http://127.0.0.1:8765")

    def bridge_probe(*args, **kwargs):
        probe_started.set()
        release_probe.wait(1)
        return {"status": "offline", "runtimeVersion": "fast-worker", "workspace": "unavailable"}

    manager._request = bridge_probe
    assert manager.health().status == "ready"
    second = manager.health()
    assert second.status == "starting"
    assert probe_started.wait(1)
    release_probe.set()
    for _ in range(30):
        if manager.health().status == "offline":
            break
        time.sleep(0.01)
    assert manager.health().status == "offline"
    manager.close()


def test_gemini_agent_gateway_stays_server_side_and_returns_usage(monkeypatch):
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "gemini")
    monkeypatch.setenv("ORCHA_AGENT_MODEL", "gemini-test")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    def gemini_protocol(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/models/gemini-test:generateContent")
        assert request.url.params["key"] == "test-key"
        body = request.read().decode()
        assert "systemInstruction" in body
        return httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": "# Product note"}]}}],
            "usageMetadata": {"promptTokenCount": 12, "candidatesTokenCount": 34},
        })

    gateway = EnvironmentModelGateway(client=httpx.Client(transport=httpx.MockTransport(gemini_protocol)))
    output = gateway.generate("system", "prompt")
    assert output.provider == "gemini"
    assert output.content == "# Product note"
    assert (output.input_tokens, output.output_tokens) == (12, 34)


def test_gateway_falls_back_when_the_first_configured_provider_rejects(monkeypatch):
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "openrouter")
    monkeypatch.setenv("ORCHA_AGENT_FALLBACK_PROVIDERS", "groq")
    monkeypatch.setenv("ORCHA_AGENT_MODEL", "test-model")
    monkeypatch.setenv("OPENROUTER_API_KEY", "first-key")
    monkeypatch.setenv("GROQ_API_KEY", "second-key")

    def protocol(request: httpx.Request) -> httpx.Response:
        if "openrouter" in request.url.host:
            return httpx.Response(429, json={"error": "rate limited"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "fallback answer"}}], "usage": {"prompt_tokens": 3, "completion_tokens": 4}})

    output = EnvironmentModelGateway(client=httpx.Client(transport=httpx.MockTransport(protocol))).generate("system", "prompt")
    assert (output.provider, output.fallback_from, output.content) == ("groq", "openrouter", "fallback answer")


def test_gateway_close_releases_clients_without_allocating_a_replacement(monkeypatch):
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "openrouter")
    monkeypatch.setenv("ORCHA_AGENT_MODEL", "close-test-model")
    monkeypatch.setenv("OPENROUTER_API_KEY", "close-test-key")
    shared = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200)))
    created_scoped = []

    def scoped_factory():
        client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200)))
        created_scoped.append(client)
        return client

    gateway = EnvironmentModelGateway(client=shared, scoped_client_factory=scoped_factory)
    gateway.close()
    gateway.close()

    assert shared.is_closed
    assert created_scoped == []


def test_gateway_supports_provider_specific_models_in_a_fallback_chain(monkeypatch):
    monkeypatch.delenv("ORCHA_AGENT_MODEL", raising=False)
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "openrouter")
    monkeypatch.setenv("ORCHA_AGENT_FALLBACK_PROVIDERS", "groq")
    monkeypatch.setenv("ORCHA_AGENT_OPENROUTER_MODEL", "router-free-model")
    monkeypatch.setenv("ORCHA_AGENT_GROQ_MODEL", "groq-free-model")
    monkeypatch.setenv("OPENROUTER_API_KEY", "first-key")
    monkeypatch.setenv("GROQ_API_KEY", "second-key")
    seen_models = []

    def protocol(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.read().decode())
        seen_models.append(payload["model"])
        if "openrouter" in request.url.host:
            return httpx.Response(429, json={"error": "rate limited"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "provider-specific fallback"}}]})

    output = EnvironmentModelGateway(client=httpx.Client(transport=httpx.MockTransport(protocol))).generate("system", "prompt")
    assert output.provider == "groq"
    assert seen_models == ["router-free-model", "groq-free-model"]


def test_gateway_falls_through_a_temporary_key_pool_without_changing_provider(monkeypatch):
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "openrouter")
    monkeypatch.setenv("ORCHA_AGENT_OPENROUTER_MODEL", "router-free-model")
    monkeypatch.setenv("OPENROUTER_API_KEYS", "expired-key, live-key, live-key")
    seen_keys = []

    def protocol(request: httpx.Request) -> httpx.Response:
        key = request.headers["authorization"]
        seen_keys.append(key)
        if key.endswith("expired-key"):
            return httpx.Response(429, json={"error": "rate limited"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "pool answer"}}]})

    gateway = EnvironmentModelGateway(client=httpx.Client(transport=httpx.MockTransport(protocol)))
    output = gateway.generate("system", "prompt")

    assert output.provider == "openrouter"
    assert output.fallback_from is None
    assert output.content == "pool answer"
    assert seen_keys == ["Bearer expired-key", "Bearer live-key"]


def test_gateway_cools_down_a_failed_pool_key_for_the_next_agent_call(monkeypatch):
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "openrouter")
    monkeypatch.setenv("ORCHA_AGENT_OPENROUTER_MODEL", "router-free-model")
    monkeypatch.setenv("OPENROUTER_API_KEYS", "expired-key, live-key")
    monkeypatch.setenv("ORCHA_AGENT_KEY_COOLDOWN_SECONDS", "60")
    seen_keys = []

    def protocol(request: httpx.Request) -> httpx.Response:
        key = request.headers["authorization"]
        seen_keys.append(key)
        if key.endswith("expired-key"):
            return httpx.Response(401, json={"error": "expired"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "pool answer"}}]})

    gateway = EnvironmentModelGateway(client=httpx.Client(transport=httpx.MockTransport(protocol)))
    assert gateway.generate("system", "first").content == "pool answer"
    assert gateway.generate("system", "second").content == "pool answer"

    assert seen_keys == ["Bearer expired-key", "Bearer live-key", "Bearer live-key"]


def test_gateway_keeps_original_fallback_label_when_preferred_key_is_cooling(monkeypatch):
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "openrouter")
    monkeypatch.setenv("ORCHA_AGENT_FALLBACK_PROVIDERS", "groq")
    monkeypatch.setenv("ORCHA_AGENT_MODEL", "shared-free-model")
    monkeypatch.setenv("OPENROUTER_API_KEY", "expired-key")
    monkeypatch.setenv("GROQ_API_KEY", "live-key")
    monkeypatch.setenv("ORCHA_AGENT_KEY_COOLDOWN_SECONDS", "60")
    seen_hosts = []

    def protocol(request: httpx.Request) -> httpx.Response:
        seen_hosts.append(request.url.host)
        if "openrouter" in request.url.host:
            return httpx.Response(401, json={"error": "expired"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "fallback answer"}}]})

    gateway = EnvironmentModelGateway(client=httpx.Client(transport=httpx.MockTransport(protocol)))
    first = gateway.generate("system", "first")
    second = gateway.generate("system", "second")

    assert first.fallback_from == "openrouter"
    assert second.fallback_from == "openrouter"
    assert seen_hosts == ["openrouter.ai", "api.groq.com", "api.groq.com"]


def test_gateway_skips_malformed_primary_response_and_uses_fallback(monkeypatch):
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "openrouter")
    monkeypatch.setenv("ORCHA_AGENT_FALLBACK_PROVIDERS", "groq")
    monkeypatch.setenv("ORCHA_AGENT_MODEL", "shared-test-model")
    monkeypatch.setenv("OPENROUTER_API_KEY", "first-key")
    monkeypatch.setenv("GROQ_API_KEY", "second-key")

    def protocol(request: httpx.Request) -> httpx.Response:
        if "openrouter" in request.url.host:
            return httpx.Response(200, text="not-json", headers={"content-type": "application/json"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "recovered answer"}}]})

    output = EnvironmentModelGateway(client=httpx.Client(transport=httpx.MockTransport(protocol))).generate("system", "prompt")
    assert (output.provider, output.fallback_from, output.content) == ("groq", "openrouter", "recovered answer")


def test_gateway_cancellation_does_not_fall_back_after_an_inflight_request(monkeypatch):
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "openrouter")
    monkeypatch.setenv("ORCHA_AGENT_FALLBACK_PROVIDERS", "groq")
    monkeypatch.setenv("ORCHA_AGENT_MODEL", "shared-test-model")
    monkeypatch.setenv("OPENROUTER_API_KEY", "first-key")
    monkeypatch.setenv("GROQ_API_KEY", "second-key")
    entered = threading.Event()
    release = threading.Event()
    seen_hosts: list[str] = []

    def protocol(request: httpx.Request) -> httpx.Response:
        seen_hosts.append(request.url.host)
        entered.set()
        release.wait(2)
        return httpx.Response(200, json={"choices": [{"message": {"content": "late answer"}}]})

    gateway = EnvironmentModelGateway(client=httpx.Client(transport=httpx.MockTransport(protocol)))
    result: list[Exception] = []

    def request() -> None:
        try:
            gateway.generate("system", "prompt")
        except Exception as exc:
            result.append(exc)

    worker_thread = threading.Thread(target=request)
    worker_thread.start()
    assert entered.wait(1)
    gateway.cancel()
    release.set()
    worker_thread.join(2)

    assert not worker_thread.is_alive()
    assert result and "stopped by the owner" in str(result[0])
    assert seen_hosts == ["openrouter.ai"]


def test_gateway_scoped_cancellation_only_stops_matching_company(monkeypatch):
    monkeypatch.setenv("ORCHA_AGENT_PROVIDER", "openrouter")
    monkeypatch.setenv("ORCHA_AGENT_MODEL", "shared-test-model")
    monkeypatch.setenv("OPENROUTER_API_KEY", "first-key")
    entered = {scope: threading.Event() for scope in ("company-a", "company-b")}
    release = {scope: threading.Event() for scope in ("company-a", "company-b")}
    errors: dict[str, Exception] = {}
    outputs = {}

    def protocol(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode())
        scope = payload["messages"][1]["content"]
        entered[scope].set()
        release[scope].wait(2)
        return httpx.Response(200, json={"choices": [{"message": {"content": f"answer for {scope}"}}]})

    gateway = EnvironmentModelGateway(
        scoped_client_factory=lambda: httpx.Client(transport=httpx.MockTransport(protocol))
    )

    def request(scope: str) -> None:
        try:
            outputs[scope] = gateway.generate("system", scope, cancellation_scope=scope)
        except Exception as exc:
            errors[scope] = exc

    threads = [threading.Thread(target=request, args=(scope,)) for scope in entered]
    for thread in threads:
        thread.start()
    assert all(event.wait(1) for event in entered.values())

    gateway.cancel(scope="company-a")
    release["company-a"].set()
    release["company-b"].set()
    for thread in threads:
        thread.join(2)

    assert all(not thread.is_alive() for thread in threads)
    assert "stopped by the owner" in str(errors["company-a"])
    assert outputs["company-b"].content == "answer for company-b"


def test_model_planner_creates_dependency_order_and_records_its_fallback(tmp_path):
    store = SQLiteStateStore(tmp_path / "plan.db")
    company = Company(name="Plan", goal="Build a tutoring landing page", objective=Objective(statement="Build a tutoring landing page"))
    store.save_company(company)
    tasks = Orchestrator(store, StructuredPlanGateway()).plan(company, "run_plan")
    by_role = {task.role: task for task in tasks}
    assert by_role["engineering"].depends_on == [by_role["research"].id]
    assert by_role["qa"].depends_on == [by_role["engineering"].id]
    assert "model.fallback" in [event.event_type for event in store.list(company.id)]


def test_model_planner_falls_back_for_duplicate_or_cyclic_dependency_graphs():
    class InvalidPlanGateway:
        def __init__(self, tasks):
            self.tasks = tasks

        def is_available(self):
            return True

        def generate(self, system, prompt):
            return json.dumps({"summary": "Unsafe plan", "tasks": self.tasks})

    def task(key, depends_on):
        return {
            "key": key,
            "role": "product",
            "title": f"Task {key}",
            "instruction": "Do the bounded task.",
            "depends_on": depends_on,
            "acceptance_criteria": ["Evidence is recorded"],
        }

    for invalid_tasks in (
        [task("same", []), task("same", [])],
        [task("first", ["second"]), task("second", ["first"])],
    ):
        result = RuntimePlanner(InvalidPlanGateway(invalid_tasks)).create("Build a safe product")
        assert result.source == "fallback_invalid"
        assert len(result.plan.tasks) >= 1


def test_model_planner_can_hire_bounded_business_specialist():
    class BusinessPlanGateway:
        def is_available(self):
            return True

        def generate(self, system, prompt):
            assert "business" in system
            return ModelOutput(
                '{"summary":"Internal pricing review.","tasks":[{"key":"business","role":"business","title":"Review pricing assumptions","instruction":"Review internal pricing assumptions and open questions.","depends_on":[],"acceptance_criteria":["Assumptions are explicit"]}]}',
                "test",
                "business-model",
            )

    result = RuntimePlanner(BusinessPlanGateway()).create("Review pricing assumptions")

    assert result.source == "model"
    assert result.plan.tasks[0].role == "business"
    assert ROLE_CAPABILITIES["business"] == ["workspace.read_file"]


def test_team_snapshot_does_not_present_unhired_specialist_as_active():
    proposed = Agent(
        id="agent_proposed_business",
        company_id="co_team",
        role="business",
        objective="Review internal constraints",
        hired=HireState.proposed,
        status=AgentStatus.working,
    )

    teams = {team.id: team for team in team_snapshots([proposed])}

    assert teams[TeamId.business].status.value == "empty"
    assert teams[TeamId.business].hired_count == 0


def test_agent_runner_records_a_provider_fallback_event(tmp_path):
    store = SQLiteStateStore(tmp_path / "fallback.db")
    sandbox = FakeSandbox()
    company = Company(name="Fallback", goal="Build a safe note", status=CompanyStatus.running, objective=Objective(statement="Build a safe note"))
    task = Task(company_id=company.id, role="product", title="Write product note", instruction="Write the product note")
    store.save_company(company)
    store.save_task(task)

    class FallbackGateway:
        def is_available(self): return True
        def generate(self, system, prompt): return ModelOutput("# Product note", "groq", "free", fallback_from="openrouter")

    LocalAgentRunner(store, store, sandbox, FallbackGateway(), RuntimePolicy(store)).execute(company, task)
    assert "model.fallback" in [event.event_type for event in store.list(company.id)]


def test_agent_runner_fails_closed_when_a_typed_tool_returns_not_ok(tmp_path):
    store = SQLiteStateStore(tmp_path / "tool-failure.db")
    company = Company(name="Tool failure", goal="Build a safe note", status=CompanyStatus.running, objective=Objective(statement="Build a safe note"))
    task = Task(company_id=company.id, role="product", title="Inspect the source", instruction="Inspect the source", capabilities=["workspace.read_file"])
    store.save_company(company)
    store.save_task(task)

    class FailedToolGateway:
        def is_available(self): return True
        def generate(self, system, prompt):
            return ModelOutput('{"tool":"workspace.read_file","arguments":{"path":"missing.md"}}', "test", "tool-failure")

    class FailedToolSandbox(FakeSandbox):
        def read_file(self, company_id, path):
            return SandboxResult(ok=False, result={})

    runner = LocalAgentRunner(store, store, FailedToolSandbox(), FailedToolGateway(), RuntimePolicy(store))
    try:
        runner.execute(company, task)
    except RuntimeError as exc:
        assert "failed" in str(exc).lower()
    else:
        raise AssertionError("a failed typed tool must not produce a completed specialist task")

    assert store.get_task(task.id).status == "running"
    tool_event = next(
        event
        for event in store.list(company.id)
        if event.event_type == "tool.completed" and event.data.get("tool") == "workspace.read_file"
    )
    assert tool_event.data["ok"] is False


def test_agent_runner_marks_a_denied_typed_tool_as_resumable_blocked(tmp_path):
    store = SQLiteStateStore(tmp_path / "tool-denied.db")
    company = Company(name="Tool denied", goal="Build a safe note", status=CompanyStatus.running, objective=Objective(statement="Build a safe note"))
    task = Task(company_id=company.id, role="product", title="Write the note", instruction="Write the note", capabilities=["workspace.read_file"])
    store.save_company(company)
    store.save_task(task)

    class DeniedToolGateway:
        def is_available(self): return True
        def generate(self, system, prompt):
            return ModelOutput('{"tool":"workspace.write_file","arguments":{"path":"note.md","content":"not allowed"}}', "test", "tool-denied")

    runner = LocalAgentRunner(store, store, FakeSandbox(), DeniedToolGateway(), RuntimePolicy(store))
    try:
        runner.execute(company, task)
    except AgentBlocked as exc:
        assert "not permitted" in str(exc)
    else:
        raise AssertionError("a denied typed tool must block the specialist task")

    blocked = store.get_task(task.id)
    assert blocked is not None and blocked.status == "blocked"
    assert store.get_agent(blocked.agent_id or "").status.value == "blocked"
    assert any(event.event_type == "tool.denied" for event in store.list(company.id))


def test_qa_failure_creates_one_real_revision_and_recheck(tmp_path):
    sandbox = RevisionSandbox()
    api = TestClient(create_app(sandbox=sandbox, feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), database_path=tmp_path / "revision.db", model_gateway=RevisionBuildGateway()))
    company = api.post("/v1/companies", json={"name": "StudyFlow", "goal": "Build a tutoring landing page"}).json()["company"]
    run = api.post(f"/v1/companies/{company['id']}/runs", json={"goal": "Build a tutoring landing page", "always_on": False}).json()["run"]
    for _ in range(160):
        events = api.get(f"/v1/companies/{company['id']}/events").json()["events"]
        if any(event["event_type"] == "company.run_completed" and event["data"].get("runId") == run["id"] for event in events):
            break
        time.sleep(0.03)
    names = [event["event_type"] for event in events]
    assert "task.failed" in names
    assert "revision.requested" in names
    assert "recovery.started" in names
    assert "recovery.completed" in names
    assert next(event for event in events if event["event_type"] == "recovery.started")["data"]["recoveryType"] == "qa_revision"
    assert sandbox.mobile_checks >= 2
    assert any(event["event_type"] == "company.run_completed" and event["data"].get("status") == "completed" for event in events)


def test_scheduler_records_bounded_retry_and_escalation_evidence(tmp_path):
    store = SQLiteStateStore(tmp_path / "recovery.db")
    company = Company(name="Recovery", goal="Build a safe page", status=CompanyStatus.running, objective=Objective(statement="Build a safe page"))
    run = CompanyRun(company_id=company.id, goal=company.goal, status="running")
    task = Task(company_id=company.id, role="engineering", title="Build a safe page", instruction="Build the page", run_id=run.id, max_attempts=2)
    store.save_company(company)
    store.save_run(run)
    store.save_task(task)

    class FailOnceRunner:
        def __init__(self):
            self.calls = 0

        def execute(self, _company, current):
            self.calls += 1
            current.attempts += 1
            current.status = "running"
            store.save_task(current)
            if self.calls == 1:
                raise RuntimeError("synthetic bounded failure")
            current.status = "completed"
            store.save_task(current)

    runner = FailOnceRunner()
    scheduler = PersistentScheduler(store, store, runner)
    scheduler._run(company, task)
    queued = store.get_task(task.id)
    assert queued is not None and queued.status == "queued"
    scheduler._run(company, queued)
    events = store.list(company.id)
    assert [event.event_type for event in events].count("recovery.started") == 1
    assert [event.event_type for event in events].count("recovery.completed") == 1

    exhausted = Task(company_id=company.id, role="product", title="Write the brief", instruction="Write the brief", run_id=run.id, max_attempts=1)
    store.save_task(exhausted)
    class AlwaysFailRunner:
        def execute(self, _company, current):
            current.attempts += 1
            current.status = "running"
            store.save_task(current)
            raise RuntimeError("synthetic exhausted failure")

    failing_scheduler = PersistentScheduler(store, store, AlwaysFailRunner())
    failing_scheduler._run(company, exhausted)
    assert any(event.event_type == "escalation.created" and event.data.get("reason") == "max_attempts_exhausted" for event in store.list(company.id))


def test_always_on_provider_block_recovers_without_resuming_policy_blocks(tmp_path):
    store = SQLiteStateStore(tmp_path / "provider-reconnect.db")
    company = Company(
        name="Provider reconnect",
        goal="Keep the company moving",
        status=CompanyStatus.running,
        always_on=True,
        objective=Objective(statement="Keep the company moving"),
    )
    run = CompanyRun(company_id=company.id, goal=company.goal, status="blocked")
    policy_run = CompanyRun(company_id=company.id, goal=company.goal, status="blocked")
    provider_task = Task(
        company_id=company.id,
        role="product",
        title="Resume product work",
        status="blocked",
        attempts=1,
        run_id=run.id,
        blocked_reason_code="provider_unavailable",
        agent_id="agent_provider_reconnect",
    )
    policy_task = Task(
        company_id=company.id,
        role="growth",
        title="Keep the policy gate",
        status="blocked",
        run_id=policy_run.id,
        blocked_reason_code="policy",
        agent_id="agent_policy_gate",
    )
    store.save_company(company)
    store.save_run(run)
    store.save_run(policy_run)
    store.save_task(provider_task)
    store.save_task(policy_task)
    store.save_agent(Agent(company_id=company.id, role="product", objective=company.goal, status=AgentStatus.blocked, task_id=provider_task.id, id=provider_task.agent_id))
    store.save_agent(Agent(company_id=company.id, role="growth", objective=company.goal, status=AgentStatus.blocked, task_id=policy_task.id, id=policy_task.agent_id))

    class ToggleGateway:
        available = False

        def is_available(self):
            return self.available

    gateway = ToggleGateway()

    class Runner:
        model_gateway = gateway

    scheduler = PersistentScheduler(store, store, Runner())
    assert scheduler._recover_provider_blocks() == 0
    assert store.get_task(provider_task.id).status == "blocked"

    gateway.available = True
    assert scheduler._recover_provider_blocks() == 1
    resumed = store.get_task(provider_task.id)
    still_blocked = store.get_task(policy_task.id)
    assert resumed is not None
    assert resumed.status == "queued"
    assert resumed.attempts == 0
    assert resumed.blocked_reason_code is None
    assert still_blocked is not None and still_blocked.status == "blocked"
    assert still_blocked.blocked_reason_code == "policy"
    assert store.get_run(run.id).status == "running"
    assert store.get_run(policy_run.id).status == "blocked"
    assert store.get_agent(provider_task.agent_id).status == AgentStatus.waiting
    events = store.list(company.id)
    assert any(event.event_type == "company.run_resumed" for event in events)
    assert any(event.event_type == "task.resumed" and event.data.get("recoveryType") == "provider_reconnect" for event in events)


def test_scheduler_health_reports_liveness_and_can_restart_after_stop(tmp_path):
    store = SQLiteStateStore(tmp_path / "scheduler-health.db")
    scheduler = PersistentScheduler(store, store, runner=object(), poll_seconds=0.01)
    try:
        assert scheduler.health()["status"] == "offline"
        scheduler.start()
        for _ in range(100):
            if scheduler.health()["status"] == "ready":
                break
            time.sleep(0.01)
        first = scheduler.health()
        assert first["status"] == "ready"
        assert first["thread"] == "alive"
        assert first["lastLoopAt"] is not None

        scheduler.stop()
        assert scheduler.health()["status"] == "offline"
        scheduler.start()
        for _ in range(100):
            if scheduler.health()["status"] == "ready":
                break
            time.sleep(0.01)
        second = scheduler.health()
        assert second["status"] == "ready"
        assert second["thread"] == "alive"
    finally:
        scheduler.stop()


def test_owner_stop_prevents_a_late_model_result_from_committing(tmp_path):
    gateway = SlowGateway()
    api = TestClient(create_app(sandbox=FakeSandbox(), feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), database_path=tmp_path / "stop.db", model_gateway=gateway))
    company = api.post("/v1/companies", json={"name": "Stop", "goal": "Build a safe stop test"}).json()["company"]
    api.post(f"/v1/companies/{company['id']}/runs", json={"goal": "Build a safe stop test", "always_on": False})
    assert gateway.started.wait(2)
    assert api.post(f"/v1/companies/{company['id']}/runtime/stop").status_code == 200
    gateway.release.set()
    for _ in range(80):
        dashboard = api.get(f"/v1/companies/{company['id']}/dashboard").json()
        events = api.get(f"/v1/companies/{company['id']}/events").json()["events"]
        if any(event["event_type"] == "agent.stopped" for event in events):
            break
        time.sleep(0.03)
    assert any(task["status"] == "cancelled" for task in dashboard["tasks"])
    assert "agent.stopped" in [event["event_type"] for event in events]


def test_owner_stop_passes_company_scope_to_a_scoped_gateway(tmp_path):
    class ScopedGateway:
        def __init__(self):
            self.scopes = []

        def is_available(self):
            return False

        def health(self):
            return []

        def cancel(self, scope=None):
            self.scopes.append(scope)

    gateway = ScopedGateway()
    api = TestClient(create_app(
        sandbox=FakeSandbox(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "scoped-stop.db",
        model_gateway=gateway,
    ))
    company = api.post("/v1/companies", json={"name": "Scoped stop", "goal": "Stop only this company"}).json()["company"]

    stopped = api.post(f"/v1/companies/{company['id']}/runtime/stop")

    assert stopped.status_code == 200
    assert gateway.scopes == [company["id"]]


def test_owner_stop_finalizes_a_queued_run_without_an_inflight_worker(tmp_path):
    store = SQLiteStateStore(tmp_path / "queued-stop.db")
    company = Company(
        name="Queued stop",
        goal="Stop queued work cleanly",
        status=CompanyStatus.running,
        always_on=True,
        objective=Objective(statement="Stop queued work cleanly"),
    )
    run = CompanyRun(company_id=company.id, goal=company.goal, status="running")
    task = Task(company_id=company.id, role="product", title="Queued product review", run_id=run.id)
    store.save_company(company)
    store.save_run(run)
    store.save_task(task)
    scheduler = PersistentScheduler(store, store, runner=object())

    stopped = scheduler.stop_company(company.id)

    assert stopped["active"] is False
    assert store.get_task(task.id).status == "cancelled"
    assert store.get_run(run.id).status == "stopped"
    assert any(event.event_type == "company.run_completed" for event in store.list(company.id))
    scheduler.stop()


def test_always_on_company_starts_a_second_cycle_on_this_pc(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCHA_ALWAYS_ON_CYCLE_SECONDS", "0.05")
    monkeypatch.setenv("ORCHA_ALWAYS_ON_HEARTBEAT_SECONDS", "0.05")
    api = TestClient(create_app(
        sandbox=FakeSandbox(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "always-on.db",
        model_gateway=FakeModelGateway(),
    ))
    company = api.post("/v1/companies", json={"name": "AlwaysOn", "goal": "Build a study landing page"}).json()["company"]
    started = api.post(f"/v1/companies/{company['id']}/runs", json={"goal": "Build a study landing page", "always_on": True})
    assert started.status_code == 202
    assert started.json()["company"]["always_on"] is True
    plans = []
    cycles = []
    for _ in range(250):
        events = api.get(f"/v1/companies/{company['id']}/events").json()["events"]
        plans = [event for event in events if event["event_type"] == "plan.generated"]
        cycles = [event for event in events if event["event_type"] == "company.cycle_started"]
        if len(plans) >= 2 and cycles:
            break
        time.sleep(0.03)
    assert len(plans) >= 2
    assert cycles
    stopped = api.post(f"/v1/companies/{company['id']}/runtime/stop")
    assert stopped.status_code == 200
    dashboard = api.get(f"/v1/companies/{company['id']}/dashboard").json()
    assert dashboard["company"]["always_on"] is False
    assert dashboard["company"]["status"] == "stopped"


def test_runtime_generates_verified_event_sequence(tmp_path):
    sandbox = FakeSandbox()
    api = TestClient(create_app(sandbox=sandbox, feedback_sink=LocalFeedbackSink(tmp_path / "feedback")))
    company = api.post("/v1/companies", json={"name": "StudyFlow", "goal": "Build a focused study tool"}).json()["company"]
    started = api.post(f"/v1/companies/{company['id']}/runtime/workspace-check")
    assert started.status_code == 202
    for _ in range(30):
        events = api.get(f"/v1/companies/{company['id']}/events").json()["events"]
        if any(event["event_type"] == "task.completed" for event in events):
            break
        time.sleep(0.03)
    names = [event["event_type"] for event in events]
    assert "sandbox.connected" in names
    assert "task.started" in names
    assert "tool.started" in names
    assert "file.created" in names
    assert names[-1] == "task.completed"
    assert sandbox.writes == [(company["id"], "test.txt", "hello from orcha")]


def test_workspace_check_stop_cannot_commit_a_late_success(tmp_path):
    class SlowWriteSandbox(FakeSandbox):
        def __init__(self):
            super().__init__()
            self.write_started = threading.Event()
            self.release_write = threading.Event()

        def write_file(self, company_id, path, content):
            self.write_started.set()
            self.release_write.wait(2)
            return super().write_file(company_id, path, content)

    store = SQLiteStateStore(tmp_path / "workspace-stop.db")
    sandbox = SlowWriteSandbox()
    company = Company(
        name="Workspace stop",
        goal="Stop a workspace check safely",
        status=CompanyStatus.running,
        objective=Objective(statement="Stop a workspace check safely"),
    )
    store.save_company(company)

    from orcha.runtime.local_runtime import LocalRuntimeService

    runtime = LocalRuntimeService(store, sandbox, store)
    job = runtime.start_workspace_check(company)
    assert sandbox.write_started.wait(2)
    runtime.stop(company)
    sandbox.release_write.set()

    for _ in range(60):
        task = store.get_task(job.task_id)
        if task and task.status == "cancelled":
            break
        time.sleep(0.02)

    task = store.get_task(job.task_id)
    assert task is not None and task.status == "cancelled"
    events = store.list(company.id)
    event_types = [event.event_type for event in events]
    assert "task.cancelled" in event_types
    assert "file.created" in event_types
    assert "task.completed" not in event_types
    assert "task.failed" not in event_types
    runtime.close()


def test_workspace_check_reuses_an_active_company_job(tmp_path):
    class SlowWriteSandbox(FakeSandbox):
        def __init__(self):
            super().__init__()
            self.write_started = threading.Event()
            self.release_write = threading.Event()

        def write_file(self, company_id, path, content):
            self.write_started.set()
            self.release_write.wait(2)
            return super().write_file(company_id, path, content)

    store = SQLiteStateStore(tmp_path / "workspace-dedupe.db")
    sandbox = SlowWriteSandbox()
    company = Company(
        name="Workspace dedupe",
        goal="Avoid duplicate workspace checks",
        status=CompanyStatus.running,
        objective=Objective(statement="Avoid duplicate workspace checks"),
    )
    store.save_company(company)

    from orcha.runtime.local_runtime import LocalRuntimeService

    runtime = LocalRuntimeService(store, sandbox, store)
    first = runtime.start_workspace_check(company)
    assert sandbox.write_started.wait(2)
    second = runtime.start_workspace_check(company)

    assert second.task_id == first.task_id
    assert [event.event_type for event in store.list(company.id)].count("task.created") == 1

    runtime.stop(company)
    sandbox.release_write.set()
    runtime.close()


def test_workspace_check_rehydrates_one_queued_task_after_runtime_restart(tmp_path):
    store = SQLiteStateStore(tmp_path / "workspace-rehydrate.db")
    sandbox = FakeSandbox()
    company = Company(
        name="Workspace rehydrate",
        goal="Resume a queued workspace check safely",
        status=CompanyStatus.running,
        objective=Objective(statement="Resume a queued workspace check safely"),
    )
    store.save_company(company)

    from orcha.runtime.local_runtime import LocalRuntimeService, WORKSPACE_CHECK_TITLE

    queued = Task(
        company_id=company.id,
        role="engineering",
        title=WORKSPACE_CHECK_TITLE,
        status="queued",
        capabilities=["repo.write"],
        kind="runtime",
    )
    store.save_task(queued)
    runtime = LocalRuntimeService(store, sandbox, store)

    job = runtime.start_workspace_check(company)

    assert job.task_id == queued.id
    assert [event.event_type for event in store.list(company.id)].count("task.created") == 0
    for _ in range(60):
        task = store.get_task(queued.id)
        if task and task.status == "completed":
            break
        time.sleep(0.02)

    assert store.get_task(queued.id).status == "completed"
    assert sandbox.writes == [(company.id, "test.txt", "hello from orcha")]
    runtime.close()


def test_runtime_reports_worker_offline(tmp_path):
    api = TestClient(create_app(sandbox=FakeSandbox("offline"), feedback_sink=LocalFeedbackSink(tmp_path / "feedback")))
    assert api.get("/v1/runtime/health").json()["status"] == "offline"


def test_api_uses_an_injected_runtime_service_without_constructing_local_runtime(tmp_path):
    runtime = FakeRuntime()
    with TestClient(create_app(
        sandbox=FakeSandbox(),
        runtime=runtime,
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "injected-runtime.db",
    )) as api:
        health = api.get("/v1/runtime/health").json()
        assert health["provider"] == "fake"
        assert health["scheduler"]["status"] == "ready"
        company = api.post("/v1/companies", json={"name": "Injected", "goal": "Exercise a replaceable runtime"}).json()["company"]
        started = api.post(f"/v1/companies/{company['id']}/runtime/workspace-check")
        assert started.status_code == 202
        assert runtime.started == [company["id"]]
        stopped = api.post(f"/v1/companies/{company['id']}/runtime/stop")
        assert stopped.status_code == 200
        assert runtime.stopped == [company["id"]]
    assert runtime.closed is True


def test_api_closes_the_app_sandbox_when_a_runtime_does_not_own_it(tmp_path):
    class ClosableSandbox(FakeSandbox):
        def __init__(self):
            super().__init__()
            self.close_calls = 0

        def close(self):
            self.close_calls += 1

    sandbox = ClosableSandbox()
    with TestClient(create_app(
        sandbox=sandbox,
        runtime=FakeRuntime(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "injected-runtime-sandbox-close.db",
    )):
        pass

    assert sandbox.close_calls == 1


def test_company_tasks_and_events_survive_an_api_restart(tmp_path):
    database = tmp_path / "orcha.db"
    first = TestClient(create_app(sandbox=FakeSandbox(), feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), database_path=database))
    company = first.post("/v1/companies", json={"name": "Durable", "goal": "Build a durable local runtime"}).json()["company"]
    started = first.post(f"/v1/companies/{company['id']}/start")
    assert started.status_code == 200
    planned_task_ids = {task["id"] for task in started.json()["tasks"]}

    restarted = TestClient(create_app(sandbox=FakeSandbox(), feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), database_path=database))
    dashboard = restarted.get(f"/v1/companies/{company['id']}/dashboard")
    assert dashboard.status_code == 200
    assert {task["id"] for task in dashboard.json()["tasks"]} == planned_task_ids
    assert [event["event_type"] for event in dashboard.json()["activity"]][:2] == ["company.created", "company.started"]


def test_restart_requeues_specialists_but_cancels_interrupted_runtime_jobs(tmp_path):
    store = SQLiteStateStore(tmp_path / "interrupted.db")
    specialist = Task(company_id="co_restart", role="product", title="Resume specialist work", status="running", kind="agent")
    runtime = Task(company_id="co_restart", role="engineering", title="Resume workspace check", status="running", kind="runtime")
    store.save_task(specialist)
    store.save_task(runtime)

    recovered = store.requeue_interrupted_tasks()

    assert {task.id for task in recovered} == {specialist.id, runtime.id}
    assert store.get_task(specialist.id).status == "queued"
    assert store.get_task(runtime.id).status == "cancelled"
    assert store.get_task(specialist.id).lease_id is None
    assert store.get_task(runtime.id).lease_id is None


def test_task_claim_is_atomic_and_persists_a_lease(tmp_path):
    store = SQLiteStateStore(tmp_path / "task-lease.db")
    task = Task(company_id="co_lease", role="product", title="Claim once", status="queued")
    store.save_task(task)

    first = store.claim_task(task.id, "lease_first")
    second = store.claim_task(task.id, "lease_second")

    assert first is not None
    assert first.status == "running"
    assert first.lease_id == "lease_first"
    assert first.leased_at is not None
    assert second is None
    saved = store.get_task(task.id)
    assert saved is not None and saved.lease_id == "lease_first"


def test_scheduler_restart_reconciles_interrupted_agent_projection(tmp_path):
    store = SQLiteStateStore(tmp_path / "agent-recovery.db")
    company = Company(
        name="Agent recovery",
        goal="Keep specialist state truthful after an API restart",
        status=CompanyStatus.running,
        objective=Objective(statement="Keep specialist state truthful after an API restart"),
    )
    task = Task(company_id=company.id, role="engineering", title="Resume the build", status="running", kind="agent")
    agent = Agent(
        id="agent_engineering_recovery",
        company_id=company.id,
        role="engineering",
        objective=company.goal,
        task_id=task.id,
        status=AgentStatus.working,
    )
    task.agent_id = agent.id
    store.save_company(company)
    store.save_task(task)
    store.save_agent(agent)

    scheduler = PersistentScheduler(store, store, runner=object())
    scheduler._recover_interrupted_tasks()

    recovered_task = store.get_task(task.id)
    recovered_agent = store.get_agent(agent.id)
    assert recovered_task is not None and recovered_task.status == "queued"
    assert recovered_agent is not None and recovered_agent.status == AgentStatus.waiting
    events = store.list(company.id)
    status_event = next(event for event in events if event.event_type == "agent.status_changed")
    assert status_event.data["status"] == "waiting"
    assert status_event.data["previousStatus"] == "working"
    assert status_event.data["recovered"] is True
    assert any(event.event_type == "task.recovered" for event in events)
    scheduler.stop()


def test_agent_team_membership_is_typed_and_team_status_is_derived(tmp_path):
    store = SQLiteStateStore(tmp_path / "team-projection.db")
    company = Company(
        name="Team projection",
        goal="Keep specialist departments truthful",
        status=CompanyStatus.running,
        objective=Objective(statement="Keep specialist departments truthful"),
    )
    design = Agent(
        company_id=company.id,
        role="design",
        objective=company.goal,
        status=AgentStatus.working,
    )
    store.save_company(company)
    store.save_agent(design)

    saved = store.get_agent(design.id)
    assert saved is not None
    assert saved.team == TeamId.design
    assert saved.hired == HireState.hired
    teams = {team.id: team for team in team_snapshots([saved])}
    assert teams[TeamId.design].status.value == "working"
    assert teams[TeamId.design].agent_ids == [design.id]
    assert teams[TeamId.design].hired_count == 1
    assert teams[TeamId.data].status.value == "empty"


def test_identical_artifact_retry_reuses_existing_workspace_write(tmp_path):
    store = SQLiteStateStore(tmp_path / "artifact-idempotency.db")
    sandbox = FakeSandbox()
    company = Company(
        name="Idempotent artifacts",
        goal="Avoid duplicate writes after a retry",
        status=CompanyStatus.running,
        objective=Objective(statement="Avoid duplicate writes after a retry"),
    )
    task = Task(company_id=company.id, role="engineering", title="Write the page", status="running", kind="agent")
    content = "<main>stable output</main>"
    artifact = Artifact(
        company_id=company.id,
        task_id=task.id,
        agent_id="agent_engineering_idempotent",
        kind="source",
        name="index.html",
        path="app/index.html",
        summary="Existing generated page",
        content_hash=hashlib.sha256(content.encode("utf-8")).hexdigest(),
    )
    store.save_company(company)
    store.save_task(task)
    store.save_artifact(artifact)
    runner = LocalAgentRunner(store, store, sandbox, object(), RuntimePolicy(store))

    path = runner._write_artifact(company, task, {"type": "agent", "id": artifact.agent_id}, artifact.agent_id, artifact.path, content)

    assert path == artifact.path
    assert sandbox.writes == []
    assert task.artifact_ids == [artifact.id]
    assert not any(event.event_type == "file.created" for event in store.list(company.id))


def test_scheduler_restart_reconciles_a_terminal_run_before_next_cycle(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCHA_ALWAYS_ON_CYCLE_SECONDS", "60")
    store = SQLiteStateStore(tmp_path / "run-recovery.db")
    company = Company(
        name="Run recovery",
        goal="Close a completed run after restart",
        status=CompanyStatus.running,
        always_on=True,
        cycle_count=1,
        objective=Objective(statement="Close a completed run after restart"),
    )
    run = CompanyRun(company_id=company.id, goal=company.goal, status="running")
    task = Task(company_id=company.id, role="product", title="Finished before shutdown", status="completed", run_id=run.id)
    store.save_company(company)
    store.save_run(run)
    store.save_task(task)

    scheduler = PersistentScheduler(store, store, runner=object())
    scheduler._reconcile_durable_runs()

    recovered_run = store.get_run(run.id)
    recovered_company = store.get_company(company.id)
    assert recovered_run is not None and recovered_run.status == "completed"
    assert recovered_company is not None and recovered_company.next_cycle_at is not None
    completed = [event for event in store.list(company.id) if event.event_type == "company.run_completed"]
    assert len(completed) == 1
    assert completed[0].data["runId"] == run.id
    scheduler.stop()


def test_scheduler_restart_fails_closed_when_a_run_has_no_persisted_tasks(tmp_path, monkeypatch):
    monkeypatch.setenv("ORCHA_ALWAYS_ON_RETRY_SECONDS", "60")
    store = SQLiteStateStore(tmp_path / "empty-run-recovery.db")
    company = Company(
        name="Empty run recovery",
        goal="Recover an interrupted planning transaction",
        status=CompanyStatus.running,
        always_on=True,
        cycle_count=1,
        objective=Objective(statement="Recover an interrupted planning transaction"),
    )
    run = CompanyRun(company_id=company.id, goal=company.goal, status="running")
    store.save_company(company)
    store.save_run(run)

    scheduler = PersistentScheduler(store, store, runner=object())
    scheduler._reconcile_durable_runs()

    recovered_run = store.get_run(run.id)
    recovered_company = store.get_company(company.id)
    assert recovered_run is not None and recovered_run.status == "failed"
    assert recovered_run.final_summary is not None and "no work was dispatched" in recovered_run.final_summary
    assert recovered_company is not None and recovered_company.next_cycle_at is not None
    completed = [event for event in store.list(company.id) if event.event_type == "company.run_completed"]
    assert len(completed) == 1
    assert completed[0].data["status"] == "failed"
    scheduler.stop()


def test_persistent_scheduler_runs_specialist_tasks_with_a_server_side_gateway(tmp_path):
    sandbox = FakeSandbox()
    gateway = FakeModelGateway()
    api = TestClient(create_app(
        sandbox=sandbox,
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "agents.db",
        model_gateway=gateway,
    ))
    company = api.post("/v1/companies", json={"name": "Specialists", "goal": "Build a concise product brief"}).json()["company"]
    api.post(f"/v1/companies/{company['id']}/start")
    for _ in range(80):
        dashboard = api.get(f"/v1/companies/{company['id']}/dashboard").json()
        if all(task["status"] == "completed" for task in dashboard["tasks"]):
            break
        time.sleep(0.03)
    assert all(task["status"] == "completed" for task in dashboard["tasks"])
    notes = [path for _, path, _ in sandbox.writes if path.startswith("artifacts/")]
    assert [path.split("-")[-2] for path in notes] == ["product", "design", "engineering", "qa"]
    assert any(path == "app/index.html" for _, path, _ in sandbox.writes)
    assert len(gateway.prompts) >= 4
    names = [event["event_type"] for event in dashboard["activity"]]
    assert "task.started" in names
    assert "agent.started" in names
    assert "agent.completed" in names


def test_engineering_can_create_only_validated_workspace_source_files(tmp_path):
    sandbox = FakeSandbox()
    api = TestClient(create_app(
        sandbox=sandbox,
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "build.db",
        model_gateway=BuildModelGateway(),
    ))
    company = api.post("/v1/companies", json={"name": "Builder", "goal": "Build a first screen for students"}).json()["company"]
    api.post(f"/v1/companies/{company['id']}/start")
    for _ in range(100):
        dashboard = api.get(f"/v1/companies/{company['id']}/dashboard").json()
        if all(task["status"] == "completed" for task in dashboard["tasks"]):
            break
        time.sleep(0.03)
    writes = {path: content for _, path, content in sandbox.writes}
    assert writes["app/index.html"] == "<main>StudyFlow</main>"
    assert "app/styles.css" in writes
    assert "../outside.txt" not in writes
    engineering = next(task for task in dashboard["tasks"] if task["role"] == "engineering")
    assert {"app/index.html", "app/styles.css"}.issubset(engineering["evidence"])
    qa = next(task for task in dashboard["tasks"] if task["role"] == "qa")
    assert "app/index.html" in qa["evidence"]
    events = api.get(f"/v1/companies/{company['id']}/events").json()["events"]
    assert "verification.passed" in [event["event_type"] for event in events]
    created = next(event for event in events if event["event_type"] == "file.created" and event["data"].get("artifact") == "app/index.html")
    assert created["data"]["created"] is True
    assert created["data"]["lines"] >= 1
    assert created["data"]["linesAdded"] >= 1
    assert "content" not in created["data"]
    cost = next(event for event in events if event["event_type"] == "cost.recorded")
    assert "durationMs" in cost["data"]
    assert cost["data"]["durationMs"] >= 0
    passed = next(event for event in events if event["event_type"] == "verification.passed")
    names = {check["name"] for check in passed["data"]["checks"]}
    assert "app/index.html exists" in names
    assert "app/index.html is non-empty" in names
    assert "no remote scripts" in names
    dumped = str(events)
    assert "sk-" not in dumped
    assert "OPENROUTER_API_KEY" not in dumped


def test_markdown_only_engineering_does_not_complete_with_zero_files(tmp_path):
    store = SQLiteStateStore(tmp_path / "md-eng.db")
    sandbox = FakeSandbox()
    company = Company(name="Markdown", goal="Build a first screen", status=CompanyStatus.running, objective=Objective(statement="Build a first screen"))
    task = Task(company_id=company.id, role="engineering", title="Build the page", instruction="Build the page", capabilities=ROLE_CAPABILITIES["engineering"])
    store.save_company(company)
    store.save_task(task)

    class MarkdownGateway:
        def is_available(self):
            return True

        def generate(self, system, prompt, max_tokens=None):
            return "# Engineering note\n\nThe landing page is done, with no JSON files."

    raised = False
    try:
        LocalAgentRunner(store, store, sandbox, MarkdownGateway(), RuntimePolicy(store)).execute(company, task)
    except RuntimeError as exc:
        raised = True
        assert "app/index.html" in str(exc)
    assert raised
    assert not any(path.startswith("app/") for _, path, _ in sandbox.writes)
    assert not any(task_state.status == "completed" for task_state in [store.get_task(task.id)] if task_state)


def test_engineering_parses_fenced_json_and_confines_paths_to_app():
    note, files = LocalAgentRunner._extract_build_output(
        'Thanks.\n```json\n{"summary":"Fenced build.","files":['
        '{"path":"app/index.html","content":"<main>Fenced</main>"},'
        '{"path":"../secret.txt","content":"blocked"}]}'
        "\n```\nMore prose."
    )
    assert "Fenced build" in note
    assert [item.path for item in files] == ["app/index.html"]
    empty_note, empty_files = LocalAgentRunner._extract_build_output("# Built the page\n\nNo JSON manifest.")
    assert empty_files == []
    assert empty_note.startswith("# Built the page")


def test_scheduler_resumes_durable_queued_work_when_the_api_starts(tmp_path):
    database = tmp_path / "resume.db"
    store = SQLiteStateStore(database)
    company = Company(name="Resume", goal="Build a resumable product note", status=CompanyStatus.running, objective=Objective(statement="Build a resumable product note"))
    task = Task(company_id=company.id, role="product", title="Write the product note", instruction="Write the product note")
    store.save_company(company)
    store.save_task(task)
    sandbox = FakeSandbox()
    with TestClient(create_app(
        sandbox=sandbox,
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        state_store=store,
        model_gateway=FakeModelGateway(),
    )) as api:
        for _ in range(80):
            task_state = api.get(f"/v1/companies/{company.id}/dashboard").json()["tasks"][0]["status"]
            if task_state == "completed":
                break
            time.sleep(0.03)
    assert task_state == "completed"
    assert sandbox.writes[0][1].startswith("artifacts/")


def test_runtime_policy_enforces_daily_run_limit_and_usage_is_durable(tmp_path, monkeypatch):
    store = SQLiteStateStore(tmp_path / "usage.db")
    company = Company(name="Limits", goal="Build with a safe run limit", objective=Objective(statement="Build with a safe run limit"))
    store.save_company(company)
    policy = RuntimePolicy(store)
    monkeypatch.setenv("ORCHA_MAX_AGENT_RUNS_PER_DAY", "1")
    assert policy.can_start(company).allowed is True
    store.record_usage(company.id, "test", "free", 10, 20, 0)
    usage = store.daily_usage(company.id)
    assert usage == {"runs": 1, "estimatedUsd": 0.0}
    decision = policy.can_start(company)
    assert decision.allowed is False
    assert "Daily agent-run limit" in decision.reason


def test_company_runtime_can_pause_and_resume_without_losing_its_plan(tmp_path):
    api = TestClient(create_app(
        sandbox=FakeSandbox(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "controls.db",
    ))
    company = api.post("/v1/companies", json={"name": "Controls", "goal": "Build a company with a pause control"}).json()["company"]
    api.post(f"/v1/companies/{company['id']}/start")
    paused = api.post(f"/v1/companies/{company['id']}/runtime/pause")
    assert paused.json()["status"] == "paused"
    assert api.get(f"/v1/companies/{company['id']}/dashboard").json()["company"]["status"] == "paused"
    resumed = api.post(f"/v1/companies/{company['id']}/runtime/resume")
    assert resumed.status_code == 200
    assert api.get(f"/v1/companies/{company['id']}/dashboard").json()["company"]["status"] == "running"


def test_task_controls_are_scoped_durable_and_race_safe(tmp_path):
    store = SQLiteStateStore(tmp_path / "task-controls.db")
    company = Company(
        name="Task controls",
        goal="Build a company with owner task controls",
        status=CompanyStatus.running,
        objective=Objective(statement="Build a company with owner task controls"),
    )
    other = Company(
        name="Other company",
        goal="Build another isolated company",
        status=CompanyStatus.running,
        objective=Objective(statement="Build another isolated company"),
    )
    run = CompanyRun(company_id=company.id, goal=company.goal, status="failed")
    queued = Task(company_id=company.id, role="design", title="Queue the design pass", attempts=2, max_attempts=2, run_id=run.id)
    blocked = Task(company_id=company.id, role="qa", title="Hold the QA pass", status="blocked", run_id=run.id)
    running = Task(company_id=company.id, role="engineering", title="Build the page", status="running", run_id=run.id)
    foreign = Task(company_id=other.id, role="product", title="Other company's task")
    for record in (company, other):
        store.save_company(record)
    store.save_run(run)
    for task in (queued, blocked, running, foreign):
        store.save_task(task)
    scheduler = TaskControlScheduler()

    with TestClient(create_app(
        sandbox=FakeSandbox(),
        runtime=FakeRuntime(),
        scheduler=scheduler,
        state_store=store,
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
    )) as api:
        listed = api.get(f"/v1/companies/{company.id}/tasks")
        assert listed.status_code == 200
        assert {task["id"] for task in listed.json()["tasks"]} == {queued.id, blocked.id, running.id}
        assert listed.json()["truth_source"] == "durable_task_state"

        paused = api.post(f"/v1/companies/{company.id}/tasks/{queued.id}/pause")
        assert paused.status_code == 200
        assert paused.json()["task"]["status"] == "paused"
        assert store.get_task(queued.id).status == "paused"

        blocked_pause = api.post(f"/v1/companies/{company.id}/tasks/{blocked.id}/pause")
        assert blocked_pause.status_code == 200
        assert store.get_task(blocked.id).status == "paused"

        active_pause = api.post(f"/v1/companies/{company.id}/tasks/{running.id}/pause")
        assert active_pause.status_code == 409
        assert api.post(f"/v1/companies/{company.id}/tasks/{foreign.id}/pause").status_code == 404
        assert any(event["event_type"] == "task.paused" for event in api.get(f"/v1/companies/{company.id}/events").json()["events"])

        retried = api.post(f"/v1/companies/{company.id}/tasks/{queued.id}/retry")
        assert retried.status_code == 200
        assert retried.json()["task"]["status"] == "queued"
        assert retried.json()["task"]["attempts"] == 0
        assert store.get_run(run.id).status == "running"
        assert scheduler.starts >= 2  # lifespan start plus explicit retry wake-up
        assert any(event["event_type"] == "task.retry_requested" for event in api.get(f"/v1/companies/{company.id}/events").json()["events"])

    # A paused sibling is pending work, not a terminal run. Exercise the real
    # scheduler accounting directly without starting another worker thread.
    queued_state = store.get_task(queued.id)
    running_state = store.get_task(running.id)
    assert queued_state is not None and running_state is not None
    queued_state.status = "completed"
    running_state.status = "completed"
    store.save_task(queued_state)
    store.save_task(running_state)
    paused_scheduler = PersistentScheduler(store, store, runner=object())
    paused_scheduler._complete_run_if_terminal(company.id, run.id)
    assert store.get_run(run.id).status == "running"
    paused_scheduler.stop()


def test_task_retry_rejects_runtime_jobs_and_paused_companies(tmp_path):
    store = SQLiteStateStore(tmp_path / "task-retry-boundaries.db")
    company = Company(
        name="Retry boundaries",
        goal="Build a company with clear retry boundaries",
        status=CompanyStatus.running,
        objective=Objective(statement="Build a company with clear retry boundaries"),
    )
    runtime_task = Task(company_id=company.id, role="engineering", title="Workspace check", status="cancelled", kind="runtime")
    store.save_company(company)
    store.save_task(runtime_task)
    scheduler = TaskControlScheduler()

    with TestClient(create_app(
        sandbox=FakeSandbox(),
        runtime=FakeRuntime(),
        scheduler=scheduler,
        state_store=store,
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
    )) as api:
        assert api.post(f"/v1/companies/{company.id}/tasks/{runtime_task.id}/retry").status_code == 409
        company.status = CompanyStatus.paused
        store.save_company(company)
        specialist = Task(company_id=company.id, role="product", title="Retry later", status="failed")
        store.save_task(specialist)
        assert api.post(f"/v1/companies/{company.id}/tasks/{specialist.id}/retry").status_code == 409


def test_company_destroy_requires_exact_confirmation_and_erases_local_records(tmp_path):
    sandbox = FakeSandbox()
    database = tmp_path / "destroy.db"
    api = TestClient(create_app(sandbox=sandbox, feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), database_path=database))
    company = api.post("/v1/companies", json={"name": "Disposable", "goal": "Build a contained disposable company"}).json()["company"]
    sandbox.write_file(company["id"], "artifact.txt", "private work")
    rejected = api.post(f"/v1/companies/{company['id']}/destroy", json={"confirm_company_id": "co_wrong"})
    assert rejected.status_code == 422
    destroyed = api.post(f"/v1/companies/{company['id']}/destroy", json={"confirm_company_id": company["id"]})
    assert destroyed.status_code == 200
    assert destroyed.json()["destroyed"] is True
    assert sandbox.destroyed == [company["id"]]
    assert api.get(f"/v1/companies/{company['id']}/dashboard").status_code == 404
    assert not any(saved_company == company["id"] for saved_company, _ in sandbox.files)


def test_experiment_requires_evidence_and_can_be_promoted_then_rolled_back(tmp_path):
    api = TestClient(create_app(sandbox=FakeSandbox(), feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), database_path=tmp_path / "experiments.db"))
    company = api.post("/v1/companies", json={"name": "Evolution", "goal": "Build a measured experiment loop"}).json()["company"]
    created = api.post(f"/v1/companies/{company['id']}/experiments", json={
        "target_type": "ui",
        "baseline_version": "landing-v1",
        "candidate_version": "landing-v2",
        "primary_metric": "task_completion",
        "minimum_improvement": 0.1,
        "minimum_observations": 2,
        "guardrails": {"reliability": 0.99},
        "sample_window": "local smoke suite",
    })
    assert created.status_code == 201
    experiment_id = created.json()["experiment"]["id"]
    assert api.post(f"/v1/companies/{company['id']}/experiments/{experiment_id}/promote").status_code == 409
    for variant, metric in (("baseline", 0.50), ("baseline", 0.50), ("candidate", 0.60), ("candidate", 0.60)):
        response = api.post(f"/v1/companies/{company['id']}/experiments/{experiment_id}/observations", json={
            "variant": variant,
            "primary_value": metric,
            "guardrail_values": {"reliability": 0.995},
            "evidence": f"{variant} local result",
        })
        assert response.status_code == 201
    promoted = api.post(f"/v1/companies/{company['id']}/experiments/{experiment_id}/promote")
    assert promoted.status_code == 200
    assert promoted.json()["experiment"]["status"] == "promoted"
    assert promoted.json()["experiment"]["rollback_target"] == "landing-v1"
    rolled_back = api.post(f"/v1/companies/{company['id']}/experiments/{experiment_id}/rollback")
    assert rolled_back.status_code == 200
    assert rolled_back.json()["experiment"]["status"] == "rolled_back"
    dashboard = api.get(f"/v1/companies/{company['id']}/dashboard").json()
    assert dashboard["experiments"][0]["id"] == experiment_id
    names = [event["event_type"] for event in api.get(f"/v1/companies/{company['id']}/events").json()["events"]]
    assert {"experiment.created", "experiment.promotion_rejected", "experiment.promoted", "experiment.rolled_back"}.issubset(names)


def test_experiment_guardrail_keeps_the_baseline_when_candidate_is_unreliable(tmp_path):
    api = TestClient(create_app(sandbox=FakeSandbox(), feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), database_path=tmp_path / "guardrails.db"))
    company = api.post("/v1/companies", json={"name": "Guardrail", "goal": "Keep unreliable variants from promotion"}).json()["company"]
    experiment = api.post(f"/v1/companies/{company['id']}/experiments", json={
        "target_type": "workflow", "baseline_version": "safe-v1", "candidate_version": "fast-v2",
        "primary_metric": "completion", "minimum_observations": 1, "guardrails": {"reliability": 0.99},
    }).json()["experiment"]
    for variant, metric, reliability in (("baseline", 0.5, 1.0), ("candidate", 0.8, 0.8)):
        assert api.post(f"/v1/companies/{company['id']}/experiments/{experiment['id']}/observations", json={
            "variant": variant, "primary_value": metric, "guardrail_values": {"reliability": reliability}, "evidence": "local test",
        }).status_code == 201
    rejected = api.post(f"/v1/companies/{company['id']}/experiments/{experiment['id']}/promote")
    assert rejected.status_code == 409
    assert "reliability guardrail" in rejected.json()["detail"]
    stored = api.get(f"/v1/companies/{company['id']}/experiments/{experiment['id']}").json()["experiment"]
    assert stored["status"] == "evaluating"
    assert stored["promoted_version"] is None


def test_local_only_file_registration_rejects_content_and_never_reaches_the_worker(tmp_path):
    sandbox = FakeSandbox()
    api = TestClient(create_app(sandbox=sandbox, feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), database_path=tmp_path / "local-only.db"))
    company = api.post("/v1/companies", json={"name": "Private", "goal": "Keep a private source file local"}).json()["company"]
    rejected = api.post(f"/v1/companies/{company['id']}/local-only-files", json={"name": "secret.txt", "size_bytes": 12, "content": "do not accept this"})
    assert rejected.status_code == 422
    registered = api.post(f"/v1/companies/{company['id']}/local-only-files", json={"name": "secret.txt", "size_bytes": 12, "content_hash": "f" * 64})
    assert registered.status_code == 201
    assert registered.json()["file"]["tier"] == "local_only"
    assert sandbox.writes == [] and sandbox.reads == []
    listed = api.get(f"/v1/companies/{company['id']}/local-only-files").json()["files"]
    assert listed == [registered.json()["file"]]
    event = api.get(f"/v1/companies/{company['id']}/events").json()["events"][-1]
    assert event["event_type"] == "file.classified"
    assert "contents never entered" in event["data"]["summary"]


def test_worker_artifacts_can_be_shared_but_not_reclassified_as_local_only(tmp_path):
    store = SQLiteStateStore(tmp_path / "tiers.db")
    api = TestClient(create_app(sandbox=FakeSandbox(), feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), state_store=store))
    company = api.post("/v1/companies", json={"name": "Tiers", "goal": "Classify a generated artifact safely"}).json()["company"]
    artifact = Artifact(company_id=company["id"], task_id="task_local", agent_id="agent_local", kind="source", name="index.html", path="app/index.html", summary="Generated preview")
    store.save_artifact(artifact)
    shared = api.post(f"/v1/companies/{company['id']}/files/classify", json={"file_id": artifact.id, "tier": "shareable"})
    assert shared.status_code == 200
    assert shared.json()["artifact"]["tier"] == "shareable"
    local = api.post(f"/v1/companies/{company['id']}/files/classify", json={"file_id": artifact.id, "tier": "local_only"})
    assert local.status_code == 409
    assert store.get_artifact(artifact.id).tier.value == "shareable"
    artifacts = api.get(f"/v1/companies/{company['id']}/artifacts").json()["artifacts"]
    assert artifacts[0]["tier"] == "shareable"


def test_feedback_validation_and_sanitized_diagnostics(tmp_path):
    sink = LocalFeedbackSink(tmp_path / "feedback")
    runtime = FakeRuntime()
    api = TestClient(create_app(sandbox=FakeSandbox(), runtime=runtime, feedback_sink=sink))
    invalid = api.post("/api/feedback", json={"type": "bug", "message": ""})
    assert invalid.status_code == 422
    oversized_error = api.post("/api/feedback", json={"type": "other", "message": "bounded", "client_errors": ["x" * 601]})
    assert oversized_error.status_code == 422
    ordinary = api.post("/api/feedback", json={"type": "suggestion", "message": "Keep feedback available offline."})
    assert ordinary.status_code == 201
    assert runtime.health_reads == 0
    response = api.post("/api/feedback", json={
        "type": "bug", "message": "The grid froze", "include_technical_info": True,
        "route": "/?token=do-not-store", "client_errors": ["Authorization: secret-value"],
    })
    assert response.status_code == 201
    assert runtime.health_reads == 1
    record = make_feedback_record(FeedbackPayload(type="bug", message="x", include_technical_info=True, route="/x?secret=no", client_errors=["token=abc"]))
    assert record["diagnostics"]["route"] == "/x"
    assert "abc" not in record["diagnostics"]["recentErrors"][0]


def test_feedback_diagnostics_redact_raw_credentials_environment_values_and_paths():
    raw = (
        "Bearer abcdefghijklmnop https://provider.example/v1?key=secret "
        "sk-or-v1-1234567890abcdefghijkl C:\\Users\\bents\\private\\error.log "
        "/home/orcha/workspaces/co_test/app/index.html ORCHA_WORKER_AUTH_TOKEN=hidden"
    )

    safe = sanitize_text(raw)

    assert "abcdefghijklmnop" not in safe
    assert "sk-or-v1-" not in safe
    assert "C:\\Users" not in safe
    assert "/home/orcha" not in safe
    assert "hidden" not in safe
    assert "[url]" in safe
    assert "[path]" in safe


def test_feedback_diagnostics_keep_only_same_app_pathnames():
    external = make_feedback_record(FeedbackPayload(
        type="bug",
        message="x",
        include_technical_info=True,
        route="https://external.example/path?token=should-not-store",
    ))
    protocol_relative = make_feedback_record(FeedbackPayload(
        type="bug",
        message="x",
        include_technical_info=True,
        route="//external.example/path",
    ))
    assert external["diagnostics"]["route"] == "/"
    assert protocol_relative["diagnostics"]["route"] == "/"


def test_agent_inbox_returns_targeted_and_broadcast_handoffs_only(tmp_path):
    store = SQLiteStateStore(tmp_path / "inbox.db")
    api = TestClient(create_app(sandbox=FakeSandbox(), feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), state_store=store))
    company = api.post("/v1/companies", json={"name": "Inbox", "goal": "Coordinate specialized internal agents"}).json()["company"]
    agent = Agent(company_id=company["id"], role="engineering", objective=company["goal"])
    other = Agent(company_id=company["id"], role="qa", objective=company["goal"])
    store.save_agent(agent)
    store.save_agent(other)
    store.save_message(AgentMessage(company_id=company["id"], source_agent_id="orchestrator", target_agent_id=None, summary="Broadcast acceptance criteria"))
    store.save_message(AgentMessage(company_id=company["id"], source_agent_id="orchestrator", target_agent_id=agent.id, summary="Engineering handoff"))
    store.save_message(AgentMessage(company_id=company["id"], source_agent_id="orchestrator", target_agent_id=other.id, summary="QA handoff"))
    response = api.get(f"/v1/companies/{company['id']}/agents/{agent.id}/inbox")
    assert response.status_code == 200
    assert response.json()["inboxId"] == agent.inbox_id
    assert response.json()["inboxAddress"] == agent.inbox_address
    assert response.json()["inbox"]["delivery"] == "internal_only"
    assert response.json()["inbox"]["external_delivery_enabled"] is False
    assert [item["summary"] for item in response.json()["messages"]] == ["Broadcast acceptance criteria", "Engineering handoff"]
    directory = api.get(f"/v1/companies/{company['id']}/inboxes")
    assert directory.status_code == 200
    assert directory.json()["delivery"] == "internal_only"
    assert {item["agent_id"] for item in directory.json()["inboxes"]} == {agent.id, other.id}
    assert all(item["address"].endswith("@inbox.orcha.local") for item in directory.json()["inboxes"])
    assert api.get(f"/v1/companies/{company['id']}/agents/agent_missing/inbox").status_code == 404


def test_agent_inbox_address_is_stable_for_legacy_payloads():
    legacy = Agent.model_validate({
        "id": "agent_legacy",
        "company_id": "co_legacy",
        "role": "engineering",
        "objective": "Build a bounded internal tool",
        "inbox_id": "inbox_legacy_42",
    })
    reloaded = Agent.model_validate({**legacy.model_dump(mode="json"), "inbox_address": "spoof@external.example"})
    assert legacy.inbox_address == "inbox-legacy-42@inbox.orcha.local"
    assert reloaded.inbox_address == legacy.inbox_address


def test_completed_handoff_routes_to_dependent_inbox_and_is_loaded(tmp_path):
    store = SQLiteStateStore(tmp_path / "handoffs.db")
    sandbox = FakeSandbox()
    company = Company(
        name="Handoffs",
        goal="Coordinate dependent specialist work",
        status=CompanyStatus.running,
        objective=Objective(statement="Coordinate dependent specialist work"),
    )
    upstream = Task(
        company_id=company.id,
        role="product",
        title="Define the first product slice",
        instruction="Define the first product slice.",
        capabilities=ROLE_CAPABILITIES["product"],
    )
    downstream = Task(
        company_id=company.id,
        role="design",
        title="Shape the first product slice",
        instruction="Use the product handoff to shape the first product slice.",
        capabilities=ROLE_CAPABILITIES["design"],
        depends_on=[upstream.id],
    )
    store.save_company(company)
    store.save_task(upstream)
    store.save_task(downstream)
    gateway = FakeModelGateway()
    runner = LocalAgentRunner(store, store, sandbox, gateway, RuntimePolicy(store))

    runner.execute(company, upstream)

    downstream_agent_id = f"agent_design_{downstream.id[-6:]}"
    messages = store.list_agent_messages(company.id, downstream_agent_id)
    assert len(messages) == 1
    assert messages[0].target_agent_id == downstream_agent_id
    assert "Define the first product slice" in messages[0].summary
    assert not store.list_agent_messages(company.id, "agent_unrelated")

    runner.execute(company, downstream)
    assert any(
        "Internal inbox handoffs" in prompt and "Define the first product slice" in prompt
        for prompt in gateway.prompts
    )


def test_server_chat_sse_uses_injected_gateway_without_persisting_identity(tmp_path):
    class ChatGateway:
        def __init__(self):
            self.prompts = []

        def is_available(self):
            return True

        def generate(self, system, prompt, max_tokens=None):
            self.prompts.append((system, prompt, max_tokens))
            return ModelOutput("A real server reply.", "test", "chat-model")

    gateway = ChatGateway()
    api = TestClient(create_app(
        sandbox=FakeSandbox(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "chat.db",
        model_gateway=gateway,
    ))
    response = api.post("/api/chat", json={
        "userId": "founder@example.test",
        "instructions": "Be concise.",
        "messages": [{"role": "user", "content": "Help me build a study tool."}],
    })
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert '"delta": "A real server reply."' in response.text
    assert '"done": true' in response.text
    assert len(gateway.prompts) == 1
    assert "founder@example.test" not in gateway.prompts[0][1]
    assert "Be concise." in gateway.prompts[0][1]
    assert "Be concise." not in gateway.prompts[0][0]


def test_server_chat_returns_truthful_503_without_a_provider(tmp_path):
    class OfflineGateway:
        def is_available(self):
            return False

    api = TestClient(create_app(
        sandbox=FakeSandbox(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "chat-offline.db",
        model_gateway=OfflineGateway(),
    ))
    response = api.post("/api/chat", json={"messages": [{"role": "user", "content": "Hello Orcha"}]})
    assert response.status_code == 503
    assert "No server-side AI provider" in response.json()["detail"]
    rejected = api.post("/api/chat", json={"apiKey": "sk-never-accepted", "messages": [{"role": "user", "content": "Hello Orcha"}]})
    assert rejected.status_code == 422


def test_scheduler_shutdown_race_is_cleanly_ignored():
    scheduler = PersistentScheduler(object(), object(), object())
    company = Company(name="Shutdown", goal="Handle scheduler shutdown", objective=Objective(statement="Handle scheduler shutdown"))
    task = Task(company_id=company.id, role="product", title="No-op shutdown task")
    scheduler._executor.shutdown(wait=False, cancel_futures=True)
    with scheduler._lock:
        scheduler._in_flight.add(task.id)
    assert scheduler._submit(company, task) is False
    assert task.id not in scheduler._in_flight


def test_next_cycle_does_not_restore_a_company_stopped_during_planning(tmp_path):
    store = SQLiteStateStore(tmp_path / "cycle-stop.db")
    company = Company(
        name="Cycle stop",
        goal="Keep a company from restarting",
        status=CompanyStatus.running,
        always_on=True,
        cycle_count=1,
        objective=Objective(statement="Keep a company from restarting"),
    )
    store.save_company(company)

    class StoppingOrchestrator:
        def start(self, current, run_id, evidence="", cycle=1):
            stopped = store.get_company(current.id)
            stopped.status = CompanyStatus.stopped
            stopped.always_on = False
            stopped.next_cycle_at = None
            store.save_company(stopped)
            return []

    scheduler = PersistentScheduler(store, store, object(), orchestrator=StoppingOrchestrator())
    scheduler._start_next_cycle(company)
    current = store.get_company(company.id)
    assert current is not None
    assert current.status == CompanyStatus.stopped
    assert current.always_on is False


def test_api_start_does_not_resurrect_a_company_stopped_during_planning(tmp_path):
    class BlockingPlannerGateway:
        def __init__(self):
            self.started = threading.Event()
            self.release = threading.Event()

        def is_available(self):
            return True

        def generate(self, system, prompt, max_tokens=None):
            if "orchestration planner" in system:
                self.started.set()
                self.release.wait(3)
                return "not valid planning JSON"
            return "# Work note\n\nEvidence: generated by the approved test gateway."

    gateway = BlockingPlannerGateway()
    api = TestClient(create_app(
        sandbox=FakeSandbox(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "planning-stop.db",
        model_gateway=gateway,
    ))
    company = api.post("/v1/companies", json={"name": "Planning stop", "goal": "Build a small study landing page"}).json()["company"]
    response_holder = {}

    def start():
        response_holder["response"] = api.post(
            f"/v1/companies/{company['id']}/runs",
            json={"goal": company["goal"], "always_on": True},
        )

    thread = threading.Thread(target=start)
    thread.start()
    assert gateway.started.wait(2)
    stopped = api.post(f"/v1/companies/{company['id']}/runtime/stop")
    assert stopped.status_code == 200
    gateway.release.set()
    thread.join(timeout=5)

    assert not thread.is_alive()
    started = response_holder["response"]
    assert started.status_code == 202
    body = started.json()
    assert body["company"]["status"] == "stopped"
    assert body["run"]["status"] == "stopped"
    assert all(task["status"] == "cancelled" for task in body["tasks"])
    events = api.get(f"/v1/companies/{company['id']}/events").json()["events"]
    assert any(event["event_type"] == "company.run_completed" and event["data"]["status"] == "stopped" for event in events)


def test_internal_diagnostics_are_flag_gated_and_omit_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-secret-must-not-leak")
    api = TestClient(create_app(sandbox=FakeSandbox(), feedback_sink=LocalFeedbackSink(tmp_path / "feedback"), database_path=tmp_path / "diag.db"))
    assert api.get("/v1/internal/diagnostics").status_code == 404
    monkeypatch.setenv("ORCHA_INTERNAL_DIAGNOSTICS", "true")
    body = api.get("/v1/internal/diagnostics").json()
    assert "providers" in body
    assert body["worker"]["status"] == "ready"
    assert body["eventStore"] == "sqlite"
    dumped = str(body)
    assert "sk-secret-must-not-leak" not in dumped
    assert "OPENROUTER_API_KEY" not in dumped


def test_worker_write_reports_real_line_stats(tmp_path):
    client = worker(tmp_path)
    first = client.post("/execute", json={"company_id": "co_lines", "action": "write_file", "path": "app/index.html", "content": "<main>one</main>\n"})
    assert first.status_code == 200
    assert first.json()["result"]["created"] is True
    assert first.json()["result"]["lines"] == 1
    assert first.json()["result"]["linesAdded"] == 1
    assert first.json()["result"]["linesRemoved"] == 0
    second = client.post("/execute", json={"company_id": "co_lines", "action": "write_file", "path": "app/index.html", "content": "<main>one</main>\n<p>two</p>\n"})
    assert second.json()["result"]["created"] is False
    assert second.json()["result"]["linesAdded"] >= 1
    assert "content" not in second.json()["result"]


def test_scheduler_revision_events_include_role_and_parent(tmp_path):
    from orcha.runtime.scheduler import PersistentScheduler
    task = Task(company_id="co_rev", role="engineering", title="Revise the page", revision=1)
    payload = PersistentScheduler._data(task, "Created an engineering revision from QA evidence", {"parentTaskId": "task_qa", "revision": 1})
    assert payload["role"] == "engineering"
    assert payload["revision"] == 1
    assert payload["parentTaskId"] == "task_qa"
    assert payload["title"] == "Revise the page"


def test_tool_event_slice_omits_file_contents_and_keeps_stdout():
    from orcha.tools import ToolResult
    extra = LocalAgentRunner._tool_extra("git.status", ToolResult(
        name="git.status",
        ok=True,
        summary="Read repository status",
        data={"stdout": " M app/index.html", "stderr": "", "content": "<secret>should-not-copy</secret>", "exitCode": 0},
    ))
    assert extra["ok"] is True
    assert extra["stdout"] == " M app/index.html"
    assert extra["exitCode"] == 0
    assert "content" not in extra


def test_tool_event_slice_redacts_credentials_from_command_output():
    from orcha.tools import ToolResult
    extra = LocalAgentRunner._tool_extra("git.diff", ToolResult(
        name="git.diff",
        ok=True,
        summary="Read repository diff",
        data={"stdout": "OPENROUTER_API_KEY=sk-or-v1-12345678901234567890\nBearer abcdefghijklmnop"},
    ))
    assert "sk-or-v1-12345678901234567890" not in extra["stdout"]
    assert "abcdefghijklmnop" not in extra["stdout"]
    assert "[redacted]" in extra["stdout"]


def test_newest_running_company_owns_runnable_tasks(tmp_path):
    store = SQLiteStateStore(tmp_path / "dispatch.db")
    older = Company(
        name="Older",
        goal="Build leftover study work",
        status=CompanyStatus.running,
        always_on=True,
        objective=Objective(statement="Build leftover study work"),
    )
    store.save_company(older)
    store.save_task(Task(company_id=older.id, role="product", title="Old product", instruction="Write a leftover note"))
    newer = Company(
        name="Newer",
        goal="Build a tutoring landing page",
        status=CompanyStatus.running,
        always_on=True,
        objective=Objective(statement="Build a tutoring landing page"),
    )
    store.save_company(newer)
    store.save_task(Task(company_id=newer.id, role="engineering", title="New page", instruction="Build the page"))
    runnable = store.list_runnable_tasks()
    assert runnable
    assert all(task.company_id == newer.id for task in runnable)
    paused = store.pause_other_running_companies(newer.id)
    assert older.id in paused
    assert store.get_company(older.id).status == CompanyStatus.paused
    assert store.get_company(newer.id).status == CompanyStatus.running


def test_latest_company_run_pauses_older_always_on_work(tmp_path):
    api = TestClient(create_app(
        sandbox=FakeSandbox(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        database_path=tmp_path / "focus.db",
        model_gateway=FakeModelGateway(),
    ))
    older = api.post("/v1/companies", json={"name": "Older", "goal": "Build leftover study work"}).json()["company"]
    api.post(f"/v1/companies/{older['id']}/runs", json={"goal": "Build leftover study work", "always_on": True})
    newer = api.post("/v1/companies", json={"name": "Newer", "goal": "Build a tutoring landing page"}).json()["company"]
    started = api.post(f"/v1/companies/{newer['id']}/runs", json={"goal": "Build a tutoring landing page", "always_on": True})
    assert started.status_code == 202
    assert api.get(f"/v1/companies/{older['id']}/dashboard").json()["company"]["status"] == "paused"
    assert api.get(f"/v1/companies/{newer['id']}/dashboard").json()["company"]["status"] == "running"
    events = []
    for _ in range(160):
        events = api.get(f"/v1/companies/{newer['id']}/events").json()["events"]
        if any(event["event_type"] == "agent.started" for event in events):
            break
        time.sleep(0.03)
    assert any(event["event_type"] == "plan.generated" for event in events)
    assert any(event["event_type"] == "agent.started" for event in events)


def test_retried_active_run_reuses_the_existing_plan(tmp_path):
    gateway = SlowGateway()
    store = SQLiteStateStore(tmp_path / "run-idempotency.db")
    api = TestClient(create_app(
        sandbox=FakeSandbox(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        state_store=store,
        model_gateway=gateway,
    ))
    company = api.post("/v1/companies", json={"name": "Retry safe", "goal": "Build a retry-safe first screen"}).json()["company"]
    first = api.post(f"/v1/companies/{company['id']}/runs", json={"goal": "Build a retry-safe first screen", "always_on": True})
    second = api.post(f"/v1/companies/{company['id']}/runs", json={"goal": "Build a retry-safe first screen", "always_on": True})

    assert first.status_code == 202
    assert second.status_code == 202
    assert second.json()["reused"] is True
    assert second.json()["run"]["id"] == first.json()["run"]["id"]
    assert len(store.list_runs(company["id"])) == 1
    assert len([event for event in store.list(company["id"]) if event.event_type == "plan.generated"]) == 1

    different = api.post(f"/v1/companies/{company['id']}/runs", json={"goal": "Build a different retry-safe product", "always_on": True})
    assert different.status_code == 409
    gateway.release.set()


def test_company_started_is_visible_while_the_planner_is_still_working(tmp_path):
    gateway = BlockingPlannerGateway()
    store = SQLiteStateStore(tmp_path / "live-start.db")
    api = TestClient(create_app(
        sandbox=FakeSandbox(),
        feedback_sink=LocalFeedbackSink(tmp_path / "feedback"),
        state_store=store,
        model_gateway=gateway,
    ))
    company = api.post("/v1/companies", json={"name": "Live start", "goal": "Build a tutoring landing page"}).json()["company"]
    result = {}

    def go():
        result["res"] = api.post(f"/v1/companies/{company['id']}/runs", json={"goal": "Build a tutoring landing page", "always_on": True})

    thread = threading.Thread(target=go)
    thread.start()
    assert gateway.started.wait(3)
    events = store.list(company["id"])
    assert any(event.event_type == "company.started" for event in events)
    assert not any(event.event_type == "plan.generated" for event in events)
    gateway.release.set()
    thread.join(6)
    assert result["res"].status_code == 202
    assert result["res"].json()["tasks"]
