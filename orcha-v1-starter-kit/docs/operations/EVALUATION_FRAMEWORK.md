# Evaluation Framework

## Evaluation object

An evaluation has a target (agent, workflow, prompt, UI, code), baseline version, candidate versions, task set, metrics, guardrails, sample window, and promotion policy.

## Metrics

Use outcome metrics plus guardrails: task completion, correctness, user-rated usefulness, preview health, latency, cost, regression rate, security violations, and recovery success.

## Promotion rule

Promote only when the candidate improves the primary metric by the configured threshold, does not violate guardrails, and has enough observations. If uncertain, keep the baseline. Store a rollback pointer and immutable decision record.

## V1 evolution boundary

Agents may propose prompt/workflow/tool/code changes in isolated branches. The evaluator may recommend promotion. Production changes require a policy gate and deploy transaction with rollback.
