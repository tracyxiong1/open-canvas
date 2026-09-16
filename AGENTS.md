# Open Canvas agent contract

## Product boundary

- Build a new, independent AI video creation canvas. External products are interaction references only.
- Do not use reference-product names, logos, source code, private APIs, or hotlinked assets in the product.
- The MVP consists of a Codex creation skill, a first-party CLI, and a standalone editable infinite-canvas studio.
- Generation is BYOK. Never store or print API keys in source files, fixtures, issue comments, logs, or task-tracker configuration.
- Treat a model integration as a user-configured provider instance: persist only its safe provider ID and resolved model ID, while credentials stay in a local environment variable.
- Let the AI select providers and models by default. Preserve explicit prompt-level strategy overrides.
- Ignore billing and commercial cost optimization in the MVP.
- The local P0 has no global role, material, style, or history library. Reusable direction and local references are ordinary project-scoped canvas nodes; imported bytes stay in the local project store.

## Shared behavior

- Treat the project/canvas document as the single source of truth for the CLI, skill, and studio.
- Keep creation conversation-first and atomic: Codex composes only the requested
  canvas operations through the Skill and CLI. Do not impose a script-to-shots
  workflow, and keep MCP out of this local MVP.
- Keep implementation minimal and trace every change to an MVP acceptance criterion.
- Keep product-owned desktop and compact visual QA baselines under `docs/qa/`.
- Do not invent visual styles or copy protected source assets. Use approved source evidence and open-source icons/assets.
- Preserve unrelated work. Do not perform destructive Git operations.

## Canvas visual direction

- The studio is a general-purpose editable creative canvas, not a branded clone.
- Match the approved interaction anatomy: a dark dotted infinite plane, fixed
  top/bottom control layers, compact type-specific nodes, direct curved links,
  and an inline composer that moves with the selected node.
- Text, image, video, and editing/composition surfaces must be visually
  distinguishable. Reference-product names, logos, imagery, model names, and
  wording remain excluded.
- Selecting a canvas node must focus it in the viewport and open its inline
  composer; do not preselect a node on initial load.
- The current creation palette contains only text, image, video, and audio.
  Audio starts with text-to-speech, local import and playback; music generation,
  voice cloning and timeline rendering are out of scope. Keep legacy context
  and composition nodes readable and editable without exposing new palette entries.
  Local file import belongs to the CLI or a node-level action. Result history
  stays on its originating node, including explicit selection for downstream use.

## Delivery

- Start by reading `docs/context-pack.md` and the relevant issue or PR context.
- Add or update tests for behavior changed by the task.
- Run the narrowest relevant checks, then the repository-wide checks available for the affected package.
- Report assumptions, files changed, commands run, and remaining blockers in the active task or PR.
