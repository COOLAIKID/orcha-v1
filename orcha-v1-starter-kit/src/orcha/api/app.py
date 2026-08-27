from __future__ import annotations

import asyncio
import os
import json
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from pathlib import PurePosixPath

from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, Response, StreamingResponse
from orcha.api.chat import ChatRequest, ChatUnavailable, ServerChatService, sse_frame
from orcha.agents.runner import LocalAgentRunner
from orcha.config import load_local_environment
from orcha.domain.models import AgentInbox, ArtifactClassification, ArtifactTier, Company, CompanyCreate, CompanyDestroyRequest, CompanyRun, CompanyRunCreate, CompanyStatus, Experiment, ExperimentCreate, ExperimentDecision, ExperimentObservation, ExperimentObservationCreate, ExperimentStatus, HireState, LocalOnlyFile, LocalOnlyFileRegister, team_for_role, team_snapshots
from orcha.feedback.service import FeedbackPayload, FeedbackSink, LocalFeedbackSink, make_feedback_record
from orcha.models.gateway import EnvironmentModelGateway, cancel_with_scope, close_model_gateway
from orcha.persistence import SQLiteStateStore
from orcha.runtime.local_runtime import LocalRuntimeService, RuntimeService
from orcha.runtime.orchestrator import Orchestrator
from orcha.runtime.policy import RuntimePolicy
from orcha.runtime.experiments import evaluate
from orcha.runtime.scheduler import PersistentScheduler
from orcha.sandbox.contracts import SandboxManager
from orcha.sandbox.cloud import CloudSandboxManager
from orcha.sandbox.local_wsl import LocalWslSandboxManager, SandboxUnavailable

load_local_environment()

def _default_database_path() -> str:
    return os.getenv("ORCHA_DATABASE_URL", "sqlite:///var/orcha.db")


def _default_sandbox() -> SandboxManager:
    if os.getenv("ORCHA_SANDBOX_PROVIDER", "local_wsl").strip().lower() == "cloud":
        return CloudSandboxManager()
    return LocalWslSandboxManager()


def create_app(
    sandbox: SandboxManager | None = None,
    feedback_sink: FeedbackSink | None = None,
    state_store: SQLiteStateStore | None = None,
    database_path: str | Path | None = None,
    model_gateway=None,
    scheduler: PersistentScheduler | None = None,
    runtime: RuntimeService | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def persistent_runtime_lifespan(application: FastAPI):
        application.state.scheduler.start()
        try:
            yield
        finally:
            application.state.scheduler.stop()
            try:
                application.state.runtime.close()
            finally:
                # A replaceable RuntimeService may not own the sandbox passed
                # to create_app (for example, a hosted adapter or test fake).
                # Close the app-level provider as a second idempotent boundary
                # so a persistent cloud client cannot outlive the control
                # plane. LocalRuntimeService already closes this same object.
                close_sandbox = getattr(application.state.sandbox, "close", None)
                if callable(close_sandbox):
                    try:
                        close_sandbox()
                    except Exception:
                        pass
                # A provider request is external to the scheduler executor.
                # Make the process-wide cancellation boundary explicit on API
                # shutdown so it cannot outlive the control plane.
                close_model_gateway(application.state.model_gateway)

    app = FastAPI(title="Orcha V1 API", version="0.1.0", lifespan=persistent_runtime_lifespan)
    app.state.store = state_store or SQLiteStateStore(database_path or _default_database_path())
    app.state.bus = app.state.store
    app.state.sandbox = sandbox or _default_sandbox()
    app.state.runtime = runtime or LocalRuntimeService(app.state.bus, app.state.sandbox, app.state.store)
    app.state.feedback_sink = feedback_sink or LocalFeedbackSink()
    app.state.model_gateway = model_gateway or EnvironmentModelGateway()
    app.state.chat_service = ServerChatService(app.state.model_gateway)
    app.state.orchestrator = Orchestrator(app.state.bus, app.state.model_gateway)
    app.state.runtime_policy = RuntimePolicy(app.state.store)
    app.state.agent_runner = LocalAgentRunner(app.state.bus, app.state.store, app.state.sandbox, app.state.model_gateway, app.state.runtime_policy)
    app.state.scheduler = scheduler or PersistentScheduler(
        app.state.store,
        app.state.bus,
        app.state.agent_runner,
        orchestrator=app.state.orchestrator,
        policy=app.state.runtime_policy,
    )
    # API handlers run in a threadpool. Serialize runtime ownership changes so
    # two mobile/tunnel retries cannot both pause each other and then persist
    # themselves as the latest running company.
    app.state.runtime_control_lock = threading.RLock()

    def company_or_404(company_id: str) -> Company:
        company = app.state.store.get_company(company_id)
        if not company:
            raise HTTPException(404, "Company not found")
        return company

    def task_or_404(company_id: str, task_id: str):
        task = app.state.store.get_task(task_id)
        if not task or task.company_id != company_id:
            raise HTTPException(404, "Task not found")
        return task

    def task_event_data(task, summary: str, **extra):
        return {
            "companyId": task.company_id,
            "taskId": task.id,
            "agentId": task.agent_id or f"agent_{task.role}",
            "role": task.role,
            "team": team_for_role(task.role).value,
            "hired": HireState.hired.value,
            "title": task.title,
            "summary": summary[:300],
            **extra,
        }

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "orcha-api"}

    @app.get("/health/ready")
    def readiness():
        """Return process readiness for a supervisor or container probe.

        ``/health`` intentionally remains a cheap process-liveness probe. This
        deeper check is the restart boundary for a long-running deployment: it
        requires both the configured workspace provider and the persistent
        dispatcher to be ready, without requiring a model provider because a
        company can legitimately be waiting on provider configuration.
        """
        worker = app.state.runtime.health().model_dump(mode="json")
        scheduler = app.state.scheduler.health() if hasattr(app.state.scheduler, "health") else None
        scheduler_ready = scheduler is None or scheduler.get("status") == "ready"
        ready = worker.get("status") == "ready" and scheduler_ready
        payload = {
            "status": "ready" if ready else "not_ready",
            "service": "orcha-api",
            "worker": worker,
            "scheduler": scheduler,
        }
        return payload if ready else JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=payload)

    @app.post("/api/chat")
    def chat(payload: ChatRequest):
        """Production/static-deployment chat boundary with the Vite SSE shape."""
        try:
            reply = app.state.chat_service.reply(payload)
        except ChatUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        metadata = {key: value for key, value in {"provider": reply.provider, "model": reply.model}.items() if value}

        def stream():
            yield sse_frame({"delta": reply.content, **metadata})
            yield sse_frame({"done": True})

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    @app.post("/v1/companies", status_code=status.HTTP_201_CREATED)
    def create_company(payload: CompanyCreate):
        company = Company(name=payload.name, goal=payload.goal, constraints=payload.constraints,
                          objective={"statement": payload.goal, "metrics": ["milestone_completion", "reliability", "cost"]})
        app.state.store.save_company(company)
        app.state.bus.publish("company.created", company.id, company.id, {"type": "user", "id": "owner"}, company.model_dump(mode="json"))
        return {"company": company, "required_capabilities": ["repo.write", "shell.test"], "plan_preview": "Ready to generate a minimal team."}

    def yield_pc_to(company_id: str) -> None:
        for paused_id in app.state.store.pause_other_running_companies(company_id):
            app.state.bus.publish(
                "company.paused",
                paused_id,
                paused_id,
                {"type": "runtime", "id": "scheduler"},
                {"summary": "Paused so the latest company can use this PC"},
            )

    def start_run(company: Company, goal: str, always_on: bool | None = None) -> dict:
        with app.state.runtime_control_lock:
            current = app.state.store.get_company(company.id) or company
            active_finder = getattr(app.state.store, "active_run", None)
            active = active_finder(current.id) if callable(active_finder) else next(
                (candidate for candidate in reversed(app.state.store.list_runs(current.id)) if candidate.status in {"queued", "running", "blocked"}),
                None,
            )
            if active:
                if active.goal.strip() != goal.strip():
                    raise HTTPException(409, "This company already has an active run. Stop it before starting a different goal.")
                return {
                    "company": current,
                    "run": active,
                    "tasks": [task for task in app.state.store.list_tasks(current.id) if task.run_id == active.id],
                    "reused": True,
                }
            yield_pc_to(current.id)
            current.goal = goal
            current.objective.statement = goal
            if always_on is not None:
                current.always_on = always_on
            if current.always_on and current.cycle_count < 1:
                current.cycle_count = 1
            run = CompanyRun(company_id=current.id, goal=goal, status="running")
            app.state.store.save_run(run)
            current.status = CompanyStatus.running
            app.state.store.save_company(current)
            run_id = run.id
            cycle = max(current.cycle_count, 1)
        tasks = app.state.orchestrator.start(current, run_id, cycle=cycle)
        with app.state.runtime_control_lock:
            latest = app.state.store.get_company(current.id) or current
            if latest.status == CompanyStatus.stopped:
                # Planning happens outside the control lock because it may
                # wait on a provider. If Stop All wins that race, persist the
                # planned work as cancelled and never resurrect the company
                # or start the scheduler behind the owner's back.
                for task in tasks:
                    task.status = "cancelled"
                    app.state.store.save_task(task)
                    app.state.bus.publish(
                        "task.cancelled",
                        latest.id,
                        task.id,
                        {"type": "user", "id": "owner"},
                        task_event_data(task, "Cancelled because the owner stopped the company during planning"),
                    )
                run.status = "stopped"
                run.final_summary = "The owner stopped this company while its next plan was being prepared."
                app.state.store.save_run(run)
                app.state.bus.publish(
                    "company.run_completed",
                    latest.id,
                    run.id,
                    {"type": "user", "id": "owner"},
                    {"companyId": latest.id, "runId": run.id, "summary": run.final_summary, "status": run.status, "alwaysOn": False},
                )
                return {"company": latest, "run": run, "tasks": tasks, "reused": False}
            if latest.status != CompanyStatus.paused:
                latest.status = CompanyStatus.running
                app.state.store.save_company(latest)
            for task in tasks:
                app.state.store.save_task(task)
            app.state.scheduler.start()
        return {"company": latest, "run": run, "tasks": tasks, "reused": False}

    @app.post("/v1/companies/{company_id}/start")
    def start_company(company_id: str):
        company = company_or_404(company_id)
        return start_run(company, company.goal)

    @app.post("/v1/companies/{company_id}/runs", status_code=status.HTTP_202_ACCEPTED)
    def create_company_run(company_id: str, payload: CompanyRunCreate):
        return start_run(company_or_404(company_id), payload.goal, payload.always_on)

    @app.post("/v1/companies/{company_id}/runtime/resume")
    def resume_runtime(company_id: str):
        with app.state.runtime_control_lock:
            company = company_or_404(company_id)
            yield_pc_to(company.id)
            company.status = CompanyStatus.running
            if company.always_on:
                company.next_cycle_at = None
            app.state.store.save_company(company)
            app.state.scheduler.start()
            return {"companyId": company.id, "resumed": app.state.scheduler.resume_company(company.id)}

    @app.post("/v1/companies/{company_id}/runtime/pause")
    def pause_runtime(company_id: str):
        with app.state.runtime_control_lock:
            company = company_or_404(company_id)
            company.status = CompanyStatus.paused
            app.state.store.save_company(company)
            app.state.bus.publish("company.paused", company.id, company.id, {"type": "user", "id": "owner"}, {"summary": "Company runtime paused"})
            return {"companyId": company.id, "status": company.status}

    @app.get("/v1/companies/{company_id}/events")
    def events(company_id: str, since: int = Query(default=0, ge=0)):
        company_or_404(company_id)
        return {"events": [event.model_dump(mode="json") for event in app.state.bus.list(company_id, since)]}

    @app.get("/v1/companies/{company_id}/events/stream")
    async def event_stream(company_id: str, request: Request, since: int = Query(default=0, ge=0)):
        company_or_404(company_id)

        async def stream():
            cursor = since
            last_keepalive = time.monotonic()
            # EventSource clients reconnect automatically. This keeps a phone
            # or temporary tunnel from waiting on the browser's default delay.
            yield "retry: 1500\n\n"
            while True:
                if await request.is_disconnected():
                    return
                items = app.state.bus.list(company_id, cursor)
                if items:
                    for event in items:
                        if await request.is_disconnected():
                            return
                        cursor = event.sequence
                        yield f"id: {cursor}\nevent: runtime\ndata: {json.dumps(event.model_dump(mode='json'))}\n\n"
                    continue
                if time.monotonic() - last_keepalive >= 15:
                    yield ": keepalive\n\n"
                    last_keepalive = time.monotonic()
                await asyncio.sleep(0.35)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    @app.get("/v1/companies/{company_id}/dashboard")
    def dashboard(company_id: str):
        company = company_or_404(company_id)
        events = app.state.bus.list(company_id)
        tasks = app.state.store.list_tasks(company_id)
        agents = app.state.store.list_agents(company_id)
        return {
            "company": company,
            "objective": company.objective,
            "tasks": tasks,
            "agents": agents,
            "teams": team_snapshots(agents),
            "artifacts": app.state.store.list_artifacts(company_id),
            "messages": app.state.store.recent_messages(company_id),
            "experiments": app.state.store.list_experiments(company_id),
            "activity": events[-40:],
            "truth_source": "durable_domain_events",
        }

    @app.get("/v1/companies/{company_id}/tasks")
    def list_tasks(company_id: str):
        company_or_404(company_id)
        return {"tasks": app.state.store.list_tasks(company_id), "truth_source": "durable_task_state"}

    @app.post("/v1/companies/{company_id}/tasks/{task_id}/pause")
    def pause_task(company_id: str, task_id: str):
        company_or_404(company_id)
        task = task_or_404(company_id, task_id)
        if app.state.scheduler.task_is_in_flight(task.id) or task.status == "running":
            raise HTTPException(status_code=409, detail="A running task cannot be paused. Use Stop All to cancel active work.")
        if task.status not in {"queued", "blocked"}:
            raise HTTPException(status_code=409, detail=f"A {task.status} task cannot be paused.")
        task.status = "paused"
        app.state.store.save_task(task)
        app.state.bus.publish(
            "task.paused",
            company_id,
            task.id,
            {"type": "user", "id": "owner"},
            task_event_data(task, "Paused before dispatch; retry is available", status="paused"),
        )
        return {"task": task, "status": task.status}

    @app.post("/v1/companies/{company_id}/tasks/{task_id}/retry")
    def retry_task(company_id: str, task_id: str):
        company = company_or_404(company_id)
        task = task_or_404(company_id, task_id)
        if task.kind != "agent":
            raise HTTPException(status_code=409, detail="Runtime control tasks are retried through their dedicated runtime action.")
        if app.state.scheduler.task_is_in_flight(task.id) or task.status == "running":
            raise HTTPException(status_code=409, detail="A running task cannot be retried.")
        if task.status not in {"failed", "cancelled", "blocked", "paused"}:
            raise HTTPException(status_code=409, detail=f"A {task.status} task is not awaiting retry.")
        if company.status != CompanyStatus.running:
            raise HTTPException(status_code=409, detail="Resume the company before retrying this task.")
        previous_attempts = task.attempts
        task.status = "queued"
        task.blocked_reason_code = None
        # An owner-requested retry starts a fresh bounded attempt window. The
        # daily runtime policy still applies, while an exhausted task is not
        # silently granted unlimited execution.
        task.attempts = 0
        app.state.store.save_task(task)
        if task.run_id:
            run = app.state.store.get_run(task.run_id)
            if run and run.status in {"failed", "stopped", "blocked"}:
                run.status = "running"
                run.final_summary = None
                app.state.store.save_run(run)
        app.state.bus.publish(
            "task.retry_requested",
            company_id,
            task.id,
            {"type": "user", "id": "owner"},
            task_event_data(task, "Retry requested; task requeued for the persistent runtime", status="queued", previousAttempts=previous_attempts),
        )
        app.state.scheduler.start()
        return {"task": task, "status": task.status}

    @app.get("/v1/companies/{company_id}/agents/{agent_id}/inbox")
    def agent_inbox(company_id: str, agent_id: str, limit: int = Query(default=50, ge=1, le=100)):
        company_or_404(company_id)
        agent = app.state.store.get_agent(agent_id)
        if not agent or agent.company_id != company_id:
            raise HTTPException(status_code=404, detail="Agent not found")
        inbox = AgentInbox(
            company_id=company_id,
            agent_id=agent.id,
            inbox_id=agent.inbox_id,
            address=agent.inbox_address,
        )
        return {
            "agentId": agent.id,
            "inboxId": agent.inbox_id,
            "inboxAddress": agent.inbox_address,
            "inbox": inbox,
            "messages": app.state.store.list_agent_messages(company_id, agent.id, limit),
            "truth_source": "durable_agent_messages",
            "delivery": "internal_only",
        }

    @app.get("/v1/companies/{company_id}/inboxes")
    def company_inboxes(company_id: str):
        """List stable, internal-only mailbox identities for active specialists."""

        company_or_404(company_id)
        inboxes = [
            AgentInbox(
                company_id=company_id,
                agent_id=agent.id,
                inbox_id=agent.inbox_id,
                address=agent.inbox_address,
            ).model_dump(mode="json")
            for agent in app.state.store.list_agents(company_id)
            if agent.hired == HireState.hired
        ]
        return {
            "inboxes": inboxes,
            "delivery": "internal_only",
            "external_delivery_enabled": False,
            "truth_source": "durable_agent_records",
        }

    @app.get("/v1/companies/{company_id}/artifacts")
    def list_artifacts(company_id: str):
        company_or_404(company_id)
        return {"artifacts": app.state.store.list_artifacts(company_id)}

    @app.post("/v1/companies/{company_id}/files/classify")
    def classify_artifact(company_id: str, payload: ArtifactClassification):
        company_or_404(company_id)
        artifact = app.state.store.get_artifact(payload.file_id)
        if not artifact or artifact.company_id != company_id:
            raise HTTPException(status_code=404, detail="Artifact not found")
        if payload.tier == ArtifactTier.local_only:
            raise HTTPException(
                status_code=409,
                detail="A worker artifact cannot be reclassified Local Only because it already entered the Company Vault. Register Local Only metadata before any upload or agent task.",
            )
        artifact.tier = payload.tier
        app.state.store.save_artifact(artifact)
        app.state.bus.publish("file.classified", company_id, artifact.id, {"type": "user", "id": "owner"}, {
            "artifactId": artifact.id,
            "tier": artifact.tier.value,
            "summary": f"Classified {artifact.name} as {artifact.tier.value.replace('_', ' ')}",
        })
        return {"artifact": artifact}

    @app.post("/v1/companies/{company_id}/local-only-files", status_code=status.HTTP_201_CREATED)
    def register_local_only_file(company_id: str, payload: LocalOnlyFileRegister):
        company_or_404(company_id)
        record = LocalOnlyFile.from_register(company_id, payload)
        app.state.store.save_local_only_file(record)
        app.state.bus.publish("file.classified", company_id, record.id, {"type": "user", "id": "owner"}, {
            "fileId": record.id,
            "tier": record.tier.value,
            "summary": f"Registered Local Only metadata for {record.name}; its contents never entered the company runtime.",
        })
        return {"file": record}

    @app.get("/v1/companies/{company_id}/local-only-files")
    def list_local_only_files(company_id: str):
        company_or_404(company_id)
        return {"files": app.state.store.list_local_only_files(company_id)}

    def experiment_or_404(company_id: str, experiment_id: str) -> Experiment:
        experiment = app.state.store.get_experiment(experiment_id)
        if not experiment or experiment.company_id != company_id:
            raise HTTPException(404, "Experiment not found")
        return experiment

    @app.post("/v1/companies/{company_id}/experiments", status_code=status.HTTP_201_CREATED)
    def create_experiment(company_id: str, payload: ExperimentCreate):
        company_or_404(company_id)
        experiment = Experiment.from_create(company_id, payload)
        app.state.store.save_experiment(experiment)
        app.state.bus.publish("experiment.created", company_id, experiment.id, {"type": "user", "id": "owner"}, {
            "experimentId": experiment.id,
            "summary": f"Proposed {experiment.target_type} experiment: {experiment.baseline_version} vs {experiment.candidate_version}",
            "primaryMetric": experiment.primary_metric,
            "sampleWindow": experiment.sample_window,
        })
        return {"experiment": experiment}

    @app.get("/v1/companies/{company_id}/experiments")
    def list_experiments(company_id: str):
        company_or_404(company_id)
        return {"experiments": app.state.store.list_experiments(company_id)}

    @app.get("/v1/companies/{company_id}/experiments/{experiment_id}")
    def get_experiment(company_id: str, experiment_id: str):
        return {"experiment": experiment_or_404(company_id, experiment_id), "evaluation": evaluate(experiment_or_404(company_id, experiment_id)).__dict__}

    @app.post("/v1/companies/{company_id}/experiments/{experiment_id}/observations", status_code=status.HTTP_201_CREATED)
    def record_experiment_observation(company_id: str, experiment_id: str, payload: ExperimentObservationCreate):
        experiment = experiment_or_404(company_id, experiment_id)
        if experiment.status in {ExperimentStatus.promoted, ExperimentStatus.rolled_back}:
            raise HTTPException(status_code=409, detail="A decided experiment cannot accept more observations.")
        observation = ExperimentObservation(**payload.model_dump())
        experiment.observations.append(observation)
        experiment.status = ExperimentStatus.evaluating
        experiment.updated_at = observation.recorded_at
        app.state.store.save_experiment(experiment)
        app.state.bus.publish("experiment.observation_recorded", company_id, experiment.id, {"type": "evaluator", "id": "local"}, {
            "experimentId": experiment.id,
            "summary": f"Recorded {observation.variant} {experiment.primary_metric} evidence",
            "variant": observation.variant,
            "costUsd": observation.cost_usd,
        })
        return {"experiment": experiment, "evaluation": evaluate(experiment).__dict__}

    @app.post("/v1/companies/{company_id}/experiments/{experiment_id}/promote")
    def promote_experiment(company_id: str, experiment_id: str):
        experiment = experiment_or_404(company_id, experiment_id)
        if experiment.status == ExperimentStatus.rolled_back:
            raise HTTPException(status_code=409, detail="A rolled-back experiment cannot be promoted again.")
        result = evaluate(experiment)
        if not result.promotable:
            app.state.bus.publish("experiment.promotion_rejected", company_id, experiment.id, {"type": "policy", "id": "evaluator"}, {"experimentId": experiment.id, "summary": result.reason})
            raise HTTPException(status_code=409, detail=result.reason)
        experiment.status = ExperimentStatus.promoted
        experiment.promoted_version = experiment.candidate_version
        experiment.rollback_target = experiment.baseline_version
        experiment.decisions.append(ExperimentDecision(decision="promoted", reason=result.reason))
        app.state.store.save_experiment(experiment)
        app.state.bus.publish("experiment.promoted", company_id, experiment.id, {"type": "policy", "id": "evaluator"}, {"experimentId": experiment.id, "summary": result.reason, "rollbackTarget": experiment.rollback_target})
        return {"experiment": experiment, "evaluation": result.__dict__}

    @app.post("/v1/companies/{company_id}/experiments/{experiment_id}/rollback")
    def rollback_experiment(company_id: str, experiment_id: str):
        experiment = experiment_or_404(company_id, experiment_id)
        if experiment.status != ExperimentStatus.promoted:
            raise HTTPException(status_code=409, detail="Only a promoted experiment has a rollback target.")
        experiment.status = ExperimentStatus.rolled_back
        experiment.promoted_version = experiment.baseline_version
        experiment.decisions.append(ExperimentDecision(decision="rolled_back", reason=f"Restored retained baseline {experiment.baseline_version}."))
        app.state.store.save_experiment(experiment)
        app.state.bus.publish("experiment.rolled_back", company_id, experiment.id, {"type": "user", "id": "owner"}, {"experimentId": experiment.id, "summary": f"Rolled back to {experiment.baseline_version}", "rollbackTarget": experiment.baseline_version})
        return {"experiment": experiment}

    @app.get("/v1/runtime/health")
    def runtime_health():
        health = app.state.runtime.health().model_dump(mode="json")
        health["agentProviderConfigured"] = app.state.model_gateway.is_available()
        health["providers"] = app.state.model_gateway.health() if hasattr(app.state.model_gateway, "health") else []
        scheduler_health = app.state.scheduler.health() if hasattr(app.state.scheduler, "health") else None
        if scheduler_health is not None:
            health["scheduler"] = scheduler_health
        return health

    @app.get("/v1/internal/diagnostics")
    def diagnostics():
        if os.getenv("ORCHA_INTERNAL_DIAGNOSTICS", "false").lower() != "true":
            raise HTTPException(status_code=404, detail="Not found")
        return {
            "providers": app.state.model_gateway.health() if hasattr(app.state.model_gateway, "health") else [],
            "worker": app.state.runtime.health().model_dump(mode="json"),
            "scheduler": app.state.scheduler.health() if hasattr(app.state.scheduler, "health") else None,
            "eventStore": "sqlite",
            "eventStream": "sse",
        }

    @app.get("/v1/companies/{company_id}/preview/{asset_path:path}")
    def preview_asset(company_id: str, asset_path: str = "index.html"):
        company_or_404(company_id)
        pure = PurePosixPath(asset_path or "index.html")
        if pure.is_absolute() or ".." in pure.parts or pure.suffix.lower() not in {".html", ".css", ".js", ".json", ".svg", ".txt"}:
            raise HTTPException(status_code=400, detail="Preview path is not permitted")
        try:
            result = app.state.sandbox.read_file(company_id, f"app/{pure.as_posix()}")
        except SandboxUnavailable as exc:
            raise HTTPException(status_code=503, detail="Local Workspace is offline.") from exc
        content = result.result.get("content") if isinstance(result.result, dict) else None
        if not isinstance(content, str):
            raise HTTPException(status_code=404, detail="Preview asset not found")
        media_type = {".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml"}.get(pure.suffix.lower(), "text/plain")
        return Response(content=content, media_type=media_type, headers={"Cache-Control": "no-store"})

    @app.post("/v1/companies/{company_id}/runtime/workspace-check", status_code=status.HTTP_202_ACCEPTED)
    def workspace_check(company_id: str):
        company = company_or_404(company_id)
        job = app.state.runtime.start_workspace_check(company)
        return {"taskId": job.task_id, "companyId": company.id, "status": "queued"}

    @app.post("/v1/companies/{company_id}/runtime/stop")
    def stop_runtime(company_id: str):
        with app.state.runtime_control_lock:
            company = company_or_404(company_id)
            company.status = CompanyStatus.stopped
            company.always_on = False
            company.next_cycle_at = None
            app.state.store.save_company(company)
            cancelled = app.state.scheduler.stop_company(company.id)
            cancel_with_scope(app.state.model_gateway, company.id)
            try:
                result = app.state.runtime.stop(company)
            except SandboxUnavailable as exc:
                raise HTTPException(status_code=503, detail="Local Workspace is offline.") from exc
            return {"companyId": company.id, "stopped": result, "cancelled": cancelled}

    @app.post("/v1/companies/{company_id}/destroy")
    def destroy_company(company_id: str, payload: CompanyDestroyRequest):
        """Permanently erase one local company after an exact confirmation.

        Only an idle company can be deleted. That prevents a late model result
        from recreating task records after its workspace and evidence are gone.
        """
        company = company_or_404(company_id)
        if payload.confirm_company_id != company.id:
            raise HTTPException(status_code=422, detail="Confirmation must exactly match the company id.")
        company.status = CompanyStatus.paused
        app.state.store.save_company(company)
        quiesced = app.state.scheduler.quiesce_company(company.id)
        if quiesced["active"]:
            raise HTTPException(status_code=409, detail="Company still has active work. Try destruction again after it becomes idle.")
        try:
            workspace = app.state.sandbox.destroy_workspace(company.id)
        except SandboxUnavailable as exc:
            raise HTTPException(status_code=503, detail="Local Workspace is offline. The company was not erased.") from exc
        records = app.state.store.delete_company(company.id)
        return {"companyId": company.id, "destroyed": True, "workspace": workspace.result, "records": records}

    @app.post("/api/feedback", status_code=status.HTTP_201_CREATED)
    def submit_feedback(payload: FeedbackPayload):
        # Feedback remains available when the worker is offline. Runtime
        # diagnostics are collected only after the owner explicitly opts in.
        runtime_version = app.state.runtime.health().runtime_version if payload.include_technical_info else None
        record = make_feedback_record(payload, runtime_version)
        feedback_id = app.state.feedback_sink.submit(record)
        return {"id": feedback_id, "status": "received"}

    return app


app = create_app()
