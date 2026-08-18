# Creator Canvas MVP Context Pack

## Task summary

Build a new AI video creation product around an infinite canvas. Users create and revise videos from Codex with natural-language prompts. Each project owns one or more switchable drafts; every draft is an independent editable canvas, while generated and imported assets are shared by the project. A first-party CLI mutates the project document and invokes image/video providers with user-owned API keys. A standalone React Flow studio renders and edits the selected draft through the same command core.

## Confirmed scope

1. Codex creation skill.
2. First-party CLI.
3. Standalone editable infinite-canvas studio.

A Codex plugin is a later packaging and distribution step, not a separate MVP implementation.

## Core user loop

1. The user describes a video in Codex.
2. The skill plans a script and shot graph in a new or selected draft.
3. The CLI creates nodes and edges in that draft within the shared project document.
4. The routing layer selects a configured image or video provider unless the prompt overrides the strategy.
5. Jobs run with user-owned credentials.
6. The studio shows and edits relationships, layout, prompts, state, parameters, and assets.
7. A follow-up may copy a draft to create a variation, then updates only the affected subgraph in that draft.
8. The user exports an explicitly selected draft.

## Product rules

- Independent product: no reference-product runtime dependency or branding.
- BYOK only: secrets remain local and must never enter repository history or server-side task metadata.
- AI-first routing: choose provider/model automatically, while accepting user prompt constraints.
- MVP canvas interaction: pan, zoom, direct node movement, typed node relationships, prompt editing, undo/redo, local JSON import/export, asset preview, generation state, and parameter details.
- Complex editing may remain prompt-driven in V1.
- Billing, subscriptions, quotas, and cost optimization are out of scope.

## Acceptance scenario

Given the prompt `Create a three-shot science-fiction short`, the system creates a main draft with a three-shot graph, invokes configured generation adapters, and displays outputs and progress. Given the follow-up `Change shot 2 to night`, it copies the main draft into a night variation, updates and regenerates only the affected shot and downstream dependencies in that variation, and leaves the main draft unchanged. The selected draft can then be exported.

## Development and delivery

- Codex operates the project directly from the local workspace; the Devbox remains an optional remote development environment.
- GitHub repository: `tracyxiong1/creator-canvas` (private).
- `main` is the integrated baseline. Feature work is delivered through focused branches and Draft PRs.
- The shared command core is the only mutation implementation used by the CLI and browser studio.
- The Codex creation skill is the next consumer now that the CLI contract is available.

## Visual evidence

Reference products inform interaction anatomy only; brand, protected assets, private APIs, and runtime code are excluded. Product-owned desktop and compact QA baselines live under `docs/qa/`.

## Open decisions

- Export container and encoding behavior.
- Final product name and visual identity.

## Provider decision

The MVP provider boundary, routing precedence, local BYOK rules, deterministic
mock, and evidence-backed initial adapters are specified in
`docs/provider-contract.md`. The deterministic mock adapter is executable. Real
provider adapters remain a later BYOK integration milestone.
