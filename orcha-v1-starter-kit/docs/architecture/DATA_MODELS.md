# Data Models

## Company

`id, owner_id, name, goal, status, objective_id, runtime_id, dna_version, budget, created_at, updated_at`.

## Objective

`id, company_id, statement, success_metrics[], current_value, target_value, status, horizon`.

## Agent

`id, company_id, role, identity, status, model_policy, capabilities[], memory_namespace, inbox_id, workspace_scope, version, performance`.

## Task

`id, company_id, objective_id, parent_id, role, title, instruction, status, priority, dependencies[], capabilities[], retry_policy, lease, artifact_ids[], outcome, failure`.

## Artifact

`id, company_id, kind, path, tier, version, content_hash, created_by, provenance, preview_url`.

## Experiment

`id, company_id, target_type, baseline_version, candidate_versions[], primary_metric, guardrails[], observations[], decision, rollback_target`.

## MemoryEntry

`id, company_id, namespace, type, content, source_event_ids[], confidence, created_at, expires_at`.

## AuditRecord

`id, company_id, actor, capability, action, resource, decision, reason, trace_id, created_at`.
