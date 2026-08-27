# Held goal onboarding handoff

Date: 2026-08-26  
Agent: @codex

Changed:
- Updated `orcha-v1-starter-kit/ui/src/views/ChatEntry.tsx` so `openBoard`
  accepts an optional initial goal and retains a pending message when sign-in
  or sign-up leads into company onboarding.
- The company plan’s offer/objective now reflects the owner’s original chat
  sentence; direct “new company” entry continues to start blank.
- Recorded the change in `ORCHA-CHANGES.md` and the required Field Study crew
  note.

Discovered:
- Cursor’s active entrypoint remains `ui/src/main.tsx` → `Shell` →
  `ChatEntry`; dormant developer views remain intentionally unwired.
- The existing real local runtime, feedback sheet, temporary 5175 Quick Tunnel,
  and dark chat surface were preserved.

Validated:
- Bundled `pnpm run check` passed.
- Bundled `pnpm run build` passed (Vite production build).
- Existing frontend runtime/adapter test set passed 36 tests.
- Refreshed `http://127.0.0.1:5175/`; no horizontal overflow, the rotating
  headline remains single-face, and the Feedback control is present.

Open:
- Provider credentials remain intentionally unconfigured in this environment;
  model-backed specialist work still reports a truthful blocked state.
- The runtime is local-PC execution; the temporary tunnel shares the cockpit,
  not a power-independent cloud VM.

Preview: http://127.0.0.1:5175/
