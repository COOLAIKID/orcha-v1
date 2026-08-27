# Handoff — Provider shutdown lifecycle

Changed: Added `EnvironmentModelGateway.close()` and the compatible
`close_model_gateway()` helper. API lifespan shutdown now releases the shared
and any active company-scoped HTTP clients without allocating the replacement
client used by reusable company cancellation. Cleanup is idempotent, and older
injected gateways still receive their no-argument `cancel()` fallback.

Discovered: The prior shutdown path reused global cancellation, which correctly
stopped requests but created a fresh idle `httpx.Client` after the control plane
was already stopping.

Validated: Added a regression for idempotent client cleanup; the focused
provider tests and full backend suite pass (94 tests, one existing
Starlette/httpx deprecation warning). The local API/UI/tunnel remain on the
canonical 8080/5175 topology, and the API was refreshed successfully while
idle.

Open: Hosted deployments still need managed service lifecycle and secret
storage; this closes the local API gateway lifecycle only.
