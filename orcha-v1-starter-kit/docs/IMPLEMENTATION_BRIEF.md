# Implementation Brief for an AI Coding Agent

You are extending Orcha V1 from this repository. Preserve the product abstraction and boundaries in the docs. Implement vertical slices in this order:

1. Company creation and plan preview.
2. Durable repositories and event outbox.
3. Orchestrator task graph and idempotent worker loop.
4. VM adapter with a fake local implementation for tests.
5. Artifact and file-tier service.
6. Activity projection and Live HQ stream.
7. Recovery state machine.
8. Evaluation and experiment promotion/rollback.
9. Consumer cockpit; then Studio.

For every slice, add contracts, tests, observability, and a failure path. Keep provider integrations behind ports/interfaces. Never hard-code a model vendor into the domain. Never claim a result without evidence. When a requirement is ambiguous, choose the smallest reversible implementation and document the assumption.

## Definition of done

The feature works through an API or UI path, persists state, emits domain events, has a visible consumer projection, respects policy, survives retry/duplicate delivery, and has a test for its primary failure mode.
