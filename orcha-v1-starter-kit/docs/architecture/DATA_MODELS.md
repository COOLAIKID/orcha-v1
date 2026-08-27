# Data Models

## Company

`id, owner_id, name, goal, status, objective_id, runtime_id, dna_version, budget, created_at, updated_at`.

## Objective

`id, company_id, statement, success_metrics[], current_value, target_value, status, horizon`.

## Team

The runtime recognizes seven consumer-facing departments: `product`,
`engineering`, `quality`, `design`, `growth`, `data`, and `business`. A Team is
a safe department descriptor; the durable membership lives on each Agent so a
dashboard can reconstruct which specialists were actually hired for a run.
Team status is derived from member state (`empty`, `waiting`, `working`, or
`attention`) and is never an independent claim of work.
Proposed or available catalog members do not make a department active; the
status remains `empty` until at least one specialist is hired for that company.

## Agent

`id, company_id, role, team, hired, identity, status, model_policy, capabilities[], memory_namespace, inbox_id, inbox_address, workspace_scope, version, performance`.

`team` is derived from the planner role for older records when omitted. `hired`
is a bounded state (`hired`, `proposed`, or `available`); runtime-created
specialists are `hired`, while the absence of an Agent row still means a role
has not been activated for that company slice.

`inbox_id` identifies the agent's internal durable handoff stream.
`inbox_address` is a deterministic `.local` address-like label for that stream;
it has `internal_only` delivery semantics and must never be treated as public
email capability.

## Task

`id, company_id, objective_id, parent_id, role, title, instruction, status, priority, dependencies[], capabilities[], retry_policy, lease, artifact_ids[], outcome, failure, blocked_reason_code`.

The local task `lease_id` and `leased_at` are set by an atomic queued-task
claim and cleared after terminal or retry-queued state. They are control-plane
coordination metadata, not provider credentials or user-visible instructions.
`blocked_reason_code` is a bounded internal discriminator, such as
`provider_unavailable`, `policy`, or `capability_denied`; it lets the scheduler
recover only safe infrastructure blocks without matching on user-facing prose.

## Artifact

`id, company_id, kind, path, tier, version, content_hash, created_by, provenance, preview_url`.

The local runtime records `content_hash` for generated artifacts when it is
known. On a safe retry, an identical task/path/hash is reused without a second
workspace mutation; a changed hash remains eligible for a repair write. Older
records may have no hash and therefore do not participate in this optimization.

## LocalOnlyFile

`id, company_id, name, size_bytes, media_type?, content_hash?, tier=local_only, registered_at`.

This record is intentionally metadata-only. It has no content field and is
never passed to a worker agent.

## Experiment

`id, company_id, target_type, baseline_version, candidate_versions[], primary_metric, guardrails[], observations[], decision, rollback_target`.

The local implementation persists one baseline/candidate pair per record. An
observation stores the measured primary value, named guardrail values, cost,
and a concise evidence reference. A decision is append-only in the record and
also represented by a sequenced domain event. `promoted_version` is only the
accepted version label; it is not an implicit deployment instruction.

## MemoryEntry

`id, company_id, namespace, type, content, source_event_ids[], confidence, created_at, expires_at`.

## AuditRecord

`id, company_id, actor, capability, action, resource, decision, reason, trace_id, created_at`.
