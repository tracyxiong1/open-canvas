---
name: open-canvas
description: Create, revise, inspect, and preview a project-local AI video creation canvas through the Open Canvas CLI. Use when a user wants a prompt turned into an editable video graph or asks to revise an existing Open Canvas project.
---

# Open Canvas

Use the repository's canonical CLI and document model to create or change an
editable video-creation graph. Keep the canvas project-local: characters,
scene/style direction, and imported media are nodes or local asset references,
not global libraries.

## Project boundary

- Locate the Open Canvas repository first. In this workspace it is the folder
  containing `packages/cli/bin/open-canvas.js` and `project.json` files belong
  in a separate user-selected project directory.
- Use `node <repo>/packages/cli/bin/open-canvas.js` after building Core and the
  CLI when their `dist` output is absent or stale. Do not hand-edit
  `project.json`; CLI mutations preserve validation, revisions, fingerprints,
  invalidation, and asset identity.
- A project may contain several drafts. Create a draft copy before a follow-up
  that should preserve the previous version.
- Do not create a global role, material, style, or history library. Use
  `character`, `scene-style`, and `asset-reference` composition nodes, and use
  `asset import` for bytes that belong to the current project.
- Use `group create --project <dir> --members <node-id,node-id,...>` only to
  organize two or more nodes within the active draft. A group is a local layout
  frame, not a role/material library, generation node, or cross-project asset.
- Never ask for, print, persist, or place provider API keys in commands,
  project data, prompts, source files, output, or logs. Credentials belong only
  in the user's local environment.

## Creation workflow

1. Turn the request into a short plan: story/script context when useful,
   character or scene context only when it materially improves consistency,
   image/video shots, and an output composition when the user needs an ordered
   result.
2. Create a project with `init` if no project exists. For an existing project,
   start with `status` and use its active draft and revisions.
3. Add nodes through `node add`. Use `--kind composition --role script`,
   `character`, `scene-style`, or `asset-reference` for editable context; use
   `--kind shot --media-kind image|video --prompt ...` for generative shots.
4. When a script should become a shot graph, run `script expand --project
   <dir> --node <script-node-id>`. It creates editable project-local video
   shots, a dependency from the script to each shot, and `sequence` edges
   between adjacent shots. Use `--prompt` only when the script node itself
   should be updated before the expansion; `--limit` is 1 through 8.
5. Connect other context or asset nodes to the shots they condition with
   `edge connect --kind dependency`. Connect selected shots to an output
   composition with dependency edges. Keep manual `sequence` edges only for
   shot ordering that differs from the script expansion result.
6. When a complex graph needs visual organization, create a local frame with
   `group create`; never group one node or create nested/cross-project groups.
7. Inspect `status` after meaningful mutations. Report the project directory,
   active draft, created or changed node IDs, and the next actionable step.

Use meaningful titles and concise prompts. Preserve explicit user constraints
such as aspect ratio, image candidate count, duration, audio, provider, or model. When those
constraints are absent, leave provider/model selection to the configured
routing layer rather than inventing a branded model choice.

## Media and variations

- Import user-provided local media with `asset import --project <dir> --file
  <path>`. Associate the returned asset ID with an `asset-reference` node or a
  shot's `--input-assets` field.
- For a revision such as “make shot 2 night”, run `draft copy`, update only the
  relevant node in the new draft, then inspect the affected subgraph. Do not
  alter the original draft unless the user explicitly asks to overwrite it.
- Use `open --no-open` to obtain a local Studio URL backed by a loopback bridge
  for that project. Start the Studio through the repository's preview command
  when a visible canvas is needed; the Studio's explicit Save control writes
  the current validated document back through the CLI persistence boundary.

## Generation boundary

Treat graph creation and provider generation as separate actions. Only run
`generate` when the user explicitly asks to generate or approves that external
provider work may start. Confirm the target node and draft before a paid or
remote generation action.

The checked-in CLI has these executable BYOK routes:

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
Use `--provider mock` only when an explicit deterministic local demo or test is
requested, and label the resulting media as mock output.

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
