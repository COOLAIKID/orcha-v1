# V1 Scope

## The V1 loop

1. User chooses a starting intent and writes an outcome.
2. Planner turns the outcome into a measurable objective, milestones, risks, and a minimal team.
3. User reviews a plain-language plan and starts the company.
4. Orchestrator creates bounded tasks for Product, Research, Engineering, Design, and QA as needed.
5. Agents work in an isolated VM workspace with durable artifacts and memory.
6. Events stream to the consumer dashboard and Live HQ.
7. Builds run tests and produce deployment previews.
8. The company can run safe experiments on prompts, workflows, UI variants, and code in preview environments.
9. Evaluations compare variants; a winner can be promoted, otherwise the baseline remains.
10. Failures trigger diagnosis, repair, retry, alternative strategy, or a user request for missing authority.

## In scope

- Software product planning, repository creation, coding, testing, preview deployment.
- Research using explicitly enabled web or document tools.
- Persistent company memory, task history, artifacts, and decisions.
- Per-agent internal inboxes; email identity as a future adapter with no external send by default.
- Live HQ, activity feed, “While you were away,” and Evolution views.
- Local Only, Company Vault, and Shareable file tiers.
- Orcha Studio inspection and bounded configuration.
- Usage/cost estimates, budgets, audit logs, and capability approvals.

## Out of scope

- Autonomous purchases, financial transfers, regulated decisions, or legal commitments.
- Unbounded browsing, credential harvesting, or arbitrary local file access.
- Production self-editing without test/evaluation/approval gates.
- Claiming growth, revenue, or user results without instrumented evidence.
- Full multi-tenant billing, marketplace, and mobile apps.

## V1 acceptance criteria

- A new company can be created from one natural-language goal in under two minutes.
- Every visible Live HQ connection maps to an actual task, message, artifact, or state transition.
- A failed task is represented with cause, recovery attempt, and final status.
- A file marked Local Only cannot be read by VM agents.
- A promoted experiment includes baseline, variant, metric, sample window, decision, and rollback target.
- A reviewer can reconstruct who did what, with which capability, and which files changed.
