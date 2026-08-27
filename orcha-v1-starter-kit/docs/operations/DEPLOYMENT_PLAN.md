# Deployment Plan

## Local

`docker compose --env-file .env -f infra/docker-compose.yml up --build -d`
starts a restartable API plus a private `orcha-worker` service. Create the
ignored `.env` from the safe inventory first, then put provider credentials and
the optional worker token there. Compose passes those values explicitly to the
API; it does not load `.env.example` as a service environment file. The API
uses durable SQLite in `orcha-data`; worker-only company workspaces live in the
separate `orcha-workspaces` volume. The API is bound to `127.0.0.1:8080` and
the worker has no published host port, so the worker is reached only by the API
as `http://worker:8765` through `CloudSandboxManager`.

Both services use bounded health checks and a 30-second graceful stop window.
`/health` is a cheap process-liveness probe; the API's Compose check uses
`/health/ready`, which also requires the workspace provider and persistent
dispatcher to be ready. The worker check covers the private execution
boundary before the API is started. Docker's restart policy can recover a
crashed or stranded process without treating a dead worker or scheduler as
healthy.

The container API sets `ORCHA_DISABLE_LOCAL_ENV=true` so a copied developer
`orcha.local.env` cannot be discovered inside the image. If no provider values
are supplied, the stack still starts but specialist work remains honestly
blocked until the API is restarted with a configured provider. Do not paste
provider keys into `docker compose config` output or commit the ignored `.env`.

This is a deployable local/pilot topology, not yet a public multi-tenant cloud
control plane. Configure model provider values in the API host environment,
not in browser build variables.

For a Windows pilot that should resume after a normal user login, register the
current-user task with `./scripts/install-orcha-startup.ps1`. It runs a scoped
supervisor that checks the named worker and API every 15 seconds and recovers
missing Orcha services. Add `-IncludePhonePilot` when the owner also wants
the Vite cockpit and temporary Cloudflare Quick Tunnel to recover after logon;
that wrapper delegates to the same ownership-checked pilot launcher. API
recovery uses `/health/ready` and may restart only
the API process whose PID file and command line both prove ownership by this
repository; an unknown process occupying the port is never terminated. Worker
failure defers API recovery until the execution boundary is available. The
scheduled task can restart the supervisor itself up to three times if its
process fails. This is not a service account or cloud supervisor: the user
must log in, the PC must remain powered on, and the private environment file
stays local.

The built cockpit uses the API's server-side `POST /api/chat` boundary. In
development, the Vite chat middleware remains in front so its local smart
router and model-catalog behavior are preserved. A hosted deployment must put
authentication, per-user quotas, abuse controls, and an origin allowlist in
front of the chat route before exposing it beyond a private pilot.

For the temporary Cloudflare share, Vite may enforce the optional
`ORCHA_TUNNEL_TOKEN` bootstrap cookie across `/v1` and `/api/*`. This protects
the accidental public Quick Tunnel from casual callers while preserving the
same-origin browser contract, but it is deliberately not presented as hosted
authentication or a replacement for the production control-plane boundary.

## Hosted pilot

For the hardened single-tenant/container pilot, layer the opt-in hosted
profile over the base file as documented in `infra/HOSTED_DEPLOYMENT.md`. It
adds the static cockpit on host loopback `127.0.0.1:3000`, proxies the browser
API/chat contract to the API over the private Compose network, requires the
worker auth token in both services, and keeps the worker unpublished. A
Cloudflare connector or authenticated reverse proxy should target the cockpit
port, not the worker.

Run a control-plane API, Postgres, Redis/NATS-compatible event transport, object storage, and one isolated VM per active company. Provision VMs from a pinned image with non-root agent users, resource quotas, egress policy, and encrypted volumes.

The present `CloudSandboxManager` is the handoff boundary: a hosted worker only
needs to expose the same authenticated private `/health` and `/execute`
contract. Before exposing it beyond a private network, add workload identity,
mutual authentication, egress allowlists, quotas, encrypted object storage,
and managed Postgres/queue replacements for local SQLite and polling.

Set one high-entropy `ORCHA_WORKER_AUTH_TOKEN` in the API and worker secret
stores to make `/execute` reject callers that are not the control plane. The
token is optional only for the single-machine local compose convenience setup;
it must be set for any shared network deployment. Set
`ORCHA_REQUIRE_WORKER_AUTH=true` for that deployment. In required mode, a
worker with missing secret injection fails closed with `503` on `/execute`
instead of silently accepting unauthenticated execution; `/health` remains a
minimal liveness probe for container supervision.

The compose pilot maps that same environment variable into both API and worker
containers. The API preserves an explicit remote-worker `offline` health
response, so a draining or unavailable cloud worker cannot be presented as
merely starting to the control plane. In required-auth mode, the cloud
sandbox health check also fails closed before probing the worker when the API
does not have a token; this prevents a deployment with broken secret
injection from ever advertising `/health/ready`.

## Production sequence

1. Build and sign the VM image.
2. Apply database migrations and seed policy defaults.
3. Deploy API and workers with health checks.
4. Provision a canary company VM.
5. Run smoke task: create file, test, emit artifact, stop process.
6. Verify event ordering, audit records, cost metering, and kill switch.
7. Gradually enable external adapters behind feature flags.

## SLO targets for V1

- Control-plane API availability: 99.5%.
- Event-to-Live-HQ projection latency: p95 under 2 seconds.
- Task state durability: no silent loss; at-least-once delivery with idempotent handlers.
- Recovery: detect worker heartbeat loss within 60 seconds.
