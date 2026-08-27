# Dev mode — the original Orcha

> **What this is:** the specification for the operator product — the cloud company runtime, the
> control-room surfaces, the capability model, and the actions an operator can take.
>
> **This is a reference, not a work order.** It documents what dev mode *is*, including parts
> never built. For the order things should be built in, see
> [ORCHA-FIELD-STUDY.md](ORCHA-FIELD-STUDY.md) — which is itself on hold pending @bents.

Dev mode is not a debug panel. It is the product Orcha was first designed as: an executive
control room for an always-on company running on a cloud VM.

Consumer mode is a **lower altitude over the same data** — not a different system, not a
different database, not a summary generated separately. The same events, unsummarised.

## Current runtime delta — 25 Aug 2026

The historical snapshot below describes the original operator prototype and
its unrouted views. It is no longer accurate about the local runtime. Current
implementation truth is `docs/operations/LOCAL_RUNTIME.md`:

- Companies, tasks, agents, artifacts, safe handoffs, runs, usage, events, and
  evidence-only experiments are durable in local SQLite.
- A persistent scheduler executes role-scoped specialist work when the API has
  a private provider configured; without one it records a truthful blocked
  state rather than pretending work happened.
- The dedicated `orcha-worker` WSL environment confines company workspaces,
  static previews, process cancellation, and desktop/mobile browser QA.
- Pause, resume, stop, explicit company deletion, cost/run limits, local
  experiment promotion gates, and rollback records have API contracts.

This does **not** make the dormant Live HQ, Evolution, Studio, Timeline,
Recovery, or Assets UI routes reachable. The current consumer chat and Agent
Grid remain the active surface. Hosted multi-tenant execution and real cloud
VMs remain unbuilt.

**The contract between the two modes:**

> Consumer mode answers **what happened**. Dev mode answers **how, why, and on whose authority**.
> Neither invents. Every fact in either mode traces to a recorded event.

---

## At a glance

*Snapshot taken 22 Aug 2026, 21:50. Line counts drift — trust the files, not this table.*

| Surface | File | State | Answers |
|---|---|---|---|
| Live HQ | `views/LiveHQ.tsx` | written · unrouted | Who is working, on what, connected how |
| Evolution | `views/Evolution.tsx` | written · unrouted | Which variant is winning, and what it costs |
| Company Home | `views/CompanyHome.tsx` | written · unrouted | Objective, progress, team, spend |
| Timeline | `views/Timeline.tsx` | written · unrouted | What changed since I last looked |
| Recovery | `views/Recovery.tsx` | written · unrouted | How a failure was diagnosed and repaired |
| Assets | `views/Assets.tsx` | written · unrouted | What exists, and who may read it |
| Studio | `views/Studio.tsx` | written · unrouted | Prompts, tools, workflows, permissions, logs, VM |
| Agent drawer | `components/Overlays.tsx` | written · **never mounted** | Why this agent did that |
| Promote modal | `components/Overlays.tsx` | written · **never mounted** | Should this variant ship |
| Onboarding | `views/Onboarding.tsx` **and** `views/CompanyOnboard.tsx` | **two implementations**, both unrouted | How a company gets created |

Nothing in this table is reachable in the running app. `main.tsx` routes `/`, `/teams` and
`/create` only.

---

## What dev mode *does*

The panes above are how an operator **sees**. These are how an operator **acts** — and this is
the part that distinguishes dev mode from a read-only dashboard.

| Action | Where | Gate | Built? |
|---|---|---|---|
| Inspect an agent's evidence | Agent drawer | none — reading is free | written, unmounted |
| Read the raw event stream | Studio · Logs | none | placeholder |
| Promote a variant | Evolution → Promote modal | policy check | written, unmounted |
| Roll back to baseline | Evolution | always available, never gated | written, unmounted |
| Grant or revoke a capability | Studio · Permissions | inspect-first; propose, don't apply | table only, no action |
| Change prompts, tools, workflows | Studio | gated behind evaluation + policy | placeholder |
| Set the spend ceiling | `ORCHA_MAX_COMPANY_BUDGET_USD` | — | locally enforced before a model request |
| Set approval posture | `ORCHA_APPROVAL_MODE` | — | declared; consequential external actions remain unavailable |
| Pause or stop the company | local runtime API | — | `pause`, `resume`, and `stop` implemented |
| Kill switch | local runtime stop | — | stops company-scoped tracked worker children; no cloud VM yet |

Two principles govern every row:

**Inspect-first.** Reading costs nothing and is never gated. Changing is proposed, not applied —
`Studio.tsx` ships a deliberately disabled *"Propose change"* button with the note *"gated until
evaluation and policy pass."* That disabled button is the correct design, not an unfinished one.

**Rollback is never gated.** Promotion requires a policy check; reverting never does. An operator
must always be able to undo faster than the company can act.

---

## One event, two altitudes

The toggle is not a different screen — it is the same record shown at different resolution:

| Recorded event | Consumer mode shows | Dev mode shows |
|---|---|---|
| `task.completed` (Engineering, upload flow) | "Building the upload flow" → done | task id, role, capabilities used, files touched, evidence, duration |
| Experiment decided | "Testing a clearer first screen" | variant tree, metric, confidence window, cost/100 sessions, reliability, decision |
| Build failed then repaired | "Fixed a problem with the build" | failure event id, diagnosis, repair attempt, retry, rollback target |
| Capability requested | "Orcha wants to search the web to check competitors" | `external.send` grant request, requesting agent, scope, policy result |
| Spend | "$2.18 of $25 today" | per-run costs, per-tool costs, retries billed |

If a fact cannot be shown in both, it does not belong in either. That rule is what stops consumer
mode from becoming marketing copy and dev mode from becoming a log dump.

---

## The surfaces in detail

### Live HQ — the orchestration map
The orchestrator at the centre, specialists around it, edges labelled `dispatch`, `message`,
`artifact`, `dependency`. Selecting an agent opens the evidence drawer. Beside it sits "While you
were away", scoped to events since the last-seen cursor.

Its own note states the contract: *every visible connection maps to a recorded task, message,
artifact, or state transition.* No decorative edges.

**Blocker for N agents:** `types.ts` types `position` as `'eng' | 'research' | 'design' | 'qa'`,
and `styles.css` places nodes by class name with four static edges. A computed layout is required
before the map can show more than four.

### Evolution — measured variants
An experiment tree where each variant carries metric, confidence window, cost per 100 sessions,
reliability and a decision. Promotion requires a policy check; the baseline is retained as the
rollback target.

This is what makes "the company improves itself" legible rather than mystical. Consumer mode
should surface one line of it and keep the tree here.

### Company Home — the operator dashboard
Objective, milestone progress, active team, Live HQ entry, experiments, results, assets, cost
against budget, timeline.

**Caveat:** nine regions is an operator dashboard, and `DESIGN.md` says *avoid nested card grids*.
Correct for dev mode, wrong for the consumer home.

### Timeline — while you were away
Summarises only events since the last-seen cursor — shipped previews, completed tasks, failures
repaired, experiments decided, new questions, next actions — then the raw list with event ids.

The most consumer-legible idea in the codebase. Dev mode keeps the ids; consumer mode keeps the
sentences.

### Recovery — how a failure was repaired
Failure recorded → diagnosis → repair attempt → retry succeeded, with the rollback target named
throughout. Worth protecting: most agent products hide failures, and showing the repair is what
makes autonomy credible.

### Assets — the file tier boundary
| Tier | Meaning | VM readable |
|---|---|---|
| **Local Only** | Never leaves the owner's machine | No |
| **Company Vault** | Internal to the company | Yes |
| **Shareable** | May leave the company | Yes |

`VM_IMAGE_NOTES.md` reinforces it: *mount Company Vault and Shareable storage separately; keep
Local Only outside the VM entirely.* This is a security boundary, not a UI category.

### Orcha Studio — the internals
Ten tabs, typed as `StudioTab`: Agents, Prompts, Tools, Workflows, Files, Environment,
Permissions, Logs, VM, Evaluations. Three have real tables (Agents, Permissions, Files); seven
render a placeholder.

The rail labels it *"inspect-first, not default home."* Keep it that way.

### Agent drawer — the evidence panel
Per agent: Doing / Why / Files changed / Tools used / Outcome, carrying the line *"this drawer is
evidence, not a chat."*

This is the explainable-rationale pattern, already written. `main.tsx` never imports it.

### Onboarding — two implementations, both unrouted
`Onboarding.tsx` is four steps: intent → goal → constraints → plan.
`CompanyOnboard.tsx` is five: intent → kind → goal → bounds → plan, adding company *kinds*
(software, content, commerce, growth, support, research) with per-kind team presets, and deriving
a company name from the goal.

**These overlap and both are dead.** Whoever takes onboarding next should pick one and record the
decision in `ORCHA-CHANGES.md` — this is the duplicate-implementation case `AGENTS.md` warns about.

---

## The cloud runtime

### The VM — specification only, nothing built
From `infra/VM_IMAGE_NOTES.md`: pin the OS, Python/Node runtimes, browser version, build tools and
security agent; run agents as an unprivileged user.

Required image checks, verbatim:

- no default credentials
- outbound network policy loaded
- metadata service blocked
- secret redaction enabled
- process and disk quotas active
- audit forwarder healthy
- kill switch reachable
- preview server isolated from control-plane credentials

There is no cloud VM/image lifecycle yet. The local development runtime does
have a dedicated WSL worker with its own unprivileged user and disabled Windows
drive automounting, but that is not a hosted isolation guarantee. Every cloud
image check remains a production requirement, not a UI status.

### The container — written, never built
`python:3.11-slim`, installs the package, exposes 8080, runs uvicorn. Compose mounts a named volume
at `/var/lib/orcha`. Multi-arch base, so ARM hosts work unchanged.

### The runtime surface
| Variable | Purpose | Honoured |
|---|---|---|
| `ORCHA_API_HOST` / `ORCHA_API_PORT` | API bind | yes, via uvicorn args |
| `ORCHA_DATABASE_URL` | `sqlite:///./orcha.db` | **no** — state is in-memory |
| `ORCHA_EVENT_BUS` | `in_memory` | accurate by accident |
| `ORCHA_WORKSPACE_ROOT` | Where agents may write | **no** — no filesystem tool exists |
| `ORCHA_VM_ID` | Which VM runs this company | **no** |
| `ORCHA_SIGNING_KEY` | Event signing | **no** |
| `ORCHA_MAX_COMPANY_BUDGET_USD` | Spend ceiling (25) | **no** |
| `ORCHA_APPROVAL_MODE` | `consequential-only` | **no** |

`ORCHA_APPROVAL_MODE=consequential-only` is the most important unimplemented line in the repo. It
encodes the intended posture — ordinary internal work proceeds without asking, consequential or
externally-visible actions gate — and both onboarding screens already promise it in copy.

---

## The capability model

| Capability | Default | Meaning |
|---|---|---|
| `repo.write` | Allowed | Write code in the company workspace |
| `shell.test` | Allowed | Run tests and build commands |
| `preview.deploy` | Allowed | Publish to the company preview |
| `external.send` | **Blocked** | Anything that leaves the company |

`external.send` blocked by default is the line separating this from an unbounded agent. **It stays
blocked by default permanently.**

**Status:** these are string literals in a returned dict and an HTML table. Nothing enforces them,
because nothing acts yet.

---

## The domain model

`src/orcha/domain/models.py`, `events/bus.py`, `runtime/orchestrator.py` — 136 lines total.

- **Company** — id, name, goal, constraints, status (`draft` / `running` / `paused`), objective
- **Task** — id, company, role, title, status, capabilities, evidence
- **DomainEvent** — event_id, type, version, occurred_at, company, aggregate, **sequence**, **actor**, data
- **Orchestrator** — `plan()` picks between two hardcoded role sets by keyword; `start()` marks running and emits

The event model is the strongest thing in the backend. Events are sequenced per company and carry
an actor (`{type: user|orchestrator, id}`). That is the substrate for the audit trail, the timeline,
the recovery view and undo — four surfaces, one source.

**Verified working:** `POST /v1/companies` → `/start` → `/events` produces real sequenced,
actor-attributed events.
**Current local state:** SQLite persists companies and evidence through an API
restart; a bounded scheduler moves eligible tasks through execution.
**Still not built:** a cloud control plane, shared durable queue, VM fleet,
external capability adapters, and automatic production deployment.

---

## What is real today

| | Real | Synthetic | Absent |
|---|---|---|---|
| Chat with a model | ✅ Smart AI Router (Gemini free → Groq fallback) | | |
| Domain events | ✅ durable, sequenced, actor-attributed | | |
| Company lifecycle | ✅ create → run → pause/resume/stop/delete | | |
| Task planning | ✅ validated model plan with recorded safe fallback | | |
| Task execution | ✅ bounded local specialist runner when an API provider is configured | blocked honestly without provider |
| Persistence | ✅ local SQLite | | hosted multi-tenant database |
| VM / isolation | ✅ dedicated local WSL worker | | cloud VM lifecycle |
| Capability enforcement | ✅ role-scoped local tool allowlist | | external adapters/capability broker |
| Budget enforcement | ✅ daily run and pre-call reserve locally | | multi-tenant billing |
| Evolution record | ✅ gated local evidence/promotion/rollback API | | dormant tree UI/apply transaction |
| Dashboard data | | `data.ts` constants remain Demo-labelled | |

---

## How dev mode is reached

A **toggle, not a separate app**. `Teams.tsx` already ships a working `Simple / Dev mode` switch
that reveals individual specialists inside each department. That is the interaction — extend it to
the other surfaces rather than re-inventing it per view.

Consumer mode is the default. Nothing in dev mode should be required to operate the product.

---

## Rules for anyone working on dev mode

1. **Every visible connection maps to a recorded event.** No decorative edges, no invented motion.
2. **Synthetic data stays labelled synthetic.** `data.ts` does this well today — keep it.
3. **Idle agents stay idle.** The existing *"Idle — not theatrically busy"* comment is the correct
   instinct and the opposite of what most agent dashboards do.
4. **Inspect-first.** Reading is free. Changing is proposed, then gated on evaluation and policy.
5. **Rollback is never gated**, even when promotion is.
6. **`external.send` stays blocked by default.**
7. **Dev mode never becomes the consumer home.** The moment it does, Orcha is a developer console.
