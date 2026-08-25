# Observability

## Correlation

Every request, task, agent run, tool call, artifact, and experiment carries `company_id`, `objective_id`, `task_id`, `run_id`, and `trace_id`.

## Signals

- Metrics: queue latency, task success/retry rate, tool errors, token/cost usage, VM health, experiment metrics.
- Logs: structured, redacted, severity-tagged; no raw secrets or unrestricted prompt dumps.
- Traces: orchestrator decision to task dispatch to tool call to artifact and evaluation.
- Events: durable domain history used for UI projections and audit.

## User-visible reliability

Surface “what happened,” “what was tried,” “what changed,” and “what happens next.” Never convert a missing heartbeat into a success message.
