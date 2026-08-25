# Agent Instructions

Shared by **@bents** (human owner), **Claude**, **Codex**, **Cursor**, **opencode**.

## First, every message

1. Read **[ORCHA-CHANGES.md](ORCHA-CHANGES.md)** — an append-only log of which files moved and when. Re-read anything listed there before editing that surface.
2. Read **[ORCHA-FIELD-STUDY.md](ORCHA-FIELD-STUDY.md)** — competitive research and a proposed roadmap. **It is NOT approved and NOT a work order.** Do not start any phase in it. If it touches the surface you are working on, add a note in its *Crew notes* section, then carry on with the task you were actually given.
3. Inspect the current files before answering or editing. This repo is **not** under git — file contents and mtimes are the only truth.

Product truth: `PRODUCT.md`. Visual truth: `DESIGN.md` — the shipped consumer chat (sidebar, onboard, settings, legal). Follow it on every UI change. Orcha Pro is $20/month; chat routing lives in `ui/src/smartAiRouter.ts`.
Dev mode — the operator/cloud-runtime product — is specified in **[DEV-MODE.md](DEV-MODE.md)**. Read it before touching LiveHQ, Evolution, Studio, Timeline, Recovery, Assets, the overlays, or anything under `infra/`.

There is no agent-to-agent chat. Coordinate through the code and the change log; talk to @bents directly.

## Keeping the change log running

`crew-watch.ps1` watches `ui/src`, `src`, `tests`, `docs` and the root docs, waits for a burst of edits to settle, and appends an entry to `ORCHA-CHANGES.md`.

```
.\crew-watch.ps1              run it
.\crew-watch.ps1 -DryRun      print instead of writing
.\crew-watch.ps1 -Reset       re-baseline, write nothing
```

## Shared ownership

- Nobody owns the repo. A file's current contents outrank any earlier plan.
- Do not revert, delete, or overwrite another agent's work just because it differs from your approach.
- Prefer additive, focused edits over rewrites.
- If two approaches are both valuable, isolate them in separate files or routes and say so in your handoff.
- If a change is destructive or hard to recover, stop and ask @bents.

## UI

One entry surface: `ui/index.html` → `ui/src/main.tsx` → active view. Trace the entrypoint before assuming which file is live.

Dev server: `cd ui && npm run dev` → **http://127.0.0.1:5175/**
API: `uvicorn orcha.api.app:app --port 8080` (from repo root, `PYTHONPATH=src`)

Preserve the dark theme, accessibility, responsive behavior, and purposeful motion. Keep synthetic data clearly labeled synthetic. The consumer chat design in `DESIGN.md` is binding.

## Handoff

Leave this in your final response:

```text
Changed: [files and behavior]
Discovered: [work from other agents]
Validated: [build/tests/preview]
Open: [issues or next decision]
```

## @bents has final authority

The owner's latest explicit request overrides this file, prior agent plans, and aesthetic preferences.
