# Creator Canvas MVP Context Pack

## Task summary

Build a new AI video creation product around an infinite canvas. Users create and revise videos from Codex with natural-language prompts. A first-party CLI mutates the canvas document and invokes image/video providers with user-owned API keys. A standalone preview renders the graph, job states, and generated assets.

## Confirmed scope

1. Codex creation skill.
2. First-party CLI.
3. Standalone infinite-canvas preview.

A Codex plugin is a later packaging and distribution step, not a separate MVP implementation.

## Core user loop

1. The user describes a video in Codex.
2. The skill plans a script and shot graph.
3. The CLI creates nodes and edges in the shared canvas document.
4. The routing layer selects a configured image or video provider unless the prompt overrides the strategy.
5. Jobs run with user-owned credentials.
6. The preview shows relationships, state, parameters, and assets.
7. A follow-up prompt updates only the affected subgraph.
8. The user exports the result.

## Product rules

- Independent product: no LibTV runtime dependency or branding.
- BYOK only: secrets remain local and must never enter repository history or Multica server-side environment settings.
- AI-first routing: choose provider/model automatically, while accepting user prompt constraints.
- MVP canvas interaction: pan, zoom, node relationships, asset preview, generation state, and parameter details.
- Complex editing may remain prompt-driven in V1.
- Billing, subscriptions, quotas, and cost optimization are out of scope.

## Acceptance scenario

Given the prompt `Create a three-shot science-fiction short`, the system creates a three-shot graph, invokes configured generation adapters, and displays outputs and progress. Given the follow-up `Change shot 2 to night`, it updates and regenerates only the affected shot and downstream dependencies. The project can then be exported.

## Environment

- Execution host: `devbox-32c`.
- Remote workspace: `/home/xiongle/workspace`.
- Node.js 22, npm 10, Git 2.39, Codex 0.147, Multica 0.4.22.
- Multica Agent tasks must bind to the remote Codex runtime named `Codex (devbox-32c)`.

## Visual evidence gate

Before implementing the preview UI, capture the authenticated LibTV canvas at desktop and mobile viewports, including core controls and representative states. Store sanitized evidence under `docs/references/`. The source is interaction reference only; do not copy brand or protected assets.

## Open decisions

- Persistence implementation.
- Export container and encoding behavior.
- Final product name and visual identity.

## Provider decision

The MVP provider boundary, routing precedence, local BYOK rules, deterministic
mock, and evidence-backed initial adapters are specified in
`docs/provider-contract.md`. Executable adapters remain pending until the shared
package foundation exists.
