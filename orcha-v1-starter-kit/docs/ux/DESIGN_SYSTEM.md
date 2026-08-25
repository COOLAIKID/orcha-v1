# Design System Guidance

## Feeling

Executive control room plus living organization: calm, high-signal, tactile, and focused on momentum. Avoid a generic chat-first layout.

## Tokens

- Canvas: deep ink `#0B1020`; elevated surface `#121A2B`; border `#26324A`.
- Primary: electric violet `#8B7CFF`; success: mint `#58D6A0`; warning: amber `#F4B860`; failure: coral `#F06B74`; text: cloud `#E8EDF7`.
- Spacing: 4/8/12/16/24/32/48.
- Radius: 10 for cards, 16 for panels, full-pill for statuses.
- Typography: readable grotesk for UI, mono only for IDs and technical details.

## Motion rules

Animate state changes, event arrival, artifact handoff, and experiment branching. Do not loop decorative activity forever. Respect reduced-motion preferences. Every motion component needs a source event ID in development mode.

## Components

Company header, objective card, milestone rail, agent node, task edge, activity item, evidence drawer, experiment branch, cost meter, approval gate, artifact card, recovery timeline, and Studio inspector.
