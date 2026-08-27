Changed:
- Tools → Agents now lists the Demo company (status shape + task) and **Open Agent Grid**.
- Agent Grid is a workspace layer over ChatEntry/Shell. Chat stays mounted; Escape focuses out, then closes. `setView` is still a no-op.
- Canvas force-directed graph with orchestrator at center, team clusters, semantic zoom, pan/zoom, drag/pin, communication pulses, inspectable edges, agent detail, dock, Fit/Reset, Pause/Resume/Restart.
- Data path: runtime events → `ui/src/agentGrid/adapter.ts` → store → canvas. Synthetic clock lives only in `ui/src/agentGrid/demo.ts`.
- DESIGN.md Agent Grid rules. Field Study crew note. Sidebar chrome unchanged (no purple).

Discovered:
- Active path is still `ui/index.html` → `main.tsx` → `ChatShell` → `ChatEntry`. Live HQ / Studio remain unwired.
- Agents tab was an empty pane waiting for this surface.

Validated:
- `npx tsc --pretty false --noEmit`
- `node --experimental-strip-types --test src/agentGrid/agentGrid.test.ts` (5 pass, including 100-agent seed)
- `npx vite build`
- Preview serves the new modules at `http://127.0.0.1:5175/`
- No browser driver in this session; could not click the sidebar → grid → agent → chat loop in a real window.

Synthetic:
- Entire Agent Grid roster, tasks, tools, files, messages, and progress. Labeled **Demo**. Not live runtime work.

Open:
- Wire the adapter to the Python/VM event bus when that exists.
- Replace the Demo clock with real agent heartbeats.

Preview:
http://127.0.0.1:5175/
