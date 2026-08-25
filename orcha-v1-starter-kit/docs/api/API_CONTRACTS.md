# API Contracts

Base path: `/v1`. JSON over HTTPS. WebSocket endpoint: `/v1/companies/{company_id}/stream`.

## Create company

`POST /companies`

```json
{"name":"StudyFlow","goal":"Build and launch a study-material summarizer for university students","constraints":{"deadline":"30d","budget_usd":25}}
```

Returns `201` with `company`, `objective`, `plan_preview`, and `required_capabilities`.

## Start company

`POST /companies/{id}/start` — creates the first orchestration run. Idempotency key required.

## Read dashboard

`GET /companies/{id}/dashboard?since=cursor` — objective, milestone progress, agents, active tasks, results, cost, and activity summary.

## Tasks

- `GET /companies/{id}/tasks`
- `POST /companies/{id}/tasks/{task_id}/pause`
- `POST /companies/{id}/tasks/{task_id}/retry`

## Artifacts and files

- `GET /companies/{id}/artifacts`
- `POST /companies/{id}/files/classify` with `{file_id, tier}`

## Experiments

- `POST /companies/{id}/experiments`
- `GET /companies/{id}/experiments/{experiment_id}`
- `POST /companies/{id}/experiments/{experiment_id}/promote`
- `POST /companies/{id}/experiments/{experiment_id}/rollback`

Promotion is rejected unless evaluation and policy gates pass.

## Error envelope

```json
{"error":{"code":"CAPABILITY_REQUIRED","message":"External publishing is not enabled","retryable":false,"request_id":"..."}}
```

## Idempotency and ordering

Mutating requests accept `Idempotency-Key`. Events are ordered per aggregate and include sequence numbers. Consumers must tolerate duplicates.
