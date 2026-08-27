# Task controls and stale-dispatch guard

Date: 2026-08-26  
Agent: @codex

Changed:
- Added durable `GET /v1/companies/{id}/tasks` inspection.
- Added owner `pause` and `retry` task controls with company/task ownership
  checks, active-work fail-closed behavior, and explicit `task.paused` and
  `task.retry_requested` events.
- Retry only requeues specialist tasks on a running company and reopens a
  failed/stopped/blocked parent run with a fresh bounded attempt window.
  Runtime jobs remain behind their dedicated runtime actions so a generic retry
  cannot duplicate a file-writing job.
- Re-read queued task state immediately before scheduler submission to prevent
  an old queue snapshot from undoing an owner pause.
- Kept paused tasks in run terminal/open-work accounting so a paused sibling
  cannot be mistaken for a completed run or allow an always-on cycle to jump
  ahead; Stop/teardown cancels paused work too.
- Updated the real Agent Grid/work log projection and typed runtime client
  helpers so pause, resume, and retry events remain visible without synthetic
  activity.

Discovered:
- Cursor's `GameApp.tsx` remains a preserved, unwired prototype; the active
  entrypoint is still `main.tsx` → `Shell` → `ChatEntry`.
- The local runtime, SQLite event cursor, worker boundary, tunnel pilot gate,
  and always-on scheduler remain intact. `CHANNEL.md` is not present in this
  checkout.

Validated:
- Backend: 68 passed, 1 existing Starlette/httpx deprecation warning.
- Frontend TypeScript check passed.
- Frontend focused node tests: 32 passed.
- Vite production build passed (50 modules).

Open:
- A generic task-control UI is not surfaced in the consumer chat yet; the
  existing Stop All control remains the active operator action for running
  work. Hosted auth/cloud execution remain future work.

Preview: http://127.0.0.1:5175/
