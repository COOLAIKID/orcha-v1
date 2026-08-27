# Runtime contract and planner safety handoff

Date: 2026-08-26  
Agent: @codex

Changed:
- `orcha-v1-starter-kit/src/orcha/events/bus.py` and
  `orcha-v1-starter-kit/src/orcha/persistence/sqlite.py` now apply the same
  safe event normalization for in-memory and durable events: canonical
  `companyId`, fallback `summary`, and `taskId` for `task.*` aggregates.
- `orcha-v1-starter-kit/src/orcha/tools/registry.py` and
  `orcha-v1-starter-kit/src/orcha/agents/runner.py` now fail closed when a
  typed tool returns `ok: false`; a follow-up model cannot turn failed tool
  evidence into a completed task.
- `orcha-v1-starter-kit/src/orcha/runtime/planner.py` rejects duplicate keys,
  duplicate dependencies, and cyclic task graphs before a model plan enters
  the persistent scheduler. Invalid model plans use the existing visible
  fallback path.
- Added focused regressions and updated the local runtime/event documentation,
  change log, and Field Study crew note.

Discovered:
- Cursor's active consumer entrypoint remains `ui/src/main.tsx` → `Shell` →
  `ChatEntry`; the current dark 5175 chat remains intact and the dormant dev
  views remain intentionally unwired.
- Existing real-runtime improvements remain preserved: task-start evidence,
  bounded retries, restart recovery, local WSL isolation, Agent Grid event
  adapter, and the temporary Quick Tunnel.

Validated:
- Focused runtime regressions: 5 passed.
- Full backend suite: 78 passed, 1 existing Starlette/httpx deprecation
  warning.
- Frontend/runtime suite: 42 passed.
- Bundled TypeScript check and Vite production build passed.
- API health settled to `ready` for both scheduler and WSL-backed workspace;
  provider list is truthfully unconfigured in this environment.
- Refreshed and left open `http://127.0.0.1:5175/`; the dark consumer chat
  showed the Feedback control and no parallel runtime/status clutter.

Open:
- Model-backed specialist work still needs an approved provider configured on
  the API host. The temporary tunnel shares the local PC cockpit and cannot
  provide power-independent cloud execution.

Preview: http://127.0.0.1:5175/
Tunnel: https://adware-hardware-arg-trunk.trycloudflare.com/
