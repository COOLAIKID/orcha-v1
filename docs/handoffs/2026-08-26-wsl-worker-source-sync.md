# WSL worker source sync and real acceptance

Date: 2026-08-26  
Agent: @codex

Changed:
- Replaced the setup/restart wrappers' PowerShell native tar pipeline with a
  direct, text-file copy through the dedicated `\\wsl$\\orcha-worker` filesystem.
- Excluded Python bytecode from the sync and made the source path calculation
  compatible with Windows PowerShell 5.1.
- Setup, start, stop, and supervisor wrappers now invoke an absolute `wsl.exe`
  with an empty host `PATH`, so customized agent/tool paths are not translated
  into WSL.
- Documented the sync boundary in `docs/operations/LOCAL_RUNTIME.md` and the
  shared change/crew logs.

Discovered:
- The dedicated `orcha-worker` distro was already provisioned and its systemd
  service was enabled, but the previous tar pipe had truncated `worker/app.py`
  and left the service in a restart loop.
- The active UI remains Cursor's consumer chat at
  `ui/src/main.tsx` → `Shell` → `ChatEntry`; no dormant dev-mode route was
  reconnected.

Validated:
- Corrected worker wrapper starts `orcha-worker` cleanly on `127.0.0.1:8765`.
- API `/v1/runtime/health` reaches the worker through the WSL bridge.
- Real API workspace check emitted `sandbox.connected`, `task.started`,
  `tool.started`, `file.created`, and `task.completed`.
- Physically verified `test.txt` under the WSL company workspace contained
  exactly `hello from orcha`; the temporary verification company was then
  explicitly destroyed.
- Full backend suite: 73 passed. Frontend TypeScript and Vite production build
  passed.

Open:
- This is still a local-PC runtime, not hosted cloud execution after power-off.
- The existing Starlette/httpx deprecation warning remains.

Preview: http://127.0.0.1:5175/
