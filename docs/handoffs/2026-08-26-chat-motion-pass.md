# Consumer chat motion pass

Date: 2026-08-26
Agent: @codex

Changed:
- Kept Cursor's `ui/src/GameApp.tsx` preserved and unwired; the active entrypoint remains `ui/src/main.tsx` → `Shell` → `ChatEntry`.
- Replaced the active landing headline's per-frame SVG pattern updates with CSS background-clipped text. The field now moves on the actual text nodes, so the lead, current verb, next verb face, and question mark stay in the same font and share one coordinate system.
- Replaced random 2D target chasing with a deterministic left-to-right highlight sweep. A soft lane in `blueField.ts` keeps the color transition visible even when the random texture is sparse.
- Layout rects are read once per animation layout and invalidated only by resize; background position and cube transforms remain compositor-friendly style writes.
- The headline animation cancels its requestAnimationFrame loop while the document is hidden and resumes from a clean frame when visible. Reduced-motion behavior remains final-state-only.

Discovered:
- The active preview is `http://127.0.0.1:5175/`; the user-facing current browser state may still show a persisted chat, while `localhost:5175` provides a clean storage origin for visual review.
- Cursor's latest Three.js experiment is not part of the active consumer surface and was intentionally not removed.
- The local API still has no configured model provider in `orcha.local.env`; runtime truth remains blocked rather than synthetic when specialist model work is requested.

Validated:
- `ui/node_modules/typescript/bin/tsc --pretty false --noEmit -p ui/tsconfig.json`
- `ui/node_modules/vite/bin/vite.js build` (50 modules; production build passed)
- Browser preview at `http://localhost:5175/`: headline cycles through `CREATE → BUILD → AUTOMATE → BUILD`, has no SVG headline nodes, and its computed field position changes between samples.
- Impeccable detector completed. It reported existing warnings for overused font, onboarding height transition, and grid background; no headline-motion issue was reported.

Open:
- Public Quick Tunnel is still a temporary, unauthenticated private pilot; its current edge remains subject to the earlier Windows Schannel probe limitation.
- Hosted authenticated runtime, multi-user auth, and provider credentials remain future work.

Preview: `http://127.0.0.1:5175/`
