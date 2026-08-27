# Handoff — Compose lifecycle resilience

Changed: Added API/worker health checks, `init: true`, and 30-second graceful
stop windows to `orcha-v1-starter-kit/infra/docker-compose.yml`. Added
`tests/test_compose_contract.py` to protect loopback API binding, disabled
example env-file loading, and the rule that provider credentials are API-only.

Discovered: The prior Compose pilot had a worker health check but no API health
check or explicit graceful lifecycle window. The container restart policy could
therefore restart a process without a clear service readiness contract.

Validated: Compose rendering passed; the full Python suite passed with
94 tests and one existing Starlette/httpx deprecation warning. The live API
was refreshed while idle and the API, scheduler, worker, and temporary tunnel
all returned healthy afterward.

Open: Docker Compose is a local/pilot topology. Hosted multi-tenant service
supervision, managed state, authentication, and secret storage remain future
work.
