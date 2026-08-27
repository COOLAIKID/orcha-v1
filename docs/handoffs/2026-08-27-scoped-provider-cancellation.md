# Orcha handoff — company-scoped provider cancellation

## Changed

- `orcha-v1-starter-kit/src/orcha/models/gateway.py` now supports optional
  company-scoped cancellation. Scoped calls use tracked short-lived HTTP
  clients; the existing no-argument global cancellation path remains for
  process shutdown and legacy adapters.
- `orcha-v1-starter-kit/src/orcha/runtime/planner.py` and
  `orcha-v1-starter-kit/src/orcha/agents/runner.py` pass the company id into
  model requests when the gateway supports the option.
- `orcha-v1-starter-kit/src/orcha/api/app.py` now scopes Stop All to the
  selected company without breaking older injected gateways.
- Added gateway isolation and API stop-route regressions; updated local
  runtime docs and shared change/field-study logs.

## Discovered

- Cursor's consumer chat remains the active entrypoint. Dormant operator views
  are intentionally not reconnected.
- The local pilot and fresh Quick Tunnel remain healthy; the public tunnel
  exposes Vite only while API/worker ports stay private.

## Validated

- Focused gateway/planner/stop tests: 6 passed.
- Existing focused stop/cancellation baseline: 3 passed.
- Python syntax check passed for modified runtime modules.

## Open

- A real provider must still be configured on the API host before specialist
  model work can be live-verified. The browser-side `ui/.env` key is not used.
- Cloud control-plane hosting and durable multi-user identity remain future
  work; this pilot is intentionally PC-bound.

## Preview

- Local cockpit: http://127.0.0.1:5175/
- Temporary tunnel: https://representatives-battle-listprice-minute.trycloudflare.com/
