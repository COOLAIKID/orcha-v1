# Orcha handoff — chat truthfulness and shared adapter review

## Changed

- `orcha-v1-starter-kit/ui/src/chatReply.ts` now returns an explicit offline
  operational state instead of a canned assistant-style answer when Cloud AI
  is unavailable.
- `orcha-v1-starter-kit/ui/src/views/ChatEntry.tsx` uses that state in both
  unreachable-model paths without echoing the owner’s prompt, and presents
  known legacy placeholder history as the same operational state without
  rewriting stored chat.
- Revalidated Cursor’s `runtimeEvents.ts` file-event mapping and its
  evidence-backed artifact line statistics and pulse labels.
- Added regression tests in `ui/src/chatReply.test.ts`.

## Discovered

- The active entrypoint remains `ui/index.html` → `ui/src/main.tsx` → `Shell` →
  `ChatEntry`; dormant developer views were left untouched.
- The preview can still show previously persisted placeholder messages in the
  browser because existing local chat history is preserved. New unreachable
  requests now use the truthful state.

## Validated

- Full frontend test set: 30 passed.
- TypeScript check and production Vite build passed.
- Impeccable detector: no findings for the changed sources.

## Open

- Provider credentials remain intentionally unconfigured in the local preview.
- Hosted Cloud AI and always-on orchestration still require the future hosted
  control plane described in the product docs.
