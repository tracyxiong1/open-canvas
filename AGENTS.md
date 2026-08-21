# Open Canvas agent contract

## Product boundary

- Build a new, independent AI video creation canvas. External products are interaction references only.
- Do not use reference-product names, logos, source code, private APIs, or hotlinked assets in the product.
- The MVP consists of a Codex creation skill, a first-party CLI, and a standalone editable infinite-canvas studio.
- Generation is BYOK. Never store or print API keys in source files, fixtures, issue comments, logs, or task-tracker configuration.
- Let the AI select providers and models by default. Preserve explicit prompt-level strategy overrides.
- Ignore billing and commercial cost optimization in the MVP.

## Shared behavior

- Treat the project/canvas document as the single source of truth for the CLI, skill, and studio.
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
- Keep the complete creative-node palette available from the compact bottom
  add menu (text, image, video, editing, directing, analysis, audio, script,
  asset-reference, upload, and generation-history entry points).

## Delivery

- Start by reading `docs/context-pack.md` and the relevant issue or PR context.
- Add or update tests for behavior changed by the task.
- Run the narrowest relevant checks, then the repository-wide checks available for the affected package.
- Report assumptions, files changed, commands run, and remaining blockers in the active task or PR.
