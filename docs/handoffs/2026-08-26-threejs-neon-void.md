Changed:
- Replaced the starter app shell with a polished Three.js arcade game: Neon Void.
- Added a full-screen space scene, ship movement, asteroid hazards, energy pickup loop, HUD, mission overlay, and polished sci-fi styling.
- Wired the app entry to the shared UI surface at `orcha-v1-starter-kit/ui/src/main.tsx` with the game scene mounted immediately.

Discovered:
- The active app was a starter Vite/React scaffold in `orcha-v1-starter-kit/ui`; the game was added into that working surface rather than creating a parallel preview.
- The existing project already had Vite and React, so the additional work was focused on replacing the shell and adding the 3D scene.

Validated:
- `pnpm build` succeeded for the project after installing `three` and `@types/three`.
- The app was served on `http://127.0.0.1:5175/` and the page loaded successfully with the launch overlay and HUD visible.

Open:
- No blockers; this is a complete playable prototype in the current workspace.
- If you want a second phase, next upgrades could include bosses, audio, pause menus, or a proper leaderboard.

Preview:
http://127.0.0.1:5175/
