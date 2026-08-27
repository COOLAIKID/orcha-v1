Changed:
- Agent Grid no longer autoplays the Demo clock. Empty grid is live-idle until a company run.
- `beginCompanyRun` latches Orcha as working and opens the grid.
- Opening Tools → Agent Grid hydrates the current company from the API when the graph is empty.
- Chat SSE / `ingestRuntimeEvents` seed Orcha on a live-empty graph. Demo script stays tests-only.

Discovered:
- Store used to start `synthetic: true`, so Tools open replayed Demo before the first real event.

Validated:
- `node --experimental-strip-types --test` agentGrid + runtimeClient + runtimeEvents: 28 pass
- `npx tsc --pretty false --noEmit`
- Preview `http://127.0.0.1:5175/` returns 200
- No browser click-through of Tools → grid or a live company sentence this pass

Open:
- Browser E2E of chat live object + Agent Grid still needed
- Specialists still need `orcha.local.env` or the run blocks honestly

Preview:
http://127.0.0.1:5175/
