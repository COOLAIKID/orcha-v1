from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4
from pydantic import BaseModel, Field

def now() -> datetime:
    return datetime.now(timezone.utc)

class CompanyStatus(str, Enum):
    draft = "draft"
    running = "running"
    paused = "paused"

class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    goal: str = Field(min_length=10, max_length=2000)
    constraints: dict = Field(default_factory=dict)

class Objective(BaseModel):
    id: str = Field(default_factory=lambda: f"obj_{uuid4().hex[:10]}")
    statement: str
    metrics: list[str] = Field(default_factory=list)

class Company(BaseModel):
    id: str = Field(default_factory=lambda: f"co_{uuid4().hex[:10]}")
    name: str
    goal: str
    constraints: dict = Field(default_factory=dict)
    status: CompanyStatus = CompanyStatus.draft
    objective: Objective
    created_at: datetime = Field(default_factory=now)

class Task(BaseModel):
    id: str = Field(default_factory=lambda: f"task_{uuid4().hex[:10]}")
    company_id: str
    role: str
    title: str
    status: str = "queued"
    capabilities: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)

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
