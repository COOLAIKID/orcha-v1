"""Small, dependency-free durable store for the local Orcha runtime.

SQLite is intentionally the first persistence boundary: it lets the local API
resume companies, tasks, and their evidence after a restart. A hosted database
can later implement the same methods without changing the API or runtime.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from orcha.domain.models import Agent, AgentMessage, Artifact, Company, CompanyRun, CompanyStatus, DomainEvent, Experiment, LocalOnlyFile, Task, now
from orcha.events.bus import normalize_event_data


class SQLiteStateStore:
    def __init__(self, database_path: str | Path):
        self.path = self._normalise_path(database_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialise()

    @staticmethod
    def _normalise_path(value: str | Path) -> Path:
        raw = str(value)
        if raw.startswith("sqlite:///"):
            raw = raw.removeprefix("sqlite:///")
        return Path(raw).expanduser().resolve()

    def _connection(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialise(self) -> None:
        with self._connection() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS companies (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_tasks_company_status ON tasks(company_id, status);
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(company_id, sequence)
                );
                CREATE INDEX IF NOT EXISTS idx_events_company_sequence ON events(company_id, sequence);
                CREATE TABLE IF NOT EXISTS memory_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT NOT NULL,
                    namespace TEXT NOT NULL,
                    source_task_id TEXT,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_memory_company_namespace ON memory_entries(company_id, namespace, id DESC);
                CREATE TABLE IF NOT EXISTS usage_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    company_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0,
                    estimated_usd REAL NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_usage_company_created ON usage_records(company_id, created_at);
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_agents_company_status ON agents(company_id, status);
                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_artifacts_company_task ON artifacts(company_id, task_id);
                CREATE TABLE IF NOT EXISTS local_only_files (
                    id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_local_only_files_company_created ON local_only_files(company_id, created_at);
                CREATE TABLE IF NOT EXISTS agent_messages (
                    id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    source_agent_id TEXT NOT NULL,
                    target_agent_id TEXT,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_messages_company_created ON agent_messages(company_id, created_at);
                CREATE TABLE IF NOT EXISTS company_runs (
                    id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_runs_company_created ON company_runs(company_id, updated_at);
                CREATE TABLE IF NOT EXISTS experiments (
                    id TEXT PRIMARY KEY,
                    company_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_experiments_company_updated ON experiments(company_id, updated_at);
                """
            )

    @staticmethod
    def _dump(model: Company | Task | DomainEvent | Agent | Artifact | AgentMessage | CompanyRun | Experiment | LocalOnlyFile) -> str:
        return json.dumps(model.model_dump(mode="json"), separators=(",", ":"), sort_keys=True)

    def save_company(self, company: Company) -> Company:
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO companies (id, payload, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP",
                (company.id, self._dump(company)),
            )
        return company

    def get_company(self, company_id: str) -> Company | None:
        with self._connection() as connection:
            row = connection.execute("SELECT payload FROM companies WHERE id = ?", (company_id,)).fetchone()
        return Company.model_validate_json(row["payload"]) if row else None

    def list_companies(self) -> list[Company]:
        with self._connection() as connection:
            rows = connection.execute("SELECT payload FROM companies ORDER BY updated_at, id").fetchall()
        return [Company.model_validate_json(row["payload"]) for row in rows]

    def save_task(self, task: Task) -> Task:
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO tasks (id, company_id, status, payload, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload, updated_at=CURRENT_TIMESTAMP",
                (task.id, task.company_id, task.status, self._dump(task)),
            )
        return task

    def claim_task(self, task_id: str, lease_id: str) -> Task | None:
        """Atomically claim one queued task for a scheduler lease."""
        with self._lock, self._connection() as connection:
            row = connection.execute("SELECT payload FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not row:
                return None
            task = Task.model_validate_json(row["payload"])
            if task.status != "queued":
                return None
            task.status = "running"
            task.lease_id = lease_id[:80]
            task.leased_at = now()
            updated = connection.execute(
                "UPDATE tasks SET status = ?, payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'",
                (task.status, self._dump(task), task.id),
            ).rowcount
            return task if updated == 1 else None

    def save_agent(self, agent: Agent) -> Agent:
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO agents (id, company_id, status, payload, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload, updated_at=CURRENT_TIMESTAMP",
                (agent.id, agent.company_id, agent.status.value, self._dump(agent)),
            )
        return agent

    def get_agent(self, agent_id: str) -> Agent | None:
        with self._connection() as connection:
            row = connection.execute("SELECT payload FROM agents WHERE id = ?", (agent_id,)).fetchone()
        return Agent.model_validate_json(row["payload"]) if row else None

    def list_agents(self, company_id: str) -> list[Agent]:
        with self._connection() as connection:
            rows = connection.execute("SELECT payload FROM agents WHERE company_id = ? ORDER BY updated_at, id", (company_id,)).fetchall()
        return [Agent.model_validate_json(row["payload"]) for row in rows]

    def save_artifact(self, artifact: Artifact) -> Artifact:
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO artifacts (id, company_id, task_id, agent_id, payload) VALUES (?, ?, ?, ?, ?)",
                (artifact.id, artifact.company_id, artifact.task_id, artifact.agent_id, self._dump(artifact)),
            )
        return artifact

    def list_artifacts(self, company_id: str, task_id: str | None = None) -> list[Artifact]:
        query, values = "SELECT payload FROM artifacts WHERE company_id = ?", [company_id]
        if task_id:
            query += " AND task_id = ?"
            values.append(task_id)
        query += " ORDER BY created_at, id"
        with self._connection() as connection:
            rows = connection.execute(query, values).fetchall()
        return [Artifact.model_validate_json(row["payload"]) for row in rows]

    def get_artifact(self, artifact_id: str) -> Artifact | None:
        with self._connection() as connection:
            row = connection.execute("SELECT payload FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()
        return Artifact.model_validate_json(row["payload"]) if row else None

    def save_local_only_file(self, record: LocalOnlyFile) -> LocalOnlyFile:
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO local_only_files (id, company_id, payload) VALUES (?, ?, ?)",
                (record.id, record.company_id, self._dump(record)),
            )
        return record

    def list_local_only_files(self, company_id: str) -> list[LocalOnlyFile]:
        with self._connection() as connection:
            rows = connection.execute("SELECT payload FROM local_only_files WHERE company_id = ? ORDER BY created_at, id", (company_id,)).fetchall()
        return [LocalOnlyFile.model_validate_json(row["payload"]) for row in rows]

    def save_message(self, message: AgentMessage) -> AgentMessage:
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO agent_messages (id, company_id, source_agent_id, target_agent_id, payload) VALUES (?, ?, ?, ?, ?)",
                (message.id, message.company_id, message.source_agent_id, message.target_agent_id, self._dump(message)),
            )
        return message

    def recent_messages(self, company_id: str, limit: int = 12) -> list[AgentMessage]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT payload FROM agent_messages WHERE company_id = ? ORDER BY created_at DESC, id DESC LIMIT ?", (company_id, max(1, min(limit, 30)))).fetchall()
        return list(reversed([AgentMessage.model_validate_json(row["payload"]) for row in rows]))

    def list_agent_messages(self, company_id: str, agent_id: str, limit: int = 50) -> list[AgentMessage]:
        """Read one agent's internal inbox plus company-wide safe handoffs."""
        bounded = max(1, min(limit, 100))
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT payload FROM agent_messages "
                "WHERE company_id = ? AND (target_agent_id = ? OR target_agent_id IS NULL) "
                "ORDER BY rowid LIMIT ?",
                (company_id, agent_id, bounded),
            ).fetchall()
        return [AgentMessage.model_validate_json(row["payload"]) for row in rows]

    def save_run(self, run: CompanyRun) -> CompanyRun:
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO company_runs (id, company_id, status, payload, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload, updated_at=CURRENT_TIMESTAMP",
                (run.id, run.company_id, run.status, self._dump(run)),
            )
        return run

    def get_run(self, run_id: str) -> CompanyRun | None:
        with self._connection() as connection:
            row = connection.execute("SELECT payload FROM company_runs WHERE id = ?", (run_id,)).fetchone()
        return CompanyRun.model_validate_json(row["payload"]) if row else None

    def list_runs(self, company_id: str) -> list[CompanyRun]:
        """Return durable runs in stable update order for restart reconciliation."""
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT payload FROM company_runs WHERE company_id = ? ORDER BY updated_at, id",
                (company_id,),
            ).fetchall()
        return [CompanyRun.model_validate_json(row["payload"]) for row in rows]

    def active_run(self, company_id: str) -> CompanyRun | None:
        """Return the newest non-terminal run for retry-safe API boundaries."""
        with self._connection() as connection:
            row = connection.execute(
                "SELECT payload FROM company_runs "
                "WHERE company_id = ? AND status IN ('queued', 'running', 'blocked') "
                "ORDER BY rowid DESC LIMIT 1",
                (company_id,),
            ).fetchone()
        return CompanyRun.model_validate_json(row["payload"]) if row else None

    def save_experiment(self, experiment: Experiment) -> Experiment:
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO experiments (id, company_id, status, payload, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload, updated_at=CURRENT_TIMESTAMP",
                (experiment.id, experiment.company_id, experiment.status.value, self._dump(experiment)),
            )
        return experiment

    def get_experiment(self, experiment_id: str) -> Experiment | None:
        with self._connection() as connection:
            row = connection.execute("SELECT payload FROM experiments WHERE id = ?", (experiment_id,)).fetchone()
        return Experiment.model_validate_json(row["payload"]) if row else None

    def list_experiments(self, company_id: str) -> list[Experiment]:
        with self._connection() as connection:
            rows = connection.execute("SELECT payload FROM experiments WHERE company_id = ? ORDER BY updated_at, id", (company_id,)).fetchall()
        return [Experiment.model_validate_json(row["payload"]) for row in rows]

    def get_task(self, task_id: str) -> Task | None:
        with self._connection() as connection:
            row = connection.execute("SELECT payload FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return Task.model_validate_json(row["payload"]) if row else None

    def list_tasks(self, company_id: str, statuses: tuple[str, ...] | None = None) -> list[Task]:
        query = "SELECT payload FROM tasks WHERE company_id = ?"
        values: list[object] = [company_id]
        if statuses:
            query += " AND status IN (" + ", ".join("?" for _ in statuses) + ")"
            values.extend(statuses)
        query += " ORDER BY updated_at, id"
        with self._connection() as connection:
            rows = connection.execute(query, values).fetchall()
        return [Task.model_validate_json(row["payload"]) for row in rows]

    def newest_running_company_id(self) -> str | None:
        """The latest saved running company owns this PC's workers."""
        with self._connection() as connection:
            # CURRENT_TIMESTAMP is only second-precision in SQLite. Rowid
            # preserves insertion order when two companies are created in the
            # same second, so a new company cannot accidentally inherit an
            # older company's runnable queue.
            rows = connection.execute("SELECT payload FROM companies ORDER BY rowid DESC").fetchall()
        for row in rows:
            company = Company.model_validate_json(row["payload"])
            if company.status == CompanyStatus.running:
                return company.id
        return None

    def pause_other_running_companies(self, except_company_id: str) -> list[str]:
        """Pause leftover always-on companies so the latest request can dispatch."""
        paused: list[str] = []
        for other in self.list_companies():
            if other.id == except_company_id or other.status != CompanyStatus.running:
                continue
            other.status = CompanyStatus.paused
            self.save_company(other)
            paused.append(other.id)
        return paused

    def list_runnable_tasks(self, limit: int = 20) -> list[Task]:
        focus_id = self.newest_running_company_id()
        if not focus_id:
            return []
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT payload FROM tasks WHERE company_id = ? AND status = 'queued' ORDER BY updated_at DESC, id DESC LIMIT ?",
                (focus_id, limit),
            ).fetchall()
        return [Task.model_validate_json(row["payload"]) for row in rows]

    def requeue_interrupted_tasks(self) -> list[Task]:
        """Recover unfinished work without changing a task's execution class.

        Specialist tasks can safely return to the persistent scheduler. Runtime
        control-plane jobs have no durable worker continuation yet, so they are
        cancelled fail-closed and must be explicitly retried by the owner.
        """
        with self._connection() as connection:
            rows = connection.execute("SELECT payload FROM tasks WHERE status = 'running'").fetchall()
        tasks = [Task.model_validate_json(row["payload"]) for row in rows]
        for task in tasks:
            task.status = "queued" if task.kind == "agent" else "cancelled"
            task.lease_id = None
            task.leased_at = None
            self.save_task(task)
        return tasks

    def remember(self, company_id: str, content: str, source_task_id: str | None = None, namespace: str = "company") -> None:
        safe_content = content.strip()[:4000]
        if not safe_content:
            return
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO memory_entries (company_id, namespace, source_task_id, content) VALUES (?, ?, ?, ?)",
                (company_id, namespace[:80], source_task_id, safe_content),
            )

    def recent_memory(self, company_id: str, namespace: str = "company", limit: int = 6) -> list[str]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT content FROM memory_entries WHERE company_id = ? AND namespace = ? ORDER BY id DESC LIMIT ?",
                (company_id, namespace[:80], max(1, min(limit, 20))),
            ).fetchall()
        return [str(row["content"]) for row in reversed(rows)]

    def record_usage(
        self,
        company_id: str,
        provider: str,
        model: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        estimated_usd: float = 0,
    ) -> None:
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO usage_records (company_id, provider, model, input_tokens, output_tokens, estimated_usd) VALUES (?, ?, ?, ?, ?, ?)",
                (company_id, provider[:80], model[:160], max(0, int(input_tokens)), max(0, int(output_tokens)), max(0, float(estimated_usd))),
            )

    def daily_usage(self, company_id: str) -> dict[str, float | int]:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS runs, COALESCE(SUM(estimated_usd), 0) AS estimated_usd "
                "FROM usage_records WHERE company_id = ? AND date(created_at) = date('now')",
                (company_id,),
            ).fetchone()
        return {"runs": int(row["runs"]), "estimatedUsd": float(row["estimated_usd"])}

    def delete_company(self, company_id: str) -> dict[str, int]:
        """Erase one company's local runtime records in one SQLite transaction.

        Callers must destroy the matching confined workspace first. This method
        intentionally removes evidence and memory too: it is the irreversible
        end-of-company operation, not normal task cleanup.
        """
        with self._lock, self._connection() as connection:
            counts = {
                "experiments": connection.execute("DELETE FROM experiments WHERE company_id = ?", (company_id,)).rowcount,
                "localOnlyFiles": connection.execute("DELETE FROM local_only_files WHERE company_id = ?", (company_id,)).rowcount,
                "agents": connection.execute("DELETE FROM agents WHERE company_id = ?", (company_id,)).rowcount,
                "artifacts": connection.execute("DELETE FROM artifacts WHERE company_id = ?", (company_id,)).rowcount,
                "messages": connection.execute("DELETE FROM agent_messages WHERE company_id = ?", (company_id,)).rowcount,
                "runs": connection.execute("DELETE FROM company_runs WHERE company_id = ?", (company_id,)).rowcount,
                "tasks": connection.execute("DELETE FROM tasks WHERE company_id = ?", (company_id,)).rowcount,
                "events": connection.execute("DELETE FROM events WHERE company_id = ?", (company_id,)).rowcount,
                "memory": connection.execute("DELETE FROM memory_entries WHERE company_id = ?", (company_id,)).rowcount,
                "usage": connection.execute("DELETE FROM usage_records WHERE company_id = ?", (company_id,)).rowcount,
                "companies": connection.execute("DELETE FROM companies WHERE id = ?", (company_id,)).rowcount,
            }
        return {name: max(0, int(count)) for name, count in counts.items()}

    def publish(self, event_type: str, company_id: str, aggregate_id: str, actor: dict, data: dict | None = None) -> DomainEvent:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events WHERE company_id = ?", (company_id,)
            ).fetchone()
            event = DomainEvent(
                event_type=event_type,
                company_id=company_id,
                aggregate_id=aggregate_id,
                sequence=int(row["sequence"]) + 1,
                actor=actor,
                data=normalize_event_data(event_type, company_id, aggregate_id, data),
            )
            connection.execute(
                "INSERT INTO events (event_id, company_id, sequence, payload) VALUES (?, ?, ?, ?)",
                (event.event_id, company_id, event.sequence, self._dump(event)),
            )
        return event

    def list(self, company_id: str, since: int = 0) -> list[DomainEvent]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT payload FROM events WHERE company_id = ? AND sequence > ? ORDER BY sequence", (company_id, since)
            ).fetchall()
        return [DomainEvent.model_validate_json(row["payload"]) for row in rows]
