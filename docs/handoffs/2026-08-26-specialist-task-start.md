# Specialist task-start evidence handoff

Date: 2026-08-26  
Agent: @codex

Changed:
- `orcha-v1-starter-kit/src/orcha/agents/runner.py` now publishes a bounded
  `task.started` event when a specialist task actually begins execution.
- Added a regression assertion in
  `orcha-v1-starter-kit/tests/test_worker_and_runtime.py` and reconciled the
  event schema, change log, and Field Study crew note.

Discovered:
- Cursor’s active consumer entrypoint remains `ui/src/main.tsx` → `Shell` →
  `ChatEntry`; the existing UI adapter already maps `task.started` to real
  working state.
- The local runtime continues to use provider-neutral task execution and the
  existing bounded event metadata contract.

Validated:
- Focused specialist runtime regression passed (`1 passed`).
- Full backend suite passed (`75 passed, 1 warning`).
- Frontend runtime/adapter suite passed (`36 passed`).
- Bundled TypeScript check and Vite production build passed.
- Refreshed `http://127.0.0.1:5175/`; headline, Feedback control, and no-overflow
  checks passed, and the preview was left open.

Open:
- Model-backed specialist work remains blocked until the API host has an
  approved provider configured.
