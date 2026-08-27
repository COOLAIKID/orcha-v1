# Stop All idle-run finalization

Date: 2026-08-27  
Agent: @codex

Changed:
- Updated `orcha-v1-starter-kit/src/orcha/runtime/scheduler.py` so
  `stop_company()` immediately closes queued-only runs after cancelling their
  tasks. In-flight runs still finalize through their worker boundary.
- Added a regression in
  `orcha-v1-starter-kit/tests/test_worker_and_runtime.py`.

Discovered:
- Cursor’s current active surface remains the shared consumer chat. The
  local runtime work is integrated beneath it; provider credentials remain
  intentionally unconfigured in the API environment.

Validated:
- Focused scheduler regressions passed.
- Full backend suite passed: 87 tests, 1 existing Starlette/httpx warning.
- Frontend suite passed: 31 tests; TypeScript and Vite production build pass.
- Live API workspace check completed through the WSL bridge and the temporary
  verification company was destroyed afterward.
- Restarted the named API and worker services; the Cloudflare tunnel process
  remains alive.
- The reloaded live health endpoint reports API `ok`, worker `ready`, and
  scheduler `ready`; a fresh disposable workspace check completed and its
  exact WSL file contents were verified before cleanup.

Open:
- Configure a server-side provider before expecting real model-backed
  specialist work.
- The Windows host does not expose the WSL service through its localhost
  forwarder, so direct `wsl.exe` probes can print host-PATH translation
  warnings; the managed bridge and runtime health path are working.
