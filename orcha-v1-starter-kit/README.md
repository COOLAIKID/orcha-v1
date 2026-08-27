# Orcha V1 Starter Kit

Orcha is a consumer-facing autonomous AI company builder. A person states an outcome; Orcha creates a persistent company runtime, assigns work to specialized agents, builds software in an isolated cloud workspace, and reports tangible progress through a consumer control room.

This kit is an implementation brief and starter scaffold for an AI coding agent. It is intentionally opinionated about V1: autonomous software-building workflows first; real-world money movement, unrestricted account control, and unsupervised self-modification later.

## Start here

1. Read `docs/product/V1_SCOPE.md`.
2. Read `docs/architecture/REFERENCE_ARCHITECTURE.md`.
3. Read `docs/api/API_CONTRACTS.md` and `docs/api/EVENT_SCHEMAS.md`.
4. Read `docs/agents/AGENT_PROMPTS.md`.
5. For the container pilot, create a private `.env` from `.env.example`, fill
   the API-host provider values, then run
   `docker compose --env-file .env -f infra/docker-compose.yml up --build`.
6. For the real local Workspace milestone, read `docs/operations/LOCAL_RUNTIME.md`.
7. For the hardened hosted/container pilot, read `infra/HOSTED_DEPLOYMENT.md`
   and layer `infra/docker-compose.hosted.yml` over the base Compose file; it
   serves the production cockpit on host loopback port 3000. The scoped
   `scripts/start-orcha-hosted.ps1` and `scripts/stop-orcha-hosted.ps1` wrappers
   validate Docker and readiness without printing or deleting secrets/volumes.

## Product sentence

> Orcha is a company you start with one instruction, watch operate in real time, and see continuously improve itself.

## V1 success condition

A user can say “Build and launch a simple SaaS for students,” review the generated plan, start the company, watch real task events in Live HQ, inspect files and decisions, recover from a failed build, and see a measured experiment promoted or rolled back.

## Repository map

- `docs/` — product, architecture, UX, API, operations, security, evaluation, and agent instructions.
- `src/` — FastAPI runtime with durable local SQLite companies/tasks/events, a
  bounded persistent scheduler, provider-neutral specialist agents, gated
  Evolution records, and the isolated Local Workspace boundary.
- `tests/` — contract-oriented starter tests.
- `infra/` — local container setup, the hardened hosted Compose overlay, and VM
  deployment notes.
- `.env.example` — safe configuration inventory; no secrets.
- `RELEASE-MANIFEST.md` — what the portable sanitized ZIP contains and omits.
- `scripts/package-orcha-release.ps1` — reproducibly creates and validates the
  sanitized release archive.

## Local always-on development runtime

Start the WSL worker and API together with
`./scripts/start-orcha-local.ps1`, as described in
`docs/operations/LOCAL_RUNTIME.md`. For a server-only provider configuration,
copy `orcha.local.env.example` to the private, ignored `orcha.local.env` first.
The paired stop command is `./scripts/stop-orcha-local.ps1`; the individual
worker/API start and stop scripts remain available for troubleshooting. The
API persists to `var/orcha.db` by default and its dispatcher keeps eligible
tasks moving while that process is alive and this PC remains available.

For real specialist model work, configure exactly one provider on the API host:
`ORCHA_AGENT_PROVIDER`, `ORCHA_AGENT_MODEL`, and the matching provider key (or
an ordered comma-separated `*_API_KEYS` pool for temporary keys).
Those credentials must never be placed in the browser or in a user-provided
chat message. Without them, Orcha records a truthful blocked state rather than
simulating an agent result.

The safest interactive setup is:

```powershell
.\scripts\configure-orcha-provider.ps1
```

It asks for the provider, model id, and one or more temporary keys without
accepting a key in the command line or printing it. It only writes the private
API-host file `orcha.local.env`, tightens that file's Windows ACL when possible,
and does not make a provider request. Restart the API afterward, then check
`http://127.0.0.1:8080/v1/runtime/health`; `agentProviderConfigured: true` means
Orcha can attempt a request, not that the upstream key has already been
verified. A provider rejection remains an honest blocked/failed run.

The API also loads the optional `orcha.local.env` file when launched directly
with `PYTHONPATH=src uvicorn orcha.api.app:app --port 8080`. Existing process or
container environment variables always win. Set `ORCHA_DISABLE_LOCAL_ENV=true`
for a hosted/container launch that should read secrets only from its runtime
environment.

To share the feature-complete local cockpit from a phone, run the Vite server
on port `5175`, then `./scripts/start-orcha-tunnel.ps1`. The wrapper verifies
the local origin and temporary Cloudflare URL, and only exposes the Vite
surface; the API and worker ports remain private. Stop it with
`./scripts/stop-orcha-tunnel.ps1` when the sharing window ends.

For a repeatable pilot startup, use `./scripts/start-orcha-pilot.ps1`. It
reuses only a runtime that passes `/health/ready`; if port 8080 is occupied but
not ready, it invokes the scoped supervisor, which can recover only a verified
Orcha API process and the named worker. Unknown processes are never
terminated. The launcher starts missing local services and then the same
verified Quick Tunnel. Use `-NoTunnel` for a local-only run. The separate stop
scripts remain the intentionally scoped shutdown commands. If Node.js is
installed outside `PATH`, pass `-NpmPath <path-to-npm.cmd>`.

For a friends-only pilot, set a high-entropy `ORCHA_TUNNEL_TOKEN` in the Vite
process before starting the UI (the variable belongs in the private, ignored
`ui/.env`, never in client code). Open the tunnel at
`/__orcha_access?token=<value>` once; it redirects to `/` and stores only a
same-origin, HttpOnly, 24-hour cookie. `/v1` and `/api/*` then require that
cookie. This is a temporary shared-token gate, not accounts, multi-user
authorization, quotas, or production security.

To resume and supervise the local runtime after a normal Windows login,
optionally register the current-user startup task with
`./scripts/install-orcha-startup.ps1`. By default it watches the named API and
dedicated worker and invokes the existing start scripts if either later
disappears; it is safe to run again. To keep the phone pilot available after
login as well, use
`./scripts/install-orcha-startup.ps1 -IncludePhonePilot`; that mode also
retries the scoped Vite and temporary Cloudflare Quick Tunnel launcher. Remove
the task with `./scripts/install-orcha-startup.ps1 -Uninstall`. This is PC
continuity only: the task does not run before login and cannot keep a company
or tunnel alive while the PC is powered off.

## Non-goals for V1

- Autonomous financial transactions or money movement.
- Sending messages or publishing externally without an explicit capability grant.
- Arbitrary access to a user's local filesystem.
- Self-changing production orchestrator code without review, evaluation, and rollback.
- Pretending that simulated activity is real activity.

## License

Choose a license before publishing. This starter kit contains no third-party production dependencies beyond what is listed in `pyproject.toml`.
