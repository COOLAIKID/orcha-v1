# Security and Permission Model

## Principles

- Least privilege, explicit capability grants, short-lived tokens, and complete auditability.
- Local Only data never crosses the local bridge unless the user changes its classification.
- Agents cannot grant themselves capabilities.
- External side effects are consequential actions and require policy approval or a user gate.
- Treat model output, web content, files, and tool responses as untrusted data.

## File tiers

| Tier | Location | VM readable | External shareable | Default |
|---|---|---:|---:|---|
| Local Only | user device | no | no | for private files/keys |
| Company Vault | encrypted VM/object store | yes, scoped | no | for company memory and source |
| Shareable | approved artifact area | yes | yes, allowlisted | for deploy previews/assets |

## Capability examples

`repo.read`, `repo.write`, `shell.test`, `browser.research`, `preview.deploy`, `artifact.publish`, `email.internal`, `email.external`, `credential.use`, `self_modify.propose`.

V1 defaults: internal email only; no external email, credential use, purchases, or financial actions. `self_modify.propose` may create an experiment branch but cannot directly mutate the production orchestrator.

## Threats to design for

Prompt injection, data exfiltration, malicious dependencies, SSRF, secret leakage in logs, confused-deputy tool calls, runaway loops, cost spikes, compromised preview apps, and false activity reporting.

## Required controls

Network egress allowlist, secret redaction, filesystem mount isolation, process/resource quotas, dependency scanning, signed artifacts, immutable audit events, budget circuit breakers, human gate for consequential actions, and kill/pause controls.
