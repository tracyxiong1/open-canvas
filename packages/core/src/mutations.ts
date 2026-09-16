import { v7 as uuidv7 } from "uuid";

import { canonicalSha256 } from "./canonical.js";
import type {
  Asset,
  CompositionSpec,
  OpenCanvasDraftBasedProjectDocumentV1 as CanvasDocument,
  Draft,
  Node,
  Position,
  ShotSpec,
} from "./canvas-document.generated.js";
import { computeNodeFingerprint, isLayoutGroup, parseCanvasDocument } from "./validation.js";
import { invalidateDependencyClosure } from "./graph.js";
import {
  buildScriptShotConnections,
  splitScriptIntoShotPrompts,
  type ScriptShotPositionContext,
} from "./script-shots.js";

export class RevisionConflictError extends Error {
  constructor(scope: "project" | "draft", expected: number, actual: number) {
    super(`${scope} revision conflict: expected ${expected}, found ${actual}`);
    this.name = "RevisionConflictError";
  }
}

type NodeSpec = ShotSpec | CompositionSpec;

function isEditableContextNode(node: Node): boolean {
  return node.spec.kind === "composition"
    && node.spec.role !== undefined
    && node.spec.role !== "composition"
    && node.spec.role !== "group";
}

function id(prefix: "project" | "draft" | "node" | "edge" | "job"): string {
  return `${prefix}_${uuidv7()}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function now(value?: string): string {
  return value ?? new Date().toISOString();
}

function assertRevision(actual: number, expected: number, scope: "project" | "draft"): void {
  if (actual !== expected) throw new RevisionConflictError(scope, expected, actual);
}

export interface CreateProjectOptions {
  title: string;
  projectId?: string;
  draftId?: string;
  draftTitle?: string;
  now?: string;
}

export function createProject(options: CreateProjectOptions): CanvasDocument {
  const timestamp = now(options.now);
  const draftId = options.draftId ?? id("draft");
  const document: CanvasDocument = {
    schemaVersion: 1,
    revision: 0,
    project: {
      id: options.projectId ?? id("project"),
      title: options.title,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    activeDraftId: draftId,
    drafts: [{
      id: draftId,
      title: options.draftTitle ?? "Main",
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      nodes: [],
      edges: [],
      jobs: [],
    }],
    assets: [],
  };
  return parseCanvasDocument(document);
}

function prepareMutation(
  input: CanvasDocument,
  draftId: string,
  expectedProjectRevision: number,
  expectedDraftRevision: number,
): { document: CanvasDocument; draft: Draft } {
  assertRevision(input.revision, expectedProjectRevision, "project");
  const document = clone(input);
  const draft = document.drafts.find((candidate) => candidate.id === draftId);
  if (!draft) throw new Error(`Unknown draft: ${draftId}`);
  assertRevision(draft.revision, expectedDraftRevision, "draft");
  return { document, draft };
}

function finishMutation(document: CanvasDocument, draft: Draft, timestamp: string): CanvasDocument {
  draft.revision += 1;
  draft.updatedAt = timestamp;
  document.revision += 1;
  document.project.updatedAt = timestamp;
  return parseCanvasDocument(document);
}

function finishProjectMutation(document: CanvasDocument, timestamp: string): CanvasDocument {
  document.revision += 1;
  document.project.updatedAt = timestamp;
  return parseCanvasDocument(document);
}

function referencedAssetIds(document: CanvasDocument): Set<string> {
  const references = new Set<string>();
  for (const draft of document.drafts) {
    for (const node of draft.nodes) {
      for (const assetId of node.execution.outputAssetIds) references.add(assetId);
      if (node.spec.kind === "shot") {
        for (const assetId of node.spec.inputAssetIds) references.add(assetId);
      } else {
        for (const assetId of node.spec.referenceAssetIds ?? []) references.add(assetId);
      }
    }
    for (const job of draft.jobs) {
      for (const assetId of job.outputAssetIds) references.add(assetId);
    }
  }
  return references;
}

export interface RegisterImportedAssetOptions {
  expectedProjectRevision: number;
  kind: "image" | "video" | "audio";
  mediaType: string;
  byteLength: number;
  checksumSha256: string;
  now?: string;
}

/**
 * Registers immutable, content-addressed bytes that have already been copied
 * into the local asset store. The command core deliberately receives metadata
 * rather than bytes so the browser-safe mutation layer never handles files or
 * credentials. Re-importing the same digest is idempotent.
 */
export function registerImportedAsset(
  input: CanvasDocument,
  options: RegisterImportedAssetOptions,
): { document: CanvasDocument; asset: Asset; created: boolean } {
  assertRevision(input.revision, options.expectedProjectRevision, "project");
  const digest = options.checksumSha256.match(/^sha256:([0-9a-f]{64})$/)?.[1];
  if (!digest) throw new Error("Imported asset checksum must be a lowercase sha256 digest");
  if (!Number.isSafeInteger(options.byteLength) || options.byteLength <= 0) {
    throw new Error("Imported asset byteLength must be a positive integer");
  }
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(options.mediaType)) {
    throw new Error("Imported asset mediaType must be a MIME type");
  }

  const id = `asset_sha256_${digest}`;
  const existing = input.assets.find((asset) => asset.id === id);
  if (existing) return { document: input, asset: clone(existing), created: false };

  const document = clone(input);
  const timestamp = now(options.now);
  const asset: Asset = {
    id,
    kind: options.kind,
    mediaType: options.mediaType,
    byteLength: options.byteLength,
    checksumSha256: options.checksumSha256,
    path: `assets/sha256/${digest}`,
    origin: { kind: "import" },
    createdAt: timestamp,
  };
  document.assets.push(asset);
  const nextDocument = finishProjectMutation(document, timestamp);
  return {
    document: nextDocument,
    asset: clone(nextDocument.assets.find((candidate) => candidate.id === id)!),
    created: true,
  };
}

export interface AddNodeOptions {
  draftId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  title: string;
  spec: NodeSpec;
  position?: { x: number; y: number };
  nodeId?: string;
  now?: string;
}

export function addNode(input: CanvasDocument, options: AddNodeOptions): CanvasDocument {
  const { document, draft } = prepareMutation(
    input,
    options.draftId,
    options.expectedProjectRevision,
    options.expectedDraftRevision,
  );
  const node: Node = {
    id: options.nodeId ?? id("node"),
    title: options.title,
    position: options.position ?? { x: 0, y: 0 },
    specRevision: 1,
    spec: clone(options.spec),
    execution: { status: "dirty", inputFingerprint: "sha256:" + "0".repeat(64), outputAssetIds: [] },
  };
  draft.nodes.push(node);
  node.execution.inputFingerprint = computeNodeFingerprint(document, draft, node);
  return finishMutation(document, draft, now(options.now));
}

function groupMemberNodeIds(node: Node): string[] {
  return isLayoutGroup(node) ? [...(node.spec.memberNodeIds ?? [])] : [];
}

function defaultGroupTitle(memberCount: number): string {
  return `分组 ${memberCount} 个节点`;
}

function updateLayoutGroupAnchor(draft: Draft, group: Node): void {
  const members = groupMemberNodeIds(group)
    .map((memberId) => draft.nodes.find((node) => node.id === memberId))
    .filter((node): node is Node => node !== undefined);
  if (members.length === 0) return;
  group.position = {
    x: Math.min(...members.map((node) => node.position.x)),
    y: Math.min(...members.map((node) => node.position.y)),
  };
}

function refreshLayoutGroupFingerprint(document: CanvasDocument, draft: Draft, group: Node): void {
  group.execution = {
    status: "dirty",
    inputFingerprint: computeNodeFingerprint(document, draft, group),
    outputAssetIds: [],
  };
}

export interface NodeOutputOptions {
  draftId: string;
  nodeId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  now?: string;
}

/** Select an immutable historical output without rewriting the generation record. */
export function selectNodeOutput(input: CanvasDocument, options: NodeOutputOptions & { assetId: string }): CanvasDocument {
  const { document, draft } = prepareMutation(input, options.draftId, options.expectedProjectRevision, options.expectedDraftRevision);
  const node = draft.nodes.find((candidate) => candidate.id === options.nodeId);
  const asset = document.assets.find((candidate) => candidate.id === options.assetId);
  if (!node || node.spec.kind !== "shot" || !asset || asset.kind !== node.spec.mediaKind
    || !draft.jobs.some((job) => job.nodeId === node.id && job.status === "succeeded" && job.outputAssetIds.includes(asset.id))) {
    throw new Error("Selected output must be a compatible successful result of this node");
  }
  if (node.execution.status === "queued" || node.execution.status === "running") throw new Error("Wait for the active generation before selecting an output");
  node.execution.selectedOutputAssetId = asset.id;
  invalidateDependencyClosure(document, draft, [node.id], false);
  return finishMutation(document, draft, now(options.now));
}

export function resetNodeGeneration(input: CanvasDocument, options: NodeOutputOptions): CanvasDocument {
  const { document, draft } = prepareMutation(input, options.draftId, options.expectedProjectRevision, options.expectedDraftRevision);
  const node = draft.nodes.find((candidate) => candidate.id === options.nodeId);
  if (!node || node.spec.kind !== "shot") throw new Error("Only media nodes can be regenerated");
  if (node.execution.status === "queued" || node.execution.status === "running") throw new Error("An active generation is already resumable");
  invalidateDependencyClosure(document, draft, [node.id], true);
  return finishMutation(document, draft, now(options.now));
}

export interface CreateGroupOptions {
  draftId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  memberNodeIds: string[];
  title?: string;
  nodeId?: string;
  now?: string;
}

/**
 * Creates a durable layout-only frame around project-local nodes. The frame
 * contains membership but no copied cards, edges, jobs, or external assets;
 * every surface therefore observes the same grouping through the document.
 */
export function createGroup(input: CanvasDocument, options: CreateGroupOptions): CanvasDocument {
  const { document, draft } = prepareMutation(
    input,
    options.draftId,
    options.expectedProjectRevision,
    options.expectedDraftRevision,
  );
  const memberNodeIds = [...options.memberNodeIds];
  if (memberNodeIds.length < 2) throw new Error("A group requires at least two nodes");
  if (new Set(memberNodeIds).size !== memberNodeIds.length) throw new Error("A group cannot repeat a member node");

  const members = memberNodeIds.map((memberNodeId) => {
    const node = draft.nodes.find((candidate) => candidate.id === memberNodeId);
    if (!node) throw new Error(`Unknown group member: ${memberNodeId}`);
    if (isLayoutGroup(node)) throw new Error(`A group cannot contain another group: ${memberNodeId}`);
    return node;
  });
  const existingMembership = new Map<string, string>();
  for (const candidate of draft.nodes) {
    if (!isLayoutGroup(candidate)) continue;
    for (const memberNodeId of groupMemberNodeIds(candidate)) {
      existingMembership.set(memberNodeId, candidate.id);
    }
  }
  for (const memberNodeId of memberNodeIds) {
    const existingGroupId = existingMembership.get(memberNodeId);
    if (existingGroupId) throw new Error(`Node ${memberNodeId} already belongs to group ${existingGroupId}`);
  }

  const group: Node = {
    id: options.nodeId ?? id("node"),
    title: options.title?.trim() || defaultGroupTitle(memberNodeIds.length),
    position: {
      x: Math.min(...members.map((node) => node.position.x)),
      y: Math.min(...members.map((node) => node.position.y)),
    },
    specRevision: 1,
    spec: {
      kind: "composition",
      mediaType: "application/json",
      role: "group",
      memberNodeIds: memberNodeIds as [string, string, ...string[]],
    },
    execution: { status: "dirty", inputFingerprint: "sha256:" + "0".repeat(64), outputAssetIds: [] },
  };
  draft.nodes.push(group);
  group.execution.inputFingerprint = computeNodeFingerprint(document, draft, group);
  return finishMutation(document, draft, now(options.now));
}

export interface ConnectNodesOptions {
  draftId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  kind: "dependency" | "sequence";
  sourceNodeId: string;
  targetNodeId: string;
  edgeId?: string;
  now?: string;
}

export function connectNodes(input: CanvasDocument, options: ConnectNodesOptions): CanvasDocument {
  const { document, draft } = prepareMutation(input, options.draftId, options.expectedProjectRevision, options.expectedDraftRevision);
  draft.edges.push({
    id: options.edgeId ?? id("edge"),
    kind: options.kind,
    sourceNodeId: options.sourceNodeId,
    targetNodeId: options.targetNodeId,
  });
  invalidateDependencyClosure(document, draft, [options.targetNodeId], true);
  return finishMutation(document, draft, now(options.now));
}

function scriptContextNode(draft: Draft, scriptNodeId: string): Node {
  const node = draft.nodes.find((candidate) => candidate.id === scriptNodeId);
  if (!node || node.spec.kind !== "composition" || node.spec.role !== "script") {
    throw new Error("Script expansion requires a script context node");
  }
  return node;
}

function defaultScriptShotPosition(scriptNode: Node, index: number, shotCount: number): Position {
  return {
    x: scriptNode.position.x + 300,
    y: scriptNode.position.y + (index - (shotCount - 1) / 2) * 156,
  };
}

export interface ExpandScriptIntoShotsOptions {
  draftId: string;
  scriptNodeId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  /** An optional edited script value to persist before creating its shots. */
  prompt?: string;
  limit?: number;
  /**
   * Studio may supply collision-aware positions. The CLI uses the deterministic
   * fallback so the same action remains available without a browser layout.
   */
  positionForShot?: (context: ScriptShotPositionContext) => Position;
  now?: string;
}

export interface ExpandScriptIntoShotsResult {
  document: CanvasDocument;
  scriptNodeId: string;
  shotNodeIds: string[];
  shotPrompts: string[];
}

/**
 * Create an editable project-local video-shot chain from one script node.
 * One expansion is one document mutation: it uses a single revision check and
 * revision increment even though it creates several nodes and edges. Studio,
 * CLI, and the Codex skill therefore share the same graph shape and mutation
 * boundary.
 */
export function expandScriptIntoShots(
  input: CanvasDocument,
  options: ExpandScriptIntoShotsOptions,
): ExpandScriptIntoShotsResult {
  const { document, draft } = prepareMutation(
    input,
    options.draftId,
    options.expectedProjectRevision,
    options.expectedDraftRevision,
  );
  const scriptNode = scriptContextNode(draft, options.scriptNodeId);
  const scriptPrompt = (options.prompt ?? scriptNode.spec.prompt ?? "").trim();
  const shotPrompts = splitScriptIntoShotPrompts(scriptPrompt, options.limit);
  if (shotPrompts.length === 0) throw new Error("Script content must contain at least one shot prompt");

  const scriptChanged = scriptNode.spec.prompt !== scriptPrompt;
  if (scriptChanged) {
    scriptNode.spec = { ...scriptNode.spec, prompt: scriptPrompt };
    scriptNode.specRevision += 1;
  }

  const existingVideoCount = draft.nodes.filter(
    (node) => node.spec.kind === "shot" && node.spec.mediaKind === "video",
  ).length;
  const shotNodeIds: string[] = [];
  for (const [index, prompt] of shotPrompts.entries()) {
    const position = options.positionForShot?.({
      draft,
      scriptNode,
      index,
      shotCount: shotPrompts.length,
    }) ?? defaultScriptShotPosition(scriptNode, index, shotPrompts.length);
    const node: Node = {
      id: id("node"),
      title: `镜头 ${existingVideoCount + index + 1}`,
      position,
      specRevision: 1,
      spec: {
        kind: "shot",
        prompt,
        mediaKind: "video",
        inputAssetIds: [],
        requirements: {
          aspectRatio: "16:9",
          audio: "either",
          mediaType: "video/mp4",
        },
      },
      execution: { status: "dirty", inputFingerprint: "sha256:" + "0".repeat(64), outputAssetIds: [] },
    };
    draft.nodes.push(node);
    node.execution.inputFingerprint = computeNodeFingerprint(document, draft, node);
    shotNodeIds.push(node.id);
  }

  for (const connection of buildScriptShotConnections(scriptNode.id, shotNodeIds)) {
    draft.edges.push({
      id: id("edge"),
      ...connection,
    });
  }

  // New shot fingerprints must include the script dependency. A prompt update
  // also invalidates pre-existing descendants of the script; simply adding a
  // new branch leaves those existing results intact.
  invalidateDependencyClosure(
    document,
    draft,
    scriptChanged ? [scriptNode.id] : shotNodeIds,
    true,
  );
  const nextDocument = finishMutation(document, draft, now(options.now));
  return {
    document: nextDocument,
    scriptNodeId: scriptNode.id,
    shotNodeIds,
    shotPrompts,
  };
}

export interface DisconnectEdgeOptions {
  draftId: string;
  edgeId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  now?: string;
}

export function disconnectEdge(input: CanvasDocument, options: DisconnectEdgeOptions): CanvasDocument {
  const { document, draft } = prepareMutation(
    input,
    options.draftId,
    options.expectedProjectRevision,
    options.expectedDraftRevision,
  );
  const edgeIndex = draft.edges.findIndex((edge) => edge.id === options.edgeId);
  if (edgeIndex === -1) throw new Error(`Unknown edge: ${options.edgeId}`);
  const targetNodeId = draft.edges[edgeIndex]!.targetNodeId;
  draft.edges.splice(edgeIndex, 1);
  invalidateDependencyClosure(document, draft, [targetNodeId], true);
  return finishMutation(document, draft, now(options.now));
}

export interface DeleteNodeOptions {
  draftId: string;
  nodeId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  now?: string;
}

/**
 * Removes one canvas node together with all graph records that cannot outlive
 * it. Imported and generated assets intentionally remain project-local: they
 * may be referenced by another draft or restored by undo, and can be garbage
 * collected by a future explicit asset-cleanup command.
 */
export function deleteNode(input: CanvasDocument, options: DeleteNodeOptions): CanvasDocument {
  const { document, draft } = prepareMutation(
    input,
    options.draftId,
    options.expectedProjectRevision,
    options.expectedDraftRevision,
  );
  const node = draft.nodes.find((candidate) => candidate.id === options.nodeId);
  if (!node) throw new Error(`Unknown node: ${options.nodeId}`);

  // Removing either a dependency or a sequence input changes the direct
  // target's executable plan. Remember those targets before pruning edges,
  // then invalidate each surviving target and its dependency descendants.
  const affectedTargetNodeIds = [...new Set(
    draft.edges
      .filter((edge) => edge.sourceNodeId === node.id && edge.targetNodeId !== node.id)
      .map((edge) => edge.targetNodeId),
  )];
  const deletedJobIds = new Set(
    draft.jobs.filter((job) => job.nodeId === node.id).map((job) => job.id),
  );
  draft.nodes = draft.nodes.filter((candidate) => candidate.id !== node.id);
  draft.edges = draft.edges.filter(
    (edge) => edge.sourceNodeId !== node.id && edge.targetNodeId !== node.id,
  );
  draft.jobs = draft.jobs.filter((job) => !deletedJobIds.has(job.id));

  // A group is a layout frame, not an independent copy of its members. Keep
  // it truthful when a member disappears: update the remaining membership,
  // or remove the frame when fewer than two cards remain. This happens in the
  // same mutation as node deletion so loading the saved document can never
  // observe a dangling group reference.
  const removedGroupIds = new Set<string>();
  const updatedGroups: Node[] = [];
  for (const candidate of draft.nodes) {
    if (!isLayoutGroup(candidate)) continue;
    const currentMembers = groupMemberNodeIds(candidate);
    const nextMembers = currentMembers.filter((memberNodeId) => memberNodeId !== node.id);
    if (nextMembers.length === currentMembers.length) continue;
    if (nextMembers.length < 2) {
      removedGroupIds.add(candidate.id);
      continue;
    }
    candidate.spec = { ...candidate.spec, memberNodeIds: nextMembers as [string, string, ...string[]] };
    // Only a generated title tracks membership. A user-supplied group name is
    // intentional project content and must survive member edits unchanged.
    if (candidate.title === defaultGroupTitle(currentMembers.length)) {
      candidate.title = defaultGroupTitle(nextMembers.length);
    }
    candidate.specRevision += 1;
    updateLayoutGroupAnchor(draft, candidate);
    updatedGroups.push(candidate);
  }
  if (removedGroupIds.size > 0) {
    draft.nodes = draft.nodes.filter((candidate) => !removedGroupIds.has(candidate.id));
    draft.edges = draft.edges.filter(
      (edge) => !removedGroupIds.has(edge.sourceNodeId) && !removedGroupIds.has(edge.targetNodeId),
    );
    draft.jobs = draft.jobs.filter((job) => !removedGroupIds.has(job.nodeId));
  }
  for (const group of updatedGroups) refreshLayoutGroupFingerprint(document, draft, group);

  if (affectedTargetNodeIds.length > 0) {
    invalidateDependencyClosure(document, draft, affectedTargetNodeIds, true);
  }

  // A document asset cannot retain a live job origin after that job is gone.
  // Drop unreferenced generated bytes from the document index; if a sibling
  // draft still uses the bytes, retain the immutable asset with explicit
  // deleted-job provenance instead of silently pretending it was imported.
  const stillReferenced = referencedAssetIds(document);
  document.assets = document.assets.flatMap((asset) => {
    if (
      asset.origin.kind !== "job"
      || asset.origin.draftId !== draft.id
      || !deletedJobIds.has(asset.origin.jobId)
    ) {
      return [asset];
    }
    if (!stillReferenced.has(asset.id)) return [];
    return [{
      ...asset,
      origin: {
        kind: "deleted-job" as const,
        draftId: asset.origin.draftId,
        jobId: asset.origin.jobId,
      },
    }];
  });
  return finishMutation(document, draft, now(options.now));
}

export interface UpdateNodeOptions {
  draftId: string;
  nodeId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  title?: string;
  position?: { x: number; y: number };
  prompt?: string;
  spec?: NodeSpec;
  now?: string;
}

export function updateNode(input: CanvasDocument, options: UpdateNodeOptions): CanvasDocument {
  const { document, draft } = prepareMutation(input, options.draftId, options.expectedProjectRevision, options.expectedDraftRevision);
  const node = draft.nodes.find((candidate) => candidate.id === options.nodeId);
  if (!node) throw new Error(`Unknown node: ${options.nodeId}`);
  const canUpdatePrompt = node.spec.kind === "shot" || isEditableContextNode(node);
  if (options.prompt !== undefined && !canUpdatePrompt) {
    throw new Error("Prompt updates apply only to shot and editable context nodes");
  }
  if (options.title !== undefined) node.title = options.title;
  if (options.position !== undefined) node.position = clone(options.position);
  const nextSpec = options.spec ?? (options.prompt !== undefined && canUpdatePrompt
    ? { ...node.spec, prompt: options.prompt }
    : undefined);
  if (nextSpec !== undefined) {
    node.spec = clone(nextSpec);
    node.specRevision += 1;
    invalidateDependencyClosure(document, draft, [node.id], true);
  }
  return finishMutation(document, draft, now(options.now));
}

export interface MoveNodesOptions {
  draftId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  updates: Array<{ nodeId: string; position: Position }>;
  now?: string;
}

/**
 * Persists a gesture-level layout update as one revision. A multi-node drag
 * and an accepted auto-arrange operation are each one user action, so they
 * must not leave a partially persisted layout or consume one revision per
 * card. Layout-only mutations deliberately preserve specs, fingerprints, and
 * execution state.
 */
export function moveNodes(input: CanvasDocument, options: MoveNodesOptions): CanvasDocument {
  const { document, draft } = prepareMutation(
    input,
    options.draftId,
    options.expectedProjectRevision,
    options.expectedDraftRevision,
  );
  if (options.updates.length === 0) throw new Error("Move operation requires at least one node");

  const movedNodeIds = new Set<string>();
  for (const { nodeId, position } of options.updates) {
    if (movedNodeIds.has(nodeId)) throw new Error(`Duplicate node position update: ${nodeId}`);
    movedNodeIds.add(nodeId);
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new Error(`Node position must contain finite coordinates: ${nodeId}`);
    }
    const node = draft.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);
    if (isLayoutGroup(node)) throw new Error(`Move a group through moveGroup: ${nodeId}`);
    node.position = clone(position);
  }
  // Frames derive their visible bounds from member cards, but their persisted
  // anchor should remain truthful as well. This matters after an individual
  // member is repositioned (rather than dragging the frame): subsequent CLI
  // inspection, copying and a later frame drag all observe the same origin.
  for (const group of draft.nodes.filter(isLayoutGroup)) {
    if (groupMemberNodeIds(group).some((memberNodeId) => movedNodeIds.has(memberNodeId))) {
      updateLayoutGroupAnchor(draft, group);
    }
  }
  return finishMutation(document, draft, now(options.now));
}

export interface MoveGroupOptions {
  draftId: string;
  groupNodeId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  delta: Position;
  now?: string;
}

/**
 * Moves every member of a layout group together as one gesture. It is a
 * single revision-checked write, just like a multi-card drag, and leaves
 * generation inputs, fingerprints, and outputs untouched.
 */
export function moveGroup(input: CanvasDocument, options: MoveGroupOptions): CanvasDocument {
  const { document, draft } = prepareMutation(
    input,
    options.draftId,
    options.expectedProjectRevision,
    options.expectedDraftRevision,
  );
  if (!Number.isFinite(options.delta.x) || !Number.isFinite(options.delta.y)) {
    throw new Error("Group move delta must contain finite coordinates");
  }
  const group = draft.nodes.find((candidate) => candidate.id === options.groupNodeId);
  if (!group || !isLayoutGroup(group)) throw new Error(`Unknown layout group: ${options.groupNodeId}`);
  const members = groupMemberNodeIds(group).map((memberNodeId) => {
    const member = draft.nodes.find((candidate) => candidate.id === memberNodeId);
    if (!member) throw new Error(`Unknown group member: ${memberNodeId}`);
    return member;
  });
  for (const member of members) {
    member.position = {
      x: member.position.x + options.delta.x,
      y: member.position.y + options.delta.y,
    };
  }
  group.position = {
    x: group.position.x + options.delta.x,
    y: group.position.y + options.delta.y,
  };
  return finishMutation(document, draft, now(options.now));
}

export interface CopyDraftOptions {
  sourceDraftId: string;
  title: string;
  expectedProjectRevision: number;
  draftId?: string;
  now?: string;
}

export function copyDraft(input: CanvasDocument, options: CopyDraftOptions): CanvasDocument {
  assertRevision(input.revision, options.expectedProjectRevision, "project");
  const document = clone(input);
  const source = document.drafts.find((draft) => draft.id === options.sourceDraftId);
  if (!source) throw new Error(`Unknown draft: ${options.sourceDraftId}`);
  const timestamp = now(options.now);
  const copy: Draft = clone(source);
  copy.id = options.draftId ?? id("draft");
  copy.sourceDraftId = source.id;
  copy.title = options.title;
  copy.revision = 0;
  copy.createdAt = timestamp;
  copy.updatedAt = timestamp;
  for (const node of copy.nodes) {
    if (node.execution.status === "queued" || node.execution.status === "running") {
      node.execution = {
        status: "dirty",
        inputFingerprint: node.execution.inputFingerprint,
        outputAssetIds: [],
      };
    }
  }
  document.drafts.push(copy);
  document.activeDraftId = copy.id;
  document.revision += 1;
  document.project.updatedAt = timestamp;
  return parseCanvasDocument(document);
}

export function placeholderFingerprint(spec: NodeSpec): string {
  return canonicalSha256({ schemaVersion: 1, spec });
}
