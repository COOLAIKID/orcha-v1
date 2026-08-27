# API Contracts

Base path: `/v1`. JSON over HTTPS. The local runtime exposes both the durable
cursor (`GET /companies/{company_id}/events?since=N`) and a server-sent event
stream (`GET /companies/{company_id}/events/stream?since=N`). UI consumers use
SSE and must still tolerate reconnects/duplicates by sequence number.

The FastAPI app accepts injected runtime, sandbox, model-gateway, scheduler,
state-store, and feedback-sink services. Production wiring selects the local
or future cloud implementation; tests can provide fakes without constructing
or reaching WSL. The API surface remains independent of that provider choice.

## Server chat boundary

`POST /api/chat` accepts `{messages, instructions?, userId?}` and returns
the same `text/event-stream` frames as the Vite development chat:
`{"delta":"..."}` followed by `{"done":true}`. Turns and instructions are
bounded, are not persisted, and `userId` is contract metadata only until
authentication exists. The endpoint delegates to the API host's injected
server-side model gateway; it never accepts provider keys. If no provider is
configured or the upstream request fails, it returns `503` rather than a fake
AI reply. The Vite middleware remains the development implementation, while
this endpoint is the production/static-deployment boundary.

## Create company

`POST /companies`

```json
{"name":"StudyFlow","goal":"Build and launch a study-material summarizer for university students","constraints":{"deadline":"30d","budget_usd":25}}
```

Returns `201` with `company`, `objective`, `plan_preview`, and `required_capabilities`.

## Start company

`POST /companies/{id}/start` — creates the first durable orchestration run and
queues the initial role-scoped tasks. The local scheduler dispatches eligible
tasks while the API host is alive.

`POST /companies/{id}/runs` with `{"goal":"..."}` — starts one durable
company run from the provided outcome and returns the persisted run plus its
planned tasks. The boundary is retry-safe for a phone or temporary tunnel:
while the same company has a queued, running, or blocked run with the same
goal, a repeated request returns that existing run and task set with
`reused: true` and does not spawn another plan. A different goal while work is
active returns `409`; stop the current run before changing the outcome.

## Read dashboard

`GET /companies/{id}/dashboard` — durable company, objective, stored tasks,
agents, derived team snapshots, safe handoffs, artifacts, and the most recent
domain events. Team snapshots are informational: their status is computed from
the returned Agent records and does not create or dispatch work.

`GET /companies/{id}/events?since=N` — ordered durable event cursor for the
current UI.

## Local runtime controls (implemented)

- `GET /runtime/health` — Local Workspace state, boolean
  `agentProviderConfigured`, provider configuration summaries, and (when the
  scheduler exposes it) a separate `scheduler` liveness projection. The
  worker's `ready` state does not imply that the API dispatcher is alive; the
  scheduler status is `ready` only after its loop has started. No provider key
  is returned.
- `POST /companies/{id}/runtime/workspace-check` — starts the bounded
  `test.txt` proof loop. The boundary is retry-safe: an in-flight check is
  reused within the API process, and one still-queued check is rehydrated after
  a process restart rather than duplicated. A check that was already running
  when the process stopped is cancelled fail-closed and must be explicitly
  retried.
- `POST /companies/{id}/runtime/stop` — stops tracked Local Workspace work.
- `POST /companies/{id}/runtime/pause` — pauses new scheduled agent dispatch.
- `POST /companies/{id}/runtime/resume` — returns a paused company to running
  and requeues tasks blocked solely by runtime configuration.
- `POST /companies/{id}/destroy` — permanently erases one *idle* local company.
  Its JSON body must include `{"confirm_company_id":"{id}"}` exactly. The
  runtime first cancels queued work, refuses deletion while a model task is
  still in flight, stops only that company's worker children, destroys only
  its confined workspace, and finally removes its SQLite company, task, event,
  memory, and usage records. It cannot be undone.

## Internal diagnostic

## Process probes

`GET /health` is a cheap process-liveness probe and returns `200` while the
API process can answer. `GET /health/ready` is the bounded deployment
readiness probe: it returns `200` only when the workspace provider and the
persistent scheduler are ready, otherwise `503` with their safe status
projections. Model-provider configuration is intentionally not required for
readiness; a running company may be waiting for an approved provider key.

`GET /internal/diagnostics` is available only when
`ORCHA_INTERNAL_DIAGNOSTICS=true`. It reports provider configuration status,
worker health, scheduler liveness, durable event-store type, and event
transport. It never returns provider keys, prompts, files, or private agent
reasoning.

## Feedback

`POST /api/feedback` stores a bounded, sanitized local record. Ordinary
feedback does not require a worker health probe; this keeps the endpoint usable
while the Local Workspace is offline. If `include_technical_info` is true, the
API adds only the allowlisted app/runtime versions, OS family, same-app pathname
without query data, timestamp, and a short sanitized client-error buffer. A
non-path route fails closed to `/`. That buffer
redacts labeled and raw credential shapes, environment assignments, URLs, and
common Windows/Unix filesystem paths before it is persisted.

## Tasks

- `GET /companies/{id}/tasks` returns the company's durable task records and
  `truth_source: "durable_task_state"`.
- `POST /companies/{id}/tasks/{task_id}/pause` pauses a queued or blocked
  specialist task before dispatch. Running tasks fail closed with `409`; use
  the runtime Stop action for active work. The route emits `task.paused`.
- `POST /companies/{id}/tasks/{task_id}/retry` requeues a failed, cancelled,
  blocked, or paused specialist task when its company is running. It reopens a
  failed/stopped/blocked parent run, resets that task's bounded attempt window,
  and emits `task.retry_requested`. Runtime control tasks are retried through
  their dedicated action (`workspace-check`) so a generic task route cannot
  duplicate a file-writing job.

Blocked specialist task records may include a bounded internal
`blocked_reason_code`. `provider_unavailable` is the only code the always-on
scheduler can recover automatically after the server-side gateway becomes
available; policy and capability blocks remain owner-resumable.

Task routes always verify that the task belongs to the path company. A stale
dispatch race is handled by re-reading the task immediately before scheduler
submission; an owner pause cannot be overwritten by an old queue snapshot.
Paused work keeps its parent run open and prevents an always-on company from
starting a later cycle. Stop/teardown cancels paused work along with queued and
blocked work.

## Artifacts and files

- `GET /companies/{id}/artifacts` returns generated worker artifacts with
  their current `company_vault` or `shareable` tier.
- `POST /companies/{id}/files/classify` with `{file_id, tier}` can move a
  generated artifact between `company_vault` and `shareable`. It rejects
  `local_only`; local-only bytes must never be copied into the worker.
- `POST /companies/{id}/local-only-files` accepts metadata only:
  `{name, size_bytes, media_type?, content_hash?}`. The request must not
  include file contents. `GET /companies/{id}/local-only-files` returns the
  device-local metadata records. A future authenticated client bridge owns
  reading those bytes; this milestone does not upload or expose them.

## Agent inboxes

- `GET /companies/{id}/agents/{agent_id}/inbox?limit=50` returns the durable
  safe handoffs addressed to that agent plus company-wide handoffs. Each agent
  has a stable `inbox_id` and deterministic address-like `inbox_address` (for
  example `inbox-a1b2@inbox.orcha.local`).
- `GET /companies/{id}/inboxes` lists those identities for hired specialists.
  The `.local` domain and the `delivery: internal_only` response are
  deliberate: this is an internal runtime mailbox concept, not public email
  delivery or a permission to contact anyone. When a task completes, the
  runtime routes its bounded handoff to directly dependent specialists using
  their deterministic id even before they start; tasks without dependents
  broadcast to the orchestrator.

Inboxes are internal runtime messages only. They contain concise summaries and
evidence references, never raw reasoning, provider request bodies, secrets, or
external email delivery. An email adapter remains a future capability and is
not enabled by this endpoint.

## Experiments

- `POST /companies/{id}/experiments` creates an evidence-only comparison with a
  baseline version, one candidate version, primary metric, minimum sample
  count/improvement, guardrails, and sample window.
- `GET /companies/{id}/experiments` and
  `GET /companies/{id}/experiments/{experiment_id}` return the durable record
  and the current evaluation.
- `POST /companies/{id}/experiments/{experiment_id}/observations` records one
  bounded baseline or candidate observation, its guardrail values, cost, and
  concise evidence reference.
- `POST /companies/{id}/experiments/{experiment_id}/promote` promotes only
  after both variants meet the sample minimum, the candidate reaches the
  configured improvement, and every candidate guardrail passes. Failed gates
  return `409` and preserve the baseline.
- `POST /companies/{id}/experiments/{experiment_id}/rollback` always restores
  the retained baseline for a previously promoted experiment.

Promotion records a durable decision and rollback target; it does **not**
deploy source, alter an agent prompt, or mutate production. Applying a
promoted version remains a future explicitly gated deploy transaction.

## Error envelope

```json
{"error":{"code":"CAPABILITY_REQUIRED","message":"External publishing is not enabled","retryable":false,"request_id":"..."}}
```

## Idempotency and ordering

Events are ordered per company and include monotonically increasing sequence
numbers. Consumers must tolerate duplicates. Idempotency keys and a WebSocket
stream remain required before a public multi-user API is exposed.
