# Event Schemas

All events use this envelope:

```json
{"event_id":"evt_123","event_type":"task.created","version":1,"occurred_at":"2026-08-20T12:00:00Z","company_id":"co_123","aggregate_id":"task_123","sequence":4,"actor":{"type":"orchestrator","id":"orch_1"},"data":{}}
```

## V1 event types

The names below are the current local-runtime contract. `task.completed` is
the terminal success event; `task.succeeded` and `task.progressed` are not
emitted by this implementation.

- `company.created`, `company.started`, `company.paused`,
  `company.cycle_started`, `company.cycle_scheduled`, `company.heartbeat`,
  `company.run_blocked`, `company.run_completed`
- `plan.generated`
- `agent.created`, `agent.started`, `agent.status_changed`,
  `agent.message_sent`, `agent.completed`, `agent.blocked`, `agent.failed`,
  `agent.stopped`
- `task.created`, `task.started`, `task.resumed`, `task.recovered`,
  `task.completed`, `task.failed`, `task.cancelled`, `task.paused`,
  `task.retry_requested`, `task.retry_scheduled`
- `tool.started`, `tool.completed`, `tool.denied`
- `artifact.created`, `file.created`, `file.changed`, `file.classified`
- `experiment.created`, `experiment.observation_recorded`,
  `experiment.promotion_rejected`, `experiment.promoted`,
  `experiment.rolled_back`
- `cost.recorded`, `model.requested`, `model.fallback`, `sandbox.connected`,
  `sandbox.stopped`, `verification.passed`, `verification.skipped`,
  `verification.failed`, `recovery.started`, `recovery.completed`,
  `revision.requested`, `escalation.created`

## Implemented local runtime events

The durable local runtime currently emits `company.created`, `company.started`,
`company.paused`, `company.cycle_started`, `company.cycle_scheduled`,
`company.run_completed`, `company.run_blocked`, `company.run_resumed`,
`task.created`, `task.started`,
`task.resumed`, `task.recovered`, `task.retry_scheduled`, `task.completed`,
`task.failed`, `task.cancelled`, `agent.started`, `agent.created`,
`agent.status_changed`, `agent.completed`, `agent.blocked`, `agent.failed`,
`agent.stopped`, `sandbox.connected`, `sandbox.stopped`, `model.requested`,
`model.fallback`, `cost.recorded`, `tool.started`, `tool.completed`,
`tool.denied`, `file.created`, and `file.changed`.

The event stores add `companyId` to every payload and a concise fallback
`summary` when an older caller does not provide one. `task.*` events also get
`taskId` from their aggregate id when needed. Existing fields are preserved;
prompts, provider payloads, and workspace contents are never synthesized by
this normalization.

The bounded static-source QA path also emits `verification.passed` or
`verification.skipped`. It does not emit a pass unless a concrete source check
ran.

`recovery.started` identifies a bounded retry or the single QA-to-engineering
revision loop. `recovery.completed` is emitted only after the recovered task
actually completes. `escalation.created` records that the scheduler stopped
retrying and needs owner attention; it does not claim that a human or external
system was contacted.

Provider configuration blocks carry `blockReason: "provider_unavailable"` on
the durable task and `agent.blocked` event. For an always-on company, the
scheduler requeues only those blocks after `is_available()` becomes true,
resets the bounded attempt window, and emits `recovery.started`,
`task.resumed`, and `company.run_resumed` with
`recoveryType: "provider_reconnect"`. Policy, capability, and owner-stop
blocks do not use this automatic path.

On scheduler startup, a durable run with no open tasks is finalized from the
task states if its previous process stopped before the run-finalization write.
This emits the same single `company.run_completed` transition as the live
path, including `alwaysOn` scheduling data.

The local Evolution record emits `experiment.created`,
`experiment.observation_recorded`, `experiment.promotion_rejected`,
`experiment.promoted`, and `experiment.rolled_back`. These are durable
evaluation decisions only; no event claims that code, prompts, or a preview
were changed unless a separately recorded task/artifact did that work.

Owner task controls emit `task.paused` when queued or blocked work is held
before dispatch, and `task.retry_requested` when an eligible specialist task
is requeued. Both events carry the normal company/task/agent identity fields
and a concise summary; they never include prompts, provider payloads, or
filesystem paths.

When the scheduler recovers an interrupted specialist after an API restart, it
first persists the Agent as `waiting` and emits `agent.status_changed` with
`recovered: true` and the prior status. It then emits `task.recovered` for the
requeued task. Interrupted runtime control jobs emit `task.cancelled` instead
and must be explicitly started again.

Every runtime event includes a concise `data.summary` and `companyId`; task
and specialist events include `taskId` and `agentId` where applicable.
Specialist events also include the canonical
`team` and `hired` projection so consumer departments and the Agent Grid do not
need to infer membership from display text. It never includes a raw API key, full prompt,
model reasoning, or workspace path outside the company-relative artifact name.

Agent inboxes are projections of persisted `agent.message_sent` handoffs. Each
hired specialist has a deterministic, address-like identity under
`inbox.orcha.local`, but it is explicitly `internal_only`; no SMTP, webhook,
external account, or public email delivery exists in V1. A completed task
targets each directly dependent specialist's deterministic agent id; a task
without dependents targets the company-wide orchestrator.

## Truthfulness rule

`task.progressed` must cite a real checkpoint or artifact. A client must not synthesize progress events for visual effect.
