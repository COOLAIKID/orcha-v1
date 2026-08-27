# Runtime and chat continuation

Date: 2026-08-26  
Agent: @codex

Changed:
- Continued from Cursor's active consumer chat surface and removed rotating
  headline face ghosting by clipping the flip viewport and switching face
  ownership at the midpoint.
- Fixed the local Windows-to-WSL bridge so workspace JSON bodies are sent only
  over stdin and never appended to the visible `wsl.exe` argument list.
- Made cancellation preserve an in-flight verified file event without allowing
  a late `task.completed` result.
- Reconciled `ORCHA-CHANGES.md` and `ORCHA-FIELD-STUDY.md`.

Discovered:
- Cursor's current entrypoint remains `ui/src/main.tsx` → `Shell` →
  `ChatEntry`; dormant dev-mode views remain intentionally unwired.
- The local worker and API were stale/offline when this session began. The
  scoped lifecycle wrappers restored `orcha-worker` on `127.0.0.1:8765` and the
  latest API on `127.0.0.1:8080`.
- The existing managed Quick Tunnel targets Vite on port 5175 and remained
  reachable; unknown Cloudflare processes were not terminated.

Validated:
- 75 backend tests passed; 42 frontend/runtime tests passed.
- TypeScript check and Vite production build passed.
- Impeccable detector was run; remaining warnings are existing low-severity
  font/grid/dormant onboarding patterns.
- Real disposable API workspace check emitted `sandbox.connected`,
  `task.started`, `tool.started`, `file.created`, and `task.completed`; its
  company and workspace were explicitly destroyed afterward.
- Local and temporary-tunnel health both report scheduler `ready` and worker
  `ready` after the bounded probe settles.

Open:
- The runtime is still local-PC execution, not a cloud VM that survives power
  off. Provider credentials are unconfigured in this environment, so model
  backed specialist work remains truthfully blocked until the API host is
  configured.

Preview: http://127.0.0.1:5175/
