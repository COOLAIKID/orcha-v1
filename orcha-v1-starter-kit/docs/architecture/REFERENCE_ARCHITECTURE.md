# Reference Architecture

```text
Consumer Web/Desktop Cockpit
        |
API + Auth + Company Service
        |
Orchestrator / Policy Engine ---- Event Bus ---- Activity Projection
        |                                  \---- Live HQ / Evolution WebSocket
        |
Task Queue -> Agent Runner -> Tool Gateway -> Isolated Company VM
        |                         |             |
Memory / Artifacts / Eval Store  |        Workspace + Preview Deploy
        |                         |
Audit Log + Cost Meter       Capability Broker
```

## Runtime boundaries

- **Cockpit:** presentation only; never holds long-lived agent credentials.
- **Control plane:** companies, plans, tasks, policies, events, budgets, and projections.
- **Execution plane:** isolated VM per company or trust domain. Agents run here.
- **Tool gateway:** allowlisted tools with typed inputs, output filtering, rate limits, and audit records.
- **Artifact store:** versioned files, build outputs, screenshots, reports, and logs.
- **Evaluation store:** immutable experiment definitions, measurements, decisions, and rollbacks.

## Persistence model

Use Postgres in production, SQLite for local development. Use object storage for artifacts and a queue/event stream for execution. The scaffold uses in-memory repositories so the domain contracts are easy to replace.

## Always-on VM

The VM is the company's office: persistent disk, browser sandbox, code tools, scheduled worker, and preview server. The desktop app is a cockpit and optional local file bridge. A company may continue working while the user's computer is closed.

## Control loop

`observe -> interpret -> plan -> authorize -> execute -> verify -> record -> reprioritize`.

No UI animation should be emitted directly by a client-side timer. UI projections consume recorded domain events.
