# Start here

Give this file to Cursor, Codex, or opencode as their first instruction.

---

You are joining a crew of four AI agents — **@claude**, **@codex**, **@cursor**, **@opencode** — working in one repo for a human owner, **@bents**. @bents has final authority.

## Do this first, every session

1. Read **[ORCHA-CHANGES.md](ORCHA-CHANGES.md)** — which files moved and when. Re-read anything listed there before editing that surface.
2. Read **[AGENTS.md](AGENTS.md)** — the collaboration contract.
3. Read **[PRODUCT.md](PRODUCT.md)** (product truth) and **[DESIGN.md](DESIGN.md)** (visual truth).
4. Read **[ORCHA-FIELD-STUDY.md](ORCHA-FIELD-STUDY.md)** — research and a proposed roadmap. **Not approved, not a work order.** Note anything that affects your surface in its *Crew notes* section; do not build from it.

There is no agent-to-agent chat. Coordinate through the code and the change log.

## What this project is

**Orcha** — an AI business starter. You describe an outcome; a company of specialized AI agent teams plans, builds, tests, and reports back.

Two modes:

- **Consumer mode** — departments are the unit. "Growth is testing two ad headlines." Calm, plain language, no jargon.
- **Dev mode** — individual agents, the Live HQ map, Evolution experiment tree, Studio internals. This is the original operator product and it stays. Fully specified in **[DEV-MODE.md](DEV-MODE.md)**.

## Repo facts you must know

- **Not under git.** File contents and mtimes are the only diff signal. `ORCHA-CHANGES.md` records what moved.
- UI dev server: `cd ui && npm run dev` → **http://127.0.0.1:5175/** (not 4173 or 5173).
- API: from repo root, `PYTHONPATH=src uvicorn orcha.api.app:app --port 8080`. Verified working; usually not running.
- **`npm install` is blocked** in some agents' sandboxes. Do not add dependencies without asking @bents first.
- Entry point: `ui/index.html` → `ui/src/main.tsx` → active view. Trace it before assuming which file is live.

## Known state — read ORCHA-CHANGES.md before "fixing" these

- **`main.tsx` discards its `setView` argument**, so 8 views + 2 overlays are orphaned (`LiveHQ`, `Evolution`, `Studio`, `Timeline`, `CompanyHome`, `Recovery`, `Assets`, `Onboarding`, `AgentDrawer`, `PromoteModal`). This is being redesigned around consumer/dev modes — reconnecting it naively makes the product *less* consumer-friendly.
- **Backend state is in-memory** and dies on restart. No executor exists; tasks never leave `queued`.
- **`/api/chat` is the Smart AI Router** — same engine in the Vite preview (`http://127.0.0.1:5175/api/chat`) and in `server/smart-ai-router.ts` for the VM (`http://127.0.0.1:8787`). Gemini free → Groq infinite fallback. NVIDIA is no longer the product pipe.

## The model being built

7 departments, 32 specialists (see `ui/src/teams.ts`). Departments are the **consumer** unit; individual agents are the **dev-mode** unit.

| Department | Specialists |
|---|---|
| Product | Product Manager, Researcher, User Interviewer, Spec Writer |
| Engineering | Backend, Frontend, Mobile, Database, DevOps, Integrations |
| Quality | Code Reviewer, QA/Test, Security Auditor, Accessibility Auditor, Performance |
| Design | UX, UI/Visual, Brand, Copywriter |
| Growth | Ads, SEO, Content, Social, Email/Lifecycle, Landing Page |
| Data | A/B Tester, Analytics, Reporting |
| Business | Pricing, Competitor Analyst, Legal (ToS/Privacy), Support |

Agents are **hired over time**, not spawned all at once — 32 concurrent LLM agents does not fit the $25/day cap in `.env.example`. Departments wake on demand.

**Blocker before N agents can render:** `types.ts:18` hardcodes `position: 'eng' | 'research' | 'design' | 'qa'`, and `styles.css:270-273` places map nodes by CSS class with four static edges. Both need a computed layout. Confined to `LiveHQ.tsx` plus that CSS block.

**Needed in the model:** `Team` type, `Agent.team` membership, `Agent.hired` state, department status derived from members.

## Rules

- Nobody owns the repo. Current file contents outrank any earlier plan.
- Never revert or overwrite another agent's work just because it differs from your approach.
- Prefer additive, focused edits over rewrites.
- If two approaches are both valuable, isolate them in separate files or routes and say so in your handoff.
- Keep synthetic data clearly labeled synthetic.
- If a change is destructive or hard to recover, stop and ask @bents.

## End every session with

```text
Changed: [files and behavior]
Discovered: [work from other agents]
Validated: [build/tests/preview]
Open: [issues or next decision]
```
