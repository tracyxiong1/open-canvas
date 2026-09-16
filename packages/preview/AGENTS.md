# Prototype Instructions

Current confirmed scope: expose text, image, video and generative audio in the
creation menu and empty-state guide. Preserve legacy node rendering. Audio
parameters are voice, speed and format, not aspect ratio or video duration.
The default standalone entry starts with an empty project, not the visual QA fixture.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

React Flow is the selected canvas engine. Preserve direct node dragging, typed sequence/dependency handles, and a controlled projection from the canonical project document. Browser edits must use `@open-canvas/core/browser`; do not add a second mutation or fingerprint implementation in the UI. The timeline is a separate synchronized surface, not a React Flow node.

Completed video nodes expose a visible play control in their media area. A normal node click still focuses the node; the play control opens and starts the local media preview without initiating a drag.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
