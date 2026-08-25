from fastapi.testclient import TestClient
from orcha.api.app import app

client = TestClient(app)

def test_company_lifecycle_emits_real_events():
    created = client.post("/v1/companies", json={"name": "StudyFlow", "goal": "Build and launch a study summarizer"})
    assert created.status_code == 201
    company_id = created.json()["company"]["id"]
    started = client.post(f"/v1/companies/{company_id}/start")
    assert started.status_code == 200
    events = client.get(f"/v1/companies/{company_id}/events").json()["events"]
    assert [e["event_type"] for e in events] == ["company.created", "company.started", "task.created", "task.created", "task.created"]

def test_unknown_company_is_404():
    assert client.get("/v1/companies/co_missing/dashboard").status_code == 404
