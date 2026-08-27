# Handoff — Compose deployment boundary

Changed: Hardened `orcha-v1-starter-kit/infra/docker-compose.yml` so the
example inventory is no longer injected as a runtime env file, provider values
are explicitly scoped to the API, container local-env discovery is disabled,
and the API binds only to `127.0.0.1:8080`. Added `.env` and `ui/.env` to the
starter-kit ignore rules and documented the private Compose setup.

Discovered: The prior Compose file contradicted its own privacy docs by
loading `.env.example` and publishing API port 8080 on all host interfaces.
The worker remained private and uses the existing CloudSandboxManager boundary.

Validated: `docker compose --env-file .env.example -f infra/docker-compose.yml config`
passed without starting containers; secrets were not added to any tracked file.
Full runtime/UI validation remains unchanged from the prior handoff.

Open: A true hosted deployment still needs authentication, managed state,
secret storage, and a supervisor. The local Quick Tunnel remains a temporary
share of the Vite cockpit only.
