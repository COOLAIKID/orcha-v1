# Runtime and tunnel hardening

Date: 2026-08-26
Agent: @codex

Changed:
- Preserved the active consumer chat entrypoint. Cursor's `ui/src/GameApp.tsx`
  and Three.js handoff are not wired into `ui/src/main.tsx`, so they remain
  untouched for a future decision.
- Hardened `orcha-v1-starter-kit/scripts/start-orcha-tunnel.ps1` and
  `stop-orcha-tunnel.ps1` so a recorded tunnel PID is matched by executable and
  process start time, with a narrow compatibility read for older state.
- Added an explicit 1.5-second reconnect hint and no-transform cache boundary
  to the runtime SSE stream in `src/orcha/api/app.py`.
- Made the server stream disconnect-aware and made the browser reconnect from
  its latest received event cursor with bounded backoff.
- Hardened the future cloud worker path: explicit offline health is preserved
  and Docker Compose passes the control-plane token to both services.
- Added a cloud-manager regression test that verifies the private worker token
  is forwarded on hosted health requests.
- Added ordered, server-only provider key pools so temporary free-tier keys can
  fall through safely when one expires or is rate-limited.
- Added an in-memory cooldown for failed provider keys, so an always-on run
  skips a known-bad temporary key on its next task while still making a full
  recovery pass if every configured key is cooling down.
- Added a scoped `watch-orcha-local.ps1` supervisor and changed the optional
  Windows logon task to use it, so later API/worker disappearance can recover
  without terminating an unknown process on the API port.
- Restarted the local API so the live preview uses the updated SSE headers.

Discovered:
- The worker is running inside the dedicated `orcha-worker` distro. It is
  intentionally not exposed on Windows `127.0.0.1:8765`; the API reaches it
  through the WSL bridge.
- The local API has no configured model provider in `orcha.local.env`, so real
  specialist planning remains explicitly blocked rather than faked.
- The current temporary Quick Tunnel is recorded at
  `orcha-v1-starter-kit/var/tunnel/orcha-tunnel.json`; API and worker ports are
  private.

Validated:
- Real workspace check completed with `task.completed` and created
  `/home/orcha/workspaces/co_5b77fac5d8/test.txt` containing exactly
  `hello from orcha`.
- Backend: 66 passed, 1 existing Starlette/httpx deprecation warning.
- Frontend: 36 tests passed, TypeScript passed, Vite production build passed.
- Local UI and API health returned 200; event stream headers were verified.
- Both tunnel PowerShell scripts parse successfully.
- Runtime reconnect resumes from the latest durable cursor.
- Cloud worker health, compose token wiring, and hosted token forwarding are
  covered by regression tests.
- Focused cloud/auth suite: 4 passed, 57 deselected.
- Provider gateway suite: 11 passed, 53 deselected; failed-key cooldown and
  preserved provider fallback labeling are covered.
- Supervisor PowerShell syntax and a real `-Once` health-and-repair pass passed
  against the running API and dedicated WSL worker.
- Shared UI TypeScript check and Vite production build passed again; UI remains
  on the consumer chat entrypoint.

Open:
- Public Quick Tunnel reachability could not be re-probed from this Windows
  environment after startup because Schannel reported `SEC_E_NO_CREDENTIALS`;
  cloudflared remains registered and the local origin is healthy.
- A hosted, authenticated runtime still needs a real CloudSandboxManager,
  managed process supervision, provider credentials, and multi-user auth.
- The local supervisor improves PC continuity only; it cannot run before login
  or while Windows is powered off. The managed Quick Tunnel process is alive at
  the recorded URL, but this Windows environment still cannot reliably probe
  the public edge because Schannel reports `SEC_E_NO_CREDENTIALS`.
