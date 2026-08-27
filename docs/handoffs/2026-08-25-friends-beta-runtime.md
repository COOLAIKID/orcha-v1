Changed:
- Engineering now completes only with a JSON `app/` manifest (`app/index.html` required). Markdown-only is a failed/retryable task. Company agents use `max_tokens` 4096. Fenced JSON and trailing prose are parsed; paths stay under `app/`.
- Chat shows Planning → Researching/Designing/Building/Testing, then a quiet iframe/link to `GET /v1/companies/{id}/preview/index.html` when `preview.ready` or `app/index.html` exists.
- Agent Grid maps `plan.generated`, `task.created`, tool/preview/verification/revision/run events onto role-stable `specialist_*` nodes. Demo pauses on a live run. Workspace-check still uses `agent_local_engineer`.
- QA overflow uses the snapshot `overflow` flag when present. Stop All on Grid and `/stop` both call `POST /runtime/stop`, which also cancels in-flight `generate()`. `/diagnostics` is flag-gated and secret-free.
- Cloud AI off still blocks everyday chat; company specialists keep using server-side keys.

Discovered:
- Working tree already had FastAPI `/v1`, SSE, SQLite, WSL worker, planner, scheduler, Agent Grid `ingestReal`, and the preview route. The adapter was wired; docs that said otherwise were stale.
- `FakeModelGateway` had to return engineering JSON so specialist tests still complete after the empty-build guard.

Validated:
- `python -m pytest tests/test_worker_and_runtime.py` — 30 passed
- `python -m pytest tests/test_orcha_contracts.py` — 2 passed
- `node --experimental-strip-types --test src/runtimeEvents.test.ts src/agentGrid/agentGrid.test.ts` — 10 passed
- `npx tsc --pretty false --noEmit` and `npx vite build`
- UI is serving at http://127.0.0.1:5175/ and http://127.0.0.1:4173/
- Live `/workspace-check` + StudyFlow against worker/API were not run: `127.0.0.1:8080` and `127.0.0.1:8765` are down, and `orcha.local.env` is not present. Loop coverage is the FakeSandbox/gateway tests above (including markdown-empty-build guard, path confinement, QA revision, Stop All cancel).

Synthetic:
- Agent Grid Demo roster remains labeled **Demo** when no company run is active.

Open:
- Friends packaging (signed channel, one-click WSL installer) deferred until a live StudyFlow preview is confirmed on this machine.
- GitHub feedback sink still later; JSONL is enough for friends.

Preview:
http://127.0.0.1:5175/ (dev) or http://127.0.0.1:4173/ after `vite build`
