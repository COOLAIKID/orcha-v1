from fastapi import FastAPI, HTTPException, Query
from orcha.domain.models import Company, CompanyCreate
from orcha.events.bus import InMemoryEventBus
from orcha.runtime.orchestrator import Orchestrator

app = FastAPI(title="Orcha V1 API", version="0.1.0")
bus = InMemoryEventBus()
orchestrator = Orchestrator(bus)
companies: dict[str, Company] = {}

@app.get("/health")
def health():
    return {"status": "ok", "service": "orcha-api"}

@app.post("/v1/companies", status_code=201)
def create_company(payload: CompanyCreate):
    company = Company(name=payload.name, goal=payload.goal, constraints=payload.constraints,
                      objective={"statement": payload.goal, "metrics": ["milestone_completion", "reliability", "cost"]})
    companies[company.id] = company
    bus.publish("company.created", company.id, company.id, {"type": "user", "id": "owner"}, company.model_dump(mode="json"))
    return {"company": company, "required_capabilities": ["repo.write", "shell.test"], "plan_preview": "Ready to generate a minimal team."}

@app.post("/v1/companies/{company_id}/start")
def start_company(company_id: str):
    company = companies.get(company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    tasks = orchestrator.start(company)
    return {"company": company, "tasks": tasks}

@app.get("/v1/companies/{company_id}/events")
def events(company_id: str, since: int = Query(default=0, ge=0)):
    if company_id not in companies:
        raise HTTPException(404, "Company not found")
    return {"events": [event.model_dump(mode="json") for event in bus.list(company_id, since)]}

@app.get("/v1/companies/{company_id}/dashboard")
def dashboard(company_id: str):
    company = companies.get(company_id)
    if not company:
        raise HTTPException(404, "Company not found")
    events = bus.list(company_id)
    return {"company": company, "objective": company.objective, "activity": events[-20:], "truth_source": "domain_events"}
