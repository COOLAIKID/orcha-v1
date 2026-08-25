# Orchestrator Cycle

```text
load objective + latest events + memory
identify the highest-value unblocked milestone
check budget, capabilities, file tiers, and concurrency
choose existing agent or create minimal role
create task with acceptance criteria and retry policy
lease task to runner
observe checkpoint/artifact/result
verify against acceptance criteria
record success or recovery state
update objective progress and next decision
```

The cycle should be resumable. A process restart must not duplicate a side effect because task leases and idempotency keys are persisted.
