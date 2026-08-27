"""Small persistent dispatcher for the local always-on company runtime."""

from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from orcha.agents.runner import AgentBlocked, AgentStopped
from orcha.domain.models import AgentStatus, Company, CompanyRun, CompanyStatus, Task, now
from orcha.runtime.awake import hold_pc_awake


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PersistentScheduler:
    """Continuously drains durable queued tasks while a company is running.

    It deliberately knows nothing about HTTP, a particular model provider, or
    WSL. The runner is replaceable, and all decisions are recorded as events.
    Always-on companies plan the next slice after a completed run, while this
    process and PC stay up.
    """

    def __init__(self, store, bus, runner, poll_seconds: float = 0.15, orchestrator=None, policy=None):
        self.store = store
        self.bus = bus
        self.runner = runner
        self.orchestrator = orchestrator
        self.policy = policy
        self.poll_seconds = poll_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="orcha-agents")
        self._in_flight: set[str] = set()
        self._lock = threading.Lock()
        self._lifecycle_lock = threading.RLock()
        self._last_heartbeat: dict[str, float] = {}
        self._holding_awake = False
        self._executor_closed = False
        self._started_at: datetime | None = None
        self._last_loop_at: datetime | None = None
        self._last_error: str | None = None
        self._active_companies = 0

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            if self._executor_closed:
                self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="orcha-agents")
                self._executor_closed = False
            self._stop.clear()
            self._started_at = _utc_now()
            self._thread = threading.Thread(target=self._loop, name="orcha-scheduler", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        with self._lock:
            executor = self._executor
            self._executor_closed = True
            self._active_companies = 0
        executor.shutdown(wait=False, cancel_futures=True)
        hold_pc_awake(False)
        self._holding_awake = False

    def health(self) -> dict[str, object]:
        """Return bounded scheduler liveness for operator diagnostics.

        Worker health alone is insufficient: the worker can be ready while
        the API's dispatcher has stopped. This projection intentionally
        exposes liveness and counts, not task prompts, model output, or
        exception text.
        """
        with self._lock:
            thread_alive = bool(self._thread and self._thread.is_alive()) and not self._stop.is_set() and self._last_loop_at is not None
            in_flight = len(self._in_flight)
            started_at = self._started_at.isoformat() if self._started_at else None
            last_loop_at = self._last_loop_at.isoformat() if self._last_loop_at else None
            return {
                "status": "ready" if thread_alive else "offline",
                "thread": "alive" if thread_alive else "stopped",
                "activeTasks": in_flight,
                "activeCompanies": self._active_companies,
                "startedAt": started_at,
                "lastLoopAt": last_loop_at,
                "lastError": self._last_error,
            }

    def resume_company(self, company_id: str) -> int:
        resumed = 0
        for task in self.store.list_tasks(company_id, ("blocked",)):
            task.status = "queued"
            task.blocked_reason_code = None
            self.store.save_task(task)
            self.bus.publish("task.resumed", company_id, task.id, {"type": "orchestrator", "id": "orch_v1"}, self._data(task, "Task requeued for the persistent runtime"))
            resumed += 1
        return resumed

    def task_is_in_flight(self, task_id: str) -> bool:
        """Return whether a scheduler worker has claimed a task."""
        with self._lock:
            return task_id in self._in_flight

    def quiesce_company(self, company_id: str) -> dict[str, int | bool]:
        """Stop new dispatch for a company and cancel work that never started.

        An in-flight model call is never force-killed here. The caller can use
        this result to require a quiet runtime before irreversible teardown.
        """
        with self._lifecycle_lock:
            cancelled = 0
            for task in self.store.list_tasks(company_id, ("queued", "blocked", "paused")):
                task.status = "cancelled"
                self.store.save_task(task)
                self.bus.publish("task.cancelled", company_id, task.id, {"type": "user", "id": "owner"}, self._data(task, "Cancelled before company teardown"))
                cancelled += 1
            with self._lock:
                active_task_ids = tuple(self._in_flight)
            active = any(
                task is not None and task.company_id == company_id
                for task in (self.store.get_task(task_id) for task_id in active_task_ids)
            )
            return {"cancelled": cancelled, "active": active}

    def stop_company(self, company_id: str) -> dict[str, int | bool]:
        """Cancel queued work and make late in-flight results non-committable.

        The API changes the company state before calling this; runners check that
        state between bounded provider and tool actions. The sandbox owns any
        child-process termination separately.
        """
        with self._lifecycle_lock:
            # The API writes this state before entering the scheduler, but
            # reassert it here after any in-flight cycle planner releases the
            # same lock so a stale snapshot can never resurrect always-on work.
            current = self.store.get_company(company_id)
            if current:
                current.status = CompanyStatus.stopped
                current.always_on = False
                current.next_cycle_at = None
                self.store.save_company(current)
            cancelled = 0
            for task in self.store.list_tasks(company_id, ("queued", "blocked", "paused")):
                task.status = "cancelled"
                self.store.save_task(task)
                self.bus.publish("task.cancelled", company_id, task.id, {"type": "user", "id": "owner"}, self._data(task, "Cancelled by the owner"))
                cancelled += 1
            with self._lock:
                active_task_ids = tuple(self._in_flight)
            active = any(
                task is not None and task.company_id == company_id
                for task in (self.store.get_task(task_id) for task_id in active_task_ids)
            )
            # If Stop All only found queued/blocked work, there is no worker
            # finally block left to close the parent run. Finalize it here so
            # the durable run state and the event stream agree immediately.
            # An in-flight task keeps ownership of finalization because its
            # runner still needs to publish the stopped agent boundary.
            if not active:
                for run in reversed(self.store.list_runs(company_id)):
                    if run.status in {"queued", "running", "blocked"}:
                        self._complete_run_if_terminal(company_id, run.id)
            return {"cancelled": cancelled, "active": active}

    def _loop(self) -> None:
        self._touch_loop()
        try:
            self._recover_interrupted_tasks()
        except Exception as exc:
            self._record_loop_error(exc)
        while not self._stop.wait(self.poll_seconds):
            try:
                self._touch_loop()
                self._recover_provider_blocks()
                self._continue_always_on_companies()
                self._heartbeat_and_awake()
                for task in self.store.list_runnable_tasks():
                    # The API can pause a queued task while this loop is between
                    # its database query and dispatch. Re-read the durable record
                    # so a stale query result cannot resurrect paused work.
                    current = self.store.get_task(task.id)
                    if not current or current.status != "queued":
                        continue
                    task = current
                    company = self.store.get_company(task.company_id)
                    if not company or company.status != CompanyStatus.running or task.kind != "agent":
                        continue
                    if not self._dependencies_met(task):
                        continue
                    claimed = self._claim_task(task)
                    if not claimed:
                        continue
                    task = claimed
                    with self._lock:
                        if task.id in self._in_flight:
                            self._release_task_lease(task.id)
                            continue
                        self._in_flight.add(task.id)
                    if not self._submit(company, task):
                        return
            except Exception as exc:
                # One malformed durable row or transient store error must not
                # silently kill the always-on dispatcher. Keep the error
                # intentionally coarse and retry on the next bounded tick.
                self._record_loop_error(exc)
                self._stop.wait(min(1.0, max(0.15, self.poll_seconds * 4)))

    def _touch_loop(self) -> None:
        with self._lock:
            self._last_loop_at = _utc_now()

    def _record_loop_error(self, exc: Exception) -> None:
        with self._lock:
            self._last_error = type(exc).__name__[:80]

    def _claim_task(self, task: Task) -> Task | None:
        """Claim queued work durably, with a safe compatibility fallback."""
        claim = getattr(self.store, "claim_task", None)
        if callable(claim):
            return claim(task.id, f"lease_{uuid4().hex}")
        # Test/future stores that predate durable leases retain the same
        # single-process behavior until they implement the contract.
        current = self.store.get_task(task.id)
        if not current or current.status != "queued":
            return None
        current.status = "running"
        self.store.save_task(current)
        return current

    def _release_task_lease(self, task_id: str) -> None:
        task = self.store.get_task(task_id)
        if not task or not task.lease_id:
            return
        task.lease_id = None
        task.leased_at = None
        self.store.save_task(task)

    def _recover_interrupted_tasks(self) -> None:
        """Reconcile durable specialist projections before dispatch resumes.

        A process restart can leave an Agent row at ``working`` while its
        durable task is being put back into the queue. Reset that projection to
        ``waiting`` first so the API dashboard, Agent Grid, and scheduler all
        describe the same recoverable state. Runtime control jobs still cancel
        fail-closed because they have no safe continuation point.
        """
        for task in self.store.requeue_interrupted_tasks():
            actor = {"type": "runtime", "id": "scheduler"}
            if task.kind == "agent":
                self._recover_agent_projection(task, actor)
                self.bus.publish("task.recovered", task.company_id, task.id, actor, self._data(task, "Recovered unfinished task after restart"))
            else:
                self.bus.publish("task.cancelled", task.company_id, task.id, actor, self._data(task, "Cancelled interrupted runtime operation after restart; retry is available"))
        self._reconcile_durable_runs()

    def _reconcile_durable_runs(self) -> None:
        """Close runs whose terminal tasks committed before a process restart.

        Run finalization and task persistence are separate SQLite writes. If
        the process stops between them, the task set is authoritative and the
        next scheduler instance must emit the missing terminal transition once
        before considering another always-on cycle.
        """
        list_runs = getattr(self.store, "list_runs", None)
        list_companies = getattr(self.store, "list_companies", None)
        if not callable(list_runs) or not callable(list_companies):
            return
        for company in list_companies():
            for run in list_runs(company.id):
                if run.status not in {"running", "queued", "blocked"}:
                    continue
                tasks = [task for task in self.store.list_tasks(company.id) if task.run_id == run.id]
                if any(task.status in {"queued", "running", "blocked", "paused"} for task in tasks):
                    continue
                # A process can stop after save_run() but before the plan's
                # tasks are committed. Treat that as an interrupted planning
                # run, not as an idle company: otherwise an always-on company
                # has no task row or next-cycle timestamp to wake it again.
                self._complete_run_if_terminal(company.id, run.id, allow_empty=True)

    def _recover_agent_projection(self, task: Task, actor: dict) -> None:
        """Make an interrupted Agent row truthful without inventing progress."""
        if not task.agent_id:
            return
        agent = self.store.get_agent(task.agent_id)
        if not agent:
            return
        previous_status = agent.status.value
        agent.status = AgentStatus.waiting
        agent.updated_at = now()
        self.store.save_agent(agent)
        self.bus.publish(
            "agent.status_changed",
            task.company_id,
            agent.id,
            actor,
            self._data(
                task,
                "Specialist recovered after restart and is waiting for scheduler dispatch",
                {
                    "agentId": agent.id,
                    "status": agent.status.value,
                    "previousStatus": previous_status,
                    "recovered": True,
                },
            ),
        )

    def _submit(self, company: Company, task: Task) -> bool:
        """Submit work unless the process is already shutting down.

        Python can begin interpreter shutdown while this daemon loop is between
        its stop check and executor submission. Treat that race as a clean exit
        and release the in-flight marker instead of leaking a traceback.
        """
        try:
            self._executor.submit(self._run, company, task)
            return True
        except RuntimeError as exc:
            with self._lock:
                self._in_flight.discard(task.id)
            if self._stop.is_set() or "shutdown" in str(exc).lower():
                return False
            raise

    def _dependencies_met(self, task: Task) -> bool:
        if not task.depends_on:
            return True
        dependencies = [self.store.get_task(task_id) for task_id in task.depends_on]
        if all(dependency and dependency.status == "completed" for dependency in dependencies):
            return True
        if any(dependency and dependency.status in {"failed", "cancelled"} for dependency in dependencies):
            task.status = "cancelled"
            self.store.save_task(task)
            self.bus.publish(
                "task.cancelled",
                task.company_id,
                task.id,
                {"type": "runtime", "id": "scheduler"},
                self._data(task, "Cancelled because a required predecessor did not complete"),
            )
            self._complete_run_if_terminal(task.company_id, task.run_id)
        return False

    def _run(self, company, task: Task) -> None:
        try:
            self.runner.execute(company, task)
            latest = self.store.get_task(task.id) or task
            if latest.status == "completed" and latest.attempts > 1:
                self.bus.publish(
                    "recovery.completed",
                    latest.company_id,
                    latest.id,
                    {"type": "runtime", "id": "scheduler"},
                    self._data(
                        latest,
                        "Bounded retry completed successfully",
                        {"recoveryType": "retry", "attempt": latest.attempts, "maxAttempts": latest.max_attempts},
                    ),
                )
            if latest.status == "completed" and latest.role == "qa" and latest.revision > 0 and latest.parent_task_id:
                self.bus.publish(
                    "recovery.completed",
                    latest.company_id,
                    latest.id,
                    {"type": "runtime", "id": "scheduler"},
                    self._data(
                        latest,
                        "QA recheck completed after the bounded revision",
                        {"recoveryType": "qa_revision", "parentTaskId": latest.parent_task_id},
                    ),
                )
            self._complete_run_if_terminal(task.company_id, task.run_id)
        except AgentStopped:
            self._complete_run_if_terminal(task.company_id, task.run_id)
            return
        except AgentBlocked as exc:
            # This is an explicit, resumable configuration block—not a false failure.
            self._block_run(task.company_id, task.run_id, str(exc))
            return
        except Exception:
            latest = self.store.get_task(task.id) or task
            self._mark_failed(latest)
            if latest.role == "qa" and latest.parent_task_id is None and latest.revision == 0:
                self._schedule_qa_revision(latest)
                self._complete_run_if_terminal(latest.company_id, latest.run_id)
                return
            if latest.attempts < latest.max_attempts:
                latest.status = "queued"
                self.store.save_task(latest)
                self.bus.publish(
                    "recovery.started",
                    latest.company_id,
                    latest.id,
                    {"type": "runtime", "id": "scheduler"},
                    self._data(
                        latest,
                        "Starting one bounded retry after the task failure",
                        {"recoveryType": "retry", "attempt": latest.attempts + 1, "maxAttempts": latest.max_attempts},
                    ),
                )
                self.bus.publish("task.retry_scheduled", latest.company_id, latest.id, {"type": "runtime", "id": "scheduler"}, self._data(latest, "Agent task failed safely; queued one bounded retry"))
            else:
                latest.status = "failed"
                self.store.save_task(latest)
                self.bus.publish("task.failed", latest.company_id, latest.id, {"type": "runtime", "id": "scheduler"}, self._data(latest, "Agent task exhausted its bounded retries"))
                self.bus.publish(
                    "escalation.created",
                    latest.company_id,
                    latest.id,
                    {"type": "runtime", "id": "scheduler"},
                    self._data(latest, "Escalated after the task exhausted its bounded retries", {"reason": "max_attempts_exhausted"}),
                )
                self._complete_run_if_terminal(latest.company_id, latest.run_id)
        finally:
            latest = self.store.get_task(task.id)
            if latest and latest.status != "running":
                latest.lease_id = None
                latest.leased_at = None
                self.store.save_task(latest)
            with self._lock:
                self._in_flight.discard(task.id)

    def _schedule_qa_revision(self, qa_task: Task) -> None:
        """Turn one verified QA failure into a single, traceable fix/recheck loop."""
        source_id = next(
            (
                task_id
                for task_id in qa_task.depends_on
                if (source := self.store.get_task(task_id)) is not None and source.role == "engineering"
            ),
            None,
        )
        if not source_id:
            qa_task.status = "failed"
            self.store.save_task(qa_task)
            self.bus.publish("task.failed", qa_task.company_id, qa_task.id, {"type": "runtime", "id": "scheduler"}, self._data(qa_task, "QA failed and no engineering task is available for a revision"))
            self.bus.publish(
                "escalation.created",
                qa_task.company_id,
                qa_task.id,
                {"type": "runtime", "id": "scheduler"},
                self._data(qa_task, "Escalated because QA had no engineering task to revise", {"reason": "no_engineering_dependency"}),
            )
            return
        source = self.store.get_task(source_id)
        if not source:
            return
        qa_task.status = "failed"
        self.store.save_task(qa_task)
        self.bus.publish("task.failed", qa_task.company_id, qa_task.id, {"type": "runtime", "id": "scheduler"}, self._data(qa_task, "QA found a verified failure; scheduling one bounded revision"))
        # Keep the verified failure in the immutable event log while marking the
        # original QA task as superseded so a successful recheck can complete
        # the run instead of being shadowed by its parent failure.
        qa_task.status = "superseded"
        self.store.save_task(qa_task)
        revision = Task(
            company_id=qa_task.company_id,
            role="engineering",
            title=f"Revise: {source.title}",
            instruction=(source.instruction + "\n\nQA reported a failed verification. Inspect the existing shared app/ files and correct the issue before handing it back."),
            capabilities=source.capabilities,
            acceptance_criteria=source.acceptance_criteria,
            depends_on=[source.id],
            parent_task_id=qa_task.id,
            run_id=qa_task.run_id,
            revision=1,
        )
        recheck = Task(
            company_id=qa_task.company_id,
            role="qa",
            title=f"Recheck: {qa_task.title}",
            instruction=qa_task.instruction,
            capabilities=qa_task.capabilities,
            acceptance_criteria=qa_task.acceptance_criteria,
            depends_on=[revision.id],
            parent_task_id=qa_task.id,
            run_id=qa_task.run_id,
            revision=1,
        )
        self.store.save_task(revision)
        self.store.save_task(recheck)
        actor = {"type": "orchestrator", "id": "orch_v1"}
        self.bus.publish(
            "recovery.started",
            qa_task.company_id,
            qa_task.id,
            actor,
            self._data(
                qa_task,
                "Starting one bounded engineering revision and QA recheck",
                {"recoveryType": "qa_revision", "recoveryTaskId": revision.id, "recheckTaskId": recheck.id, "parentTaskId": qa_task.id},
            ),
        )
        self.bus.publish("revision.requested", qa_task.company_id, qa_task.id, actor, self._data(qa_task, "QA requested one bounded engineering revision"))
        self.bus.publish("task.created", qa_task.company_id, revision.id, actor, self._data(revision, "Created an engineering revision from QA evidence", {"parentTaskId": qa_task.id, "revision": 1}))
        self.bus.publish("task.created", qa_task.company_id, recheck.id, actor, self._data(recheck, "Created a QA recheck after the engineering revision", {"parentTaskId": qa_task.id, "revision": 1}))

    def _complete_run_if_terminal(self, company_id: str, run_id: str | None, allow_empty: bool = False) -> None:
        if not run_id:
            return
        run = self.store.get_run(run_id)
        if not run or run.status not in {"running", "queued", "blocked"}:
            return
        tasks = [task for task in self.store.list_tasks(company_id) if task.run_id == run_id]
        if not tasks and not allow_empty:
            return
        if any(task.status in {"queued", "running", "blocked", "paused"} for task in tasks):
            return
        if not tasks:
            run.status, run.final_summary = "failed", "The run was interrupted before its task plan was persisted; no work was dispatched."
        elif any(task.status == "failed" for task in tasks):
            run.status, run.final_summary = "failed", "The run stopped after bounded retries or a failed QA recheck."
        elif any(task.status == "cancelled" for task in tasks):
            run.status, run.final_summary = "stopped", "The owner stopped this run."
        else:
            run.status, run.final_summary = "completed", "All planned specialist tasks and required checks completed."
        self.store.save_run(run)
        company = self.store.get_company(company_id)
        self.bus.publish(
            "company.run_completed",
            company_id,
            run.id,
            {"type": "orchestrator", "id": "orch_v1"},
            {
                "companyId": company_id,
                "runId": run.id,
                "summary": run.final_summary,
                "status": run.status,
                "alwaysOn": bool(company and company.always_on and company.status == CompanyStatus.running and run.status in {"completed", "failed"}),
            },
        )
        if company and company.always_on and company.status == CompanyStatus.running:
            delay = self._cycle_delay_seconds(run.status)
            if delay is not None:
                company.next_cycle_at = _utc_now() + timedelta(seconds=delay)
                self.store.save_company(company)
                self.bus.publish(
                    "company.cycle_scheduled",
                    company_id,
                    run.id,
                    {"type": "orchestrator", "id": "orch_v1"},
                    {"summary": "Next company slice is scheduled on this PC", "delaySeconds": delay, "after": run.status},
                )

    def _recover_provider_blocks(self) -> int:
        """Reopen only provider-blocked work after server configuration returns.

        A missing provider is an infrastructure condition, not a failed task.
        Always-on companies should recover without a phone click once a
        provider becomes available, but policy, capability, and owner-stop
        blocks must remain explicit gates. This method is intentionally safe to
        call on older stores because absent reason codes are not auto-resumed.
        """
        gateway = getattr(self.runner, "model_gateway", None)
        is_available = getattr(gateway, "is_available", None)
        if not callable(is_available):
            return 0
        try:
            if not bool(is_available()):
                return 0
        except Exception:
            # Provider health is advisory here. A transient health-check error
            # must never turn a blocked task into an unverified execution.
            return 0

        resumed = 0
        actor = {"type": "runtime", "id": "scheduler"}
        for company in self.store.list_companies():
            if not company.always_on or company.status != CompanyStatus.running:
                continue
            blocked = [
                task
                for task in self.store.list_tasks(company.id, ("blocked",))
                if task.blocked_reason_code == "provider_unavailable"
            ]
            if not blocked:
                continue
            reopened_run_ids: set[str] = set()
            for task in blocked:
                task.status = "queued"
                task.blocked_reason_code = None
                task.attempts = 0
                task.lease_id = None
                task.leased_at = None
                self.store.save_task(task)
                if task.run_id:
                    reopened_run_ids.add(task.run_id)
                agent = self.store.get_agent(task.agent_id or "")
                if agent:
                    agent.status = AgentStatus.waiting
                    agent.updated_at = now()
                    self.store.save_agent(agent)
                    self.bus.publish(
                        "agent.status_changed",
                        company.id,
                        agent.id,
                        actor,
                        self._data(
                            task,
                            "Provider returned; specialist is waiting to resume",
                            {"agentId": agent.id, "status": agent.status.value, "recovered": True},
                        ),
                    )
                self.bus.publish(
                    "recovery.started",
                    company.id,
                    task.id,
                    actor,
                    self._data(
                        task,
                        "Provider returned; requeueing the blocked specialist task",
                        {"recoveryType": "provider_reconnect", "blockReason": "provider_unavailable"},
                    ),
                )
                self.bus.publish(
                    "task.resumed",
                    company.id,
                    task.id,
                    actor,
                    self._data(task, "Provider returned; task requeued for the persistent runtime", {"recoveryType": "provider_reconnect"}),
                )
                resumed += 1
            for run_id in reopened_run_ids:
                run = self.store.get_run(run_id)
                if not run or run.status != "blocked":
                    continue
                # A run may contain a provider outage and an independent
                # policy/capability gate. Requeueing the safe infrastructure
                # work must not make the parent run look fully resumed while a
                # manual block is still holding another task.
                if any(
                    task.status == "blocked" and task.run_id == run.id
                    for task in self.store.list_tasks(company.id)
                ):
                    continue
                run.status = "running"
                run.final_summary = None
                self.store.save_run(run)
                self.bus.publish(
                    "company.run_resumed",
                    company.id,
                    run.id,
                    {"type": "orchestrator", "id": "orch_v1"},
                    {
                        "companyId": company.id,
                        "runId": run.id,
                        "summary": "Provider returned; the always-on company run resumed automatically",
                        "recoveryType": "provider_reconnect",
                    },
                )
        return resumed

    def _mark_failed(self, task: Task) -> None:
        agent = self.store.get_agent(task.agent_id or "")
        actor = {"type": "runtime", "id": "scheduler"}
        if agent:
            agent.status = AgentStatus.failed
            self.store.save_agent(agent)
            self.bus.publish("agent.status_changed", task.company_id, agent.id, actor, self._data(task, f"{task.role.title()} encountered a bounded execution failure") | {"agentId": agent.id, "status": agent.status.value})
            self.bus.publish("agent.failed", task.company_id, task.id, actor, self._data(task, "Agent failed safely; the scheduler will recover or stop it"))

    def _block_run(self, company_id: str, run_id: str | None, reason: str) -> None:
        if not run_id:
            return
        run = self.store.get_run(run_id)
        if not run or run.status == "blocked":
            return
        run.status = "blocked"
        run.final_summary = reason[:300]
        self.store.save_run(run)
        self.bus.publish("company.run_blocked", company_id, run.id, {"type": "orchestrator", "id": "orch_v1"}, {"companyId": company_id, "runId": run.id, "summary": run.final_summary, "status": run.status})

    @staticmethod
    def _data(task: Task, summary: str, extra: dict | None = None) -> dict:
        payload = {
            "companyId": task.company_id,
            "taskId": task.id,
            "agentId": task.agent_id or f"agent_{task.role}",
            "role": task.role,
            "summary": summary,
            "title": task.title,
            "revision": task.revision,
        }
        if extra:
            payload.update(extra)
        return payload

    @staticmethod
    def _env_seconds(name: str, default: float) -> float:
        try:
            return max(0.05, float(os.getenv(name, str(default))))
        except ValueError:
            return default

    def _cycle_delay_seconds(self, run_status: str) -> float | None:
        if run_status == "completed":
            return self._env_seconds("ORCHA_ALWAYS_ON_CYCLE_SECONDS", 12)
        if run_status == "failed":
            return self._env_seconds("ORCHA_ALWAYS_ON_RETRY_SECONDS", 45)
        return None

    def _has_open_work(self, company_id: str) -> bool:
        with self._lock:
            in_flight = [self.store.get_task(task_id) for task_id in self._in_flight]
        if any(task is not None and task.company_id == company_id for task in in_flight):
            return True
        return any(task.status in {"queued", "running", "blocked", "paused"} for task in self.store.list_tasks(company_id))

    def _continue_always_on_companies(self) -> None:
        if self.orchestrator is None:
            return
        now = _utc_now()
        for company in self.store.list_companies():
            if not company.always_on or company.status != CompanyStatus.running:
                continue
            if self._has_open_work(company.id):
                continue
            due = False
            if company.next_cycle_at is not None:
                due_at = company.next_cycle_at
                if due_at.tzinfo is None:
                    due_at = due_at.replace(tzinfo=timezone.utc)
                due = due_at <= now
            idle_resume = (
                company.next_cycle_at is None
                and company.cycle_count >= 1
                and any(True for _ in self.store.list_tasks(company.id))
            )
            if not due and not idle_resume:
                continue
            self._start_next_cycle(company)

    def _start_next_cycle(self, company: Company) -> None:
        with self._lifecycle_lock:
            current = self.store.get_company(company.id)
            if not current or current.status != CompanyStatus.running or not current.always_on:
                return
            company = current
            if self.policy is not None:
                decision = self.policy.can_start(company)
                if not decision.allowed:
                    company.next_cycle_at = _utc_now() + timedelta(seconds=self._env_seconds("ORCHA_ALWAYS_ON_RETRY_SECONDS", 45))
                    self.store.save_company(company)
                    self.bus.publish(
                        "company.cycle_deferred",
                        company.id,
                        company.id,
                        {"type": "orchestrator", "id": "orch_v1"},
                        {"summary": decision.reason},
                    )
                    return
            company.cycle_count = max(company.cycle_count, 1) + 1
            company.next_cycle_at = None
            run = CompanyRun(company_id=company.id, goal=company.goal, status="running")
            evidence = "\n".join(self.store.recent_memory(company.id))
            self.store.save_run(run)
            tasks = self.orchestrator.start(company, run.id, evidence=evidence, cycle=company.cycle_count)
            latest = self.store.get_company(company.id)
            if not latest or latest.status != CompanyStatus.running or not latest.always_on:
                run.status = "stopped"
                run.final_summary = "The owner stopped the company while the next slice was being planned."
                self.store.save_run(run)
                return
            self.store.save_company(company)
            for task in tasks:
                self.store.save_task(task)

    def _heartbeat_and_awake(self) -> None:
        active = False
        interval = self._env_seconds("ORCHA_ALWAYS_ON_HEARTBEAT_SECONDS", 4)
        now = time.monotonic()
        for company in self.store.list_companies():
            if not company.always_on or company.status != CompanyStatus.running:
                continue
            active = True
            last = self._last_heartbeat.get(company.id, 0)
            if now - last < interval:
                continue
            self._last_heartbeat[company.id] = now
            self.bus.publish(
                "company.heartbeat",
                company.id,
                company.id,
                {"type": "orchestrator", "id": "orch_v1"},
                {"summary": "Company is running on this PC", "cycle": company.cycle_count or 1},
            )
        with self._lock:
            self._active_companies = sum(
                1
                for company in self.store.list_companies()
                if company.always_on and company.status == CompanyStatus.running
            )
        if active != self._holding_awake:
            hold_pc_awake(active)
            self._holding_awake = active
