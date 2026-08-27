# Evaluation Framework

## Evaluation object

An evaluation has a target (agent, workflow, prompt, UI, code), baseline version, candidate versions, task set, metrics, guardrails, sample window, and promotion policy.

## Metrics

Use outcome metrics plus guardrails: task completion, correctness, user-rated usefulness, preview health, latency, cost, regression rate, security violations, and recovery success.

## Promotion rule

Promote only when the candidate improves the primary metric by the configured threshold, does not violate guardrails, and has enough observations. If uncertain, keep the baseline. Store a rollback pointer and immutable decision record.

## Implemented local evaluation

The local API stores one baseline/candidate pair with a minimum observation
count for each. It evaluates the average primary metric and requires either a
relative improvement over a positive baseline or an absolute improvement from
zero. Every candidate observation must include and meet each configured
minimum guardrail. A rejected promotion preserves the `evaluating` record;
rollback is available only after promotion and returns the record to the
retained baseline. These controls decide a version label only—they never
auto-apply code, prompts, or workflows.

## V1 evolution boundary

Agents may propose prompt/workflow/tool/code changes in isolated branches. The evaluator may recommend promotion. Production changes require a policy gate and deploy transaction with rollback.
