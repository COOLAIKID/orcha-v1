# Orcha handoff — provider setup and direct API startup

## Changed

- Added `orcha-v1-starter-kit/scripts/configure-orcha-provider.ps1`.
- The helper accepts provider/model values normally, reads API keys with hidden
  input only, supports a bounded temporary-key pool, writes only the private
  `orcha.local.env`, and attempts to tighten its Windows ACL. It never prints a
  key, accepts one in a command-line argument, or makes an upstream request.
- Added `src/orcha/config.py` and API startup loading so direct `uvicorn`
  launches read the same optional local environment file as the PowerShell
  wrappers. Explicit process/container variables win; hosted launches can set
  `ORCHA_DISABLE_LOCAL_ENV=true`.
- Documented the setup in `README.md`, `docs/operations/LOCAL_RUNTIME.md`, and
  the safe environment examples. Updated the shared change log and field-study
  crew notes.

## Discovered

- Cursor’s active consumer surface remains `ui/src/main.tsx -> Shell ->
  ChatEntry`; dormant Live HQ/Evolution/Studio views remain intentionally
  disconnected.
- The real local runtime is already wired: retry-safe scheduler, WSL worker,
  truthful offline chat, stop-all cancellation, durable events, and local
  feedback. Provider configuration is the remaining prerequisite for real
  specialist model requests.

## Validated

- Backend: `90 passed, 1 warning`.
- Frontend: `31 passed`; TypeScript no-emit and Vite production build passed.
- PowerShell helper parsed successfully; list-to-file serialization smoke test
  passed; direct local-env-to-gateway smoke test passed with a dummy key and no
  network request.
- Live API/UI returned HTTP 200. Runtime recovered to `ready`; scheduler was
  `ready`; the temporary Cloudflare tunnel process remained running.

## Open

- `agentProviderConfigured` is intentionally `false` until the owner configures
  a real server-side provider through the helper. A configured key still needs
  a real request before it can be considered usable.
- Cloudflare Quick Tunnel is temporary and exposes only the Vite UI; API and
  worker ports remain private. A second older cloudflared process was visible,
  but no process was terminated because that would be destructive without an
  explicit target.

Preview: `http://127.0.0.1:5175/`
Tunnel: `https://adware-hardware-arg-trunk.trycloudflare.com`
