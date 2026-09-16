---
name: open-canvas
description: Create, revise, inspect, and preview a project-local AI video creation canvas through the Open Canvas CLI. Use when a user wants a prompt turned into an editable video graph or asks to revise an existing Open Canvas project.
---

# Open Canvas

Use the canonical CLI and document model to create or change an
editable video-creation graph. Keep the canvas project-local: characters,
scene/style direction, and imported media are nodes or local asset references,
not global libraries.

Current creation scope: text, image, video and audio. Use a text context node
for new scripts, character descriptions or style direction instead of adding
specialized roles. Preserve all legacy roles when editing existing projects.

## Project boundary

- Start with `open-canvas --version` and `open-canvas --help`. A globally
  installed npm CLI works from any project directory without a source checkout.
  If the executable is missing, use an explicitly supplied local npm install
  or CLI path. For a source checkout, run `npm run build --workspace
  open-canvas-cli` there, then use `node <repo>/packages/cli/bin/open-canvas.js`.
  The public package is `open-canvas-cli`. If no CLI is installed,
  use `npm exec --yes --registry=https://registry.npmjs.org/
  --package=open-canvas-cli -- open-canvas <args>`.
- Keep `project.json` in the user-selected project directory. Do not hand-edit
  `project.json`; CLI mutations preserve validation, revisions, fingerprints,
  invalidation, and asset identity.
- A project may contain several drafts. Create a draft copy before a follow-up
  that should preserve the previous version.
- Do not create a global role, material, style, or history library. Use text
  nodes for reusable direction, and `asset import` for bytes that belong to
  the current project. Preserve legacy role nodes when editing older projects.
- Use `group create --project <dir> --members <node-id,node-id,...>` only to
  organize two or more nodes within the active draft. A group is a local layout
  frame, not a role/material library, generation node, or cross-project asset.
- Never ask for, print, persist, or place provider API keys in commands,
  project data, prompts, source files, output, or logs. Credentials belong only
  in the user's local environment.

## Conversation-first atomic workflow

Do not impose a script, shot plan, variation, or generation workflow before
the user requests one. Translate the current request into the smallest useful
project mutation, then leave the resulting canvas editable for the next turn.

1. Create a project with `init` only if there is no project. For an existing
   project, start with `context --project <dir>`. Use `--node <id> --depth 0..4`
   when the request concerns one node and its local graph; `status` is only a
   concise project-wide summary.
2. Apply only the requested atomic operation. Add editable context through
   `node add --kind composition --role text --prompt ...`,
   or a generative image/video node through `node add --kind shot --media-kind
   image|video|audio --prompt ...`. Use `node update`, `node delete`, `node move`,
   `node copy`, `edge connect`, `edge disconnect`, and `group create` only when
   the user asks for their corresponding change.
3. Run `script expand --project <dir> --node <script-node-id>` only when the
   user explicitly wants a script turned into shots. It creates editable
   project-local video shots, dependency edges from the script, and sequence
   edges between adjacent shots. `--limit` is 1 through 8.
4. Create a draft copy only when the user wants to preserve the current draft
   while exploring a variation. Otherwise update the requested node in place.
5. Inspect the affected result with `context` after meaningful mutations.
   Report the project directory, active draft, affected node IDs, and the
   visible result—without proposing a mandatory next workflow step. Context
   output is designed for the Skill: it contains semantic nodes, relationships,
   safe job state, and referenced asset metadata, but no filesystem paths or
   credentials.

When a Studio URL is open through `open --no-open`, CLI revisions propagate to
the clean browser canvas automatically. If the browser has unsaved edits, it
will preserve them and show an explicit **加载更新** action instead of
overwriting them.

Use meaningful titles and concise prompts. Preserve explicit user constraints
such as aspect ratio, image candidate count, duration, audio, provider, or model. When those
constraints are absent, leave provider/model selection to the configured
routing layer rather than inventing a branded model choice.

## Media and variations

- Import user-provided local media with `asset import --project <dir> --file
  <path>`. Associate the returned asset ID with an `asset-reference` node or a
  shot's `--input-assets` field.
- When Codex or another local agent has already produced a media file, record
  it as the visible, traceable output of a dirty image/video node with `result
  import --project <dir> --node <id> --file <path>`. This is distinct from
  `asset import`: it creates a successful job and output asset rather than a
  reusable input. Supply `--provider` and `--model` only as non-secret labels
  when provenance needs to be recorded.
- For a revision such as “make shot 2 night”, update only that node and inspect
  the affected subgraph. Use `draft copy` first when the user requests a variation
  or preservation of the original draft.
- Use `open --no-open` to obtain a local Studio URL backed by a loopback bridge
  for that project. The npm CLI does not include a Studio server: use an
  already-running local Studio with `--url`, or start the Studio through the repository's preview command
  when a visible canvas is needed; the Studio's explicit Save control writes
  the current validated document back through the CLI persistence boundary.

## Generation boundary

Audio nodes use `--media-kind audio` and literal speech text in `--prompt`.
Optional settings are `--voice coral`, `--speed 1` (0.25–4), and
`--media-type audio/wav` or `audio/mpeg`. Upstream text is spoken as plain text;
do not connect image/video references to a TTS node. The `openai-speech` adapter
uses `gpt-4o-mini-tts` and the local `OPENAI_API_KEY` environment variable.
Disclose generated speech as AI-generated; never present mock silence as TTS.

`asset import` accepts audio files as project-local assets. To display a local
recording on an audio node, use `result import`; its actual audio MIME type is
recorded on the node. Select an existing successful result with `result select
--project <dir> --node <id> --asset <asset-id>`. This preserves original jobs and
current prompt, invalidates downstream nodes, and uses the selected asset for
preview, downstream generation and export. It does not claim the old result
was generated with current settings. Editing the node clears this selection.

Calling `generate` again on a successful media node starts a new attempt while
keeping history. Speech is synchronous: an interrupted submitted request has
no remote polling handle and is not silently resubmitted on resume. Report the
uncertain completion and require a deliberate new attempt. Video jobs retain
their existing persisted-task polling behavior.

Treat graph creation and provider generation as separate actions. Only run
`generate` when the user explicitly asks to generate or approves that external
provider work may start. Confirm the target node and draft before a paid or
remote generation action.

The checked-in CLI has these executable BYOK routes. Users can supply a
non-secret provider configuration with `generate --provider-config <path>` or
`OPEN_CANVAS_PROVIDER_CONFIG`; use `provider list` to inspect the effective
safe metadata. The JSON config may select built-in adapters, stable provider
IDs, model/endpoint IDs, priority, and a credential environment-variable name.
It must never contain an API key or token.

- `volcengine-ark` / `doubao-seedream-5-0-260128`: direct image generation
  with project-local image references; and `doubao-seedance-2-5-260628`:
  video generation from text or one project-local first-frame image (4–30
  seconds). Both routes are enabled only when the user's local `ARK_API_KEY`
  environment variable is already configured. A user may point either route
  at their own public Ark model/endpoint identifier with the non-secret
  `OPEN_CANVAS_ARK_IMAGE_MODEL` or `OPEN_CANVAS_ARK_VIDEO_MODEL` environment
  setting. Do not ask for or display any of these values.

- `openai` / `gpt-image-2`: text-to-image and project-local image-reference
  generation/editing, enabled only when the user's local `OPENAI_API_KEY`
  environment variable is already configured. Image shots may use `--count`
  `1`, `2`, or `4`; each returned candidate remains an output of that project
  node rather than entering a global material library.
- `google-gemini` / `gemini-omni-flash-preview`: text-to-video and
  image-to-video, enabled only when the user's local `GEMINI_API_KEY`
  environment variable is already configured.

Never request either value in chat. If the required variable is absent, report
only its variable name and leave the node dirty. By default the router chooses
an eligible configured real provider; it never silently falls back to mock.
Set `--provider mock` on `node add/update` only when an explicit deterministic local demo or test is
requested, and label the resulting media as mock output.
`generate` uses the node's saved routing: set provider/model overrides through
`node add/update`, not flags on `generate`.

The current CLI does not render a composition node into a final edited video.
Generate and export an individual shot until the local composition renderer is
implemented.

## Failure handling

- If a CLI command reports a revision conflict, run `status`, re-evaluate the
  user's intended target, and retry only the intended mutation with current
  revisions.
- If a requested file is not local or cannot be imported, ask the user for a
  local path instead of fabricating an asset reference.
- If a requested generation route cannot satisfy an explicit provider/model
  override, report the safe routing error and offer to revise the constraint.
