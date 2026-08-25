# Contributing to Orcha V1

## Working agreements

- Preserve the user-facing abstraction: Company, Objective, Team, Work, Experiments, Results.
- Every visible activity item must be backed by a durable event or artifact.
- Every autonomous action must have a capability, scope, actor, and audit record.
- Prefer reversible changes, staged rollouts, and explicit rollback points.
- Keep consumer UI simple; put technical detail in Orcha Studio.

## Change checklist

- What user outcome does this improve?
- What is the failure mode and recovery path?
- What data leaves the VM or crosses a file tier boundary?
- What event(s) make the change observable?
- What evaluation proves it works?
- Is the change covered by a contract or integration test?

## Pull requests

Include a short outcome statement, screenshots or event traces for UI/runtime changes, test evidence, security impact, and rollback notes.
