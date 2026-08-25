# Deployment Plan

## Local

`docker compose up --build` starts the API scaffold. Use SQLite and an in-memory bus. This mode is for contract development and UI wiring.

## Hosted pilot

Run a control-plane API, Postgres, Redis/NATS-compatible event transport, object storage, and one isolated VM per active company. Provision VMs from a pinned image with non-root agent users, resource quotas, egress policy, and encrypted volumes.

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
