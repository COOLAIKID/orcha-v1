# Orcha V1 Starter Kit

Orcha is a consumer-facing autonomous AI company builder. A person states an outcome; Orcha creates a persistent company runtime, assigns work to specialized agents, builds software in an isolated cloud workspace, and reports tangible progress through a consumer control room.

This kit is an implementation brief and starter scaffold for an AI coding agent. It is intentionally opinionated about V1: autonomous software-building workflows first; real-world money movement, unrestricted account control, and unsupervised self-modification later.

## Start here

1. Read `docs/product/V1_SCOPE.md`.
2. Read `docs/architecture/REFERENCE_ARCHITECTURE.md`.
3. Read `docs/api/API_CONTRACTS.md` and `docs/api/EVENT_SCHEMAS.md`.
4. Read `docs/agents/AGENT_PROMPTS.md`.
5. Run the local API scaffold with `docker compose up --build`.

## Product sentence

> Orcha is a company you start with one instruction, watch operate in real time, and see continuously improve itself.

## V1 success condition

A user can say “Build and launch a simple SaaS for students,” review the generated plan, start the company, watch real task events in Live HQ, inspect files and decisions, recover from a failed build, and see a measured experiment promoted or rolled back.

## Repository map

- `docs/` — product, architecture, UX, API, operations, security, evaluation, and agent instructions.
- `src/` — small Python/FastAPI-shaped domain scaffold with an in-memory event bus.
- `tests/` — contract-oriented starter tests.
- `infra/` — local container setup and VM deployment notes.
- `.env.example` — safe configuration inventory; no secrets.

## Non-goals for V1

- Autonomous financial transactions or money movement.
- Sending messages or publishing externally without an explicit capability grant.
- Arbitrary access to a user's local filesystem.
- Self-changing production orchestrator code without review, evaluation, and rollback.
- Pretending that simulated activity is real activity.

## License

Choose a license before publishing. This starter kit contains no third-party production dependencies beyond what is listed in `pyproject.toml`.
