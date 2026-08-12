# Creator Canvas architecture and canvas document v1

Status: MVP architecture decision for JIM-11.

The canvas document is the durable source of truth shared by the CLI, Codex
creation skill, and preview. The CLI is the only writer. The skill plans work
and invokes the CLI; it does not edit JSON itself. The preview reads the same
document and project-local assets; it does not run providers or receive
credentials.

This decision deliberately stops before scaffolding TypeScript packages or UI.
The machine-readable v1 contract is
`docs/schema/canvas-document-v1.schema.json`, with complete examples in
`docs/examples/`.

## Acceptance trace

| MVP requirement | Architecture decision |
| --- | --- |
| One model for CLI, skill, and preview | A versioned `canvas.json` is the only durable graph, execution, route, and asset metadata store. |
| Three-shot graph | `shot` nodes are ordered with `sequence` edges and feed a `composition` through `dependency` edges. |
| Targeted follow-up edits | Only the edited node and transitive `dependency` descendants become `dirty`; `sequence` edges never propagate invalidation. |
| Observable generation | Nodes expose current execution state while jobs retain attempt history and normalized provider state. |
| Restart-safe providers | The resolved route and provider job ID are persisted on the job before subsequent polling. |
| Durable assets | Provider artifacts are streamed into a project-local, content-addressed asset store before their metadata is committed. |
| BYOK isolation | Credentials remain process-local environment values and are forbidden from the document, assets, logs, and preview. |
| Small TypeScript implementation | One shared core package will own schema validation, mutations, persistence, routing, and jobs; the CLI and preview are thin consumers. |

## Decision and rejected alternatives

The repository will use a small npm workspace when implementation begins:

```text
package.json
packages/
  core/                 # schema/types, graph mutations, invalidation, storage, jobs
  cli/                  # first-party command surface; the only canvas writer
  preview/              # read-only standalone web app
skills/
  create-video/         # Codex instructions that invoke the CLI
```

`@creator-canvas/core` is the only shared TypeScript dependency. Splitting
schema, graph, persistence, providers, and jobs into separate packages would
add release and dependency overhead without creating an MVP deployment
boundary. A single application package would instead tempt the CLI and preview
to develop incompatible document models. A database or local server is also
unnecessary: the MVP has one local writer and a read-only preview.

The checked-in JSON Schema is canonical until `packages/core` exists. The core
package must expose a runtime validator and TypeScript types derived from this
contract; it must not maintain a second handwritten shape. Schema version 1 is
closed to unknown fields (`additionalProperties: false`). A future incompatible
shape requires a new integer `schemaVersion`, schema file, explicit migration,
and fixture. Readers must reject unsupported versions rather than guess.

## Document and identity rules

`canvas.json` contains:

- `schemaVersion`: the document format version, currently `1`.
- `revision`: a monotonically increasing optimistic-concurrency revision. Each
  successful CLI transaction increments it exactly once.
- `project`: stable project identity and display metadata.
- `nodes` and `edges`: the user-visible graph.
- `jobs`: normalized generation attempt records.
- `assets`: metadata for immutable local blobs.

All graph and attempt identities are lowercase, type-prefixed UUIDv7s generated
client-side: `project_<uuid>`, `node_<uuid>`, `edge_<uuid>`, and `job_<uuid>`.
They never depend on array position, label, path, or provider identity. Renaming
or moving a node preserves its ID. A retry creates a new job ID; a resumed poll
preserves the existing one because its job ID is the provider idempotency key.

Asset identity is content-derived:
`asset_sha256_<lowercase SHA-256 digest>`. Asset bytes are immutable, so equal
bytes deduplicate safely and replacing content always creates a new asset ID.
`checksumSha256` repeats the digest in conventional `sha256:<digest>` form for
integrity checks. Referential integrity, ID uniqueness, and asset-ID/checksum
agreement are semantic invariants checked by the core in addition to JSON
Schema validation.

Asset `origin` is either `{ kind: "job", jobId }` for generated/composed bytes
or `{ kind: "import" }` for user-supplied bytes copied into the asset store.
Origin is provenance only and does not affect content identity.

## Graph contract

Version 1 has two node kinds:

- `shot`: a generation request with a prompt, media kind, optional immutable
  asset inputs, normalized output requirements, and optional routing hints.
- `composition`: an exported video assembled from dependency inputs in shot
  sequence order.

Every node has presentation fields (`title`, `position`) and a `specRevision`.
Changing only presentation fields increments the document revision but does
not increment `specRevision` or invalidate generation. Changing `spec`
increments `specRevision` and triggers invalidation.

Edges are directed `sourceNodeId -> targetNodeId` and have distinct semantics:

- `dependency`: the target consumes the source's output. These edges form a
  DAG and propagate invalidation.
- `sequence`: the target shot follows the source shot. These edges define
  composition order but do not imply data dependency and do not propagate
  invalidation.

Duplicate `(kind, sourceNodeId, targetNodeId)` edges and self-edges are invalid.
Dependency edges must be acyclic; v1 dependency edges terminate at a
composition and sequence edges connect shots. For an exportable project, the
shots feeding a composition must form one unambiguous sequence chain;
disconnected or branching order is a validation error, not an invitation to
use array order.

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

## Fingerprints and targeted invalidation

The core computes each node's `inputFingerprint` as SHA-256 over canonical
UTF-8 JSON. Object keys are recursively sorted, array order is preserved, and
presentation fields, timestamps, execution state, and document revision are
excluded.

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

A mutation is one locked transaction:

1. Validate the requested patch and load the expected document revision.
2. Apply it in memory. For a spec edit, increment only that node's
   `specRevision`.
3. Find the affected set: the edited node plus all nodes reachable from it by
   outbound `dependency` edges. A presentation-only edit has an empty affected
   set.
4. Recompute fingerprints in dependency-topological order. Set every affected
   execution to `dirty`, remove `activeJobId`, and clear current
   `outputAssetIds`. Do not delete jobs or assets.
5. Validate the complete document, increment its revision once, update
   `project.updatedAt`, and atomically replace `canvas.json`.

If an invalidated provider attempt later completes, its job may be updated for
history and its blob may be materialized, but the result attaches to the node
only when both `activeJobId` and `inputFingerprint` still match. This prevents a
late response from overwriting a newer prompt.

For the acceptance edit, changing shot 2's prompt to include night increments
only shot 2's `specRevision`. Shot 2 and the composition become `dirty`; shots
1 and 3 retain their successful executions because sequence edges do not
propagate invalidation. `docs/examples/canvas-v1-shot2-night.json` demonstrates
that state while preserving the superseded shot-2 and composition jobs.

## Storage boundaries

The project directory is the persistence boundary:

```text
<project>/
  canvas.json                         # canonical metadata and graph
  assets/sha256/<digest>              # immutable generated/imported bytes
  .creator-canvas/lock                # transient single-writer lock
  .creator-canvas/tmp/                # transient same-filesystem writes/downloads
```

`canvas.json` stores only project-relative asset paths using `/` separators.
Absolute paths, `..` traversal, remote URLs, provider artifact locators,
authorization material, and signed URLs are invalid. Imported and generated
bytes are copied or streamed into `assets/` before the document references
them. The CLI verifies byte length and checksum on read/export.

Writes use a project-local lock and optimistic `revision` check. The CLI writes
and fsyncs a temporary file in `.creator-canvas/tmp/`, validates it, then
renames it over `canvas.json` on the same filesystem. A lock file and temporary
files are operational state, never document truth. The preview watches
`canvas.json`, reloads only after a successful parse/validation, and keeps its
last valid snapshot during a partial or rejected read.

Credentials are resolved from the selected provider's local environment
variable only inside the CLI immediately before adapter I/O. Credential values,
headers, provider response dumps, and secret-bearing URLs must never enter any
project file, fixture, error, log, or preview payload.

## Normative examples

`docs/examples/canvas-v1-three-shot.json` is a completed three-shot project:
three successful shot nodes, one successful composition, sequence edges for
order, dependency edges for data flow, normalized jobs, and content-addressed
assets.

`docs/examples/canvas-v1-shot2-night.json` is the result immediately after the
follow-up edit. It proves that:

- the document revision and shot 2 `specRevision` advance;
- shot 2 and the composition are dirty with new fingerprints;
- shots 1 and 3 remain succeeded with the same jobs and assets; and
- superseded jobs and asset provenance remain available but are not current.

## Verification criteria

The JIM-8 implementation must turn these into automated tests:

1. Both checked-in examples pass Draft 2020-12 schema validation.
2. Every ID is unique within its type, every reference resolves, and every
   asset ID agrees with its checksum and project-relative path.
3. Dependency and sequence graphs satisfy the invariants above.
4. Job and execution cross-field rules and allowed state transitions reject
   impossible states.
5. An edit with an incorrect document revision fails without changing disk.
6. A presentation-only edit changes no fingerprint or execution state.
7. Changing shot 2 to night dirties exactly shot 2 and the composition.
8. A stale provider completion cannot attach outputs to an invalidated node.
9. A same-filesystem atomic save is either wholly old or wholly new after a
   simulated interruption.
10. A document containing a credential value, absolute/traversing asset path,
    remote URL, unknown field, or unsupported schema version is rejected.

For this specification-only change, validation consists of parsing the schema
and examples, validating both examples with a Draft 2020-12 validator, checking
the targeted-invalidation assertions above, and running `git diff --check`.
