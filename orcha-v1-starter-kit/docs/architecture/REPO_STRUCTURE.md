# Suggested Repository Structure

```text
apps/
  cockpit/                 # consumer web/desktop UI
  studio/                  # advanced developer UI
services/
  api/                     # HTTP and WebSocket API
  orchestrator/            # planning, dispatch, recovery
  agent-runner/            # sandboxed execution workers
  evaluator/               # experiment scoring and promotion
packages/
  contracts/               # shared schemas and generated clients
  policy/                  # capabilities, file tiers, approvals
infra/
  docker-compose.yml
  vm/                      # image, provisioning, isolation notes
docs/
tests/
```

This starter keeps a compact `src/orcha` package so an AI coding agent can run it immediately; split services only when load or deployment boundaries justify it.
