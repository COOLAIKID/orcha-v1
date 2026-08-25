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
- Cloud AI off: nothing is sent to any model provider. Do not fake a live reply.
- Orcha uses **every model available**, not NVIDIA only. The catalog refreshes from OpenRouter. A free model ranked at or above GPT-5.6 (Ox Alpha today) takes general and advanced work. Else Gemini 2.5 Flash (50k/user/month) then Groq infinite fallback. GPT-5.6 is only the $5 envelope when no free star model is live. Video creation is planned in chat and rendered elsewhere. Plan is **$20/month** on a ~$10 VM.

## Sidebar

- One company list: active first, then others by date.
- Top of the rail: a full-width ChatGPT-style sliding pill for **Chats / Tools**. Drag the thumb; pulling past either end rubber-bands and stretches a bit, then snaps. Click still switches. Tools has an **Agents** tab (empty for now; more tool tabs later). Persist the pane in `workspace.side.pane`.
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

Only for real state: sheet rise, sidebar, folds, composer lift, flip cube, switch thumb. Reduced-motion users get the final state immediately, except owner-requested onboard rise. Honor Settings → Motion (system / full / reduce). Controls ≥ 44px. Focus visible.

## Composition

12–14px radii, one elevation, quiet borders. Settings rows in a single grouped list — not nested cards. Landing breathing room around the composer.

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
