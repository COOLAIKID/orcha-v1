# Handoff — Runtime control rehydration

Changed: Updated `orcha-v1-starter-kit/ui/src/runtimeClient.ts` so existing
device-local runtime mappings are validated and rehydrated before pause,
resume, status, and refresh hydration. A missing Stop All runtime clears the
stale mapping and returns an actionable message instead of exposing the API’s
raw 404 detail. Added focused regressions in
`orcha-v1-starter-kit/ui/src/runtimeClient.test.ts`.

Discovered: Cursor’s consumer chat remains the active entry surface. The local
API intentionally keeps company state in memory, so the browser can outlive a
company record after an API restart. The existing workspace mapping and
`ensureRuntimeCompany` contract were preserved.

Validated: 51 direct UI tests pass. TypeScript `--noEmit` and the Vite
production build pass. The rehydration path is bounded by the existing
8-second hydration signal. Backend source was unchanged; the latest known
full backend result remains 96 passed, with the local venv unavailable to the
current sandbox for a fresh rerun.

Open: Server-side provider credentials remain intentionally unconfigured in
this local checkout. True hosted 24/7 execution is still a future
`CloudSandboxManager` boundary; the current runtime is real while the PC/API
and local worker are alive.

Preview: `http://127.0.0.1:5175/`
