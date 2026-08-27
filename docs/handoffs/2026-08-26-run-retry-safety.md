# Orcha handoff — retry-safe company runs

## Changed

- `orcha-v1-starter-kit/src/orcha/persistence/sqlite.py` adds `active_run()`
  for a durable non-terminal run lookup.
- `orcha-v1-starter-kit/src/orcha/api/app.py` serializes runtime ownership
  changes (including Stop) and makes `POST /v1/companies/{id}/runs`
  single-flight. A same-goal retry returns the existing run/tasks with
  `reused: true`; a different goal receives `409` while work is active.
- API and local-runtime docs describe the retry contract.

## Why

The phone can lose a response through the temporary Cloudflare tunnel after
the API has already accepted the run. Replaying the request must not create a
second plan or duplicate specialist work.

## Validated

- Focused runtime recovery and retry-safety tests: 4 passed.
- Full backend suite: 81 passed, 1 existing httpx/Starlette deprecation warning.

## Open

- Provider credentials remain intentionally unconfigured in the local preview.
- This protects one API process; a future multi-instance deployment needs a
  database-backed activation/idempotency key at the hosted boundary.
