from orcha.domain.models import Company, Task

ROLE_HINTS = {
    "build": [("product", "Define the smallest useful product slice"),
              ("engineering", "Implement the first runnable product slice"),
              ("qa", "Verify acceptance criteria and failure paths")],
    "research": [("research", "Collect evidence relevant to the objective"),
                 ("product", "Turn evidence into a testable recommendation")],
}

class Orchestrator:
    def __init__(self, bus):
        self.bus = bus

    def plan(self, company: Company) -> list[Task]:
        mode = "research" if any(w in company.goal.lower() for w in ("research", "validate", "competitor")) else "build"
        tasks = [Task(company_id=company.id, role=role, title=title) for role, title in ROLE_HINTS[mode]]
        for task in tasks:
            self.bus.publish("task.created", company.id, task.id, {"type": "orchestrator", "id": "orch_v1"}, task.model_dump())
        return tasks

    def start(self, company: Company):
        company.status = "running"
        self.bus.publish("company.started", company.id, company.id, {"type": "user", "id": "owner"}, {"goal": company.goal})
        return self.plan(company)
