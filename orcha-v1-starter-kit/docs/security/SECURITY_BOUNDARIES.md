# Security and Permission Model

## Principles

- Least privilege, explicit capability grants, short-lived tokens, and complete auditability.
- Local Only data never crosses the local bridge unless the user changes its classification.
- Agents cannot grant themselves capabilities.
- External side effects are consequential actions and require policy approval or a user gate.
- Treat model output, web content, files, and tool responses as untrusted data.

## File tiers

| Tier | Location | VM readable | External shareable | Default |
|---|---|---:|---:|---|
| Local Only | user device | no | no | for private files/keys |
| Company Vault | encrypted VM/object store | yes, scoped | no | for company memory and source |
| Shareable | approved artifact area | yes | yes, allowlisted | for deploy previews/assets |

The Local Only API is metadata-only in this milestone. It rejects a `content`
field, stores only bounded name/size/type/hash metadata, and emits a safe
classification event without calling the worker. Worker artifacts cannot be
reclassified as Local Only. A future authenticated client bridge must be
designed before local bytes can be shared.

## Capability examples

`repo.read`, `repo.write`, `shell.test`, `browser.research`, `preview.deploy`, `artifact.publish`, `email.internal`, `email.external`, `credential.use`, `self_modify.propose`.

V1 defaults: internal handoffs use deterministic `.local` address-like labels
only; there is no SMTP or external email delivery, credential use, purchases,
or financial actions. `self_modify.propose` may create an experiment branch but
cannot directly mutate the production orchestrator.

## Threats to design for

Prompt injection, data exfiltration, malicious dependencies, SSRF, secret leakage in logs, confused-deputy tool calls, runaway loops, cost spikes, compromised preview apps, and false activity reporting.

## Required controls

Network egress allowlist, secret redaction, filesystem mount isolation, process/resource quotas, dependency scanning, signed artifacts, immutable audit events, budget circuit breakers, human gate for consequential actions, and kill/pause controls.

## Current local provider boundary

The first specialized-agent gateway reads provider credentials from the API
process environment only. The browser, localStorage, DomainEvent records,
SQLite task records, agent prompts, WSL worker, and feedback records never
receive or persist a raw key. The gateway supports one operator-configured
provider order (OpenRouter, Gemini, Groq, or OpenAI) and exposes configuration
state, never key material, through the internal runtime diagnostic.

This is intentionally **not** a bring-your-own-key feature for friends. A
multi-user credential system must use authenticated ownership, envelope
encryption backed by a managed key service, scoped provider keys, quotas, audit
records, explicit deletion, and provider-side revocation. Until those controls
exist, do not add an API endpoint or UI input that submits API keys.

For a portable private worker, `ORCHA_WORKER_AUTH_TOKEN` is an API/worker
service secret, not a user credential. When configured on both ends, the
control plane sends it only in the `X-Orcha-Worker-Token` request header. The
same header is forwarded by the WSL bridge; it is not logged in domain events,
feedback, SQLite records, task prompts, or browser traffic. It complements—
and does not replace—the worker's loopback-only bind and per-company workspace
containment. On Windows, the bridge passes it through the child environment
instead of the visible `wsl.exe` command line. For shared/container workers,
set `ORCHA_REQUIRE_WORKER_AUTH=true`; the worker then returns a bounded `503`
when secret injection is absent rather than downgrading to open execution.

The temporary Vite/Cloudflare sharing path can opt into a single shared
`ORCHA_TUNNEL_TOKEN`. The Vite process never bundles it into the client. A
successful `/__orcha_access?token=...` bootstrap sets a same-origin,
HttpOnly, 24-hour cookie whose value is a SHA-256 digest of the token; the
token is removed from the URL by the redirect. `/v1` and `/api/*` reject
requests without that cookie. This is only a narrow private-pilot boundary:
it is not per-user identity, revocation, quota enforcement, CSRF protection,
or a substitute for hosted authentication and abuse controls. Leave the
variable unset for ordinary local development.

The bridge also launches with only the Windows system path and its dedicated
token variable, so arbitrary host agent/tool paths are not imported into WSL
startup.

Bridge request bodies travel over stdin rather than the visible `wsl.exe`
argument list. Workspace contents therefore do not become command-line data,
and bounded file writes are not truncated by Windows argument limits.

`LocalWslSandboxManager` rejects any worker URL other than the exact
`http://127.0.0.1:8765` endpoint. Remote/container workers belong behind the
separate `CloudSandboxManager` replacement boundary; an environment variable
cannot silently turn the local provider into an SSRF-capable client.

## Generated source boundary

Engineering may turn a model response into a small static source manifest only
when the task has the explicit `workspace.write_file` capability. The validator accepts
at most eight files under `app/`, rejects absolute/traversal paths and duplicate
names, permits only a small source-extension allowlist, and applies both
per-file and total-size limits. Model output is written as data; it is never
executed, deployed, installed, or granted network access by this capability.
Running tests, installing dependencies, and publishing a preview remain gated
capabilities for later milestones.

QA can list workspace files, inspect `app/index.html`, start a private
localhost-only static preview, and capture a Playwright desktop/mobile snapshot.
It rejects an empty entry file, a remote script source, preview load failure,
or mobile overflow. It cannot install generated dependencies, follow external
links, execute arbitrary shell code, or publish the preview.

Command and diff output is treated as untrusted evidence too. The agent runner
keeps bounded stdout/stderr for useful inspection, but redacts obvious provider
keys, bearer tokens, JWTs, and labeled environment assignments before the data
is written into tool events or included in a follow-up model context. This is
defense in depth, not a replacement for keeping secrets out of workspaces.

## Company destruction boundary

Destruction is deliberately a company-level, explicit action rather than an
automatic end-of-task behavior. The API requires an exact company-id
confirmation and refuses to erase a company with an in-flight model task.
Before deletion, it pauses the company and cancels only queued/blocked work.
The worker validates that its deletion target is exactly one direct child of
the configured workspace root, stops only that company's tracked child
processes, and removes that directory. SQLite records are deleted only after
the worker confirms the scoped workspace operation. This still is not a
cryptographic disk-wipe guarantee: secure media sanitization belongs to the
future managed-cloud storage layer.
