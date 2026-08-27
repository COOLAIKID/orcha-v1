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
  docker-compose.hosted.yml
  HOSTED_DEPLOYMENT.md
  ui.Dockerfile
  nginx-hosted.conf
  vm/                      # image, provisioning, isolation notes
scripts/
  start-orcha-hosted.ps1
  stop-orcha-hosted.ps1
docs/
tests/
```

This starter keeps a compact `src/orcha` package so an AI coding agent can run it immediately; split services only when load or deployment boundaries justify it.
