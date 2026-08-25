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




