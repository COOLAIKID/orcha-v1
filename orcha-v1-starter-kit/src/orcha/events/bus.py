from collections import defaultdict
from orcha.domain.models import DomainEvent


def normalize_event_data(event_type: str, company_id: str, aggregate_id: str, data: dict | None = None) -> dict:
    """Add the small, safe identity contract shared by every event store.

    Older callers intentionally pass domain-model dumps for events such as
    ``task.created``. Those payloads contain ``id`` but not the camel-case
    fields consumed by the browser projection. Normalizing at the event-store
    boundary keeps in-memory tests and durable SQLite history identical without
    copying prompts, provider responses, or filesystem contents into events.
    """

    normalized = dict(data or {})
    normalized["companyId"] = company_id
    if event_type.startswith("task."):
        normalized.setdefault("taskId", aggregate_id)
    summary = normalized.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        label = event_type.replace(".", " ").strip() or "Runtime event"
        normalized["summary"] = label[:300]
    return normalized


class InMemoryEventBus:
    def __init__(self):
        self.events: list[DomainEvent] = []
        self._seq = defaultdict(int)

    def publish(self, event_type: str, company_id: str, aggregate_id: str, actor: dict, data: dict | None = None) -> DomainEvent:
        self._seq[company_id] += 1
        event = DomainEvent(event_type=event_type, company_id=company_id, aggregate_id=aggregate_id,
                            sequence=self._seq[company_id], actor=actor,
                            data=normalize_event_data(event_type, company_id, aggregate_id, data))
        self.events.append(event)
        return event

    def list(self, company_id: str, since: int = 0) -> list[DomainEvent]:
        return [e for e in self.events if e.company_id == company_id and e.sequence > since]
