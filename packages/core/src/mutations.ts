import { v7 as uuidv7 } from "uuid";

import { canonicalSha256 } from "./canonical.js";
import type {
  CompositionSpec,
  OpenCanvasDraftBasedProjectDocumentV1 as CanvasDocument,
  Draft,
  Node,
  ShotSpec,
} from "./canvas-document.generated.js";
import { computeNodeFingerprint, parseCanvasDocument } from "./validation.js";
import { invalidateDependencyClosure } from "./graph.js";

export class RevisionConflictError extends Error {
  constructor(scope: "project" | "draft", expected: number, actual: number) {
    super(`${scope} revision conflict: expected ${expected}, found ${actual}`);
    this.name = "RevisionConflictError";
  }
}

type NodeSpec = ShotSpec | CompositionSpec;

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
  for (const node of draft.nodes.filter((candidate) => candidate.spec.kind === "composition")) {
    node.execution = {
      status: "dirty",
      inputFingerprint: computeNodeFingerprint(document, draft, node),
      outputAssetIds: [],
    };
  }
  return finishMutation(document, draft, now(options.now));
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
  draft.edges.splice(edgeIndex, 1);
  for (const node of draft.nodes.filter((candidate) => candidate.spec.kind === "composition")) {
    node.execution = {
      status: "dirty",
      inputFingerprint: computeNodeFingerprint(document, draft, node),
      outputAssetIds: [],
    };
  }
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
  const canUpdatePrompt = node.spec.kind === "shot" || (
    node.spec.kind === "composition" && node.spec.role === "text"
  );
  if (options.prompt !== undefined && !canUpdatePrompt) {
    throw new Error("Prompt updates apply only to shot and text nodes");
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
