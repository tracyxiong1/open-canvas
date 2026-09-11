# Open Canvas MVP Context Pack

## Task summary

Build a new AI video creation product around an infinite canvas. Users create and revise videos from Codex with natural-language prompts. Each project owns one or more switchable drafts; every draft is an independent editable canvas, while generated and imported assets are shared by the project. A first-party CLI mutates the project document and invokes image/video providers with user-owned API keys. A standalone React Flow studio renders and edits the selected draft through the same command core.

## Confirmed scope

The current node scope is text, image, video and audio (confirmed 2026-09-15).
Audio covers text-to-speech, project-local import, playback and export; music,
voice cloning and composition rendering are excluded. Legacy context roles
remain readable/editable but are hidden from creation menus. See
`docs/four-node-context.md` for the original gap inventory and acceptance scope.

1. Codex creation skill.
2. First-party CLI.
3. Standalone editable infinite-canvas studio.

A Codex plugin is a later packaging and distribution step, not a separate MVP implementation.

## Core user loop

1. The user asks Codex to create or revise the current canvas in natural language.
2. The skill chooses the smallest requested atomic operation (for example add,
   update, delete, connect, group, or revise a node), rather than imposing a
   script-to-shots workflow.
3. The CLI reads a semantic `context` projection before and after an edit when
   needed, then applies the operation to the shared project document and
   reports the affected project, draft, and node IDs.
4. The studio reflects CLI revisions automatically when it has no unsaved
   browser edits; otherwise it preserves those edits and presents an explicit
   choice to load the external revision.
5. Only when the user explicitly asks to generate does the routing layer select
   a configured image, video or speech provider and run a job with user-owned
   credentials.
6. A user may explicitly ask to expand a script, create a variation draft, or
   export a selected draft; none of those operations is a prerequisite for
   ordinary canvas editing.

## Product rules

- Independent product: no reference-product runtime dependency or branding.
- BYOK only: secrets remain local and must never enter repository history or server-side task metadata.
- AI-first routing: choose provider/model automatically, while accepting user prompt constraints.
- Conversation-first canvas: expose composable atomic operations to Codex;
  never force a story, script, shot-plan, or variation workflow before the
  user asks for it.
- Context-safe CLI: `context` exposes selected nodes, nearby relationships,
  referenced assets, and safe job state to the Skill without exposing local
  asset paths or credentials.
- MVP canvas interaction: pan, zoom, direct node movement, project-local group frames, typed node relationships, prompt editing, undo/redo, local JSON import/export, asset preview, generation state, and parameter details.
- Project-local resources only: characters, scene/style direction, and imported assets are reusable nodes or references inside one project; no global role, material, style, or history library is built.
- Complex editing may remain prompt-driven in V1.
- Billing, subscriptions, quotas, and cost optimization are out of scope.

## Acceptance scenario

Given `在当前画布增加一个雨夜城市的图片节点`, Codex creates only that
editable node and Studio shows it without a page reload. Given `把它改成清晨`,
Codex updates only that node and the canvas reflects the new prompt. If the user
asks to expand a script, create a variation, generate media, or export, Codex
performs that explicit operation and leaves unrelated nodes and drafts intact.

## Development and delivery

- Codex operates the project directly from the local workspace; the Devbox remains an optional remote development environment.
- GitHub repository: `tracyxiong1/open-canvas` (private).
- `main` is the integrated baseline. Feature work is delivered through focused branches and Draft PRs.
- The shared command core is the only mutation implementation used by the CLI and browser studio.
- The Codex creation skill source is `skills/open-canvas`. Install or link that
  folder under the local Codex skills directory to make it discoverable; the
  skill uses the same CLI and project document rather than a parallel data
  model.

## Visual evidence

Reference products inform interaction anatomy only; brand, protected assets, private APIs, and runtime code are excluded. Product-owned desktop and compact QA baselines live under `docs/qa/`.

## Open decisions

- Export container and encoding behavior.
- Final product name and visual identity.

## Provider decision

The MVP provider boundary, routing precedence, local BYOK rules, deterministic
mock, and evidence-backed initial adapters are specified in
docs/provider-contract.md. The local CLI reads a user-owned, non-secret
provider configuration when supplied, then executes direct Ark Seedream image
and Seedance video paths, OpenAI text/image-to-image, and Gemini Omni Flash
text/image-to-video using only the configured local credential environment
variables. The deterministic mock remains explicit-only for tests and local
demos; it is never the production fallback.
