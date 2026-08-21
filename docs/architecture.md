# Open Canvas architecture and draft-based project document v1

Status: implemented MVP architecture baseline.

The project document is the durable source of truth shared by the CLI, Codex
creation skill, and studio. A project owns one or more drafts; each draft is an
independent editable canvas with its own graph, jobs, and revision, while assets
are shared by the project. The CLI remains the filesystem writer. The skill
plans work and invokes the CLI; it does not edit JSON itself. `open` starts a
single-project loopback bridge so Studio can load the actual project, resolve
only its declared local assets, and explicitly save a revision-checked snapshot
back through the same atomic persistence boundary. The browser still uses the
shared command core for in-memory edits; it does not run providers or receive
credentials.

The machine-readable v1 contract is
`docs/schema/canvas-document-v1.schema.json`, with complete examples in
`docs/examples/`.

## Acceptance trace

| MVP requirement | Architecture decision |
| --- | --- |
| One model for CLI, skill, and studio | A versioned `project.json` contains project metadata, drafts, graph/job state, and shared asset metadata. |
| Draft-based creation | A project has one or more switchable drafts; each draft owns an independent canvas and may record the draft it was copied from. |
| Three-shot graph | Within a draft, `shot` nodes are ordered with `sequence` edges and feed a `composition` through `dependency` edges. |
| Script-to-shot graph | The shared `expandScriptIntoShots` mutation creates editable local video shots, script dependencies, and adjacent sequence edges in one revision-checked draft mutation. |
| Targeted follow-up edits | Only the edited node and transitive `dependency` descendants in the selected draft become `dirty`; other drafts are unchanged. |
| Observable generation | Nodes expose current execution state while jobs retain attempt history and normalized provider state. |
| Restart-safe providers | The resolved route and provider job ID are persisted on the job before subsequent polling. |
| Durable assets | Provider artifacts are streamed into a project-local, content-addressed asset store before their metadata is committed. |
| BYOK isolation | Credentials remain process-local environment values and are forbidden from the document, assets, logs, and studio. |
| Small TypeScript implementation | One shared core package owns schema validation, mutations, persistence, routing, and jobs; the CLI and studio are thin consumers. |

## Decision and rejected alternatives

The repository uses a small npm workspace:

```text
package.json
packages/
  core/                 # schema/types, graph mutations, invalidation, storage, jobs
  cli/                  # first-party command surface and filesystem writer
  preview/              # React Flow editor using the browser-safe core entry
skills/
  open-canvas/          # Codex instructions that invoke the CLI
```

`@open-canvas/core` is the only shared TypeScript dependency. Splitting
schema, graph, persistence, providers, and jobs into separate packages would
add release and dependency overhead without creating an MVP deployment
boundary. A single application package would instead tempt the CLI and studio
to develop incompatible document models. A database or local server is also
unnecessary: the MVP has one filesystem writer and an explicit local-file web
editing loop. A local project service may replace import/export later without
changing command semantics.

The checked-in JSON Schema is canonical. The core exposes a runtime validator
and generates TypeScript types from this contract; it does not maintain a
second handwritten shape. Schema version 1 is
closed to unknown fields (`additionalProperties: false`). A future incompatible
shape requires a new integer `schemaVersion`, schema file, explicit migration,
and fixture. Readers must reject unsupported versions rather than guess.

## Project, draft, and identity rules

`project.json` contains:

- `schemaVersion`: the document format version, currently `1`.
- `revision`: the project-wide optimistic-concurrency revision. Every successful
  command-core mutation increments it exactly once.
- `project`: stable project identity and display metadata.
- `activeDraftId`: the draft selected by default for CLI and studio commands.
- `drafts`: one or more independent editable canvases. A draft owns its
  `revision`, optional `sourceDraftId`, `nodes`, `edges`, and `jobs`.
- `assets`: project-shared metadata for immutable local blobs.

Project and draft identities are lowercase, type-prefixed UUIDv7s generated
client-side: `project_<uuid>` and `draft_<uuid>`. Node, edge, and job IDs use the
same rule inside a draft: `node_<uuid>`, `edge_<uuid>`, and `job_<uuid>`. Their
canonical address is `(draftId, localId)`, so local IDs need only be unique
inside their draft. They never depend on array position, label, path, or
provider identity. Renaming or moving a node preserves its ID. A retry creates
a new job ID; a resumed poll preserves the existing one because its job ID is
the provider idempotency key.

Copying a draft creates a fresh `draftId`, records `sourceDraftId`, and copies
the graph, job history, and current executions as a snapshot. Local node, edge,
and job IDs are preserved because the new draft is a separate namespace. This
lets unchanged nodes immediately reuse their valid project-shared output assets.
Queued or running executions are the exception: their jobs remain copied as
history, but the corresponding execution in the copy becomes `dirty` with no
active job because provider work belongs to the source draft. The copied draft
then evolves independently: an edit increments only its draft revision and
never mutates its source. Draft deletion and multi-level history navigation are
outside MVP scope.

CLI commands that mutate, generate, inspect status, preview, or export resolve
one draft. They accept an explicit draft ID; commands intended for interactive
use may default to `activeDraftId`. Export records and reports the selected
draft ID so two variations can never be confused.

Asset identity is content-derived:
`asset_sha256_<lowercase SHA-256 digest>`. Asset bytes are immutable, so equal
bytes deduplicate safely and replacing content always creates a new asset ID.
`checksumSha256` repeats the digest in conventional `sha256:<digest>` form for
integrity checks. Referential integrity, ID uniqueness, and asset-ID/checksum
agreement are semantic invariants checked by the core in addition to JSON
Schema validation.

Asset `origin` is `{ kind: "job", draftId, jobId }` for generated/composed
bytes or `{ kind: "import" }` for user-supplied bytes copied into the asset
store. When a node is explicitly deleted but a sibling draft still references
its immutable result, the origin becomes `{ kind: "deleted-job", draftId,
jobId }`; that preserves provenance without retaining a graph job whose node no
longer exists. The draft-qualified job address remains unambiguous after a
draft is copied. Origin is provenance only and does not affect content identity.

## Graph contract

Each draft in version 1 has two node kinds:

- `shot`: a generation request with a prompt, media kind, optional immutable
  asset inputs, normalized output requirements, and optional routing hints.
- `composition`: an exported video assembled from dependency inputs in shot
  sequence order. Its optional context roles (`text`, `smart-edit`, `director`,
  `frame-analysis`, `audio`, `script`, `asset-reference`, `character`, and
  `scene-style`) are durable project-scoped canvas prompt nodes: they store
  creative intent, accept incoming reference links, and are editable in the
  studio, but never submit a generation job. `asset-library` remains accepted
  only to read older v1 documents; new commands must not create it.

`composition.role = "group"` is the one layout-only composition role. A group
contains at least two current-draft `memberNodeIds`, has no Prompt, asset
references, edges, jobs, or output assets, and is never eligible for
generation. Its visible bounds are derived by Studio from its members rather
than treated as a second copy of their geometry. `createGroup` and `moveGroup`
are revision-checked Core mutations: the latter moves every member in one
atomic layout write. Deleting a member updates its frame membership or removes
the frame when fewer than two members remain. Groups cannot nest or share a
member in v1, which keeps every node's project-local layout ownership explicit.

A `script` context node may be expanded through the shared Core mutation. The
operation reads its line or sentence-oriented prompt, creates at most eight
ordinary video-shot nodes, adds a `dependency` edge from the script to every
new shot, and adds `sequence` edges between adjacent shots. Studio and the CLI
use the same operation; it does not create a global template, role, or material
record.

Every node has presentation fields (`title`, `position`) and a `specRevision`.
Changing only presentation fields increments the selected draft revision and
project revision but does not increment `specRevision` or invalidate
generation. A multi-node drag or accepted auto-arrange uses one `moveNodes`
layout mutation, and an explicit group-frame drag uses `moveGroup`, so each
complete coordinate set advances each revision once rather than persisting
card-by-card. Changing `spec` increments `specRevision` and triggers
invalidation inside that draft.

Edges are directed `sourceNodeId -> targetNodeId` and have distinct semantics:

- `dependency`: the target consumes the source's output. These edges form a
  DAG and propagate invalidation.
- `sequence`: the target shot follows the source shot. These edges define
  composition order but do not imply data dependency and do not propagate
  invalidation.

Edges and jobs cannot reference nodes from another draft. Duplicate `(kind,
sourceNodeId, targetNodeId)` edges and self-edges are invalid.
Dependency edges must be acyclic. Layout groups cannot participate in either
edge kind. A dependency may condition a shot with a
context node or an already-produced asset node, and may feed an output
composition. Sequence edges connect shots only. For an exportable project, the
output-producing nodes feeding a composition must form one unambiguous sequence
chain; disconnected or branching order is a validation error, not an invitation
to use array order.

## Execution and job states

Each node has one current `execution` projection and may have many historical
jobs. Its state machine is:

```text
dirty -> queued -> running -> succeeded
            |          |
            +----------+-> failed

succeeded | failed | queued | running -> dirty  (invalidation)
failed -> queued                             (new retry job)
```

`dirty` means no recorded output is valid for the node's current inputs.
`queued`, `running`, `succeeded`, and `failed` point to the current job through
`activeJobId`. A succeeded execution has at least one current output asset; all
other states have none. Starting work creates a new job, sets it as active, and
moves the node to `queued` in the same atomic transaction.

Jobs follow the provider contract's monotonic lifecycle:

```text
queued -> running -> succeeded
   |          |
   +----------+-> failed
```

A job records the input fingerprint, resolved non-secret route, timestamps,
progress, safe error, provider job ID, and output asset IDs. The route is
persisted before provider submission. The provider job ID is persisted before
the next poll. Progress is absent or in `0..1` and never decreases. Success has
outputs and no error; failure has one sanitized error and no outputs.

Historical jobs and assets are retained when superseded so the document can
explain provenance. They are not current merely because they succeeded.
Garbage collection and cancellation are outside MVP scope.

Explicit node deletion is different from invalidation: it removes that node,
its incident edges and jobs. Unreferenced assets produced only by those jobs are
removed from the document index; immutable assets that remain referenced by a
sibling draft are retained with `deleted-job` provenance.

A context-role composition stays `dirty`: it carries editable planning context
rather than an output asset, and `startGeneration` rejects it explicitly. This
keeps planning, editing, audio, script, and asset-reference surfaces on the
same document and graph surface without fabricating a provider job or an output
media artifact. Validation also forbids a context role from owning a historical
generation job or a non-`dirty` execution state.

## Fingerprints and targeted invalidation

The core computes each node's `inputFingerprint` as SHA-256 over canonical
UTF-8 JSON. Object keys are recursively sorted, array order is preserved, and
presentation fields, timestamps, execution state, project/draft IDs, and
revisions are excluded. Therefore an unchanged node keeps the same fingerprint
when its draft is copied and can safely reuse the same immutable output asset.

For a shot, the fingerprint input contains:

1. the schema version and node kind;
2. its complete `spec`; and
3. each input asset ID and checksum in the order listed by the spec.

For a composition, it contains:

1. the schema version and complete composition `spec`; and
2. each direct dependency's current fingerprint and output asset IDs, ordered
   by the validated `sequence` chain.

The exact pre-canonicalization payloads are:

```ts
type ShotFingerprintInput = {
  schemaVersion: 1;
  kind: "shot";
  spec: ShotSpec;
  inputAssets: Array<{ assetId: AssetId; checksumSha256: Sha256 }>;
};

type CompositionFingerprintInput = {
  schemaVersion: 1;
  kind: "composition";
  spec: CompositionSpec;
  dependencies: Array<{
    nodeId: NodeId;
    inputFingerprint: Sha256;
    outputAssetIds: AssetId[];
  }>;
};
```

Shot `inputAssets` follow `spec.inputAssetIds` order. Composition dependencies
follow the validated shot sequence, never node or edge array order. The checked-
in examples contain fingerprints produced from these payloads rather than
synthetic digest values.

A draft mutation is one locked project transaction:

1. Resolve the explicit `draftId` (or `activeDraftId` only when the command
   allows that default), validate the patch, and load the expected project and
   draft revisions.
2. Apply it in memory. For a spec edit, increment only that node's
   `specRevision` in the selected draft.
3. Find the affected set: the edited node plus all nodes reachable from it by
   outbound `dependency` edges. A presentation-only edit has an empty affected
   set.
4. Recompute fingerprints in dependency-topological order. Set every affected
   execution to `dirty`, remove `activeJobId`, and clear current
   `outputAssetIds`. Do not delete jobs or assets.
5. Validate the complete document, increment the selected draft revision and
   project revision once, update both timestamps, and atomically replace
   `project.json`. Composite actions such as script expansion may create
   several graph records in this same mutation. No other draft changes.

If an invalidated provider attempt later completes, its job may be updated for
history and its blob may be materialized, but the result attaches only to the
addressed draft and node when `draftId`, `activeJobId`, and `inputFingerprint`
all still match. This prevents a late response from overwriting a newer prompt
or attaching to a copied draft that shares the same local IDs.

For the acceptance edit, the CLI first copies the main draft to a night
variation and selects it. Changing shot 2's prompt increments only the copied
draft and shot 2's `specRevision`. Shot 2 and the composition become `dirty` in
the copy; shots 1 and 3 retain their successful executions because sequence
edges do not propagate invalidation. The main draft stays byte-for-byte
unchanged. `docs/examples/canvas-v1-shot2-night.json` demonstrates both drafts,
their lineage, shared assets, and the targeted invalidation.

## Storage boundaries

The project directory is the persistence boundary:

```text
<project>/
  project.json                        # project, drafts, graphs, jobs, asset metadata
  assets/sha256/<digest>              # immutable project-shared bytes
  .open-canvas/lock                # transient single-writer lock
  .open-canvas/tmp/                # transient same-filesystem writes/downloads
```

`project.json` stores only project-relative asset paths using `/` separators.
Absolute paths, `..` traversal, remote URLs, provider artifact locators,
authorization material, and signed URLs are invalid. Imported and generated
bytes are copied or streamed into `assets/` before the document references
them. The CLI verifies byte length and checksum on read/export.

Writes use a project-local lock plus project and selected-draft revision checks.
The CLI writes and fsyncs a temporary file in `.open-canvas/tmp/`, validates
it, then renames it over `project.json` on the same filesystem. A lock file and
temporary files are operational state, never document truth. The browser
studio may still import/export a selected JSON snapshot, or it may be opened by
the CLI bridge: that loopback service exposes only the selected validated
`project.json` and asset IDs already declared by it. A Studio save includes the
last persisted project revision; the bridge rejects conflicts, new asset bytes,
project-identity changes, and invalid documents before calling the same atomic
save. It never accepts arbitrary filesystem paths, directory listing requests,
or provider credentials.

Credentials are resolved from the selected provider's local environment
variable only inside the CLI immediately before adapter I/O. Credential values,
headers, provider response dumps, and secret-bearing URLs must never enter any
project file, fixture, error, log, or studio payload.

## Normative examples

`docs/examples/canvas-v1-three-shot.json` is a completed project with one main
draft: three successful shot nodes, one successful composition, sequence edges
for order, dependency edges for data flow, normalized jobs, and project-shared
content-addressed assets.

`docs/examples/canvas-v1-shot2-night.json` is the same project after copying the
main draft and applying the follow-up edit to the copy. It proves that:

- both the unchanged main draft and selected night variation coexist;
- the variation records `sourceDraftId`, while draft-local IDs remain scoped;
- only the project revision, copied draft revision, and shot 2 `specRevision`
  advance;
- shot 2 and the composition are dirty only in the copy;
- shots 1 and 3 remain succeeded with the same job snapshot and shared assets;
  and
- the source draft and asset provenance remain unchanged.

## Verification criteria

The JIM-8 implementation must turn these into automated tests:

1. Both checked-in examples pass Draft 2020-12 schema validation and contain at
   least one draft; `activeDraftId` and every `sourceDraftId` resolve.
2. Project/draft IDs are unique; graph/job IDs are unique within their draft;
   every draft-local reference resolves without crossing drafts; and every
   asset ID agrees with its checksum and project-relative path.
3. Dependency and sequence graphs satisfy the invariants above independently
   in every draft.
4. Job and execution cross-field rules and allowed state transitions reject
   impossible states.
5. An edit with an incorrect project or draft revision fails without changing
   disk.
6. A presentation-only edit changes no fingerprint or execution state.
7. Copying a draft preserves its valid execution snapshot and shared asset IDs,
   assigns a new draft ID, and leaves the source unchanged.
8. Changing shot 2 to night dirties exactly shot 2 and the composition in the
   copy; no node in the source draft changes.
9. A stale provider completion cannot attach outputs to an invalidated node or
   to a node with the same local ID in another draft.
10. A same-filesystem atomic save is either wholly old or wholly new after a
   simulated interruption.
11. A document containing a credential value, absolute/traversing asset path,
    remote URL, unknown field, or unsupported schema version is rejected.

For this specification-only change, `docs/schema/verify-examples.py` validates
the schema and examples, draft-local references and fingerprints, copy lineage,
source isolation, project-shared assets, and targeted invalidation. Repository
verification also runs `git diff --check`.
