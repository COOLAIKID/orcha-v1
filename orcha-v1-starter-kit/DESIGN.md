# Orcha Design System

Durable visual truth for the shipped consumer app. Product truth stays in `PRODUCT.md`. Owner requests override this file.

## Visual world

Orcha is an obsidian control room for a living software company. The consumer product opens as a calm ChatGPT-style chat, not a wireframe dashboard. Deep graphite, quiet borders, and restrained light. Real work — not decoration — creates motion.

## Color roles

- Canvas: `#0B0D12`
- Surface: `#11141B`
- Elevated surface: `#151923`
- Border: `#252B36`
- Text: `#EDF0F5`
- Muted text: `#8D96A8`
- Violet orchestration: `#9B8CFF` — Live HQ / Studio only. **Do not use purple on the chat sidebar.**
- Mint verified: `#62D9B1` — switches on, verified states
- Amber experiment: `#EAB365`
- Coral recovery/failure: `#EF7D83` — destructive actions
- Blue preview/information: `#6FA8E9` — links, information

Chat landing canvas is `#212121` with the same wash overlay. Settings rows and sidebar chrome use `#2A2A2A` / `#454545` borders so the chat reads like ChatGPT / Cursor, not a nested card grid.

## Typography

`Space Grotesk` for product statements, labels, metrics, settings titles, sidebar names. `DM Sans` for supporting copy, legal, composer, dense text. Headlines: tight tracking, short lines. Composer and settings are sentence case — do not inherit chat-mode uppercase.

## Active surface

One entry: `ui/index.html` → `ui/src/main.tsx` → `ChatEntry` on `/`. `setView` is a no-op. Stay on chat. **Do not reconnect Live HQ, Evolution, Studio, Timeline, Recovery, or Assets.**

Preview: `http://127.0.0.1:5175/`

## Chat

- Landing stays still when signup, settings, or onboard sheets open. Only the sheet moves.
- Title: “WHAT COULD WE CREATE / BUILD / AUTOMATE?” with the hollow glyph field and flip cube. The verb slot and ? slide with the live word; the whole line shifts so the phrase stays centered.
- Try to send → signup (13+, Terms, Privacy) → start a business → held message sends.
- Signed out: composer placeholder “Sign in to chat.” AI will not run.
- Replies labeled **Orcha · AI**. Report lives on the thread.
- Cloud AI off: everyday chat sends nothing to a browser-side provider. Do not fake a live reply. Company specialists still use server-side keys only.
- Company builds stay in chat as **one live progress object**: intro line, Orcha planning immediately, role rows with `● ✓ ○ ×` marks as specialists are actually queued, the last few real work lines (`+ app/index.html +24`, model duration, QA checks), a compact strip of observed aggregates only (`3 active · +12 files · 2 checks ✓ · 1m 12s`), then a quiet `#2a2a2a` 12px-radius iframe of `/v1/companies/{id}/preview/index.html` when Engineering writes `app/index.html`. Mint flash on real `preview.ready`, then settle. The object stays glowing while a specialist is actually working; a real `company.heartbeat` also glows it without a new chat message. Keep the object on a blocked run until Stop All. Do not spam a chat message per event. After a slice completes, the company keeps planning the next improvement on this PC until Stop All. Starting a new company run pauses other always-on companies so this PC’s two workers serve the latest sentence. Demo stays labeled **Demo**. Hide a metric until a real event produced it — never `0 tests` if QA has not run.
- Orcha uses **every model available**, not NVIDIA only. The catalog refreshes from OpenRouter. A free model ranked at or above GPT-5.6 (Ox Alpha today) takes general and advanced work. Else Gemini 2.5 Flash (50k/user/month) then Groq infinite fallback. GPT-5.6 is only the $5 envelope when no free star model is live. Video creation is planned in chat and rendered elsewhere. Plan is **$20/month** on a ~$10 VM.

## Sidebar

- One company list: active first, then others by date.
- Top of the rail: a full-width ChatGPT-style sliding pill for **Chats / Tools**. Drag the thumb; pulling past either end rubber-bands the whole pill, then snaps. Click still switches. Tools has an **AgentGrid** tab; clicking it opens the Agent Grid workspace. Persist the pane in `workspace.side.pane`.
- Each company is a collapsible folder of its chats. Fold is a single height clip; chevron in sync. Persist in `workspace.side.open`. Active defaults open; others default closed.
- Profile name ellipsizes. Settings control sits next to it. Menu: Account / Sign in / Sign up / Sign out.
- Opening Settings closes the sidebar so the dim does not eat clicks.
- No purple on this rail.

## Company onboard

- Adaptive multi-select cards. Other morphs **in the tile**, not under the grid.
- Other can be deselected (chrome or Escape).
- Progress: first screen stays **10%**. Fill does not shrink when picks add pages. Continue / Back only.
- Keep the card flow. Do not delete the grid because a roadmap said to.

## Settings

ChatGPT / Cursor format: left category list, right grouped rows (title + hint + switch / select / button).

Panes: General, Chat, Personalization, Companies, Data controls, Legal & Privacy, Account.

- Signed-out Sign up / Sign in land on Settings and actually call `signUp` / `signIn`.
- Do not dump into “What is it?” after Settings signup unless a chat send is pending.
- Legal in-app: Privacy, Terms, deletion. Routes `/privacy`, `/terms`, `/delete-account`.
- Account deletion is a full wipe, not a freeze. Sign out is not deletion.

## Motion

Only for real state: sheet rise, sidebar, folds, composer lift, flip cube, switch thumb, Agent Grid communication pulses, node spawn, camera ease. Reduced-motion users get the final state immediately, except owner-requested onboard rise. Honor Settings → Motion (system / full / reduce). Controls ≥ 44px. Focus visible.

## Composition

12–14px radii, one elevation, quiet borders. Settings rows in a single grouped list — not nested cards. Landing breathing room around the composer.

## Agent Grid

Workspace layer over chat: Tools → **AgentGrid**, or a company sentence in chat. Chat stays mounted. Escape backs out of a focused agent, then closes the grid. No floating close control. While the grid is open the chat topbar is 48px. The Orcha mark stays 24px. No `setView`. Canvas `#0B0D12`. Do not put purple on the sidebar. The graph is the live company runtime — not a Demo clock.

- Graph fills the canvas: on open, fit the active network to about 70% of usable space, centered on visual mass, with room for the floating camera controls. Do not include empty team anchors in the fit. Auto-refit only after new agents settle, and never while the owner is panning, zooming, or focusing an agent.
- Nodes are small workspace objects (about 38px; orchestrator ~1.4× with a double ring and the Orcha mark). Interior `#11141B` / `#151923`, border `#252B36`. Initials or the mark sit inside. Status is a quiet perimeter accent — not a checklist glyph. Working: blue activity arc. Waiting: gray ring. Complete: thin mint tick. Experiment: amber dot. Failed: coral edge.
- Default zoom shows the agent name (Space Grotesk) plus one short state line (DM Sans). Role, model, tools, communication, and files appear through near/close zoom, hover, selection, or Inspect. Labels never overlap; collision uses the label box, not just the node center.
- Semantic zoom: far = node, team anchors, names only on important/active agents. Default = name + one state. Near = role, task, model/tool. Close = miniature workspace.
- Edges are faint curved `#252B36` lines that stop at the node. Live communication is a short traveling `#6FA8E9` segment (amber for experiment, coral tick for failure). Result events travel source → destination as stored. Real file pulses show their observed `+ / −` label even in Calm. Selecting an agent dims unrelated nodes and edges. Working agents keep a small spatial drift while their status is working; reduced motion holds them still.
- Team names sit as small Space Grotesk spatial anchors above the cluster, with a hairline — no giant team containers.
- Fit / Zoom− / Zoom+ sit bottom-right as one segmented control, same chrome as the agent dock (`#151923`, `#252B36`, 12px radius). Persist density in `workspace.prefs.gridDensity`. Calm is the premium default. Detailed shows models, file marks, check rows, and pulse labels on artifact handoffs. Stop All lives on the agent inspect sheet and calls the same company runtime stop as chat `/stop`. Hover reveals a compact 13px-radius card. Double-click or Enter inspects.
- Productivity strip at the top of the overlay uses the same observed aggregates as chat (DM Sans 12px) and keeps elapsed time ticking while work is live. A liquid-glass specialist roster on the grid uses the same role rows as chat. Agent dock is an initials strip with `● ✓ ○ ×`; working agents pulse; hover shows name and current task. Close zoom shows the last four real activity lines, not a fake terminal.
- Live Output is a filtered log of real work lines (All / Agents / Files / Models / Tools / Tests / Messages). It opens when a live company run has work lines. Observed stdout from tools and commands shows a few lines immediately; the rest stays behind a click. Do not invent shell output. There is no Local Workspace kicker on the canvas.
- Motion follows Settings → Motion and `prefers-reduced-motion`. Reduced motion keeps the information: pulses sit on the line instead of traveling; freshness glow does not loop. Glow means work arrived in the last ~4s.
- Vocabulary marks are typography, not badges: `+ − ~ ✓ × ↻ → ← ↑ ↓ ○ ●`. Mint verify, coral fail, blue info, muted history.
- Chat opens the event stream before the run POST returns, so specialists and file pulses can appear while the planner is still working. A real `preview.ready` shows the company iframe on the grid as well as in chat.
- Demo clock (`ui/src/agentGrid/demo.ts`) is tests-only. The product grid does not autoplay it. If a test still ingests synthetic events, they stay labeled **Demo**.

## Do not

- Parallel agent-specific previews
- Purple on the chat sidebar
- Other’s text field under the card grid
- Reconnect Live HQ / Studio via `setView`
- Treat Field Study phases as a work order
- Present Orcha as NVIDIA-only
- Market to children or imply a kids app
- Invent store-ready cloud identity — auth is device-local until a backend exists
- Unlabeled synthetic metrics

## Accessibility

Icon-only controls have labels. Color is paired with text or shape. Mobile: category chips for Settings; preserve the objective before secondary detail.
