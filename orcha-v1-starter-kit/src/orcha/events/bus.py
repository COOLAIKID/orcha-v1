from collections import defaultdict
from orcha.domain.models import DomainEvent

class InMemoryEventBus:
    def __init__(self):
        self.events: list[DomainEvent] = []
        self._seq = defaultdict(int)

    def publish(self, event_type: str, company_id: str, aggregate_id: str, actor: dict, data: dict | None = None) -> DomainEvent:
        self._seq[company_id] += 1
        event = DomainEvent(event_type=event_type, company_id=company_id, aggregate_id=aggregate_id,
                            sequence=self._seq[company_id], actor=actor, data=data or {})
        self.events.append(event)
        return event

    def list(self, company_id: str, since: int = 0) -> list[DomainEvent]:
        return [e for e in self.events if e.company_id == company_id and e.sequence > since]
