# Orcha handoff — stale Quick Tunnel recovery

## Changed

- Hardened `orcha-v1-starter-kit/scripts/start-orcha-tunnel.ps1` to recycle a
  stale recorded Quick Tunnel only after its executable, PID, and recorded
  start time match. If that managed process cannot be stopped, the script
  fails closed instead of starting another tunnel.
- Updated the shared change log and field-study crew notes.

## Discovered

- The previous recorded hostname had stopped resolving while cloudflared was
  still alive and retrying. A separate older cloudflared process was present
  but unrecorded and was intentionally left untouched.

## Validated

- The managed stale process was recycled successfully.
- Fresh public URL returned HTTP 200.
- Local API returned HTTP 200; runtime, workspace, and scheduler reported
  `ready`.

## Open

- Quick Tunnel URLs are temporary and can expire again; rerun the start wrapper
  to recycle and verify the recorded tunnel.
- The API still reports no configured server-side model provider until the
  owner uses the local provider helper.

Preview: `http://127.0.0.1:5175/`
Tunnel: `https://representatives-battle-listprice-minute.trycloudflare.com`
