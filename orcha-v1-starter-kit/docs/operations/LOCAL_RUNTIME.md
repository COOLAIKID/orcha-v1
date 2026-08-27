# Local Workspace runtime

This is the first real Orcha execution loop. The consumer UI calls the API; the API uses the provider-neutral `SandboxManager`; only `LocalWslSandboxManager` knows that the active provider is a localhost worker inside WSL.

## Start

1. Download an official Ubuntu 24.04 WSL image.
2. Run `./scripts/setup-orcha-worker.ps1 -ImagePath <ubuntu-image>` once.
3. Copy `orcha.local.env.example` to the private ignored `orcha.local.env`, configure an approved provider there if desired.
4. Run `./scripts/start-orcha-local.ps1`. It starts the dedicated worker, waits for `127.0.0.1:8765`, then starts the API on `127.0.0.1:8080`.
5. Run `cd ui; npm run dev`, then type `/workspace-check` in a signed-in company chat.

For a temporary phone preview, keep the Vite server running and run
`./scripts/start-orcha-tunnel.ps1`. It creates and verifies a Cloudflare Quick
Tunnel against the Vite port (`5175` by default), preserving the `/v1` and
`/api` proxies while keeping ports `8080` and `8765` private. The printed URL
is temporary. By default this is an unauthenticated private pilot; for a
friends-only share, set `ORCHA_TUNNEL_TOKEN` in the Vite process before
starting it, then visit `/__orcha_access?token=<value>` once. The gate stores
only a same-origin, HttpOnly, 24-hour cookie and protects `/v1` plus `/api/*`.
It is a shared-token convenience, not multi-user auth, quotas, or production
security. Stop the tunnel with `./scripts/stop-orcha-tunnel.ps1` when finished.
This is a sharing aid, not a hosted always-on runtime.

The repeatable pilot shortcut is `./scripts/start-orcha-pilot.ps1`. It starts
the worker/API, starts Vite on 5175 when absent, reuses healthy processes, and
then invokes the same tunnel verification. It refuses to kill an unknown
process occupying a required port. Pass `-NoTunnel` for local-only use. Stop
the scoped tunnel with `./scripts/stop-orcha-tunnel.ps1` and the local runtime
with `./scripts/stop-orcha-local.ps1`. If Node.js is installed outside
`PATH`, pass `-NpmPath <path-to-npm.cmd>`.

The API startup wrapper temporarily loads values from the private
`orcha.local.env` file only to inherit them into the child API process, then
restores the caller's process environment in both success and failure paths.
The worker/local wrappers apply the same cleanup guarantee to their temporary
Windows `PATH` isolation. This prevents a failed launch from leaving provider
credentials or a blank PATH in the interactive PowerShell session.

The tunnel state records the managed process start time (with a narrow
backwards-compatible read of older state written at verification time). The
stop script refuses to terminate a same-PID process if Windows has recycled
that PID for another process. Runtime event streams send an explicit 1.5-second
`EventSource` reconnect hint and disable intermediary buffering so a phone can
catch up after a brief tunnel or network interruption.

The browser subscription closes a failed `EventSource` and reopens it from
the latest received sequence, with bounded backoff up to 15 seconds. This
avoids replaying the full event history when a phone changes networks.

Runtime API requests from the browser use a shared 12-second timeout as well;
company creation, task controls, event polling, and diagnostics therefore
return a truthful retryable error when a phone has lost the tunnel instead of
leaving the composer or control sheet pending indefinitely. The explicit
health readiness loop retains its shorter per-probe bound.

For separate control, `start-orcha-worker.ps1` and `start-orcha-api.ps1` remain
available. `stop-orcha-local.ps1` stops both processes and the dedicated WSL
distro. The one-command wrapper is a local continuity aid: the API scheduler
can keep an always-on company moving while this PC and the API host stay up.
Run `./scripts/install-orcha-startup.ps1` if the owner wants the scoped
supervisor to start at the current Windows user's logon. It checks the named
API readiness and dedicated WSL worker every 15 seconds and invokes the
existing start script only when that Orcha service is unavailable. If API
readiness fails while the process is present, it may restart only a process
verified from this repository's PID file and command line; it will not terminate an
unknown process occupying the API port. `-Uninstall` removes only that named
task. Use `./scripts/watch-orcha-local.ps1 -Once` for a single safe
health-and-repair pass. This does not create a cloud VM, run before login, or
make work continue after the machine is powered off.

For a phone pilot that should also recover its Vite cockpit and temporary
Cloudflare URL after login, install the same named task with
`./scripts/install-orcha-startup.ps1 -IncludePhonePilot`. That mode retries the
existing `start-orcha-pilot.ps1` launcher, which keeps API and worker ports
private and recycles only a tunnel process whose managed executable and start
time still match. A tunnel URL may change after a restart because Quick Tunnel
URLs are temporary; read `var/tunnel/orcha-tunnel.json` or the launcher output.
It remains PC continuity, not hosted 24/7 service.

The worker binds only to `127.0.0.1:8765`, runs as `orcha`, disables Windows-drive automounting and Windows PATH interop, and confines each company to `/home/orcha/workspaces/<company-id>/`. `LocalWslSandboxManager` is the only layer that knows how to bridge Windows-to-WSL requests; mutating requests call the worker over that distro's own loopback interface, which avoids depending on Windows localhost-forwarding settings. On Windows, the read-only health probe may use `curl.exe` against the local forwarder for a fast readiness check, then falls back to the distro bridge in a background refresh. A cached `ready` result is rechecked through the cheap loopback probe before it is returned, so a worker that disappears is exposed as `starting` while the bounded bridge decides `ready` or `offline`. While that refresh is in flight, `/v1/runtime/health` truthfully returns `starting`; the cached state is never presented as ready once it is stale. `ORCHA_WORKER_HEALTH_TTL_SECONDS` controls the status cache (30 seconds by default, chosen to avoid re-entering `starting` during a measured cold WSL refresh). A workspace check waits up to `ORCHA_RUNTIME_HEALTH_WAIT_SECONDS` (25 seconds by default) for the real ready/offline result before writing and reports a timeout as offline rather than claiming success. Duplicate checks while one is in flight reuse the existing task instead of creating a second writer. The background health bridge is bounded separately so an unavailable worker cannot hold a status request forever. The stop script records `sandbox.stopped`, ends tracked children, then terminates only the dedicated distro. A workspace check serializes its final completion with owner cancellation, so a write that returns after Stop All can leave a real file event but cannot commit a late `task.completed`.

On Windows hosts without a localhost forwarder, the first failed fast probe
is remembered. After the WSL bridge confirms the worker is ready, that result
remains visible as `ready` until the normal TTL expires while the next bridge
refresh is bounded; a real bridge failure still transitions to `offline`.
This prevents a healthy worker from appearing permanently `starting` without
weakening the fail-closed behavior of mutating calls.

For the optional worker control-plane token, set the same
`ORCHA_WORKER_AUTH_TOKEN` on the API host and worker service. The local manager
forwards it as `X-Orcha-Worker-Token` both for direct clients and through the
Windows-to-WSL bridge. It is never included in a command result, event, or
browser response. Local loopback confinement remains required even when a
token is enabled. On Windows, the bridge passes the token through a dedicated
child environment and uses a minimal system-only `PATH`; it does not put the
secret in visible `wsl.exe` arguments or import the host's agent/tool paths.
Request bodies are sent to the short-lived WSL Python bridge over stdin rather
than as command-line arguments. Workspace contents therefore stay out of
process listings and are not constrained by the Windows command-line size
limit. For a shared/container deployment, also set
`ORCHA_REQUIRE_WORKER_AUTH=true`; the worker then fails closed with `503` if
secret injection is missing. Leave that switch false only for the
single-machine local convenience setup.

## Protocol and events

`GET /health` reports worker readiness. `POST /execute` accepts typed `mkdir`, `write_file`, `read_file`, `list_files`, restricted `run`, read-only `git_status`/`git_diff`, private `preview_start`/`preview_stop`, `browser_snapshot`, `stop_all`, and internal-only `destroy_workspace` actions. Paths are relative only and validated after resolution. Repeating a `write_file` with identical existing content is a no-op and emits no second file event; existing files over the 1 MB write bound are rejected. The allowed command catalog is intentionally tiny for this milestone; no shell or arbitrary executable is exposed.

The API records verified `sandbox.connected`, `task.started`, `tool.started`, `file.created`/`file.changed`, `command.started`, `command.completed`, `task.completed`, `task.failed`, `task.cancelled`, `recovery.started`, `recovery.completed`, `escalation.created`, and `sandbox.stopped` events. Agent Grid consumes those events through its existing adapter. Demo activity remains synthetic and explicitly labeled Demo.

`POST /v1/companies/{id}/runtime/workspace-check` is retry-safe for the
phone/tunnel path. The service reuses an in-flight check in the current API
process and rehydrates one durable, still-queued check after an API restart,
so a transient retry cannot create parallel writers. A runtime task that had
already entered `running` is cancelled during restart because its exact worker
continuation point is unknown; the owner can start a fresh check explicitly.

## File tiers

Generated worker artifacts are retained in the company workspace as
`company_vault` metadata and can be classified as `shareable` for a future
authenticated export flow. `local_only` is a device-side metadata record
only: the API rejects raw contents, does not call the worker, and does not give
VM agents a read path. A client-side document bridge and explicit
authenticated classification change are required before any local-only bytes
can leave the device. This milestone intentionally does not implement that
bridge.

## Feedback

`POST /api/feedback` writes sanitized records to `var/feedback/feedback.jsonl` by default. Diagnostics are opt-in and limited to version, platform, route without query data, timestamp, and sanitized client errors; raw credentials, environment assignments, URLs, and common filesystem paths are redacted before persistence. GitHub delivery is intentionally not configured; a future sink can implement the same `FeedbackSink` contract.

## Persistent runtime

Companies, runs, agents, safe handoff messages, artifacts, planned tasks, task status, and the append-only event feed now live
in SQLite (`ORCHA_DATABASE_URL`, default `sqlite:///var/orcha.db`). Restarting
the API no longer loses the company record or evidence cursor. The background
dispatcher resumes interrupted specialist `running` tasks as `queued` on
startup, reconciles their Agent rows to `waiting`, and emits a concise recovery
event before dispatch resumes. It also closes a run whose terminal task set
was saved before a shutdown but whose final run event was not, so an always-on
company cannot start a duplicate cycle from a stale `running` run. Runtime control-plane jobs still cancel
fail-closed because they have no safe continuation point. If a process stops
after the run row but before any task rows are committed, that run is marked
failed with a concise recovery summary and an always-on company receives a
bounded next-cycle schedule instead of remaining silently idle. The dispatcher
works continuously while the API process is running. Its executor also treats
the small process-shutdown race as a clean exit, so an API stop does not leave
an uncaught scheduler submission traceback. A company started from
chat (`POST /runs`) is always-on for this PC: after a slice completes, Orcha
schedules the next improvement from the same goal plus company memory. Agent
Grid and the orchestrator keep receiving live events until Stop All. This is
not a cloud VM. On Windows the API asks the PC to stay awake while that
company is running. A paused company is not
dispatched; blocked tasks can be requeued through
`POST /v1/companies/{id}/runtime/resume` after its configuration is fixed.
For always-on companies, a specialist blocked only because no server-side
provider was configured is requeued automatically when a provider becomes
available again; this path resets that task's bounded attempt window and does
not auto-resume policy, capability, or owner-stop blocks.
The run boundary is retry-safe for mobile and temporary-tunnel clients: a
repeated request for the same active company goal reuses the existing run and
does not create duplicate specialist work; a different goal receives `409`
until the current run is stopped.

`GET /health` is the cheap API process-liveness probe. `GET /health/ready` is
the deployment readiness probe and returns `503` while either the workspace
provider or persistent scheduler is not ready; it intentionally does not
require a model provider. `GET /v1/runtime/health` reports the worker and the
control-plane separately.
The `scheduler` projection is `ready` only while the dispatcher thread is
alive, and includes bounded active-task/company counts plus the last loop
timestamp. If a transient store or row error reaches the dispatcher loop, it
records only the exception class in `lastError` and keeps retrying on a bounded
tick. Calling `start()` after an unexpected thread exit recreates the loop;
the public health response never treats a ready worker as proof that the
scheduler is running.

The `/workspace-check` is stored as a `runtime` task rather than an agent task.
If the API is interrupted while that check is running, startup cancels the
orphaned control-plane operation and emits a recovery-safe cancellation event;
it never hands the check to a specialist or claims that the write completed.
The owner can retry `/workspace-check` explicitly.

The planner uses a configured model to produce a validated JSON plan. The
validator also requires unique task keys and an acyclic dependency graph so
one malformed response cannot strand an always-on run forever. If the planner
is unconfigured or returns an invalid plan, Orcha uses a visibly recorded local
fallback, never a claimed model plan. For a normal static build that fallback
is Product → Design → Engineering → QA. Each specialist gets only the company
objective, task instruction, dependency handoffs, acceptance criteria, and
role-scoped capabilities. A successful task writes a bounded Markdown work
note under `artifacts/` in the company workspace and records artifacts,
messages, and evidence events. The chat subscribes to the durable SSE cursor and shows concise phase lines
(Planning → Researching / Designing / Building / Testing) plus a quiet iframe
to `GET /v1/companies/{id}/preview/index.html` when Engineering writes
`app/index.html`. Agent Grid maps the same real events and never mixes them
with Demo activity. Demo autoplay pauses as soon as a company run starts.

The consumer `/workspace-check` command follows the same runtime health state:
it polls a real `starting` response until the worker is ready or the bounded
wait expires, then starts the check. A cold WSL boot therefore does not look
like an immediate offline failure, and the client still never turns a timeout
into synthetic success.

Engineering has one additional, deliberately narrow V1 capability:
`workspace.write_file` (and `workspace.mkdir` when parent directories are
needed). The only successful engineering completion is a JSON build manifest
with `summary` and `files`, including `app/index.html`. Markdown-only output
is a failed, retryable task — it does not complete with an empty `app/`.
Orcha writes at most eight source files under `app/` only. Paths cannot escape
the company workspace; only HTML/CSS/JS/TS/JSON/Markdown/text files are
accepted, and size limits apply to each file and the full manifest. Company
agents use a hard `max_tokens` cap of 4096. The worker never executes that
generated code. Preview serving uses the API preview route, not a claimed
generated video or remote host.

On a consumer-chat refresh, the UI rehydrates the selected live company from
the durable dashboard and complete event cursor before reopening its SSE
stream. This restores the verified Agent Grid/work-log projection, resumes
from the last sequence instead of replaying a second live stream, and keeps
stopped or completed non-always-on runs from appearing active. If the API or
worker cannot be reached, the saved chat remains visible with an honest
reconnection message; it does not turn the run into Demo success.

QA has `workspace.read_file`, file listing, read-only Git inspection, and the
private preview/snapshot capability—not arbitrary execution authority. When
`app/index.html` exists, it lists and reads the saved source, rejects a remote
script source, starts a localhost-only preview, and captures desktop (1440px)
and mobile (375px) browser evidence with Playwright. Overflow is the snapshot
`overflow` flag when present, otherwise `width > viewport + 8`. A missing
Playwright install or Chromium binary, non-loading preview, or horizontal
mobile overflow is a real QA failure, which requests one bounded Engineering
revision and QA recheck. The clean worker setup installs Playwright and
Chromium; an existing worker upgraded from an earlier release must install
those worker-local dependencies before browser QA can succeed. If Engineering
did not create a static app, QA records `verification.skipped` instead of
claiming a software check happened.

Tasks form a durable evidence chain: dependencies make unrelated tasks eligible
to run in parallel, while a QA task waits for its implementation dependency.
The scheduler atomically claims queued specialist tasks with a short durable
lease before dispatch. Restart recovery clears that lease when it requeues the
task, and terminal/retry cleanup clears it again, so a second scheduler cannot
silently claim the same queued task.
Generated artifacts carry a content hash. If a provider retry reaches the same
task/path with identical content after a prior write committed, the runner
reattaches the existing artifact instead of mutating the workspace or emitting
another file-change event; a different retry output can still repair the file.
Each completed role saves a bounded company-memory handoff and routes a copy to
each directly dependent specialist's deterministic internal inbox. Every hired
specialist also exposes a stable address-like label such as
`inbox-a1b2@inbox.orcha.local`; this is an internal identifier only, not an
SMTP account or external-send capability. A queued specialist can therefore
receive evidence before its Agent row exists; the message is still treated as
untrusted evidence, never as tool instructions.
Tasks with no dependent specialist retain an orchestrator broadcast. The
scheduler enforces `ORCHA_MAX_AGENT_RUNS_PER_DAY` and a per-company estimated-cost reserve
before it makes a model request; usage is recorded as `cost.recorded` without
provider credentials. Chat `/stop` and Agent Grid **Stop All** both call
`POST /runtime/stop`, which changes company state first, cancels queued work,
cancels only that company's in-flight provider `generate()` scope, tells the
worker to terminate tracked child processes, and prevents a late model result
from being committed as a success. Operator `/diagnostics` is available only when
`ORCHA_INTERNAL_DIAGNOSTICS=true`; it reports Ready/Unconfigured/Failed
providers and worker health, never secrets.

During API shutdown, the runtime also makes a best-effort global worker stop so
tracked previews and tool children do not outlive the control plane. The worker
uses the reserved `runtime` command company id for this global stop; normal
generated company ids remain scoped to their own workspace.

## Server-side model provider configuration

Set the following **only in the API host environment**—the private
`orcha.local.env` file is the local helper path—then restart the API:

For an interactive setup that keeps the key out of PowerShell history and
never prints it, run this from the starter-kit root:

```powershell
.\scripts\configure-orcha-provider.ps1
```

The helper prompts for a provider, model id, and optional additional temporary
keys using hidden input. It writes only `orcha.local.env`, attempts to remove
inherited Windows ACLs from that file, and makes no upstream request. It does
not touch `ui/.env`; a browser/Vite key is not a valid API-host configuration.
After restarting the API, use `GET /v1/runtime/health` to see whether a server
configuration is present. `configured` is only configuration evidence; the
first real request can still be rejected or rate-limited by the provider.

The API also loads this optional file when launched directly with
`PYTHONPATH=src uvicorn orcha.api.app:app --port 8080`; explicit process or
container environment variables always take precedence. Set
`ORCHA_DISABLE_LOCAL_ENV=true` for a hosted/container launch that should use
only its runtime secret environment.

```text
ORCHA_AGENT_PROVIDER=openrouter  # or gemini / groq / openai
ORCHA_AGENT_MODEL=provider/model-id
OPENROUTER_API_KEY=...
```

For a mixed provider chain, use a model identifier per provider instead of
reusing one shared value:

```text
ORCHA_AGENT_PROVIDER=openrouter
ORCHA_AGENT_FALLBACK_PROVIDERS=gemini,groq
ORCHA_AGENT_OPENROUTER_MODEL=provider/free-router-model
ORCHA_AGENT_GEMINI_MODEL=provider-gemini-model
ORCHA_AGENT_GROQ_MODEL=provider-groq-model
OPENROUTER_API_KEY=...
GEMINI_API_KEY=...
GROQ_API_KEY=...
```

The gateway tries the preferred provider first, then configured fallbacks and
any remaining configured providers. A provider-specific model is selected for
each attempt; malformed upstream responses and ordinary provider failures are
recorded as that provider failing so the next safe fallback can answer. A stop
signal remains terminal and is never retried as a successful result.
Stop All invalidates the in-flight request generation as well, so an interrupted
provider request cannot fall through to another configured key or provider after
cancellation. Each company-scoped request uses a tracked short-lived HTTP
client, so stopping company A does not close company B's provider request.
The gateway still exposes a no-argument global cancellation path for process
shutdown and legacy replacement adapters; injected gateways that predate the
scope option continue to receive that compatible call.

On API shutdown, the production gateway now closes its shared and any active
scoped HTTP clients directly instead of using the reusable cancellation path
that allocates a replacement shared client. Legacy injected gateways keep the
no-argument cancellation fallback.
The replaceable `CloudSandboxManager` follows the same lifecycle contract and
keeps a bounded persistent worker connection pool for the API process, closing
it when the runtime shuts down. An injected client remains supported for
hosted transports and tests. The API lifecycle also closes the app-level
sandbox boundary when a custom runtime does not own that provider, so a
long-lived worker connection cannot leak across a control-plane restart.
When `ORCHA_REQUIRE_WORKER_AUTH=true`, it reports the cloud provider as
`offline` before probing if the API token is absent, matching the worker's
fail-closed execution behavior instead of advertising a false ready state.
The local WSL manager also closes an injected client and rejects new requests
after shutdown; the default Windows bridge remains short-lived and does not
retain a network client between calls.

Gemini, Groq, and OpenAI use the corresponding `GEMINI_API_KEY`,
`GROQ_API_KEY`, or `OPENAI_API_KEY`. Temporary-key pools are also supported
with ordered comma-separated `GEMINI_API_KEYS`, `GROQ_API_KEYS`,
`OPENROUTER_API_KEYS`, or `OPENAI_API_KEYS` variables. The singular variable
remains compatible and is tried after any plural pool. When an upstream key
fails, the gateway tries the next key for that provider before moving to the
next provider; it does not persist or expose key material, and it does not
claim that a key is valid merely because it is configured.
After a provider-local failure, that key is skipped for the in-memory
`ORCHA_AGENT_KEY_COOLDOWN_SECONDS` window (60 seconds by default), so an
always-on company does not hammer an expired temporary key on every task. If
all keys are cooling down, the gateway makes one ordered recovery pass rather
than requiring an API restart. Cooldown state is discarded when the API stops
and never appears in health, events, prompts, SQLite, or feedback.
The gateway is OpenAI-compatible and is replaceable. Keys are not accepted by
the browser, included in task prompts, recorded in events, written to SQLite,
or made available to the WSL worker. Without a configured provider, work is
recorded as **blocked** with an honest recovery message; Orcha does not claim
an agent ran. A bounded retry or QA revision is recorded with
`recovery.started`, and only a successful recovered task emits
`recovery.completed`. Once the retry budget is exhausted, `escalation.created`
marks the run as needing owner attention without contacting an external system.

Temporary friend-provided keys are therefore not a multi-user key vault yet.
They must be configured by the API operator, may be revoked at the provider at
any time, and affect every local company served by that process. Per-person,
encrypted, scoped credential storage needs authentication, envelope encryption,
rate limits, and deletion/revocation flows before it can safely ship.

## Current boundary

The local worker is temporary. `SandboxManager` is the stable boundary for a
future `CloudSandboxManager`. SQLite makes the runtime durable on this machine,
but it is not a hosted multi-user control plane yet. The scheduler stays alive
only while the API host itself stays alive. Always-on chat companies continue
to the next slice on this PC; they do not survive turning the computer off.
A production cloud deployment still needs a managed process supervisor, hosted
database, durable queue, and credential vault.

For a restartable Docker pilot, use `infra/docker-compose.yml`. It starts the
API and a private worker with separate durable volumes; see
`docs/operations/DEPLOYMENT_PLAN.md`.

## Agent retention and permanent local deletion

Raw model reasoning, provider request bodies, and full tool traces are never
persisted. Only safe summaries, role/task metadata, artifacts, and domain
events are durable. The first runtime retains those safe records while a
company exists so the owner can inspect evidence in Agent Grid. Automatic
rolling erasure of safe historic Agent records once a replacement specialist
is hired is not implemented yet; only the explicit company destruction path
performs a full local record/workspace deletion.

Normal completed tasks intentionally retain their evidence, generated files,
and company memory so later roles can review and build on it. They are logical
agent jobs, not separately provisioned virtual machines.

To end a company completely, call `POST /v1/companies/{id}/destroy` with the
exact company id in `confirm_company_id`. The API pauses the company, cancels
queued work, refuses while an agent is still executing, asks the worker to stop
only processes owned by that company, removes only
`/home/orcha/workspaces/{id}`, and then atomically removes local SQLite task,
event, memory, usage, and company records. A worker outage leaves the local
records intact. There is no automatic per-task wipe: that would destroy the
evidence and shared workspace required by the later review steps.

## Worker source synchronization

The setup and restart wrappers copy only `src/orcha` into the dedicated distro
through `\\wsl$\\orcha-worker`, then restart its systemd service. They do not
mount a Windows drive into the worker. A direct filesystem copy is intentional:
a PowerShell native-command tar pipeline can reinterpret binary archive output
and leave the service with truncated Python source. The wrappers invoke an
absolute `wsl.exe` path with an empty host `PATH`, so customized agent/tool
executables are not translated into WSL during startup.

`start-orcha-worker.ps1` is idempotent for an already-ready worker, which is
important because the continuity supervisor may retry after a false-negative
probe. It reuses that service without bouncing active work. Pass
`-ForceRestart` when a source refresh or service-environment change must be
applied immediately; the normal pilot and supervisor paths omit that switch.
