# Testing Strategy

## Layers

- Unit: domain state transitions, policy decisions, metric calculations.
- Contract: API and event schemas, idempotency, version compatibility.
- Integration: queue, storage, VM adapter, artifact lifecycle.
- Scenario: goal to plan to build to preview to experiment to promotion/rollback.
- Adversarial: prompt injection, secret exfiltration, path traversal, runaway loops, budget exhaustion.
- UX truthfulness: every Live HQ card and edge is generated from a fixture event or live event.

## Golden scenarios

1. “Build a study summarizer” creates a minimal five-role plan.
2. Engineering test fails, repair succeeds, and activity feed explains both.
3. Local Only file access is denied and logged.
4. Variant beats baseline on conversion but fails reliability gate; baseline remains promoted.
5. Worker heartbeat disappears; task is recovered or escalated with no false completion.
