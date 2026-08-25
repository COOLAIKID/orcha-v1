# Contents Index

## Product

- `docs/product/PRODUCT_VISION.md` — positioning, pillars, consumer promise.
- `docs/product/V1_SCOPE.md` — realistic V1 loop, boundaries, acceptance criteria.
- `docs/product/ROADMAP.md` — V1 through later gated capabilities.

## Architecture and contracts

- `docs/architecture/REFERENCE_ARCHITECTURE.md` — control plane, execution plane, VM, event flow.
- `docs/architecture/DATA_MODELS.md` — core entities and fields.
- `docs/architecture/REPO_STRUCTURE.md` — recommended production decomposition.
- `docs/api/API_CONTRACTS.md` — HTTP/WebSocket contracts and error/idempotency rules.
- `docs/api/EVENT_SCHEMAS.md` — durable event envelope and event types.

## UX and agent behavior

- `docs/ux/UX_FLOWS.md` — onboarding, dashboard, Live HQ, Evolution, Studio.
- `docs/ux/DESIGN_SYSTEM.md` — visual language and motion truthfulness.
- `docs/agents/AGENT_PROMPTS.md` — shared contract plus role prompts.
- `docs/agents/SAMPLE_TASKS.md` — starter tasks for software-building workflows.
- `docs/agents/ORCHESTRATOR_CYCLE.md` — resumable orchestration loop.

## Operations and safety

- `docs/security/SECURITY_BOUNDARIES.md` — file tiers, capabilities, threats, controls.
- `docs/operations/DEPLOYMENT_PLAN.md` — local, pilot, and production deployment.
- `docs/operations/OBSERVABILITY.md` — metrics, logs, traces, event correlation.
- `docs/operations/TESTING_STRATEGY.md` — unit through adversarial testing.
- `docs/operations/EVALUATION_FRAMEWORK.md` — measured evolution and rollback.

## Starter implementation

- `src/orcha/api/app.py` — minimal FastAPI lifecycle endpoints.
- `src/orcha/domain/models.py` — Pydantic domain contracts.
- `src/orcha/events/bus.py` — in-memory durable-shaped event bus.
- `src/orcha/runtime/orchestrator.py` — minimal plan/start loop.
- `tests/test_orcha_contracts.py` — lifecycle and 404 contract tests.
- `infra/` — Docker setup and VM image notes.
- `docs/IMPLEMENTATION_BRIEF.md` — instructions for the next AI coding agent.
