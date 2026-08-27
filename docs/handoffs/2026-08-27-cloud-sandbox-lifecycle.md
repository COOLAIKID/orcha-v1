# Handoff — Cloud sandbox client lifecycle

Changed: `CloudSandboxManager` now exposes idempotent `close()` cleanup for an
injected persistent `httpx.Client`, rejects requests after close, and releases
the client through the existing `LocalRuntimeService.close()` lifecycle.
Added regression coverage and updated local runtime documentation.

Discovered: The future cloud boundary implemented the worker contract but did
not close an injected long-lived client on API shutdown; ephemeral clients were
already context-managed per request.

Validated: Focused cloud-sandbox tests pass (4); the full backend suite passes
(95 tests, one existing Starlette/httpx deprecation warning). A live temporary
company completed `/workspace-check` with the event sequence
`company.created → task.created → sandbox.connected → task.started →
tool.started → file.created → task.completed`, then was destroyed by exact
company ID. The active API/UI/tunnel topology is unchanged.

Open: Hosted deployments still need authenticated worker identity, managed
service supervision, and multi-tenant state.
