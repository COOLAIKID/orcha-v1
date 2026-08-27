# Temporary tunnel pilot gate

Date: 2026-08-26
Agent: @codex

Changed:
- Added `orcha-v1-starter-kit/ui/src/tunnelGate.ts`, a server-only constant-time token verifier. It hashes the configured token, accepts a bootstrap query once, and issues a same-origin HttpOnly SameSite cookie without retaining the raw token in the client.
- Added an opt-in gate to `ui/src/chatPlugin.ts`. When `ORCHA_TUNNEL_TOKEN` is set before Vite starts, `/v1` and `/api/*` return `401` until `/__orcha_access?token=<value>` succeeds; static assets and `/` remain reachable so the browser can bootstrap.
- Added minimal `node:crypto` declarations and private `ui/.env.example` guidance. Local development remains open when the variable is unset.
- Documented the boundary and its limits in the README, local runtime, deployment, and security docs.

Discovered:
- The current Quick Tunnel is still intentionally unauthenticated because the live Vite process has no `ORCHA_TUNNEL_TOKEN`; no existing local or phone preview behavior was changed.
- The gate is a shared-token convenience for a short friends-only pilot. It is not per-user auth, revocation, quotas, CSRF protection, or a production control plane.
- The active consumer entrypoint remains `ui/src/main.tsx` → `Shell` → `ChatEntry`; Cursor's unwired `GameApp` remains preserved.

Validated:
- Isolated Vite gate on port 5199: unauthenticated `/v1/runtime/health` → `401`; valid bootstrap → `302` with `HttpOnly; SameSite=Strict` cookie; cookie-authenticated health → `200`.
- Frontend TypeScript check passed.
- Vite production build passed; `ORCHA_TUNNEL_TOKEN` and the test token were absent from `dist` assets.
- Backend full suite: 66 passed, 1 existing Starlette/httpx deprecation warning.
- Existing local Vite preview at `http://127.0.0.1:5175/` remains reachable.

Open:
- Before exposing a shared tunnel with real provider credentials, configure a high-entropy token in the Vite process and use the bootstrap path. Hosted deployments still require real multi-user auth, quotas, abuse controls, and a managed cloud runtime.

Preview: `http://127.0.0.1:5175/`
