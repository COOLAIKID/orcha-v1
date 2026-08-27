# Orcha handoff — provider cancellation boundary

## Changed

- `orcha-v1-starter-kit/src/orcha/models/gateway.py` replaces the shared
  stop-flag race with a per-request cancellation generation and swaps the
  closed client under a lock.
- A cancelled in-flight request now terminates without trying a second key or
  provider.
- Operational docs and the change log record the boundary.

## Why

Stop All closes the provider connection, but the response can unwind on a
worker thread after that call. The old flag was cleared immediately, allowing
the fallback loop to continue and potentially consume another temporary key.

## Validated

- Focused cancellation regression: 1 passed.
- Gateway-focused suite: 10 passed, 69 deselected.
- Full backend suite: 82 passed, 1 existing httpx/Starlette deprecation warning.
- Full frontend test set: 29 passed.
- TypeScript check and production Vite build passed.
- Impeccable detector returned no findings for the changed chat/runtime adapter
  sources.

## Open

- Provider credentials remain intentionally unconfigured in the local preview.
- A future hosted gateway should preserve request-generation cancellation at
  its job boundary as well.
