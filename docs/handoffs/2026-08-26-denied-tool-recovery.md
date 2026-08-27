# Denied tool recovery handoff

Date: 2026-08-26  
Agent: @codex

Changed:
- `orcha-v1-starter-kit/src/orcha/agents/runner.py` now persists a denied
  typed-tool task and its specialist Agent as `blocked` before raising the
  existing `AgentBlocked` policy signal.
- Added a regression proving a denied `workspace.write_file` request cannot
  leave the task in `running`, and that the durable `tool.denied` evidence is
  retained for a later resume.
- Updated `ORCHA-CHANGES.md` and `ORCHA-FIELD-STUDY.md` with the narrow recovery
  correction.

Discovered:
- Cursor's active entrypoint is still `ui/src/main.tsx` → `Shell` → `ChatEntry`;
  the consumer chat and intentional dormant dev surfaces were preserved.
- The prior event normalization, failed-tool fail-closed behavior, cyclic-plan
  rejection, WSL isolation, always-on scheduler, and temporary tunnel remain
  intact.

Validated:
- Focused denied-tool/runtime regressions passed.
- Full backend suite: 79 passed, 1 existing Starlette/httpx deprecation warning.
- The preceding shared frontend/runtime suite (42 tests), TypeScript check,
  and Vite production build remain green; this change is backend-only and does
  not alter the UI bundle.

Open:
- Provider keys remain unconfigured in this environment, so real model-backed
  specialist work remains truthfully blocked until the API host is configured.

Preview: http://127.0.0.1:5175/
