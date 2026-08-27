from fastapi.testclient import TestClient
from orcha.api.app import app
from orcha.events.bus import InMemoryEventBus

client = TestClient(app)

def test_company_lifecycle_emits_real_events():
    created = client.post("/v1/companies", json={"name": "StudyFlow", "goal": "Build and launch a study summarizer"})
    assert created.status_code == 201
    company_id = created.json()["company"]["id"]
    started = client.post(f"/v1/companies/{company_id}/start")
    assert started.status_code == 200
    events = client.get(f"/v1/companies/{company_id}/events").json()["events"]
    event_types = [event["event_type"] for event in events]
    assert event_types[:3] == ["company.created", "company.started", "plan.generated"]
    assert event_types.count("task.created") >= 2
    assert started.json()["run"]["status"] == "running"

def test_unknown_company_is_404():
    assert client.get("/v1/companies/co_missing/dashboard").status_code == 404


def test_event_store_normalizes_safe_identity_and_summary_fields():
    bus = InMemoryEventBus()
    event = bus.publish("task.created", "co_contract", "task_contract", {"type": "orchestrator", "id": "orch_v1"}, {"id": "task_contract"})

    assert event.data["companyId"] == "co_contract"
    assert event.data["taskId"] == "task_contract"
    assert event.data["summary"] == "task created"

    company_event = bus.publish("company.created", "co_contract", "co_contract", {"type": "user", "id": "owner"}, {})
    assert company_event.data["companyId"] == "co_contract"
    assert company_event.data["summary"] == "company created"
