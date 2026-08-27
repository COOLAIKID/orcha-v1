# Handoff — Local sandbox client lifecycle

Changed: `LocalWslSandboxManager.close()` now stops background health refresh,
closes an injected persistent `httpx.Client`, and is idempotent. Health and
requests fail closed after shutdown. The normal Windows WSL bridge remains
short-lived per request.

Discovered: The cloud replacement had just received equivalent cleanup, while
the local adapter still retained injected test/adapter clients through API
shutdown.

Validated: Focused local/cloud sandbox lifecycle coverage passed (2); the full
backend suite passed (96 tests, one existing Starlette/httpx deprecation
warning). The idle live API was refreshed successfully, and API, scheduler,
worker, UI, and temporary tunnel all returned healthy afterward.

Open: Hosted worker identity, managed service supervision, and multi-tenant
state remain future work.
