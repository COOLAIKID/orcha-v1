# Agent Instructions

This file is the single source of truth for Codex, Cursor, Claude, and the human owner working in this repository.

The repository is shared by Codex, Cursor, and Claude. Inspect current files and recent changes on every message, integrate existing work, and never assume an earlier agent’s output is still the active implementation.

## Mission

Build Orcha as a consumer-facing autonomous AI company builder. The product begins with a calm chat-style entry point, then grows into a company runtime, Live HQ, Evolution, and Orcha Studio. Product truth lives in `PRODUCT.md`; durable visual truth lives in `orcha-v1-starter-kit/DESIGN.md` (shipped consumer chat). Cursor always-applies `.cursor/rules/orcha-design.mdc` and `.cursor/rules/orcha-smart-router.mdc`. Orcha Pro is $20/month: ~$10 VM, ~$5 GPT-5.6 for hard questions, free-tier Gemini→Groq for everything else.

## Mandatory behavior on every message

Before editing or answering implementation questions:

1. Inspect the current project state.
2. Look for files modified since the last known state.
3. Read the relevant source, docs, config, and recent handoff notes.
4. Identify whether another agent has changed the same surface.
5. Preserve useful work and integrate with it as if it were your own.
6. Only then decide what to change.

At minimum, inspect:

- `PRODUCT.md`, `DESIGN.md`, `README.md`, and this file.
- `docs/` when the task touches product or architecture.
- `ui/src/` when the task touches the interface.
- `ui/package.json`, `ui/index.html`, and build configuration before UI changes.
- `src/` and `tests/` when the task touches runtime behavior.
- `ui/src` file timestamps and any available source-control diff.

Do not rely on conversation memory when the repository can answer the question.

## Shared ownership rules

- No agent owns the repository exclusively.
- A file’s current contents are more authoritative than an agent’s earlier plan.
- Do not revert, delete, or overwrite another agent’s work merely because it differs from your preferred approach.
- If a file changed since your last inspection, re-read it before editing.
- Prefer additive, focused edits over rewrites.
- If two approaches are both valuable, isolate them in separate files or routes and document the difference.
- If a change is destructive or difficult to recover, stop and ask the human owner.

## Work with Cursor and Claude

Treat Cursor and Claude as peer implementers. Their changes may be partial, experimental, or better than the current approach. Analyze the intent and preserve the useful parts.

When another agent has changed a surface:

1. Read the changed files completely enough to understand the structure.
2. Run the relevant build or tests before changing behavior.
3. Keep compatible interfaces, names, and styles where possible.
4. Make the smallest change that fulfills the new request.
5. Mention what was discovered and integrated in the handoff.

If the same feature exists in multiple files, do not guess which is active. Trace the entrypoint and imports from `ui/index.html` → `ui/src/main.tsx` → the active component/view.

## UI collaboration rules

The active UI has one entry surface:

- `ui/index.html` — the shared Cursor-compatible app used by all agents.

All UI work should be integrated into this shared surface. Do not create a parallel agent-specific preview unless the human owner explicitly requests one.

Before changing UI:

- Check the active route and browser preview URL.
- Read the active component and its styles.
- Preserve the dark theme, accessibility, responsive behavior, and purposeful motion.
- Follow `orcha-v1-starter-kit/DESIGN.md` for the consumer chat (ChatGPT/Cursor settings, no purple sidebar, Other in-tile, landing stays still).
- Keep synthetic data clearly synthetic.
- Ensure visual motion represents a real state or an explicitly labeled prototype state.

## Runtime and preview workflow

After UI changes:

1. Run TypeScript/build validation when dependencies are healthy.
2. Restart or refresh the local preview if the user expects to see the change.
3. Use the current preview URL rather than inventing a new one.
4. If the build environment is broken, report the exact failure and still validate with the narrowest safe check available.

Primary UI preview: `http://127.0.0.1:4173/`

## Handoff format

Every agent should leave a concise handoff in its final response or, for substantial work, append a dated note to `docs/handoffs/`:

```text
Changed: [files and behavior]
Discovered: [relevant work from other agents]
Validated: [build/tests/preview checks]
Open: [known issues or next decision]
Preview: [URL, if applicable]
```

Do not create handoff notes for trivial one-line changes unless the change affects another agent’s active surface.

## Conflict handling

When files conflict:

- Prefer the newest confirmed user request.
- Prefer the currently wired entrypoint over an unused duplicate.
- Prefer the implementation with working validation over an unverified rewrite.
- Preserve user-facing behavior unless the request explicitly changes it.
- If intent cannot be inferred safely, explain the conflict and ask the human owner.

## Definition of collaborative done

A task is complete when:

- The relevant current files were inspected first.
- Existing agent work was preserved or intentionally reconciled.
- The requested behavior is implemented in the active surface.
- Build/tests or an explicit fallback validation were run.
- The preview is refreshed or its status is reported.
- The final handoff names changed files, validation, and open issues.

## Human owner has final authority

The human owner’s latest explicit request overrides this document, prior agent plans, and aesthetic preferences. This contract exists to improve cooperation, not to slow down clear user intent.
