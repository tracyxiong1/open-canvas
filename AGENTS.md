# Creator Canvas agent contract

## Product boundary

- Build a new, independent AI video creation canvas. LibTV is reference evidence only.
- Do not use LibTV names, logos, source code, private APIs, or hotlinked assets in the product.
- The MVP consists of a Codex creation skill, a first-party CLI, and a standalone infinite-canvas preview.
- Generation is BYOK. Never store or print API keys in source files, fixtures, issue comments, logs, or Multica configuration.
- Let the AI select providers and models by default. Preserve explicit prompt-level strategy overrides.
- Ignore billing and commercial cost optimization in the MVP.

## Shared behavior

- Treat the project/canvas document as the single source of truth for the CLI, skill, and preview.
- Keep implementation minimal and trace every change to an MVP acceptance criterion.
- Do not implement canvas UI before desktop and mobile visual references are captured under `docs/references/`.
- Do not invent visual styles or copy protected source assets. Use approved source evidence and open-source icons/assets.
- Preserve unrelated work. Do not perform destructive Git operations.

## Delivery

- Start by reading `docs/context-pack.md` and the current Multica issue.
- Add or update tests for behavior changed by the task.
- Run the narrowest relevant checks, then the repository-wide checks available for the affected package.
- Report assumptions, files changed, commands run, and remaining blockers in the Multica issue.

