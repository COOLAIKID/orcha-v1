from datetime import datetime, timezone
from enum import Enum
import re
from typing import Literal
from uuid import uuid4
from pydantic import BaseModel, ConfigDict, Field, model_validator

def now() -> datetime:
    return datetime.now(timezone.utc)

class CompanyStatus(str, Enum):
    draft = "draft"
    running = "running"
    paused = "paused"
    stopped = "stopped"
    completed = "completed"

class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    goal: str = Field(min_length=10, max_length=2000)
    constraints: dict = Field(default_factory=dict)


class CompanyDestroyRequest(BaseModel):
    """Explicit confirmation prevents a route typo from erasing a company."""

    confirm_company_id: str = Field(min_length=4, max_length=80)

class Objective(BaseModel):
    id: str = Field(default_factory=lambda: f"obj_{uuid4().hex[:10]}")
    statement: str
    metrics: list[str] = Field(default_factory=list)


class AgentStatus(str, Enum):
    created = "created"
    waiting = "waiting"
    thinking = "thinking"
    working = "working"
    using_tool = "using_tool"
    blocked = "blocked"
    reviewing = "reviewing"
    completed = "completed"
    failed = "failed"
    stopped = "stopped"


class TeamId(str, Enum):
    """The seven consumer-facing departments in a company."""

    product = "product"
    engineering = "engineering"
    quality = "quality"
    design = "design"
    growth = "growth"
    data = "data"
    business = "business"


class HireState(str, Enum):
    """Hiring is a durable projection, not a claim that every role is active."""

    hired = "hired"
    proposed = "proposed"
    available = "available"


class TeamStatus(str, Enum):
    empty = "empty"
    waiting = "waiting"
    working = "working"
    attention = "attention"


TEAM_NAMES: dict[TeamId, str] = {
    TeamId.product: "Product",
    TeamId.engineering: "Engineering",
    TeamId.quality: "Quality",
    TeamId.design: "Design",
    TeamId.growth: "Growth",
    TeamId.data: "Data",
    TeamId.business: "Business",
}

ROLE_TEAMS: dict[str, TeamId] = {
    "product": TeamId.product,
    "research": TeamId.product,
    "engineering": TeamId.engineering,
    "quality": TeamId.quality,
    "qa": TeamId.quality,
    "design": TeamId.design,
    "growth": TeamId.growth,
    "data": TeamId.data,
    "business": TeamId.business,
}


def team_for_role(role: str) -> TeamId:
    """Resolve a planner role to the department shown to the owner."""

    return ROLE_TEAMS.get(role.strip().lower(), TeamId.business)


INTERNAL_INBOX_DOMAIN = "inbox.orcha.local"


def internal_inbox_address(inbox_id: str) -> str:
    """Return a deterministic, non-routable address for an internal inbox."""

    local_part = re.sub(r"[^a-z0-9-]", "-", str(inbox_id).strip().lower())
    local_part = re.sub(r"-+", "-", local_part).strip("-")[:64] or "inbox"
    return f"{local_part}@{INTERNAL_INBOX_DOMAIN}"


class Team(BaseModel):
    """A safe department descriptor; membership is held on each Agent record."""

    id: TeamId
    name: str
    description: str = ""
    status: TeamStatus = TeamStatus.empty
    agent_ids: list[str] = Field(default_factory=list)
    hired_count: int = Field(default=0, ge=0)


class Agent(BaseModel):
    """A durable, safe-to-display record of one specialist runtime."""

    id: str = Field(default_factory=lambda: f"agent_{uuid4().hex[:10]}")
    company_id: str
    role: str
    objective: str
    team: TeamId | None = None
    hired: HireState = HireState.hired
    status: AgentStatus = AgentStatus.created
    model: str | None = None
    tools: list[str] = Field(default_factory=list)
    task_id: str | None = None
    inbox_id: str = Field(default_factory=lambda: f"inbox_{uuid4().hex[:10]}")
    # Address-like identity for internal handoffs. It is derived from
    # inbox_id, never user-routable, and intentionally has no send capability.
    inbox_address: str = ""
    parent_agent_id: str | None = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)

    @model_validator(mode="after")
    def infer_team(self) -> "Agent":
        """Keep older persisted agent payloads valid while making membership canonical."""

        if self.team is None:
            self.team = team_for_role(self.role)
        # Canonicalise on every load so older SQLite payloads gain the same
        # stable identity and callers cannot spoof another inbox.
        self.inbox_address = internal_inbox_address(self.inbox_id)
        return self


class AgentInbox(BaseModel):
    """The inspectable internal mailbox boundary for one specialist."""

    model_config = ConfigDict(extra="forbid")

    company_id: str
    agent_id: str
    inbox_id: str
    address: str
    delivery: Literal["internal_only"] = "internal_only"
    external_delivery_enabled: bool = False


def team_snapshots(agents: list[Agent]) -> list[Team]:
    """Derive department state from its current member records."""

    snapshots: list[Team] = []
    for team_id, name in TEAM_NAMES.items():
        members = [agent for agent in agents if agent.team == team_id]
        hired = [agent for agent in members if agent.hired == HireState.hired]
        # Proposed/available records describe the catalog, not active company
        # staff. Keep the projection aligned with the consumer model: a team
        # is empty until at least one specialist is actually hired.
        if not hired:
            status = TeamStatus.empty
        elif any(agent.status in {AgentStatus.blocked, AgentStatus.failed} for agent in hired):
            status = TeamStatus.attention
        elif any(agent.status in {AgentStatus.thinking, AgentStatus.working, AgentStatus.using_tool, AgentStatus.reviewing} for agent in hired):
            status = TeamStatus.working
        else:
            status = TeamStatus.waiting
        snapshots.append(Team(id=team_id, name=name, status=status, agent_ids=[agent.id for agent in members], hired_count=len(hired)))
    return snapshots


class ArtifactTier(str, Enum):
    """The immutable storage boundary associated with a file record."""

    local_only = "local_only"
    company_vault = "company_vault"
    shareable = "shareable"


class Artifact(BaseModel):
    id: str = Field(default_factory=lambda: f"art_{uuid4().hex[:10]}")
    company_id: str
    task_id: str
    agent_id: str
    kind: str
    name: str
    path: str
    summary: str = Field(max_length=600)
    # Content hashes make safe task retries idempotent without storing file
    # contents in the control plane. Older records may omit this field.
    content_hash: str | None = Field(default=None, min_length=8, max_length=128)
    tier: ArtifactTier = ArtifactTier.company_vault
    created_at: datetime = Field(default_factory=now)


class ArtifactClassification(BaseModel):
    """Worker artifacts may become Shareable, but can never become Local Only."""

    model_config = ConfigDict(extra="forbid")
    file_id: str = Field(min_length=4, max_length=80)
    tier: ArtifactTier


class LocalOnlyFileRegister(BaseModel):
    """Metadata only: the browser must never submit Local Only file bytes."""

    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=240)
    size_bytes: int = Field(ge=0, le=1_000_000_000)
    media_type: str = Field(default="application/octet-stream", min_length=1, max_length=120)
    content_hash: str | None = Field(default=None, min_length=8, max_length=128)


class LocalOnlyFile(BaseModel):
    id: str = Field(default_factory=lambda: f"local_{uuid4().hex[:10]}")
    company_id: str
    name: str
    size_bytes: int
    media_type: str
    content_hash: str | None = None
    tier: Literal[ArtifactTier.local_only] = ArtifactTier.local_only
    registered_at: datetime = Field(default_factory=now)

    @classmethod
    def from_register(cls, company_id: str, payload: LocalOnlyFileRegister) -> "LocalOnlyFile":
        return cls(company_id=company_id, **payload.model_dump())


class AgentMessage(BaseModel):
    """A short, safe handoff; never a chain-of-thought or raw provider trace."""

    id: str = Field(default_factory=lambda: f"msg_{uuid4().hex[:10]}")
    company_id: str
    source_agent_id: str
    target_agent_id: str | None = None
    task_id: str | None = None
    kind: str = "handoff"
    summary: str = Field(min_length=1, max_length=1200)
    created_at: datetime = Field(default_factory=now)


class CompanyRun(BaseModel):
    id: str = Field(default_factory=lambda: f"run_{uuid4().hex[:10]}")
    company_id: str
    goal: str
    status: str = "queued"
    final_summary: str | None = None
    preview_path: str | None = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)


class CompanyRunCreate(BaseModel):
    goal: str = Field(min_length=10, max_length=2000)
    always_on: bool = True


class ExperimentStatus(str, Enum):
    proposed = "proposed"
    evaluating = "evaluating"
    promoted = "promoted"
    rolled_back = "rolled_back"


class ExperimentCreate(BaseModel):
    """A comparison record, never an instruction to change production."""

    target_type: str = Field(min_length=2, max_length=40)
    baseline_version: str = Field(min_length=1, max_length=160)
    candidate_version: str = Field(min_length=1, max_length=160)
    primary_metric: str = Field(min_length=2, max_length=80)
    minimum_improvement: float = Field(default=0.05, ge=0, le=10)
    minimum_observations: int = Field(default=5, ge=1, le=10_000)
    # Guardrails are minimum acceptable values, for example
    # {"reliability": 0.99}. They are evaluated for every candidate sample.
    guardrails: dict[str, float] = Field(default_factory=dict)
    sample_window: str = Field(default="local verification", min_length=2, max_length=160)


class ExperimentObservationCreate(BaseModel):
    variant: str = Field(pattern=r"^(baseline|candidate)$")
    primary_value: float = Field(ge=-1_000_000_000, le=1_000_000_000)
    guardrail_values: dict[str, float] = Field(default_factory=dict)
    cost_usd: float = Field(default=0, ge=0, le=100_000)
    evidence: str = Field(min_length=1, max_length=600)


class ExperimentObservation(ExperimentObservationCreate):
    id: str = Field(default_factory=lambda: f"obs_{uuid4().hex[:10]}")
    recorded_at: datetime = Field(default_factory=now)


class ExperimentDecision(BaseModel):
    decision: str
    reason: str = Field(min_length=1, max_length=900)
    decided_at: datetime = Field(default_factory=now)


class Experiment(BaseModel):
    id: str = Field(default_factory=lambda: f"exp_{uuid4().hex[:10]}")
    company_id: str
    target_type: str
    baseline_version: str
    candidate_version: str
    primary_metric: str
    minimum_improvement: float
    minimum_observations: int
    guardrails: dict[str, float] = Field(default_factory=dict)
    sample_window: str
    status: ExperimentStatus = ExperimentStatus.proposed
    observations: list[ExperimentObservation] = Field(default_factory=list)
    decisions: list[ExperimentDecision] = Field(default_factory=list)
    promoted_version: str | None = None
    rollback_target: str | None = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)

    @classmethod
    def from_create(cls, company_id: str, payload: ExperimentCreate) -> "Experiment":
        return cls(company_id=company_id, **payload.model_dump())

class Company(BaseModel):
    id: str = Field(default_factory=lambda: f"co_{uuid4().hex[:10]}")
    name: str
    goal: str
    constraints: dict = Field(default_factory=dict)
    status: CompanyStatus = CompanyStatus.draft
    objective: Objective
    always_on: bool = False
    cycle_count: int = 0
    next_cycle_at: datetime | None = None
    created_at: datetime = Field(default_factory=now)

class Task(BaseModel):
    id: str = Field(default_factory=lambda: f"task_{uuid4().hex[:10]}")
    company_id: str
    role: str
    title: str
    status: str = "queued"
    capabilities: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    instruction: str = ""
    agent_id: str | None = None
    attempts: int = 0
    max_attempts: int = Field(default=2, ge=0, le=5)
    kind: str = "agent"
    depends_on: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    parent_task_id: str | None = None
    artifact_ids: list[str] = Field(default_factory=list)
    run_id: str | None = None
    revision: int = Field(default=0, ge=0, le=3)
    # A bounded machine-readable reason for a resumable block. This is kept
    # separate from the user-facing summary so the scheduler can recover only
    # safe, infrastructure-dependent blocks without guessing from prose.
    blocked_reason_code: str | None = Field(default=None, max_length=64)
    # A durable claim closes the multi-process dispatch race. It is cleared
    # when the task reaches a terminal or retry-queued state.
    lease_id: str | None = None
    leased_at: datetime | None = None

class DomainEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: f"evt_{uuid4().hex[:10]}")
    event_type: str
    version: int = 1
    occurred_at: datetime = Field(default_factory=now)
    company_id: str
    aggregate_id: str
    sequence: int
    actor: dict
    data: dict = Field(default_factory=dict)
