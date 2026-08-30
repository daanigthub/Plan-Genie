# Plan Genie project guidance

## Product

Plan Genie is a browser-based event room planner. Organizers create a room
layout, schedule time blocks, and preview how objects change during the event.
The core experience is a precise, friendly top-down 2D editor.

## Stack and commands

- React + Vite + TypeScript
- Plain CSS; do not add a component library
- No backend, database, accounts, or authentication yet
- Run locally with `npm.cmd run dev`
- Verify changes with `npm.cmd run build`

## Routes

Routing is intentionally lightweight and lives in `src/main.tsx` using
`window.location.pathname`:

- `/` — approved landing page from `index.html`
- `/app` — intake form
- `/app/editor` — editable room layout and timeline

## State and data

- Persist intake data under `planGenie.intake` in `sessionStorage`.
- Persist the layout under `planGenie.layout` in `sessionStorage`.
- Keep the existing layout shape and add timeline data rather than replacing it.
- Timeline object state is keyed by block ID and object ID:
  `{ x, y, removed }`.
- Per-block dragging and removal must affect only the active timeline block.
- Save layout changes to session storage immediately using the existing React
  state/effect pattern.

## Design and behavior

- Reuse the design tokens and fonts defined in `index.html`.
- Keep the UI rounded and friendly, but preserve precise dimensions, grid
  alignment, and timeline labels.
- Use plain CSS transitions for object movement and disappearance.
- Use red/coral only for actual conflict states.
- Keep objects on a 2 ft grid and clamp them within the room.

## Scope constraints

- Do not add dependencies without asking first.
- Do not replace the existing landing page visually.
- Keep changes focused on the requested phase and avoid unrelated refactors.
