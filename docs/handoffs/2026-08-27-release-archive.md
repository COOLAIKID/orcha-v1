# Handoff — Sanitized release archive

Changed: Added `orcha-v1-starter-kit/RELEASE-MANIFEST.md`, indexed it in the
starter-kit README and contents index, made the existing Feedback action
discoverable on desktop while preserving its compact mobile control, and
made runtime company controls resilient to stale device mappings, made legacy
runtime errors in local chat history actionable, hardened launcher environment
cleanup, corrected Python/cache exclusion validation, hardened worker-token
propagation through the local WSL lifecycle, and added a fail-closed required
auth mode for shared/container workers, aligned both environment inventories,
and enabled the bounded Business specialist role, corrected department
status so proposed specialists do not appear hired before they are actually
active, added stable address-like identities and a directory for internal
specialist inboxes without enabling external delivery, added a deployment
readiness probe that requires the workspace
provider and scheduler, hardened the Windows continuity supervisor to
recover only a verified Orcha API process, and aligned the one-command pilot
launcher with that recovery path. Generated
the refreshed portable archive at
`outputs/orcha-v1-starter-kit-2026-08-27.zip`.
Added a durable blocked-reason code and automatic provider-reconnect recovery
for always-on specialist work; policy and capability blocks remain manual.
Made the hosted worker transport use an explicitly bounded persistent pool and
made API shutdown close the app-level sandbox even when a replaceable runtime
does not own it.
Added a phone-pilot continuity supervisor that can restore Vite and the
temporary Cloudflare tunnel after logon, while delegating all ownership checks
to the existing scoped launcher. Made the worker launcher idempotent so a
healthy worker is reused during supervisor retries, with an explicit
`-ForceRestart` escape hatch for deliberate source or service-environment
refreshes.
Passed `ORCHA_REQUIRE_WORKER_AUTH` into both Compose containers so the API
enforces the same fail-closed auth boundary as the worker.
Added the opt-in hosted Compose overlay and deployment guide, with required
worker authentication, private worker networking, loopback-only API ingress,
non-root container hardening, and a static cockpit container with same-origin
Nginx API/chat proxying.
Added readiness retries and three-pass liveness hysteresis to the Windows
continuity supervisor so transient WSL refreshes do not restart a healthy API.
Added a root `.dockerignore` and hosted contract coverage so container builds
do not send local secrets, machine state, dependencies, or non-runtime source
to the Docker daemon.
Moved the hosted cockpit to an unprivileged Nginx listener and verified the
real API, worker, and cockpit images with a disposable three-container smoke
test; all health probes and the static cockpit returned successfully.
Added a Linux systemd boot unit that validates the private Compose profile and
restores it after Docker starts, closing the host-reboot continuity gap.

Discovered: No prior ZIP artifact existed. The source tree contains ignored
local state and dependencies that must not travel with a release.

Validated: The UI has a visible desktop Feedback label and keeps
`scrollWidth === clientWidth` at 375px. The latest validation passes all 52 UI
 checks, TypeScript, the production Vite build, and 118 backend tests (one
existing Starlette deprecation warning). The refreshed archive contains 184
entries and all required implementation, documentation, test, UI,
infrastructure, and script paths. The durable Agent/inbox contract now also
includes deterministic `.local` address-like identities and an internal-only
mailbox directory. Provider reconnect recovery and the fail-closed hosted
worker auth boundary are covered by the backend suite. The phone-pilot
supervisor passed a real `-Once` reuse check against the current API, Vite, and
 managed tunnel. The archive is 533,811 bytes
with SHA-256
 `10AD40E18942256A2AD26D2993B3363C0B713B8B2CC739CB77D489AAD40DBA39`. The
exclusion scan found no private `.env`, database, log, PID,
virtual-environment, dependency, bytecode, cache, or source-control entries; safe
`.env.example` files are intentionally retained. The live local API reaches
`ready` with its scheduler alive; the current preview is responsive with no
horizontal overflow; and the managed temporary tunnel remains available at
`https://representatives-battle-listprice-minute.trycloudflare.com`. The
updated pilot launcher was also exercised in `-NoTunnel` mode and recovered
the occupied local runtime without touching the existing Vite process. The
worker launcher reuse path was exercised against the live WSL service; its
systemd `ActiveEnterTimestamp` stayed unchanged, confirming no restart of an
already-ready worker. A live temporary company also wrote a physical
`/home/orcha/workspaces/{company-id}/test.txt` containing exactly
`hello from orcha`, emitted the verified event sequence, and was then destroyed.

Open: After extraction, the recipient must install dependencies and configure
server-side provider credentials independently. The archive does not include
the live Cloudflare tunnel or local runtime state. External email delivery is
still intentionally unconfigured; inbox addresses are internal `.local`
identifiers only. Docker Compose configuration and the hosted image build were
validated, and the disposable container smoke test passed. A real cloud
deployment still requires an external host, credentials, and production
ingress/authentication.
