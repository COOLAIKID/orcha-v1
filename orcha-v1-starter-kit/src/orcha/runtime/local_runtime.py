"""Event-producing runtime actions that sit above any SandboxManager provider."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Event, Lock
import os
import time
from typing import Protocol
from uuid import uuid4

from orcha.domain.models import Company, Task
from orcha.sandbox.contracts import SandboxCommand, SandboxHealth, SandboxManager
from orcha.sandbox.local_wsl import SandboxUnavailable


@dataclass
class RuntimeJob:
    company_id: str
    task_id: str
    agent_id: str = "agent_local_engineer"


class RuntimeCancelled(Exception):
    """A local runtime job was stopped before it could commit success."""


WORKSPACE_CHECK_TITLE = "Verify the Local Workspace by creating test.txt"


class RuntimeService(Protocol):
    """API-facing runtime seam for local, cloud, and test implementations."""

    def health(self) -> SandboxHealth: ...

    def start_workspace_check(self, company: Company) -> RuntimeJob: ...

    def stop(self, company: Company) -> dict: ...

    def close(self) -> None: ...


class LocalRuntimeService:
    def __init__(self, bus, sandbox: SandboxManager, task_store=None):
        self.bus = bus
        self.sandbox = sandbox
        self.task_store = task_store
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="orcha-runtime")
        self._jobs: dict[str, tuple[str, Event]] = {}
        self._jobs_lock = Lock()

    def health(self) -> SandboxHealth:
        return self.sandbox.health()

    def start_workspace_check(self, company: Company) -> RuntimeJob:
        with self._jobs_lock:
            # The UI prevents duplicate clicks, but the API is also a public
            # boundary. Reuse the in-flight check for this company so a retry
            # cannot create parallel writers or two competing terminal events.
            existing = next(
                (
                    RuntimeJob(company_id=company.id, task_id=task_id)
                    for task_id, (owner_id, _) in self._jobs.items()
                    if owner_id == company.id
                ),
                None,
            )
            if existing:
                return existing

            # A process can restart after the durable task row is written but
            # before its executor receives the job. Reuse that still-unclaimed
            # control task instead of creating a second writer when a phone or
            # tunnel retries the request. Running runtime tasks are deliberately
            # not reused: the scheduler cancels those on restart because their
            # exact worker continuation point is unknown.
            recoverable = None
            list_tasks = getattr(self.task_store, "list_tasks", None)
            if callable(list_tasks):
                recoverable = next(
                    (
                        candidate
                        for candidate in list_tasks(company.id, ("queued",))
                        if candidate.kind == "runtime" and candidate.title == WORKSPACE_CHECK_TITLE
                    ),
                    None,
                )
            if recoverable is not None:
                job = RuntimeJob(company_id=company.id, task_id=recoverable.id)
                task = recoverable
                created = False
            else:
                task = Task(
                    company_id=company.id,
                    role="engineering",
                    title=WORKSPACE_CHECK_TITLE,
                    status="queued",
                    capabilities=["repo.write"],
                    # This is a control-plane operation, not a specialist task. Keeping
                    # its kind explicit prevents an interrupted workspace check from
                    # being handed to the agent scheduler after an API restart.
                    kind="runtime",
                )
                job = RuntimeJob(company_id=company.id, task_id=task.id)
                self._save_task(task)
                created = True
            cancel = Event()
            self._jobs[job.task_id] = (company.id, cancel)
            if created:
                self._publish("task.created", company.id, task.id, job, "Queued Local Workspace check", {"task": task.model_dump(mode="json")})
        try:
            self.executor.submit(self._workspace_check, company, job, cancel)
        except RuntimeError:
            with self._jobs_lock:
                self._jobs.pop(job.task_id, None)
            self._set_task_status(job.task_id, "failed")
            self._publish("task.failed", company.id, job.task_id, job, "The Local Workspace runtime is shutting down.")
            raise
        return job

    def _workspace_check(self, company: Company, job: RuntimeJob, cancel: Event) -> None:
        try:
            self._ensure_active(cancel)
            health = self._wait_for_ready(cancel)
            if health.status != "ready":
                raise SandboxUnavailable(health.detail or "Local Workspace is offline.")
            self._ensure_active(cancel)
            self._publish("sandbox.connected", company.id, company.id, job, "Connected to Local Workspace", {"runtimeVersion": health.runtime_version})
            self._mark_running_if_active(job, cancel)
            self._ensure_active(cancel)
            self._publish("task.started", company.id, job.task_id, job, "Creating test.txt in the Local Workspace")
            self._publish("tool.started", company.id, job.task_id, job, "Writing test.txt", {"tool": "workspace.write_file"})
            result = self.sandbox.write_file(company.id, "test.txt", "hello from orcha")
            if not result.ok:
                self._ensure_active(cancel)
                raise RuntimeError("The Local Workspace did not complete the file write.")
            for activity in result.activities:
                if activity.event_type in {"file.created", "file.changed", "command.started", "command.completed", "sandbox.stopped"}:
                    self._publish(activity.event_type, company.id, job.task_id, job, activity.summary, activity.data)
            self._commit_success_if_active(company.id, job, cancel)
        except RuntimeCancelled:
            self._cancel_task_if_open(job, "Local Workspace check stopped by the owner.")
        except Exception as exc:  # the browser gets only a concise, non-sensitive summary
            self._publish("task.failed", company.id, job.task_id, job, self._safe_error(exc))
            self._set_task_status(job.task_id, "failed")
        finally:
            with self._jobs_lock:
                self._jobs.pop(job.task_id, None)

    def _wait_for_ready(self, cancel: Event) -> SandboxHealth:
        try:
            configured_timeout = float(os.getenv("ORCHA_RUNTIME_HEALTH_WAIT_SECONDS", "25"))
        except ValueError:
            configured_timeout = 25.0
        timeout = max(1.0, configured_timeout)
        deadline = time.monotonic() + timeout
        health = self.sandbox.health()
        while health.status == "starting" and time.monotonic() < deadline:
            if cancel.wait(0.35):
                raise RuntimeCancelled()
            health = self.sandbox.health()
        self._ensure_active(cancel)
        if health.status == "starting":
            return SandboxHealth(
                status="offline",
                provider=health.provider,
                runtime_version=health.runtime_version,
                workspace=health.workspace,
                detail="Local Workspace did not become ready in time. Start orcha-worker and try again.",
            )
        return health

    def stop(self, company: Company) -> dict:
        job = RuntimeJob(company_id=company.id, task_id=f"task_stop_{uuid4().hex[:10]}")
        self._cancel_company_jobs(company.id)
        try:
            result = self.sandbox.stop_all(company.id)
            summary = next((item.summary for item in result.activities if item.event_type == "sandbox.stopped"), "Stopped Local Workspace activity")
            self._publish("sandbox.stopped", company.id, company.id, job, summary)
            return result.result
        except Exception as exc:
            self._publish("task.failed", company.id, job.task_id, job, self._safe_error(exc))
            raise

    def close(self) -> None:
        """Cancel local checks and best-effort stop worker children on shutdown."""
        with self._jobs_lock:
            for _, cancel in self._jobs.values():
                cancel.set()
        # The worker may own a preview or a bounded tool process from the
        # scheduler even when no workspace-check job is registered here. Use
        # the provider contract's global stop before tearing down the API;
        # failures are intentionally swallowed during shutdown.
        try:
            self.sandbox.stop_all()
        except Exception:
            pass
        self.executor.shutdown(wait=False, cancel_futures=True)
        close = getattr(self.sandbox, "close", None)
        if callable(close):
            close()

    def _cancel_company_jobs(self, company_id: str) -> None:
        with self._jobs_lock:
            jobs = [(task_id, cancel) for task_id, (owner_id, cancel) in self._jobs.items() if owner_id == company_id]
            for _, cancel in jobs:
                cancel.set()
        # Let the worker thread own the terminal transition. A write that was
        # already in flight can still finish after the owner asks us to stop;
        # recording its verified file event before task.cancelled preserves the
        # durable order without ever allowing task.completed to commit.

    def _cancel_task_if_open(self, job: RuntimeJob, summary: str) -> None:
        with self._jobs_lock:
            task = self.task_store.get_task(job.task_id) if self.task_store else None
            if not task or task.status in {"completed", "failed", "cancelled"}:
                return
            task.status = "cancelled"
            self.task_store.save_task(task)
            self._publish("task.cancelled", job.company_id, job.task_id, job, summary, actor={"type": "user", "id": "owner"})

    def _commit_success_if_active(self, company_id: str, job: RuntimeJob, cancel: Event) -> None:
        with self._jobs_lock:
            if cancel.is_set():
                raise RuntimeCancelled()
            self._publish("task.completed", company_id, job.task_id, job, "Created test.txt with hello from orcha", {"artifact": "test.txt"})
            self._set_task_status(job.task_id, "completed", evidence=["test.txt"])

    def _mark_running_if_active(self, job: RuntimeJob, cancel: Event) -> None:
        with self._jobs_lock:
            if cancel.is_set():
                raise RuntimeCancelled()
            self._set_task_status(job.task_id, "running")

    @staticmethod
    def _ensure_active(cancel: Event) -> None:
        if cancel.is_set():
            raise RuntimeCancelled()

    def _publish(self, event_type: str, company_id: str, aggregate_id: str, job: RuntimeJob, summary: str, extra: dict | None = None, actor: dict | None = None) -> None:
        data = {
            "companyId": company_id,
            "taskId": job.task_id,
            "agentId": job.agent_id,
            "summary": summary[:300],
            **(extra or {}),
        }
        self.bus.publish(event_type, company_id, aggregate_id, actor or {"type": "sandbox", "id": "local_wsl"}, data)

    def _save_task(self, task: Task) -> None:
        if self.task_store:
            self.task_store.save_task(task)

    def _set_task_status(self, task_id: str, status: str, evidence: list[str] | None = None) -> None:
        if not self.task_store:
            return
        task = self.task_store.get_task(task_id)
        if not task:
            return
        task.status = status
        if evidence:
            task.evidence = evidence
        self.task_store.save_task(task)

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        if isinstance(exc, SandboxUnavailable):
            return "Local Workspace is offline. Start orcha-worker and try again."
        if isinstance(exc, (ValueError, RuntimeError)):
            return str(exc)[:300]
        return "The Local Workspace could not finish this task."
