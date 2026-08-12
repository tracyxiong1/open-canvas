# Creator Canvas MVP Context Pack

## Task summary

Build a new AI video creation product around an infinite canvas. Users create and revise videos from Codex with natural-language prompts. Each project owns one or more switchable drafts; every draft is an independent editable canvas, while generated and imported assets are shared by the project. A first-party CLI mutates the project document and invokes image/video providers with user-owned API keys. A standalone preview renders the selected draft's graph, job states, and generated assets.

## Confirmed scope

1. Codex creation skill.
2. First-party CLI.
3. Standalone infinite-canvas preview.

A Codex plugin is a later packaging and distribution step, not a separate MVP implementation.

## Core user loop

1. The user describes a video in Codex.
2. The skill plans a script and shot graph in a new or selected draft.
3. The CLI creates nodes and edges in that draft within the shared project document.
4. The routing layer selects a configured image or video provider unless the prompt overrides the strategy.
5. Jobs run with user-owned credentials.
6. The preview shows relationships, state, parameters, and assets.
7. A follow-up may copy a draft to create a variation, then updates only the affected subgraph in that draft.
8. The user exports an explicitly selected draft.

## Product rules

- Independent product: no LibTV runtime dependency or branding.
- BYOK only: secrets remain local and must never enter repository history or Multica server-side environment settings.
- AI-first routing: choose provider/model automatically, while accepting user prompt constraints.
- MVP canvas interaction: pan, zoom, node relationships, asset preview, generation state, and parameter details.
- Complex editing may remain prompt-driven in V1.
- Billing, subscriptions, quotas, and cost optimization are out of scope.

## Acceptance scenario

Given the prompt `Create a three-shot science-fiction short`, the system creates a main draft with a three-shot graph, invokes configured generation adapters, and displays outputs and progress. Given the follow-up `Change shot 2 to night`, it copies the main draft into a night variation, updates and regenerates only the affected shot and downstream dependencies in that variation, and leaves the main draft unchanged. The selected draft can then be exported.

## Environment and parallel delivery

- Two Multica Codex runtimes are used: the current Mac and `devbox-32c`.
- The Mac working copy is `/Users/xiongle/Documents/Codex/2026-08-07/you/work/creator-canvas`.
- The Devbox working copy is `/home/xiongle/workspace/creator-canvas`.
- Both copies exchange topic branches through the bare Git remote on Devbox; agents must not share or rewrite another task's branch.
- Devbox owns the shared core, persistence, provider jobs, and CLI work.
- The Mac owns preview UI and Codex Skill work. The Skill starts only after the CLI contract is available.
- Each task must commit and push its topic branch, then report the branch and commit in Multica. Integration is a separate lead-owned step.

## Visual evidence gate

Before implementing the preview UI, capture the authenticated LibTV canvas at desktop and mobile viewports, including core controls and representative states. Store sanitized evidence under `docs/references/`. The source is interaction reference only; do not copy brand or protected assets.

## Open decisions

- Export container and encoding behavior.
- Final product name and visual identity.

## Provider decision

The MVP provider boundary, routing precedence, local BYOK rules, deterministic
mock, and evidence-backed initial adapters are specified in
`docs/provider-contract.md`. Executable adapters remain pending until the shared
package foundation exists.
