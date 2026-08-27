# Orcha handoff — repeatable local pilot startup

## Changed

- Added `orcha-v1-starter-kit/scripts/start-orcha-pilot.ps1`.
- The launcher starts or reuses the dedicated worker, API, Vite cockpit, and
  verified temporary Cloudflare tunnel on the canonical 8765/8080/5175
  topology. `-NoTunnel` keeps it local-only.
- It checks HTTP readiness before trying to enumerate a process, so restricted
  Windows shells can still reuse a healthy UI. Unhealthy occupied ports are
  rejected rather than terminated. Standard Node paths and an explicit
  `-NpmPath` are supported.
- Updated README, local runtime docs, change log, and field-study crew notes.

## Discovered

- The current UI is reachable on 5175 even when this shell cannot enumerate
  its listening PID. HTTP readiness is the correct reuse signal for this pilot.
- Existing API, worker, scheduler, and tunnel processes were left untouched.

## Validated

- PowerShell parsing passed for both new operational scripts.
- Invalid `-NpmPath` fails closed without starting a process.
- `start-orcha-pilot.ps1 -NoTunnel` reused the live API and Vite UI successfully.
- Existing backend/UI/build/live runtime validation remains green from the
  provider setup slice.

## Open

- A real server-side model provider still needs to be configured before
  specialist AI work can run. The launcher does not infer or activate keys.
- Temporary Quick Tunnel URLs remain ephemeral and are not hosted auth.

Preview: `http://127.0.0.1:5175/`
Tunnel: `https://adware-hardware-arg-trunk.trycloudflare.com`
