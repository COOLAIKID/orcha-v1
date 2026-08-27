from orcha.domain.models import Company, CompanyStatus, Task
from orcha.runtime.planner import ROLE_CAPABILITIES, RuntimePlanner, fallback_plan

class Orchestrator:
    def __init__(self, bus, model_gateway=None):
        self.bus = bus
        self.planner = RuntimePlanner(model_gateway) if model_gateway is not None else None

    def plan(self, company: Company, run_id: str | None = None, evidence: str = "", cycle: int = 1) -> list[Task]:
        result = self.planner.create(company.goal, evidence=evidence, cycle=cycle, cancellation_scope=company.id) if self.planner else None
        plan = result.plan if result else fallback_plan(company.goal, cycle)
        by_key: dict[str, Task] = {}
        for item in plan.tasks:
            task = Task(
                company_id=company.id,
                role=item.role,
                title=item.title,
                instruction=item.instruction,
                capabilities=ROLE_CAPABILITIES[item.role],
                acceptance_criteria=item.acceptance_criteria,
                run_id=run_id,
            )
            by_key[item.key] = task
        for item in plan.tasks:
            by_key[item.key].depends_on = [by_key[key].id for key in item.depends_on]
        tasks = list(by_key.values())
        self.bus.publish(
            "plan.generated",
            company.id,
            run_id or company.id,
            {"type": "orchestrator", "id": "orch_v1"},
            {"summary": plan.summary, "source": result.source if result else "fallback_unconfigured", "taskCount": len(tasks), "cycle": cycle},
        )
        if result and result.fallback_from:
            self.bus.publish(
                "model.fallback",
                company.id,
                run_id or company.id,
                {"type": "orchestrator", "id": "orch_v1"},
                {"companyId": company.id, "runId": run_id, "summary": f"Planning provider fallback: {result.fallback_from} → model", "fallbackFrom": result.fallback_from},
            )
        for task in tasks:
            self.bus.publish("task.created", company.id, task.id, {"type": "orchestrator", "id": "orch_v1"}, task.model_dump())
        return tasks

    def start(self, company: Company, run_id: str | None = None, evidence: str = "", cycle: int = 1):
        company.status = CompanyStatus.running
        if cycle <= 1:
            self.bus.publish("company.started", company.id, company.id, {"type": "user", "id": "owner"}, {"goal": company.goal, "alwaysOn": company.always_on})
        else:
            self.bus.publish(
                "company.cycle_started",
                company.id,
                run_id or company.id,
                {"type": "orchestrator", "id": "orch_v1"},
                {"goal": company.goal, "cycle": cycle, "summary": f"Starting cycle {cycle} on this PC"},
            )
        return self.plan(company, run_id, evidence=evidence, cycle=cycle)
