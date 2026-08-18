import Ajv2020Module, { type ErrorObject } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import schema from "../schema/canvas-document-v1.schema.json" with { type: "json" };
import { canonicalSha256 } from "./canonical.js";
import type {
  Asset,
  OpenCanvasDraftBasedProjectDocumentV1 as CanvasDocument,
  Draft,
  Node,
} from "./canvas-document.generated.js";

const Ajv2020 = Ajv2020Module.default;
const addFormats = addFormatsModule.default;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile<CanvasDocument>(schema);
const credentialPattern = /(?:authorization\s*:\s*(?:bearer|basic)\s+\S+|(?:api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9_-]{12,}|\bAIza[A-Za-z0-9_-]{12,}|https?:\/\/\S+[?&](?:key|token|signature)=\S+)/i;

export class CanvasValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid canvas document: ${issues.join("; ")}`);
    this.name = "CanvasValidationError";
    this.issues = issues;
  }
}

function schemaIssues(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}

function duplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function orderedCompositionDependencies(draft: Draft, compositionId: string): Node[] {
  const nodeById = new Map(draft.nodes.map((node) => [node.id, node]));
  const dependencyIds = draft.edges
    .filter((edge) => edge.kind === "dependency" && edge.targetNodeId === compositionId)
    .map((edge) => edge.sourceNodeId);
  if (dependencyIds.length <= 1) {
    return dependencyIds.map((id) => nodeById.get(id)!);
  }

  const dependencySet = new Set(dependencyIds);
  const next = new Map<string, string>();
  const incoming = new Map(dependencyIds.map((id) => [id, 0]));
  for (const edge of draft.edges) {
    if (
      edge.kind === "sequence" &&
      dependencySet.has(edge.sourceNodeId) &&
      dependencySet.has(edge.targetNodeId)
    ) {
      if (next.has(edge.sourceNodeId)) {
        throw new CanvasValidationError([`composition ${compositionId} has branching sequence order`]);
      }
      next.set(edge.sourceNodeId, edge.targetNodeId);
      incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1);
    }
  }
  const starts = dependencyIds.filter((id) => incoming.get(id) === 0);
  if (starts.length !== 1) {
    throw new CanvasValidationError([`composition ${compositionId} has ambiguous sequence order`]);
  }
  const ordered: Node[] = [];
  const seen = new Set<string>();
  let current: string | undefined = starts[0];
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    ordered.push(nodeById.get(current)!);
    current = next.get(current);
  }
  if (ordered.length !== dependencyIds.length) {
    throw new CanvasValidationError([`composition ${compositionId} has disconnected sequence order`]);
  }
  return ordered;
}

export function computeNodeFingerprint(document: CanvasDocument, draft: Draft, node: Node): string {
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  if (node.spec.kind === "shot") {
    return canonicalSha256({
      schemaVersion: 1,
      kind: "shot",
      spec: node.spec,
      inputAssets: node.spec.inputAssetIds.map((assetId) => {
        const asset = assets.get(assetId);
        if (!asset) {
          throw new CanvasValidationError([`shot ${node.id} references unknown asset ${assetId}`]);
        }
        return { assetId, checksumSha256: asset.checksumSha256 };
      }),
    });
  }
  return canonicalSha256({
    schemaVersion: 1,
    kind: "composition",
    spec: node.spec,
    dependencies: orderedCompositionDependencies(draft, node.id).map((dependency) => ({
      nodeId: dependency.id,
      inputFingerprint: dependency.execution.inputFingerprint,
      outputAssetIds: dependency.execution.outputAssetIds,
    })),
  });
}

function validateAssetIdentity(asset: Asset): void {
  const digest = asset.checksumSha256.slice("sha256:".length);
  if (asset.id !== `asset_sha256_${digest}` || asset.path !== `assets/sha256/${digest}`) {
    throw new CanvasValidationError([`asset identity does not match checksum: ${asset.id}`]);
  }
}

function validateDraft(document: CanvasDocument, draft: Draft): void {
  const nodes = new Map(draft.nodes.map((node) => [node.id, node]));
  const jobs = new Map(draft.jobs.map((job) => [job.id, job]));
  const assets = new Set(document.assets.map((asset) => asset.id));
  if (duplicates(draft.nodes.map((node) => node.id))) throw new CanvasValidationError([`duplicate node ID in ${draft.id}`]);
  if (duplicates(draft.edges.map((edge) => edge.id))) throw new CanvasValidationError([`duplicate edge ID in ${draft.id}`]);
  if (duplicates(draft.jobs.map((job) => job.id))) throw new CanvasValidationError([`duplicate job ID in ${draft.id}`]);

  const triples = new Set<string>();
  const dependencyTargets = new Map<string, string[]>();
  const sequenceTargets = new Map<string, string[]>();
  const sequenceIncoming = new Map<string, number>();
  for (const node of draft.nodes) {
    dependencyTargets.set(node.id, []);
    sequenceTargets.set(node.id, []);
    sequenceIncoming.set(node.id, 0);
  }
  for (const edge of draft.edges) {
    const source = nodes.get(edge.sourceNodeId);
    const target = nodes.get(edge.targetNodeId);
    if (!source || !target) throw new CanvasValidationError([`edge ${edge.id} references unknown node`]);
    if (source.id === target.id) throw new CanvasValidationError([`edge ${edge.id} is a self-edge`]);
    const triple = `${edge.kind}:${source.id}:${target.id}`;
    if (triples.has(triple)) throw new CanvasValidationError([`duplicate edge ${triple}`]);
    triples.add(triple);
    if (edge.kind === "dependency") {
      if (target.spec.kind !== "composition") throw new CanvasValidationError([`dependency ${edge.id} must target a composition`]);
      dependencyTargets.get(source.id)!.push(target.id);
    } else if (source.spec.kind !== "shot" || target.spec.kind !== "shot") {
      throw new CanvasValidationError([`sequence ${edge.id} must connect shots`]);
    } else {
      sequenceTargets.get(source.id)!.push(target.id);
      sequenceIncoming.set(target.id, (sequenceIncoming.get(target.id) ?? 0) + 1);
    }
  }

  for (const [nodeId, targets] of sequenceTargets) {
    if (targets.length > 1 || (sequenceIncoming.get(nodeId) ?? 0) > 1) {
      throw new CanvasValidationError([`sequence graph branches at ${nodeId}`]);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) throw new CanvasValidationError([`dependency cycle at ${nodeId}`]);
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const targetId of dependencyTargets.get(nodeId) ?? []) visit(targetId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of nodes.keys()) visit(nodeId);

  const sequenceVisiting = new Set<string>();
  const sequenceVisited = new Set<string>();
  const visitSequence = (nodeId: string): void => {
    if (sequenceVisiting.has(nodeId)) throw new CanvasValidationError([`sequence cycle at ${nodeId}`]);
    if (sequenceVisited.has(nodeId)) return;
    sequenceVisiting.add(nodeId);
    for (const targetId of sequenceTargets.get(nodeId) ?? []) visitSequence(targetId);
    sequenceVisiting.delete(nodeId);
    sequenceVisited.add(nodeId);
  };
  for (const nodeId of nodes.keys()) visitSequence(nodeId);

  for (const job of draft.jobs) {
    if (!nodes.has(job.nodeId)) throw new CanvasValidationError([`job ${job.id} references unknown node`]);
    if (job.outputAssetIds.some((id) => !assets.has(id))) throw new CanvasValidationError([`job ${job.id} references unknown asset`]);
  }
  for (const node of draft.nodes) {
    if (node.execution.outputAssetIds.some((id) => !assets.has(id))) {
      throw new CanvasValidationError([`node ${node.id} references unknown output asset`]);
    }
    const expectedFingerprint = computeNodeFingerprint(document, draft, node);
    if (node.execution.inputFingerprint !== expectedFingerprint) {
      throw new CanvasValidationError([`node ${node.id} fingerprint mismatch`]);
    }
    if (node.execution.status !== "dirty") {
      const job = jobs.get(node.execution.activeJobId!);
      if (
        !job ||
        job.nodeId !== node.id ||
        job.inputFingerprint !== node.execution.inputFingerprint ||
        job.status !== node.execution.status ||
        JSON.stringify(job.outputAssetIds) !== JSON.stringify(node.execution.outputAssetIds)
      ) {
        throw new CanvasValidationError([`node ${node.id} active job does not match execution`]);
      }
    }
  }
}

export function parseCanvasDocument(input: unknown): CanvasDocument {
  if (!validateSchema(input)) throw new CanvasValidationError(schemaIssues(validateSchema.errors));
  if (credentialPattern.test(JSON.stringify(input))) {
    throw new CanvasValidationError(["credential-like value is forbidden"]);
  }
  const document = input as CanvasDocument;
  const draftIds = document.drafts.map((draft) => draft.id);
  if (duplicates(draftIds)) throw new CanvasValidationError(["duplicate draft ID"]);
  if (!draftIds.includes(document.activeDraftId)) throw new CanvasValidationError(["activeDraftId does not resolve"]);
  if (duplicates(document.assets.map((asset) => asset.id))) throw new CanvasValidationError(["duplicate asset ID"]);
  const drafts = new Map(document.drafts.map((draft) => [draft.id, draft]));
  for (const asset of document.assets) {
    validateAssetIdentity(asset);
    if (asset.origin.kind === "job") {
      const origin = asset.origin;
      const originDraft = drafts.get(origin.draftId);
      const originJob = originDraft?.jobs.find((job) => job.id === origin.jobId);
      if (!originJob || !originJob.outputAssetIds.includes(asset.id)) {
        throw new CanvasValidationError([`asset ${asset.id} has unresolved job origin`]);
      }
    }
  }
  for (const draft of document.drafts) {
    if (draft.sourceDraftId && (!drafts.has(draft.sourceDraftId) || draft.sourceDraftId === draft.id)) {
      throw new CanvasValidationError([`draft ${draft.id} has invalid sourceDraftId`]);
    }
    validateDraft(document, draft);
  }
  return document;
}
