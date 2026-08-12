import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

import type {
  CreatorCanvasDraftBasedProjectDocumentV1 as CanvasDocument,
  Draft,
  Job,
  Node,
  ResolvedRoute,
} from "./canvas-document.generated.js";
import type { GenerationRequest, ProviderSnapshot } from "./providers.js";
import { RevisionConflictError } from "./mutations.js";
import {
  computeNodeFingerprint,
  orderedCompositionDependencies,
  parseCanvasDocument,
} from "./validation.js";

function timestamp(value?: string): string {
  return value ?? new Date().toISOString();
}

function findDraft(document: CanvasDocument, draftId: string): Draft {
  const draft = document.drafts.find((candidate) => candidate.id === draftId);
  if (!draft) throw new Error(`Unknown draft: ${draftId}`);
  return draft;
}

function findNode(draft: Draft, nodeId: string): Node {
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown node: ${nodeId}`);
  return node;
}

function finish(document: CanvasDocument, draft: Draft, now: string): CanvasDocument {
  draft.revision += 1;
  draft.updatedAt = now;
  document.revision += 1;
  document.project.updatedAt = now;
  return parseCanvasDocument(document);
}

function routeFor(node: Node): ResolvedRoute {
  const defaultModel = node.spec.kind === "shot" && node.spec.mediaKind === "image"
    ? "mock-image-v1"
    : "mock-video-v1";
  if (node.spec.kind === "shot") {
    const override = node.spec.routing?.promptOverride;
    if (override) {
      if (
        (override.providerId !== undefined && override.providerId !== "mock") ||
        (override.modelId !== undefined && override.modelId !== defaultModel)
      ) {
        throw new Error("Only the deterministic mock provider is executable in this package");
      }
      return { providerId: "mock", modelId: defaultModel, selectionSource: "prompt_override" };
    }
    const choice = node.spec.routing?.aiChoice;
    if (
      choice &&
      (choice.providerId === undefined || choice.providerId === "mock") &&
      (choice.modelId === undefined || choice.modelId === defaultModel)
    ) {
      return { providerId: "mock", modelId: defaultModel, selectionSource: "ai_choice" };
    }
  }
  return {
    providerId: "mock",
    modelId: defaultModel,
    selectionSource: "registry_default",
  };
}

function assertMockRequirements(node: Node): void {
  if (node.spec.kind === "composition") return;
  const requirements = node.spec.requirements;
  if (!requirements) return;
  const image = node.spec.mediaKind === "image";
  const expectedMediaType = image ? "image/png" : "video/mp4";
  const expectedAspectRatio = image ? "1:1" : "16:9";
  const expectedWidth = image ? 1 : 32;
  const expectedHeight = image ? 1 : 18;
  if (
    (requirements.mediaType !== undefined && requirements.mediaType !== expectedMediaType) ||
    (requirements.aspectRatio !== undefined && requirements.aspectRatio !== expectedAspectRatio) ||
    (requirements.width !== undefined && requirements.width !== expectedWidth) ||
    (requirements.height !== undefined && requirements.height !== expectedHeight) ||
    requirements.audio === "required" ||
    (requirements.durationSeconds !== undefined && (image || requirements.durationSeconds !== 5))
  ) {
    throw new Error(`Mock provider cannot satisfy output requirements for ${node.id}`);
  }
}

function requestFor(document: CanvasDocument, draft: Draft, node: Node, jobId: string): GenerationRequest {
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const inputIds = node.spec.kind === "shot"
    ? node.spec.inputAssetIds
    : orderedCompositionDependencies(draft, node.id)
        .flatMap((dependency) => dependency.execution.outputAssetIds);
  return {
    jobId,
    kind: node.spec.kind === "shot" ? node.spec.mediaKind : "video",
    prompt: node.spec.kind === "shot" ? node.spec.prompt : `Compose ${node.title}`,
    inputs: inputIds.map((assetId) => {
      const asset = assets.get(assetId);
      if (!asset) throw new Error(`Unknown input asset: ${assetId}`);
      return { assetId, kind: asset.kind, mediaType: asset.mediaType };
    }),
    requirements: node.spec.kind === "shot"
      ? { ...node.spec.requirements }
      : { mediaType: node.spec.mediaType },
  };
}

export interface StartGenerationOptions {
  draftId: string;
  nodeId: string;
  expectedProjectRevision: number;
  expectedDraftRevision: number;
  jobId?: string;
  now?: string;
}

export function startGeneration(
  input: CanvasDocument,
  options: StartGenerationOptions,
): { document: CanvasDocument; request: GenerationRequest; route: ResolvedRoute } {
  if (input.revision !== options.expectedProjectRevision) {
    throw new RevisionConflictError("project", options.expectedProjectRevision, input.revision);
  }
  const document = structuredClone(input);
  const draft = findDraft(document, options.draftId);
  if (draft.revision !== options.expectedDraftRevision) {
    throw new RevisionConflictError("draft", options.expectedDraftRevision, draft.revision);
  }
  const node = findNode(draft, options.nodeId);
  if (node.execution.status !== "dirty" && node.execution.status !== "failed") {
    throw new Error(`Generation starts only from dirty or failed nodes: ${node.id}`);
  }
  if (node.spec.kind === "composition") {
    const dependencies = draft.edges
      .filter((edge) => edge.kind === "dependency" && edge.targetNodeId === node.id)
      .map((edge) => findNode(draft, edge.sourceNodeId));
    if (
      dependencies.length === 0 ||
      dependencies.some(
        (dependency) => dependency.execution.status !== "succeeded" || dependency.execution.outputAssetIds.length === 0,
      )
    ) {
      throw new Error(`Composition dependencies are not ready: ${node.id}`);
    }
  }
  assertMockRequirements(node);
  const now = timestamp(options.now);
  const jobId = options.jobId ?? `job_${uuidv7()}`;
  const route = routeFor(node);
  const job: Job = {
    id: jobId,
    nodeId: node.id,
    attempt: draft.jobs.filter((candidate) => candidate.nodeId === node.id).length + 1,
    inputFingerprint: node.execution.inputFingerprint,
    status: "queued",
    route,
    outputAssetIds: [],
    createdAt: now,
    updatedAt: now,
  };
  draft.jobs.push(job);
  node.execution = {
    status: "queued",
    inputFingerprint: job.inputFingerprint,
    activeJobId: job.id,
    outputAssetIds: [],
  };
  const request = requestFor(document, draft, node, job.id);
  return { document: finish(document, draft, now), request, route };
}

export interface ResumeGenerationOptions {
  draftId: string;
  nodeId: string;
}

export function resumeGeneration(
  input: CanvasDocument,
  options: ResumeGenerationOptions,
): { document: CanvasDocument; request: GenerationRequest; route: ResolvedRoute } {
  const draft = findDraft(input, options.draftId);
  const node = findNode(draft, options.nodeId);
  if (node.execution.status !== "queued" && node.execution.status !== "running") {
    throw new Error(`Node has no resumable generation: ${node.id}`);
  }
  const job = draft.jobs.find((candidate) => candidate.id === node.execution.activeJobId);
  if (!job || job.inputFingerprint !== node.execution.inputFingerprint || job.route.providerId !== "mock") {
    throw new Error(`Node has no valid resumable mock job: ${node.id}`);
  }
  return { document: input, request: requestFor(input, draft, node, job.id), route: job.route };
}

export interface FailGenerationOptions {
  draftId: string;
  jobId: string;
  providerJobId?: string;
  code?: "provider_rejected" | "provider_unavailable" | "provider_protocol" | "missing_credential";
  retryable?: boolean;
  message?: string;
  now?: string;
}

export function failGeneration(input: CanvasDocument, options: FailGenerationOptions): CanvasDocument {
  const document = structuredClone(input);
  const draft = findDraft(document, options.draftId);
  const job = draft.jobs.find((candidate) => candidate.id === options.jobId);
  if (!job) throw new Error(`Unknown job: ${options.jobId}`);
  if (job.status !== "queued" && job.status !== "running") {
    throw new Error(`Invalid provider transition: ${job.status} -> failed`);
  }
  const now = timestamp(options.now);
  job.status = "failed";
  if (options.providerJobId !== undefined) job.providerJobId = options.providerJobId;
  job.error = {
    code: options.code ?? "provider_protocol",
    retryable: options.retryable ?? true,
    message: options.message ?? "Generation adapter failed",
  };
  job.outputAssetIds = [];
  job.updatedAt = now;
  const node = findNode(draft, job.nodeId);
  assertMockRequirements(node);
  if (node.execution.activeJobId === job.id && node.execution.inputFingerprint === job.inputFingerprint) {
    node.execution.status = "failed";
    node.execution.outputAssetIds = [];
  }
  return finish(document, draft, now);
}

export interface ApplyProviderSnapshotOptions {
  draftId: string;
  jobId: string;
  snapshot: ProviderSnapshot;
  now?: string;
}

export function applyProviderSnapshot(input: CanvasDocument, options: ApplyProviderSnapshotOptions): CanvasDocument {
  if (options.snapshot.status === "succeeded") {
    throw new Error("Materialize provider artifacts before applying success");
  }
  const document = structuredClone(input);
  const draft = findDraft(document, options.draftId);
  const job = draft.jobs.find((candidate) => candidate.id === options.jobId);
  if (!job) throw new Error(`Unknown job: ${options.jobId}`);
  const allowed = job.status === "queued"
    ? new Set(["queued", "running", "failed"])
    : new Set(["running", "failed"]);
  if (!allowed.has(options.snapshot.status)) {
    throw new Error(`Invalid provider transition: ${job.status} -> ${options.snapshot.status}`);
  }
  if (job.progress !== undefined && options.snapshot.progress !== undefined && options.snapshot.progress < job.progress) {
    throw new Error("Provider progress must not decrease");
  }
  const now = timestamp(options.now);
  job.status = options.snapshot.status;
  job.providerJobId = options.snapshot.providerJobId;
  if (options.snapshot.progress !== undefined) job.progress = options.snapshot.progress;
  if (options.snapshot.error !== undefined) job.error = options.snapshot.error;
  job.updatedAt = now;
  const node = findNode(draft, job.nodeId);
  if (node.execution.activeJobId === job.id && node.execution.inputFingerprint === job.inputFingerprint) {
    node.execution.status = job.status;
    node.execution.outputAssetIds = [];
  }
  return finish(document, draft, now);
}

export interface CompleteGenerationOptions {
  draftId: string;
  jobId: string;
  providerJobId: string;
  artifact: { kind: "image" | "video"; mediaType: string; bytes: Uint8Array };
  now?: string;
}

export function completeGeneration(input: CanvasDocument, options: CompleteGenerationOptions): CanvasDocument {
  const document = structuredClone(input);
  const draft = findDraft(document, options.draftId);
  const job = draft.jobs.find((candidate) => candidate.id === options.jobId);
  if (!job) throw new Error(`Unknown job: ${options.jobId}`);
  if (job.status !== "queued" && job.status !== "running") {
    throw new Error(`Invalid provider transition: ${job.status} -> succeeded`);
  }
  const bytes = Buffer.from(options.artifact.bytes);
  if (bytes.length === 0) throw new Error("Provider artifact is empty");
  const node = findNode(draft, job.nodeId);
  const expectedKind = node.spec.kind === "shot" ? node.spec.mediaKind : "video";
  const expectedMediaType = node.spec.kind === "shot"
    ? node.spec.requirements?.mediaType ?? (expectedKind === "image" ? "image/png" : "video/mp4")
    : node.spec.mediaType;
  if (options.artifact.kind !== expectedKind || options.artifact.mediaType !== expectedMediaType) {
    throw new Error("Provider artifact does not satisfy output requirements");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const assetId = `asset_sha256_${digest}`;
  const now = timestamp(options.now);
  if (!document.assets.some((asset) => asset.id === assetId)) {
    document.assets.push({
      id: assetId,
      kind: options.artifact.kind,
      mediaType: options.artifact.mediaType,
      byteLength: bytes.length,
      checksumSha256: `sha256:${digest}`,
      path: `assets/sha256/${digest}`,
      origin: { kind: "job", draftId: draft.id, jobId: job.id },
      createdAt: now,
    });
  }
  job.status = "succeeded";
  job.providerJobId = options.providerJobId;
  job.progress = 1;
  job.outputAssetIds = [assetId];
  delete job.error;
  job.updatedAt = now;
  if (node.execution.activeJobId === job.id && node.execution.inputFingerprint === job.inputFingerprint) {
    node.execution.status = "succeeded";
    node.execution.outputAssetIds = [assetId];
    const affected = new Set([node.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of draft.edges) {
        if (edge.kind === "dependency" && affected.has(edge.sourceNodeId) && !affected.has(edge.targetNodeId)) {
          affected.add(edge.targetNodeId);
          changed = true;
        }
      }
    }
    for (const descendant of draft.nodes.filter(
      (candidate) => candidate.id !== node.id && affected.has(candidate.id),
    )) {
      descendant.execution = {
        status: "dirty",
        inputFingerprint: computeNodeFingerprint(document, draft, descendant),
        outputAssetIds: [],
      };
    }
  }
  return finish(document, draft, now);
}
