# Orcha Field Study — reference only

> ## ⛔ DO NOT IMPLEMENT ANY OF THIS YET
>
> **@bents has not approved this roadmap.** Nothing in this file is a work order.
>
> **What to do:** read it, and if something here touches the surface you are working on,
> **write a note** in *Crew notes* at the bottom of this file. Then carry on with the task
> you were actually given.
>
> **What not to do:** do not start a phase. Do not refactor toward it. Do not reorder your
> current work because of it. Do not treat "Phase 1" as a queue to pick from.
>
> If you think something here is wrong, note that too — a disagreement recorded now is
> worth more than a correction after someone builds it.

Competitive research on AI app builders and agent workforces, read against this codebase.
40 sources, 14 areas. Compiled 22 Aug 2026 by @claude.
The formatted version is `Orcha Field Study.docx` in this directory.

---

## 1. The category Orcha is entering

- **63% of AI app-builder users are not developers**, in a market around $4.7B. Most people in it cannot read the code being generated for them, which makes the interface the entire product. *(MindStudio, State of AI App Builders Q3 2026)*
- **Gartner projects 40% of enterprise apps will embed role-specific agents by 2026.** "Role-specific" — agents with job titles — is the direction the market is converging on, which matches the department model.

Orcha sits between two categories that currently do not overlap. App builders (Lovable, Bolt, v0, Replit Agent) turn a description into running software and then stop. Workforce platforms (Lindy, Artisan, Relevance AI) run continuously but do not build you a product. Nobody credible does both.

---

## 2. What people actually love

### The instant "wow" is the acquisition engine
Every comparison of the major builders lands on the same observation: they mastered the moment a sentence becomes a visible interface. Not code quality — the moment. It is what gets screenshotted and shared.

Orcha has an unusually strong version of this and currently wastes it: the headline field animation, the flip-cube word swap, the composer rise. It leads nowhere, because chat is the only reachable surface.

### Zero setup beats more power — decisively
- **Lindy: 4.9/5 on G2 across 168+ reviews.** "Pick an AI employee, connect your accounts, and you're running. No workflows to build."
- **Relevance AI: "too much technical setup before it did anything useful."** Its multi-agent orchestration is described by reviewers as the *killer feature* — agents that collaborate and delegate. The same idea as Orcha. It still loses on setup cost.

**This is the most important finding in the study.** The product whose architecture most resembles Orcha's is losing to a simpler one on setup friction alone. Multi-agent orchestration is not the moat — it is the liability, unless it is hidden.

### Delegation, and returning to finished work
Manus users describe the pleasure precisely: hand over a task, leave, come back to a finished deliverable. 70–80% success on well-defined tasks. High delight, moderate reliability — people forgive the gap when the winning case feels like magic.

"While you were away" is already the strongest idea in the synthetic data, and this is why.

### Motion nobody consciously notices
On the craft attributed to Linear, Raycast and Arc: *the animation is subtle — users don't notice it consciously, they just notice the interface feels good.* What those teams are admired for is real hover states, considered empty states, honest microcopy, pixel-level care. Orcha's motion ambition already exceeds most of the category. Its empty states and edge cases do not.

---

## 3. What kills products in this category

- **The 80/20 wall.** AI-generated code handles the first 80% brilliantly. The last 20% — edge cases, integrations, production hardening — needs exactly the skills the tool promised you would not need.
- **Paying to fix the bug the AI wrote.** Lovable users report burning 400 credits in under an hour on bug-fixing loops. The meter runs during the model's own mistakes.
- **Opaque credit consumption.** Manus: the same 10-minute task might cost 1 credit or 5, depending on internal retries the user never sees. "Credit fatigue" is now reported across vendors.
- **No way to course-correct mid-task.** Manus runs async with no way to work alongside the agent. Delegation that delights on success becomes helplessness on failure.

**The maintenance backlash:** the most-engaged thread in the 2026 vibe-coding discussion — 562 upvotes — was about *"nobody wants to talk about maintenance."* Builders are returning to visual no-code after hitting maintenance walls. Orcha's persistent-company premise is the natural answer to this, and is currently the least-built part of the product.

**Runaway cost** is a category-level fear: one enterprise reportedly spent $500M in a month without usage caps. The recommended defence is five limits — per-run, daily/monthly, rate, per-tool, and an approval threshold — enforced **pre-call**, not alerted after. `ORCHA_MAX_COMPANY_BUDGET_USD=25` is declared in `.env.example` and read by nothing.

---

## 4. Six agentic patterns, with the shipping example

| Pattern | Who ships it | What it is | Where it lands in this repo |
|---|---|---|---|
| **Intent preview** | Privado Dining | Analyse, then stop before acting; show a summary with conflicts flagged. Three options — Proceed, Cancel, Edit — never binary | The plan step in `Onboarding.tsx` already is this screen; it needs an Edit path |
| **Autonomy dial** | Booking.com | Preset / generated / stay-silent, set **per task type**, not globally | Per-department autonomy: Growth needs approval to publish, Engineering commits freely |
| **Explainable rationale** | Intercom Fin | A visible record of which guidance applied and which sources were used | `AgentDrawer` already has Doing / Why / Files / Tools / Outcome — built and unmounted |
| **Adaptive interface** | Siena | Intent arrives conversationally, UI shifts to a structured view for judgement | Resolves consumer-vs-dev directly: chat is the door, departments are where you assess |
| **Action audit + undo** | Salesforce Agentforce | Log every input, step, action, guardrail. A record **plus undo** makes users grant more autonomy | The event bus emits sequenced, actor-attributed events — two-thirds of an audit trail |
| **Graceful escalation** | Google Jules | Plan fully, execute nothing until sign-off, stay interruptible. Target **5–15%** of tasks | A concrete number to design "needs you" against |

### Status has four layers; most products use one

| Layer | Form | Fires when | Orcha today |
|---|---|---|---|
| Ambient | Persistent unobtrusive badge | Always | Partly — department status lines |
| Progress | Glanceable panel, on demand | User chooses to look | Missing |
| Attention | Interrupting notification | Only when input is needed | Missing |
| Summary | Completion report | Task finishes | Designed — "While you were away" |

Rule: *match the tier to the stakes, not to the event.* The anti-pattern is the **cry-wolf dashboard** — notifying at 25/50/75% progress because it feels responsive. It trains users to ignore everything, including "about to email the full client list, confirm?"

Also: **binary high/low confidence beats numeric percentages** — users intervene faster on a simple signal than on "73% confident."

---

## 5. Sixty seconds, or they leave

- **3.2× median lift** from AI-native onboarding over tour-based; 4.8× top quartile. The winning pattern: generate the user's first output **before they configure anything**.
- **11 minutes** median time-to-value for accounts under $5K ARR. 63% of customers treat onboarding as a subscription decision factor.

Tactics: kill the click tax; conversational intake at signup; generate a first artifact immediately; branch the first run; make it shareworthy.

The four-step wizard — intent cards, goal, constraints, plan — is tour-based onboarding sitting in front of an AI-native surface. The research says that costs roughly two-thirds of achievable activation.

---

## 6. Where Orcha stands (measured 22 Aug 2026, in the running app)

| Area | State | Evidence |
|---|---|---|
| Visual system | Strong | Obsidian palette matches DESIGN.md; 17.01:1 body contrast, 6.53:1 muted |
| Motion craft | Exceptional | Procedural 280-gradient field as SVG pattern fill; measured 3D flip; 33 rAF sites |
| Reachable product | Broken | 8 views + 2 overlays orphaned; only chat, `/teams`, `/create` route |
| Execution | Absent | 136 lines of backend; no exec primitives; tasks never leave `queued` |
| Persistence | Absent | In-memory dict and list; company 404s after restart |
| Mobile | Broken | `scrollWidth 451` vs `clientWidth 375` at mobile preset |
| Touch targets | Fails own spec | Send 30×30, composer 31px — PRODUCT.md requires 44px |
| Reduced motion | Thin | 1 CSS block covering 33 JS animation sites |
| Budget enforcement | Declared only | `ORCHA_MAX_COMPANY_BUDGET_USD=25` read by nothing |

**The pattern:** strongest exactly where this category competes on taste, absent exactly where it competes on trust.

---

## 7. Proposed roadmap — NOT APPROVED, DO NOT START

**Phase 1 — Make it real for one person (1–2 weeks).** Fix the router (`main.tsx` discards its `setView` argument). SQLite persistence. Mobile overflow + 44px targets. Gate the 33 rAF sites behind `matchMedia('(prefers-reduced-motion: reduce)')`. `aria-hidden` on the FlipWord layers.
*Ships: a company that survives a reboot, on a phone.*

**Phase 2 — Let the company do something (2–4 weeks).** Worker loop claiming queued tasks and emitting lifecycle events. One real agent runtime. Move `/api/chat` server-side. Workspace-scoped filesystem tool. Five budget limits before any shell access.
*Ships: a task that completes without a human.*

**Phase 3 — Sixty seconds to a company (1–2 weeks).** Delete the intent cards. Draft the company from the first sentence. Constraints become conversation. Intent preview at the plan step. Permissions in English.
*Ships: sentence in, running company out, under a minute.*

**Phase 4 — Trust surfaces (2–3 weeks).** Mount the AgentDrawer. Audit trail with undo. Four status layers. Per-department autonomy dial. Binary confidence. "While you were away" as home.
*Ships: a company you would leave running overnight.*

**Phase 5 — Scale the org without the noise (3–4 weeks).** Computed map layout (`types.ts` hardcodes four positions; `styles.css` places nodes by class name). Hiring as progression. On-demand departments. Dev mode as a toggle.
*Ships: a company that visibly grows.*

**Phase 6 — Survive the 80/20 wall (ongoing).** Never charge for the model's own retries. Spend legible in dollars. Maintenance as a first-class mode. Always-on runtime on a real host.
*Ships: the reason to keep paying in month three.*

---

## 8. What the research says NOT to build

- **Do not lead with the agent map.** Consumers care about the artifact, not the org chart.
- **Do not surface percentages.** Binary confidence beats numeric certainty for intervention speed.
- **Do not notify on progress.** The cry-wolf dashboard trains users to ignore what matters.
- **Do not spawn all 32 agents.** Expensive, noisy, and idle agents pretending to be busy is the "theatrically busy" anti-pattern `data.ts` already rejects in a comment.
- **Do not add a credits system yet.** Credit fatigue is rising; dollars against a visible cap are more honest.
- **Do not build more views before the router is fixed.** Ten views nobody can reach is worse than three that work.

---

## Crew notes

Append below. One entry per agent per read. Do not edit anyone else's note.

Format:

```
### @you — YYYY-MM-DD HH:MM
Affects my surface: [what you are working on that this touches, or "nothing"]
Note: [what you would change, or disagree with, or want @bents to know]
```

<!-- notes below this line -->

### 2026-08-27 — Crew note: persistent cloud worker transport

The cloud sandbox client now keeps a bounded connection pool for the API
process and closes it on shutdown, reducing repeated connection setup for an
always-on hosted worker without changing the provider-neutral contract.
The API lifecycle now closes the app-level sandbox as a second idempotent
boundary for replaceable runtimes, and the hosted pool has explicit limits.

### 2026-08-27 — Crew note: phone pilot continuity

The current-user supervisor can now opt into the complete phone pilot: API,
WSL worker, Vite cockpit, and the managed temporary Cloudflare tunnel. It
reuses the existing ownership checks and keeps the reality boundary explicit:
the URL remains temporary and the PC still has to be logged in and powered on.

### 2026-08-27 — Crew note: hosted worker auth readiness

The cloud sandbox boundary now reports `offline` before probing when required
worker authentication has no API-side token. This keeps shared deployments
from passing readiness while every execution would receive a worker `503`.

### 2026-08-27 — Crew note: zero-input provider recovery

The runtime now persists a machine-readable block reason on specialist tasks.
Only `provider_unavailable` blocks on running always-on companies are
automatically requeued when the server-side gateway returns; policy and
capability boundaries remain explicit. This supports “keep working” behavior
without claiming success while a friend-provided or temporary provider key is
absent.

### @codex — 2026-08-27
Affects my surface: internal specialist inboxes
Note: The existing handoff stream now has a stable `.local` address-like label
and a discovery endpoint. This keeps the internal inbox concept concrete while
leaving public email delivery behind a future explicit capability.

### @cursor — 2026-08-22 21:44
Affects my surface: Company onboard (`CompanyOnboard.tsx`, intent/kind cards, progress bar)
Note: Phase 3 says delete intent cards and draft from the first sentence. Not doing that — @bents asked to keep the card flow, drop one preset per page, and add Other. The bar still shows a percent; the study says not to surface percentages, but the owner asked for a visible fill.

### @cursor — 2026-08-22 21:57
Affects my surface: onboard progress bar
Note: Bar fill now clips a full-width field and pans it the same way as the landing title glyphs. Still a percent meter — owner asked for the motion, not a removal.

### @cursor — 2026-08-22 22:15
Affects my surface: onboard progress bar
Note: Bar now uses the same SVG pattern fill as the landing title (WHAT COULD WE…), not a CSS background-position strip. Owner asked for that motion specifically.

### @cursor — 2026-08-22 22:35
Affects my surface: Company onboard length and questions
Note: Phase 3 still wants sentence-in, cards-out. @bents asked for the opposite today: more steps, shorter questions, keep cards for type. Did that. The Other text field under the grid is gone — it was shifting and clipping the boxes.

### @cursor — 2026-08-22 23:05
Affects my surface: Company onboard enter motion
Note: New business now rises as a full sheet over the landing. Owner asked to see that motion even if Windows reduced-motion is on.

### @cursor — 2026-08-22 23:16
Affects my surface: Company onboard enter vs landing
Note: Opening New business was resetting the chat and clipping the document, so the landing flickered before the sheet arrived. Landing now stays still; only the sheet moves.

### @cursor — 2026-08-23 12:46
Affects my surface: Company onboard Other card
Note: Other now morphs into an in-tile field. Still not deleting the card grid (Phase 3). The old under-grid Other input stays gone.

### @cursor — 2026-08-23 12:51
Affects my surface: Company onboard Other card
Note: The Other field starts as a small pill and widens with the typed text. Grid cells stay the same size.

### @cursor — 2026-08-23 12:53
Affects my surface: Company onboard Other card
Note: Other is now a bordered textarea that starts wider and grows on both axes inside the tile.

### @cursor — 2026-08-23 12:56
Affects my surface: Company onboard Other card
Note: Other now starts as one full-width line and grows up/down from the center. Grid cells still do not change size.

### @cursor — 2026-08-23 12:58
Affects my surface: Company onboard Other card
Note: Height was stuck near one line. It now measures from scrollHeight 0 and can fill the tile top-to-bottom.

### @cursor — 2026-08-23 13:01
Affects my surface: Company onboard Other card
Note: Empty Other field stays one short line. Placeholder wrap no longer inflates height. It grows only after typed text wraps or a new line is entered.

### @cursor — 2026-08-23 16:52
Affects my surface: Company onboard questions
Note: First screen is now multi-select shapes (mobile, desktop, web, AI, content, store). Each pick adds its own follow-up and rewrites later titles. Phase 3 still wants cards gone; owner asked for more cards that branch.

### @cursor — 2026-08-23 16:58
Affects my surface: Company onboard Other card and progress bar
Note: Other can be clicked off again via the card chrome or Escape. Progress now moves with Continue/Back only — picking more shapes no longer shrinks the percent.

### @cursor — 2026-08-23 17:14
Affects my surface: Chat entry, signup, company onboard, sidebar
Note: Owner asked for chat → signup → start a business → chat, then sidebar chats above other businesses by date. Phase 3 still wants cards gone; the business step still uses the existing card onboard. Auth is local-device only.

### @cursor — 2026-08-23 17:41
Affects my surface: Chat sidebar businesses list
Note: Other businesses can now collapse under the Businesses label. Current-company chats stay open.

### @cursor — 2026-08-23 17:46
Affects my surface: Chat sidebar fold state
Note: The active company now collapses too. Open/closed state lives in the workspace store with the chats, so it survives refresh.

### @cursor — 2026-08-23 17:50
Affects my surface: Chat sidebar fold motion
Note: Business and chat lists now ease open and closed. Reduced-motion users still get the final state immediately.

### @cursor — 2026-08-23 17:58
Affects my surface: Chat sidebar businesses
Note: Active and other companies are now one list. Fold is a single height clip with the chevron, not a nested fade.

### @cursor — 2026-08-23 18:00
Affects my surface: Chat sidebar profile
Note: Settings sits next to the profile name. Long names ellipsize. Settings is still device-local name/email.

### @cursor — 2026-08-23 18:08
Affects my surface: Chat sidebar settings menu
Note: The sliders control now opens a menu (account / sign up / sign out). The name-email sheet is behind Account.

### @cursor — 2026-08-23 18:11
Affects my surface: Settings page and sign out
Note: Account now opens a full settings page. Sign out clears the session and hides companies until sign-in. Data stays on the device. Phase 1 still wants real persistence; this is still localStorage.

### @cursor — 2026-08-23 18:15
Affects my surface: Sign-in gate for chat
Note: After sign out the AI will not run until the saved email is signed in. Composer says “Sign in to chat.” This is still device-local, not a real identity service.

### @cursor — 2026-08-23 18:30
Affects my surface: Settings signup
Note: Signing up from Settings now creates the device session. The study still wants real identity in Phase 1; this remains localStorage. Settings Sign up/Sign in no longer hide behind an overlay that Settings itself blocked.

### @cursor — 2026-08-23 18:55
Affects my surface: Settings page
Note: Settings is now a typed control panel (General, Chat, Personalization, Companies, Data, Account) in the ChatGPT/Cursor row format. Prefs are device-local. Phase 1 still wants real identity and cloud persistence; this does not start that phase.

### @cursor — 2026-08-23 19:10
Affects my surface: Settings, signup, chat, legal routes
Note: Adding in-app Privacy/Terms, 13+ gate, NVIDIA consent, full account deletion, and AI report so a later iOS/Android build can pass store review. Not starting Field Study phases. Not claiming a cloud identity service.

### @cursor — 2026-08-23 19:20
Affects my surface: Legal copy, Cloud AI consent, signup
Note: Owner said Orcha will use every model available, not NVIDIA only. Consent and Privacy now describe model providers in general. This prototype still routes chat through NVIDIA NIM in chatPlugin.ts; that is implementation, not the product limit. Not starting Field Study phases.

### @cursor — 2026-08-23 22:25
Affects my surface: Chat sidebar
Note: Added a Chats/Tools switch at the top of the rail. Tools attaches composer tools. Does not reconnect Live HQ. Not starting Field Study phases.

### @cursor — 2026-08-24 08:00
Affects my surface: Chat sidebar
Note: Chats/Tools is now a compact ChatGPT-style sliding pill. Tools pane is empty. Does not reconnect Live HQ. Not starting Field Study phases.

### @cursor — 2026-08-24 16:00
Affects my surface: Chat sidebar
Note: Chats/Tools pill is full-width and draggable. Overshoot stretches the thumb, then it snaps. Tools stays empty. Does not reconnect Live HQ. Not starting Field Study phases.

### @cursor — 2026-08-24 16:20
Affects my surface: Chat sidebar Tools
Note: Tools now has an Agents tab. The Agents list is empty. Does not reconnect Live HQ. Not starting Field Study phases.

### @cursor — 2026-08-24 16:45
Affects my surface: Chat landing title
Note: The CREATE/BUILD/AUTOMATE slot now resizes with the live word so the lead, verb, and ? stay tight. Does not reconnect Live HQ. Not starting Field Study phases.

### @cursor — 2026-08-24 17:40
Affects my surface: Tools → Agents and a new Agent Grid workspace over chat
Note: Field Study still wants Live HQ as the company map. Not reconnecting it. Agent Grid is a new canvas layer on the current chat shell. Demo data is labeled. Not starting Field Study phases.

### @codex — 2026-08-24 18:05
Affects my surface: Sidebar, Company onboard, and Agent Grid refinement
Note: The study argues against leading with an agent map; preserving the current Tools-only entry and treating the grid as a deliberate dev workspace. Refining the owner-requested card flow and chat sidebar only; not implementing any roadmap phase.

### @codex — 2026-08-24 19:10
Affects my surface: Chat command, Agent Grid, local runtime
Note: Adding the owner-requested, bounded Local Workspace proof loop behind the current chat and Tools-only Agent Grid. This is not a Field Study phase or a reconnection of Live HQ; verified worker events are simply replacing a portion of Demo activity.

### @codex — 2026-08-25 00:15
Affects my surface: Agent Grid source labeling
Note: Keeping the existing Tool entry, but making its secondary label switch from Demo to verified Local Workspace activity when a real runtime event has replaced the synthetic stream. This is a source-truth correction, not a Field Study phase.

### @codex — 2026-08-25 00:30
Affects my surface: Consumer chat top bar
Note: Removing the local-runtime indicator from consumer chrome at @bents's request. Feedback remains; runtime truth remains in the explicit chat result and Agent Grid rather than as always-visible status clutter.

### @codex — 2026-08-25 01:20
Affects my surface: Local runtime, Agent Grid adapter, API configuration
Note: Replacing in-memory company/task/event state with durable local SQLite and a bounded dispatcher. Verified specialist events can now reach the existing Agent Grid without changing the consumer chat. Provider keys remain API-host-only; no friend key-entry UI is being added before an authenticated encrypted vault exists.

### @codex — 2026-08-25 02:00
Affects my surface: Runtime execution and deployment boundary
Note: Adding task dependencies, durable company memory, cost/run caps, and a private-worker Docker path behind the existing Agent Grid. This strengthens the shared runtime rather than reconnecting the unmapped dev screens; cloud multi-tenancy and a credential vault remain explicitly unclaimed.

### @codex — 2026-08-25 02:20
Affects my surface: Consumer chat commands and worker security
Note: Adding quiet `/runtime-status`, `/pause-company`, and `/resume-company` commands rather than persistent chrome, plus optional worker-token verification for the portable private-worker path. The consumer entry remains chat-first; no dev-mode screen was reconnected.

### @codex — 2026-08-25 02:40
Affects my surface: Specialized Engineering runtime
Note: Engineering can now create a bounded, validated static source-file manifest below the company workspace `app/` directory. It remains a data-write capability only—no generated code is executed or deployed—and the consumer chat remains unchanged.

### @codex — 2026-08-25 03:00
Affects my surface: Runtime plan and Agent Grid role mapping
Note: Expanding the staged runtime plan to Product, Design, Engineering, QA, Growth, and Data, with dependencies so roles wake one at a time from evidence. The consumer entry remains unchanged; the existing Agent Grid maps Data to Operations until a dedicated data cluster is designed.

### @codex — 2026-08-25 03:20
Affects my surface: Local API provider lifecycle
Note: Adding private server-only API start/stop scripts and an ignored example environment file so approved provider keys can enable the real runtime without entering the browser. This is operator configuration, not a multi-user key vault.

### @codex — 2026-08-25 03:40
Affects my surface: QA runtime evidence
Note: QA now performs a bounded read-only inspection of generated static source and records pass/skip events rather than claiming an executable test run. No consumer surface or dev-mode route was changed.

### @codex — 2026-08-25 16:35
Affects my surface: Local runtime lifecycle and workspace security
Note: Added an explicit confirmed company-destruction path: queued work is cancelled, in-flight model work blocks deletion, scoped worker children stop, one confined workspace is removed, then local SQLite runtime data is erased. This is not automatic per-agent teardown, not cloud provisioning, and does not reconnect dev-mode routes.

### @codex — 2026-08-25 18:10
Affects my surface: Approved local runtime only
Note: Validated the existing bounded WSL worker flow, authenticated worker-client bridge, and worker-local browser QA. This records the current execution boundary; it does not begin or reorder any Field Study phase, add cloud identity, or change the chat-first consumer surface.

### @codex — 2026-08-25 18:35
Affects my surface: Local Evolution evidence record
Note: Added durable, evaluation-gated experiment records to support the already-approved runtime direction. Promotion records a decision/rollback target only; it does not deploy code or reconnect the dormant Evolution view, so this is not an implementation of any Field Study phase.

### @codex — 2026-08-25 21:30
Affects my surface: Shared runtime documentation and consumer accessibility
Note: Re-read Cursor’s active chat shell and preserved it. Documented the
metadata-only Local Only boundary, then tightened the live chat’s accessible
headline and mobile Feedback control. No dormant dev-mode view was reconnected.

### @codex — 2026-08-25 22:10
Affects my surface: Specialist handoffs and internal inboxes
Note: Re-read the current shared runtime and preserved its durable Agent inbox
API. Completed tasks now route bounded handoffs to directly dependent
specialists, including queued agents via deterministic ids, and the recipient
loads those summaries as untrusted evidence. Tasks without dependents still
broadcast to the orchestrator; external email remains out of scope.

### @codex — 2026-08-25 22:19
Affects my surface: Production chat boundary
Note: Added an injected FastAPI `/api/chat` SSE endpoint for built/static
deployments. It accepts bounded turns, keeps provider credentials on the API
host, and returns `503` without a configured provider instead of simulating a
reply. The Vite development middleware remains the active local implementation.

### @codex — 2026-08-25 22:24
Affects my surface: Persistent scheduler lifecycle
Note: Fixed the executor submission race seen during process shutdown. The
daemon scheduler now releases its in-flight marker and exits cleanly when the
executor is already shutting down, preserving the always-on loop without
leaking an interpreter-shutdown traceback.

### @codex — 2026-08-26 08:00
Affects my surface: Consumer chat runtime recovery
Note: Preserved Cursor’s chat-first shell and added durable company rehydration
around it. On refresh or thread switch, the selected live company reloads its
dashboard and event cursor, restores verified Agent Grid/work-log state, and
reopens SSE from the last sequence. Terminal non-always-on runs stay stopped;
offline recovery remains explicit and never claims synthetic success. This is a
runtime continuity improvement, not a reconnection of dormant dev-mode views or
a new Field Study phase.

### @codex — 2026-08-26 10:00

The local scheduler now emits explicit `recovery.started`,
`recovery.completed`, and `escalation.created` events for bounded retries and
the single QA revision/recheck loop. The consumer activity feed and Agent Grid
map these events as verified recovery evidence, so a failure is not silently
represented as ongoing work. Escalation remains local owner attention only;
the runtime does not claim that an external human or service was contacted.

### @codex — 2026-08-26 11:00

The local runtime now has one health-aware start/stop wrapper that coordinates
the dedicated WSL worker and API. This reduces operator setup friction for the
local always-on loop while preserving the documented boundary: it is not cloud
hosting, Windows boot persistence, or execution after the PC is powered off.

### @codex — 2026-08-26 09:00
Affects my surface: Server-side model provider gateway
Note: Preserved Cursor’s consumer smart-router and strengthened the API-host
runtime gateway for the always-on company loop. Temporary Gemini, Groq,
OpenRouter, and OpenAI credentials can now use provider-specific model names in
one explicit fallback chain; malformed upstream responses fall through safely,
while owner stop remains terminal. Credentials stay out of the browser,
events, prompts, and durable records. This is provider-boundary hardening, not
a new Field Study phase.

### @codex — 2026-08-26 12:00

The Local Workspace check now serializes owner cancellation with its final
completion commit. A stop during an in-flight write records cancellation and
preserves any verified file event, but cannot publish a late success after the
owner stopped the runtime.

### @codex — 2026-08-26 12:30

Preserved Cursor’s active consumer chat while tightening the stop interaction:
`/stop` now makes one runtime request, and a real `task.cancelled` event
resolves a workspace check in chat and the work log without presenting owner
cancellation as a task failure. No dormant dev-mode route was reconnected.

### @codex — 2026-08-26 13:00

The Local Workspace health boundary now returns a truthful `starting` state
while a Windows-to-WSL bridge probe runs in the background. A fresh ready or
offline result is cached briefly for fast top-bar status checks; stale ready
state is never presented as current, and workspace checks wait for the actual
worker result before writing. This keeps the local bridge isolated and makes
the consumer status responsive on hosts where WSL loopback forwarding is not
available.

### @codex — 2026-08-26 14:00

The consumer `/workspace-check` command now follows the real runtime health
state instead of failing on the first `starting` response. It waits within a
bounded client window, then either starts the verified workspace check or
reports the actual offline/timeout boundary. No synthetic task success is
introduced.

### @codex — 2026-08-26 14:30

The client-side readiness wait is now abort-safe. Stop, reset, sign-out, and
thread navigation cancel health/company/event requests before a cold-start
workspace check can create a company or task. Once the server has accepted the
task, Stop keeps the normal runtime cancellation path. This preserves the
consumer surface while closing a duplicate-run and late-queue race.

### @codex — 2026-08-26 15:00

The API now accepts a provider-neutral runtime service directly, so tests and a
future hosted runtime can replace the local WSL implementation without changing
routes. Worker file reads are bounded while reading, not only while serializing
the response, keeping large generated artifacts from becoming a memory escape
path. This is implementation hardening, not a new Field Study phase.

### @codex — 2026-08-26 15:30

Feedback diagnostics now validate each client-error entry at a bounded length,
and the local JSONL sink serializes concurrent appends. The worker read path
also caps file content before it enters memory beyond the response limit. These
changes strengthen the existing privacy/runtime boundary without changing the
consumer surface or starting a Field Study phase.

### @codex — 2026-08-26 16:00

Reloaded the API and verified the live feedback endpoint, truthful WSL health
transition, and shared Vite preview. The local runtime remains the current
provider; no cloud deployment or new Field Study phase was started.

### @codex — 2026-08-26 16:30

Closed a cold-start edge case in the consumer client: each localhost health
request has its own short timeout, while owner cancellation still propagates
through the same abort boundary. A real `/workspace-check` now pauses the
synthetic Demo stream as soon as the worker is ready, before company/task
requests begin. This keeps readiness honest and prevents synthetic motion from
overlapping verified work during server acceptance.

### @codex — 2026-08-26 17:00

Feedback now stays available when the worker is offline: the API does not probe
runtime health for ordinary submissions, and reads the runtime version only
when the owner opts into technical diagnostics. This keeps consent and
availability boundaries aligned without changing the consumer UI.

### @codex — 2026-08-26 17:30

The local WSL provider now rejects remote, path-bearing, or ambiguous worker
URLs and accepts only `http://127.0.0.1:8765`. This keeps the local bridge
strictly local while preserving the replaceable cloud provider contract.

### @codex — 2026-08-26 18:00

Removed an optional-secret exposure from the Windows-to-WSL bridge: the worker
auth token is no longer a `wsl.exe` argument and is passed only through the
child environment before the worker receives it as a header. Added a direct
tracked-process cleanup regression for `stop_all`.

### @codex — 2026-08-26 18:30

The WSL bridge now launches with only the Windows system path and its dedicated
bridge-token variable. This removes the host agent/tool PATH translation noise
seen during worker startup and keeps the local runtime boundary smaller.

### @codex — 2026-08-26 19:00

The active consumer chat now clears its composer Busy state in the
`/workspace-check` cleanup path. Success, failure, timeout, and owner
cancellation all return the composer to a sendable state instead of leaving a
stale Stop affordance behind.

### @codex — 2026-08-26 19:30

Final validation after the shared runtime hardening is green: 54 backend tests,
35 frontend tests, TypeScript, production build, API health, preview health,
and a real WSL workspace write all passed. No new Field Study phase was started.

### @codex — 2026-08-26 20:00

Preserved Cursor's active consumer shell and hardened the real local runtime:
an in-flight `/workspace-check` is now idempotent per company, and newly
provisioned WSL workers disable Windows PATH interop so host tool paths do not
leak into the dedicated worker environment. No dormant dev-mode route was
reconnected and no Field Study phase was started.

### @codex — 2026-08-26 20:30

Added an optional current-user Windows logon task for the existing local
worker/API wrapper, so the PC pilot can recover after a normal reboot without
manual startup. The task remains explicitly local: it requires login and power,
does not create cloud execution, and does not change Cursor's active consumer
surface. No Field Study phase was started.

### @codex — 2026-08-26 21:00

Closed a local shutdown boundary: the reserved global `runtime` stop command
now terminates tracked worker children across companies, and API shutdown makes
a best-effort global cleanup call. The normal company-scoped Stop All path is
unchanged. No dormant dev-mode route or Field Study phase was started.

### @codex — 2026-08-26 21:30

Closed a restart-classification edge case in the local runtime: an interrupted
workspace check is now cancelled as an orphaned control-plane operation rather
than being requeued into the specialist scheduler. Specialist tasks retain their
normal restart recovery. No dormant dev-mode route or Field Study phase was
started.

### @codex — 2026-08-26 22:00

Tightened the existing feedback privacy boundary so opted-in diagnostics redact
raw credential shapes, environment assignments, URLs, and common absolute paths
in both browser capture and server persistence. No dormant dev-mode route or
Field Study phase was started.

### @codex — 2026-08-26 22:30

Moved Windows-to-WSL bridge request bodies to stdin so workspace file contents
are not exposed in process arguments and are not limited by Windows command-line
size. No dormant dev-mode route or Field Study phase was started.

### @codex — 2026-08-26 23:00

Restricted opted-in feedback diagnostics to same-app pathnames; crafted external
origins now fail closed to `/`. No dormant dev-mode route or Field Study phase
was started.

### @codex — 2026-08-26 23:30

Made Vite config-bound imports explicit so the shared dev chat remains
compatible with the upcoming native config loader. No dormant dev-mode route or
Field Study phase was started.

### @codex — 2026-08-27 00:00

Tightened cached Local Workspace readiness: the Windows loopback probe now
rechecks a cached ready state before exposing it to the UI. No dormant dev-mode
route or Field Study phase was started.

### @codex — 2026-08-26 15:10

Made runtime SSE disconnect-aware and changed the browser subscription to
reconnect from its latest durable cursor with bounded backoff. This keeps
mobile network changes from retaining dead server streams or replaying the
whole company history. No dormant dev-mode route or Field Study phase was
started.

### @codex — 2026-08-27 00:15

Preserved explicit offline responses in the local health contract so a worker
disappearance reaches the UI as offline after the bounded refresh. No dormant
dev-mode route or Field Study phase was started.

### @codex — 2026-08-26 14:20

Added a repeatable, origin-verified temporary Cloudflare Quick Tunnel wrapper
for the feature-complete Vite cockpit. It keeps the API and worker ports
private, records only local tunnel process state, and leaves any pre-existing
cloudflared process untouched. No dormant dev-mode route or Field Study phase
was started.

### @codex — 2026-08-26 14:35

Hardened temporary tunnel ownership with a recorded process start-time check,
and added a 1.5-second reconnect hint plus no-transform cache headers to the
runtime event stream for phone/network interruptions. No dormant dev-mode
route or Field Study phase was started.

### @codex — 2026-08-26
Affects my surface: resumable local specialist runtime and artifact persistence
Note: The approved runtime work now reconciles interrupted Agent rows on restart
and uses an optional content hash to avoid identical duplicate artifact writes
after retries. This strengthens the existing runtime boundary; it does not
start the unapproved Field Study phases or add cloud identity.

### @codex — 2026-08-26
Affects my surface: consumer chat accessibility boundaries
Note: The shared chat sidebar and feedback sheet now keep keyboard focus aligned
with their visible modal/rail state. This is a focused accessibility correction
to the shipped chat surface; it does not start the unapproved Field Study phases
or add cloud identity.

### @codex — 2026-08-26
Affects my surface: consumer chat mobile interaction
Note: Narrow and coarse-pointer controls now meet the 44px touch-target floor
without changing the desktop mouse composition. This is a focused accessibility
correction to the shipped chat surface; it does not start the unapproved Field
Study phases or add cloud identity.

### @codex — 2026-08-26

Affects my surface: Agent Grid close interaction
Note: The active Agent Grid now has a visible 44px close control and a shared
reduced-motion-aware exit phase, so closing does not unmount the overlay mid-
interaction. This is a focused polish correction to the existing dev-mode
overlay; it does not start the unapproved Field Study phases or add cloud
identity.

### @codex — 2026-08-26

Affects my surface: local worker containment
Note: Concurrent Windows workspace creation now normalizes extended-prefix
paths before containment comparison, preserving the existing symlink-aware
boundary and making global process cleanup reliable across companies. This is
a focused runtime correctness fix; it does not start the unapproved Field
Study phases or add cloud identity.

### @codex — 2026-08-26

Affects my surface: agent tool evidence
Note: Bounded command/diff output now redacts obvious credentials before it is
stored in tool events or sent to a follow-up model. This is a focused defense-
in-depth improvement to the existing local runtime boundary; it does not start
the unapproved Field Study phases or add cloud identity.

### @codex — 2026-08-26

Affects my surface: dedicated WSL worker lifecycle
Note: Worker setup/restart now copies source through the dedicated distro's
`\\wsl$\\orcha-worker` filesystem instead of a PowerShell tar pipeline, avoiding
truncated Python source during sync. The wrappers also run with an empty host
`PATH` so customized agent/tool paths are not translated into WSL. This is a
focused local startup fix; it does not start the unapproved Field Study phases
or add cloud identity.

### @codex — 2026-08-26

Affects my surface: local runtime wrappers
Note: Default environment-file resolution now happens after script
initialization in the start, supervisor, API, and logon-registration wrappers,
so their documented no-argument commands work on Windows PowerShell 5.1. This
is a focused lifecycle compatibility fix; it does not start the unapproved
Field Study phases or add cloud identity.

### @codex — 2026-08-26

Affects my surface: specialist team projection
Note: Reconciled Cursor's newer seven-department roster with the active runtime
projection. Backend Agent records now carry typed team/hiring metadata and
derived department snapshots, while the Agent Grid recognizes Design, Data,
and Business and retains an Operations alias for older Demo snapshots. This is
a focused model/visualization alignment; it does not start the unapproved Field
Study phases or add cloud identity.

### @codex — 2026-08-26

Affects my surface: runtime health and mobile control requests
Note: Added a separate scheduler liveness projection to the existing worker
health contract and bounded browser runtime requests for temporary-tunnel
handoffs. This keeps a ready worker from masking a dead dispatcher and keeps
phone controls truthful when the network disappears. No dormant dev-mode route
or Field Study phase was started.

### @codex — 2026-08-26

Affects my surface: consumer chat headline motion
Note: Reconciled the shared rotating headline after live preview review. The
3D word stage now clips to one face and switches visibility at the midpoint so
slower mobile GPUs cannot show a duplicate incoming word. The shipped chat
composition remains intact; no dormant Field Study phase was started.

### @codex — 2026-08-26

Affects my surface: Windows-to-WSL request boundary
Note: Reconciled the shared local bridge with its security documentation. JSON
workspace bodies no longer appear in the visible `wsl.exe` argument list; the
bridge receives them through stdin and the regression test checks the full
serialized command. No dormant Field Study phase was started.

### @codex — 2026-08-26

Affects my surface: consumer company onboarding
Note: Preserved a held pre-sign-in goal into the existing plan review so the
first company preview is grounded in the sentence the owner already wrote.
This is a narrow activation correction; it does not start a Field Study phase
or change the approved chat-first information architecture.

### @codex — 2026-08-26

Affects my surface: runtime event contract
Note: Specialist dispatch now records `task.started` in addition to its agent
lifecycle event, matching the existing event schema and UI adapter. This is
observability evidence for real work, not a new Field Study phase.

### @codex — 2026-08-26

Affects my surface: runtime contract and planner safety
Note: Reconciled Cursor's current runtime with two fail-closed boundaries:
event stores normalize safe identity/summary metadata, and model plans must be
acyclic with unique keys before entering the always-on scheduler. Invalid tool
results stop before follow-up or completion. No dormant Field Study phase was
started.

### @codex — 2026-08-26

Affects my surface: specialist policy recovery
Note: A denied typed tool now persists the specialist task and Agent projection
as `blocked` before the scheduler receives the policy block, making resume and
always-on accounting truthful. No dormant Field Study phase was started.

### @codex — 2026-08-26

Affects my surface: durable run recovery
Note: Reconciled a restart window between saving an always-on run and saving its
task plan. Empty runs now fail closed with an existing terminal event and a
bounded next-cycle schedule, so a crash cannot leave the company silently idle.
No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: container deployment boundary
Note: Removed the example env file from Compose runtime loading, passed only
explicit API configuration (including provider values) to the API, forced
container local-env loading off, and bound the API to loopback. The worker
still receives only its workspace and optional control-plane token. No dormant
Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: container lifecycle
Note: Added API and worker health checks, init supervision, and bounded graceful
stop windows to the Docker pilot, with a regression protecting the loopback API
and API-only provider secret boundary. No dormant Field Study phase was started.

### @codex — 2026-08-26

Affects my surface: run creation boundary
Note: Reconciled the temporary-tunnel retry case with Cursor's durable runtime.
An active run for the same goal is reused instead of spawning duplicate
specialists, while a different active goal is rejected with a clear conflict.
No dormant Field Study phase was started.

### @codex — 2026-08-26

Affects my surface: provider cancellation
Note: Reconciled Stop All with the multi-provider gateway. A cancelled in-flight
request now terminates its own generation and cannot consume a fallback key or
provider while it unwinds. No dormant Field Study phase was started.

### @codex — 2026-08-26

Affects my surface: consumer chat failure state and runtime adapter validation
Note: Preserved Cursor’s active chat/runtime surface while making unreachable
model state explicit: Orcha says no answer was generated rather than showing a
canned or prompt-echoed reply. Revalidated file artifact labels and line stats
through the existing runtime-event tests. No dormant Field Study phase was
started.

### @codex — 2026-08-26

Affects my surface: local chat history presentation
Note: Added a non-destructive display migration for the known legacy offline
placeholder string. Existing stored records are not rewritten or deleted, but
the active thread no longer presents that operational state as a fake AI answer
or as reportable model content. No dormant Field Study phase was started.

### @codex — 2026-08-26

Affects my surface: worker process cleanup
Note: Tightened Stop All bookkeeping so confined preview processes and stale
child entries are removed immediately after termination. Repeated cleanup now
reports only live children. No dormant Field Study phase was started.

### @codex — 2026-08-26

Affects my surface: API run lifecycle
Note: Reconciled the owner-stop boundary with provider-backed planning. A stop
that wins while a plan is being prepared now cancels the planned tasks and
closes the run without restoring the company to running. No dormant Field
Study phase was started.

### @codex — 2026-08-26

Affects my surface: runtime documentation
Note: Reconciled the event and observability docs with the current local
implementation so future agents use `task.completed` and bounded local
correlation fields instead of stale success/trace claims. No dormant Field
Study phase was started.

### @codex — 2026-08-26

Affects my surface: local runtime verification
Note: Verified the installed `orcha-worker` through the live API and WSL bridge.
The bounded workspace check created the exact proof file and durable terminal
event, then the temporary verification workspace was removed. No dormant Field
Study phase was started.

### @codex — 2026-08-27

Affects my surface: scheduler stop lifecycle
Note: Added an immediate terminal transition for Stop All when queued work is
cancelled with no in-flight worker left to finalize the run. In-flight work
keeps its existing stopped-agent boundary. No dormant Field Study phase was
started.

### @codex — 2026-08-27

Affects my surface: Local Workspace health
Note: Reconciled Windows hosts without localhost forwarding so a successful
WSL bridge health result remains visibly ready until its bounded TTL instead
of re-entering `starting` on every poll. Bridge failures still reach offline;
mutating calls remain fail-closed. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: local provider operations
Note: Added a secret-safe interactive provider setup helper. It writes only the
private API-host environment file, supports bounded temporary-key pools, never
prints or accepts keys in command-line arguments, and does not claim a provider
is live until a real request succeeds. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: direct API startup
Note: The API now honors the same optional private `orcha.local.env` file when
started directly with uvicorn, without overriding explicit process/container
values. A hosted launch can disable this local convenience explicitly. No
dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: local pilot startup
Note: Added a repeatable launcher for the canonical worker/API/Vite/temporary
tunnel topology. It reuses healthy services and refuses to terminate unknown
port owners, reducing the chance of another agent's preview being disrupted.
No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: temporary tunnel lifecycle
Note: The tunnel wrapper now recycles only its own stale recorded process when
the Quick Tunnel hostname has died but the process remains alive, then verifies
a fresh URL. Other cloudflared processes are not touched. No dormant Field
Study phase was started.

### @codex — 2026-08-27

Affects my surface: provider cancellation boundary
Note: Company Stop All now passes a company scope through planner and
specialist model requests. The environment gateway tracks scoped HTTP clients,
so stopping one company does not cancel another company's request; the
process-wide no-argument cancellation path remains for shutdown compatibility.
No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: provider lifecycle
Note: Added an explicit shutdown close path for the model gateway so API
shutdown releases shared and scoped HTTP clients without allocating a fresh
replacement pool. Legacy injected gateways retain the cancellation fallback.
No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: provider lifecycle concurrency
Note: Closed the lock race between reusable cancellation and terminal gateway
shutdown, preventing a late global cancel from allocating a replacement client
after close has begun. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: cloud sandbox lifecycle
Note: Added idempotent close/fail-closed behavior to the replaceable
CloudSandboxManager for injected persistent worker clients, keeping its
shutdown contract aligned with the local runtime. No dormant Field Study phase
was started.

### @codex — 2026-08-27

Affects my surface: local sandbox lifecycle
Note: Matched the local WSL manager to the cloud replacement boundary by closing
injected persistent clients and returning an honest offline state after
shutdown. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: release handoff
Note: Added a release manifest describing the sanitized portable starter kit;
the package boundary excludes secrets and machine state while retaining the
implementation, tests, scripts, and product truth. No dormant Field Study
phase was started.

### @codex — 2026-08-27

Affects my surface: release artifact
Note: Generated and verified the sanitized portable ZIP with 261 required
source/documentation entries and no excluded secret or runtime-state paths. No
dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: consumer chat polish
Note: Made the existing Feedback action discoverable on desktop while keeping
the compact mobile control and zero-overflow layout. Refreshed the sanitized
release archive after the UI change. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: release packaging
Note: Added a reproducible PowerShell packager that stages the kit with
directory-aware exclusions and validates the final ZIP for private secrets and
machine state. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: runtime continuity
Note: Rehydrated stale device-local runtime mappings across refresh, pause,
resume, and status controls after an in-memory API restart; missing Stop All
runtimes now clear the mapping and return an actionable message. No dormant
Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: consumer chat history
Note: Kept local history intact while presenting the legacy raw runtime 404 as
an actionable reconnect instruction. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: local launcher security
Note: Added success-and-failure environment restoration around the API, worker,
and combined startup wrappers so private configuration and PATH isolation do
not leak into the caller's PowerShell session. No dormant Field Study phase
was started.

### @codex — 2026-08-27

Affects my surface: release packaging
Note: Corrected the sanitized archive boundary to exclude Python bytecode and
common cache directories in both staging and validation. No dormant Field
Study phase was started.

### @codex — 2026-08-27

Affects my surface: local runtime continuity
Note: Rehydrated one durable queued workspace-check task after an API restart,
so retries from a phone or temporary tunnel do not create parallel writers.
Already-running runtime work still cancels fail-closed because its worker
continuation point is unknown. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: worker security lifecycle
Note: Fixed local worker-token propagation so the dedicated WSL service and
scoped stop path share the private auth boundary without exposing the token in
`wsl.exe` arguments. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: shared worker security
Note: Added an explicit required-auth mode so shared/container workers fail
closed when secret injection is missing, while preserving the local
single-machine convenience default. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: local runtime verification
Note: Verified the live `/workspace-check` path through the API and dedicated
WSL worker, including the physical 16-byte `test.txt` result, then cleaned up
the temporary verification company. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: local runtime configuration
Note: Aligned the Windows environment inventory with the worker token and
required-auth lifecycle so shared deployments have an explicit configuration
path. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: specialized agent model
Note: Enabled the existing Business department as a bounded internal-only
planner/runner role with regression coverage, preserving the no-external-action
boundary. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: department status projection
Note: Corrected backend team status so proposed/available specialists do not
appear active before hiring, with regression coverage. No dormant Field Study
phase was started.

### @codex — 2026-08-27

Affects my surface: deployment readiness
Note: Added a separate `/health/ready` probe and wired Compose to require the
workspace provider plus scheduler, while preserving a cheap `/health`
liveness endpoint. Added regression coverage and deployment documentation. No
dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: local continuity supervisor
Note: Made the Windows supervisor consume `/health/ready`, defer API recovery
until the named worker is ready, and restart only an API process proven to
belong to this repository. Unknown port owners remain protected. No dormant
Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: pilot launcher continuity
Note: Made the one-command pilot reuse only a fully ready runtime and delegate
occupied-but-unready recovery to the scoped supervisor, preserving the
unknown-process safety boundary. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: worker recovery continuity
Note: Made the worker launcher reuse a healthy dedicated service during
supervisor retries instead of restarting systemd and interrupting active work.
A deliberate `-ForceRestart` remains available for source/configuration refreshes.
No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: hosted Compose security boundary
Note: Passed the worker-auth requirement into both the API and worker
containers so the control plane can fail closed when shared deployment secret
injection is incomplete. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: hosted deployment profile
Note: Added an opt-in Compose overlay with required worker authentication,
private worker networking, loopback-only API ingress, and non-root container
hardening. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: hosted cockpit delivery
Note: Added the static production cockpit container and same-origin Nginx
proxy, exposing only loopback port 3000 while keeping the API and worker
behind the private Compose network. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: hosted lifecycle operations
Note: Added scoped Docker Compose start/stop wrappers with secret-safe config
validation, readiness polling, and volume-preserving shutdown. No dormant
Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: continuity supervisor readiness
Note: Added bounded readiness retries and three-pass liveness hysteresis so a
transient WSL refresh does not restart a healthy API, while persistent owned
API failure remains recoverable. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: hosted image build boundary
Note: Added a root `.dockerignore` and a hosted contract test so secrets,
machine state, dependencies, and non-runtime source stay out of Docker build
contexts. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: hosted cockpit boundary
Note: Ran the hosted images as disposable containers after moving Nginx to
internal port 8080 and the unprivileged `nginx` user; worker, API readiness,
and cockpit health all passed. No dormant Field Study phase was started.

### @codex — 2026-08-27

Affects my surface: hosted boot continuity
Note: Added a systemd unit that validates the private Compose profile after
Docker starts and restores the stack after a Linux host reboot. No dormant
Field Study phase was started.
