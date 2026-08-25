# Event Schemas

All events use this envelope:

```json
{"event_id":"evt_123","event_type":"task.created","version":1,"occurred_at":"2026-08-20T12:00:00Z","company_id":"co_123","aggregate_id":"task_123","sequence":4,"actor":{"type":"orchestrator","id":"orch_1"},"data":{}}
```

## V1 event types

- `company.created`, `company.started`, `company.paused`
- `plan.generated`, `milestone.updated`
- `agent.created`, `agent.status_changed`, `agent.message_sent`
- `task.created`, `task.started`, `task.progressed`, `task.succeeded`, `task.failed`, `task.retried`
- `tool.called`, `tool.denied`, `artifact.created`, `file.classified`
- `experiment.created`, `experiment.observation_recorded`, `experiment.promoted`, `experiment.rolled_back`
- `approval.requested`, `approval.granted`, `approval.denied`
- `cost.recorded`, `recovery.started`, `recovery.completed`, `escalation.created`

## Truthfulness rule

`task.progressed` must cite a real checkpoint or artifact. A client must not synthesize progress events for visual effect.
