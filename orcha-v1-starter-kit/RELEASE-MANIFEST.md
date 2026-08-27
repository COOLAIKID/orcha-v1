# Orcha V1 Starter Kit — Release Manifest

This package is the current implementation-ready Orcha V1 handoff for an AI
coding agent. It contains the consumer chat surface, local runtime, isolated
worker boundary, durable events, feedback path, deployment scaffolding,
security contracts, tests, and collaboration documentation.

## Included

- `ui/` — React + Vite consumer cockpit and Agent Grid adapter.
- `src/` — FastAPI API, SQLite persistence, scheduler, model gateway, worker,
  sandbox providers, feedback, policy, and runtime services.
- `tests/` — backend, worker, API, security, persistence, and deployment
  contract tests.
- `docs/` — product, UX, API, events, agent prompts, security, operations,
  deployment, evaluation, and handoff documentation.
- `scripts/` — WSL worker setup, local API/runtime startup, hosted Compose
  lifecycle, provider setup, startup supervision, and temporary Cloudflare
  tunnel helpers.
- `scripts/package-orcha-release.ps1` — reproducibly stages the kit and fails
  if excluded secrets or machine-state paths enter the archive.
- `infra/` — Dockerfile, private worker/API Compose pilot, and an opt-in
  hardened hosted profile that requires worker authentication.
- `infra/orcha-hosted.service` — a Linux boot unit for restoring the hosted
  Compose stack after Docker starts.
- `.dockerignore` — keeps secrets, local state, dependencies, and non-runtime
  source out of the Docker build context.
- `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `DEV-MODE.md`, and change logs —
  collaboration and product truth.

## Deliberately excluded

Secrets and machine state are not part of the release: `.env`, `ui/.env`,
`orcha.local.env`, databases, logs, tunnel metadata, virtual environments,
`node_modules`, Python bytecode, build caches, `.git`, and test caches are
excluded. Use
`.env.example` and `orcha.local.env.example` as safe configuration inventories.

## Current truth

The local worker and `/workspace-check` loop are real and verified. Provider
credentials are API-host-only and must be configured after extraction. The
local always-on scheduler runs while its host remains available; true hosted
multi-tenant cloud persistence, authentication, credential vaulting, and
external money movement are not included in V1.

## First steps after extraction

1. Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, and `README.md`.
2. Install the UI and Python dependencies in fresh local environments.
3. Run the backend and frontend test/build commands in the README.
4. Configure a private server-side provider only when real specialist work is
   intended.
5. Start the local pilot and verify `/v1/runtime/health` before sharing it.
