# Observability

## Correlation

The local event envelope carries `company_id`, `aggregate_id`, `sequence`, and
`actor`. Its bounded `data` includes `companyId`, `summary`, and the relevant
`taskId`, `agentId`, `runId`, `role`, or artifact name. The current SQLite
runtime does not claim an `objective_id` or distributed `trace_id` on every
event; those remain hosted-observability additions.

## Signals

- Metrics: queue latency, task success/retry rate, tool errors, token/cost usage, VM health, experiment metrics.
- Logs: structured, redacted, severity-tagged; no raw secrets or unrestricted prompt dumps.
- Traces: orchestrator decision to task dispatch to tool call to artifact and evaluation.
- Events: durable domain history used for UI projections and audit.

## User-visible reliability

Surface “what happened,” “what was tried,” “what changed,” and “what happens next.” Never convert a missing heartbeat into a success message.
