import { createHash } from "node:crypto";

import { canonicalSha256 } from "./canonical.js";
import type { ResolvedRoute, RouteHint } from "./canvas-document.generated.js";

export type MediaKind = "image" | "video";
export type InputKind = "text" | MediaKind;
export type ProviderErrorCode =
  | "provider_rejected"
  | "provider_unavailable"
  | "provider_protocol"
  | "missing_credential";

export interface GenerationRequest {
  jobId: string;
  kind: MediaKind;
  prompt: string;
  inputs: Array<{ assetId: string; kind: MediaKind; mediaType: string }>;
  requirements: {
    aspectRatio?: "16:9" | "9:16" | "1:1";
    width?: number;
    height?: number;
    /** Number of candidate outputs requested by an image shot. */
    count?: number;
    durationSeconds?: number;
    audio?: "required" | "forbidden" | "either";
    mediaType?: string;
  };
}
export interface ProviderArtifact {
  artifactId: string;
  kind: MediaKind;
  mediaType: string;
  byteLength: number;
  checksumSha256: string;
}
export interface ProviderSnapshot {
  providerJobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: number;
  outputs?: ProviderArtifact[];
  error?: {
    code: ProviderErrorCode;
    retryable: boolean;
    message: string;
  };
}

export interface ModelCapability {
  modelId: string;
  kind: MediaKind;
  inputKinds: readonly InputKind[];
  /** Restricts the media types of non-text references when a provider requires it. */
  inputMediaTypes?: readonly string[];
  /** Maximum number of project-local media references accepted by one request. */
  maxInputs?: number;
  outputMediaTypes: readonly string[];
  aspectRatios?: ReadonlyArray<"16:9" | "9:16" | "1:1">;
  sizes?: ReadonlyArray<{ width: number; height: number }>;
  /**
   * Some providers accept more than a short preset list. Keep their published
   * dimension limits declarative so routing rejects impossible requests before
   * a job is persisted or bytes are sent to a provider.
   */
  sizeConstraints?: {
    maxEdgeLength?: number;
    minPixels?: number;
    maxPixels?: number;
    multipleOf?: number;
    maxAspectRatio?: number;
  };
  /**
   * Maximum candidate outputs a single provider request can materialize.
   * Omission deliberately means the adapter only advertises the default
   * one-output behavior.
   */
  maxOutputs?: number;
  durationsSeconds?: readonly number[];
  audio: "always" | "never" | "optional";
  registryPriority: number;
}

export interface ProviderManifest {
  providerId: string;
  credentialEnv?: string;
  capabilities: readonly ModelCapability[];
}

const providerCredentialBrand = Symbol("open-canvas.provider-credential");
const credentialValues = new WeakMap<object, string>();

export type ProviderCredential = {
  readonly [providerCredentialBrand]: true;
};

/**
 * Wrap a process-local credential before it crosses into an adapter. The
 * value intentionally has no JSON representation and is never attached to a
 * canvas document.
 */
export function createProviderCredential(value: string): ProviderCredential {
  if (value.trim() === "") throw new Error("Provider credential must not be empty");
  const credential = { [providerCredentialBrand]: true } as ProviderCredential;
  credentialValues.set(credential, value);
  return credential;
}

function credentialValue(credential: ProviderCredential | undefined): string {
  if (credential === undefined) {
    throw new ProviderAdapterError("missing_credential", false, "A local provider credential is required");
  }
  const value = credentialValues.get(credential);
  if (!value) {
    throw new ProviderAdapterError("missing_credential", false, "A local provider credential is required");
  }
  return value;
}

export interface ProviderExecutionContext {
  credential?: ProviderCredential;
  /**
   * Transient project-local bytes. They are supplied by the CLI immediately
   * before submission, never persisted on a job, and never exposed to the
   * browser preview.
   */
  inputBytes?: ReadonlyMap<string, Uint8Array>;
}

export interface ProviderAdapter {
  readonly manifest: ProviderManifest;
  submit(
    request: GenerationRequest,
    modelId: string,
    context?: ProviderExecutionContext,
  ): Promise<ProviderSnapshot>;
  poll(providerJobId: string, context?: ProviderExecutionContext): Promise<ProviderSnapshot>;
  openArtifact(
    providerJobId: string,
    artifactId: string,
    context?: ProviderExecutionContext,
  ): AsyncIterable<Uint8Array>;
}

export type FetchLike = typeof globalThis.fetch;

export class ProviderAdapterError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: ProviderErrorCode, retryable: boolean, message: string) {
    super(message);
    this.name = "ProviderAdapterError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type ProviderRoutingErrorCode = "invalid_override" | "missing_credential" | "no_matching_provider";

export class ProviderRoutingError extends Error {
  readonly code: ProviderRoutingErrorCode;
  readonly providerId?: string;
  readonly credentialEnv?: string;

  constructor(
    code: ProviderRoutingErrorCode,
    message: string,
    details: { providerId?: string; credentialEnv?: string } = {},
  ) {
    super(message);
    this.name = "ProviderRoutingError";
    this.code = code;
    if (details.providerId !== undefined) this.providerId = details.providerId;
    if (details.credentialEnv !== undefined) this.credentialEnv = details.credentialEnv;
  }
}

export interface CredentialAvailability {
  has(providerId: string): boolean;
}

export interface RouteSelection {
  request: GenerationRequest;
  promptOverride?: RouteHint;
  aiChoice?: RouteHint;
  credentials: CredentialAvailability;
}

type Candidate = {
  adapter: ProviderAdapter;
  capability: ModelCapability;
};

function candidateOrder(left: Candidate, right: Candidate): number {
  return left.capability.registryPriority - right.capability.registryPriority
    || left.adapter.manifest.providerId.localeCompare(right.adapter.manifest.providerId)
    || left.capability.modelId.localeCompare(right.capability.modelId);
}

function dimensionsMatchAspectRatio(
  width: number,
  height: number,
  aspectRatio: "16:9" | "9:16" | "1:1",
): boolean {
  switch (aspectRatio) {
    case "16:9":
      return width * 9 === height * 16;
    case "9:16":
      return width * 16 === height * 9;
    case "1:1":
      return width === height;
  }
}

function dimensionsMatchSizeConstraints(
  width: number,
  height: number,
  constraints: NonNullable<ModelCapability["sizeConstraints"]>,
): boolean {
  const shortestEdge = Math.min(width, height);
  const longestEdge = Math.max(width, height);
  const pixels = width * height;
  if (constraints.maxEdgeLength !== undefined && longestEdge > constraints.maxEdgeLength) return false;
  if (constraints.minPixels !== undefined && pixels < constraints.minPixels) return false;
  if (constraints.maxPixels !== undefined && pixels > constraints.maxPixels) return false;
  if (constraints.multipleOf !== undefined && (width % constraints.multipleOf !== 0 || height % constraints.multipleOf !== 0)) return false;
  if (constraints.maxAspectRatio !== undefined && longestEdge / shortestEdge > constraints.maxAspectRatio) return false;
  return true;
}

function capabilityMatches(request: GenerationRequest, capability: ModelCapability): boolean {
  if (capability.kind !== request.kind || !capability.inputKinds.includes("text")) return false;
  if (capability.maxInputs !== undefined && request.inputs.length > capability.maxInputs) return false;
  if (request.inputs.some((input) => (
    !capability.inputKinds.includes(input.kind)
    || (capability.inputMediaTypes !== undefined && !capability.inputMediaTypes.includes(input.mediaType))
  ))) return false;
  const requirements = request.requirements;
  if (requirements.mediaType !== undefined && !capability.outputMediaTypes.includes(requirements.mediaType)) return false;
  if (
    requirements.aspectRatio !== undefined
    && (capability.aspectRatios === undefined || !capability.aspectRatios.includes(requirements.aspectRatio))
  ) {
    return false;
  }
  if (requirements.width !== undefined || requirements.height !== undefined) {
    if (
      requirements.width === undefined
      || requirements.height === undefined
    ) {
      return false;
    }
    const matchesPreset = capability.sizes?.some(
      (size) => size.width === requirements.width && size.height === requirements.height,
    ) ?? false;
    const matchesConstraints = capability.sizeConstraints !== undefined
      && dimensionsMatchSizeConstraints(requirements.width, requirements.height, capability.sizeConstraints);
    if (!matchesPreset && !matchesConstraints) return false;
    if (
      requirements.aspectRatio !== undefined
      && !dimensionsMatchAspectRatio(requirements.width, requirements.height, requirements.aspectRatio)
    ) {
      return false;
    }
  }
  if (
    requirements.count !== undefined
    && (!Number.isSafeInteger(requirements.count) || requirements.count < 1 || requirements.count > (capability.maxOutputs ?? 1))
  ) {
    return false;
  }
  if (
    requirements.durationSeconds !== undefined
    && (capability.durationsSeconds === undefined || !capability.durationsSeconds.includes(requirements.durationSeconds))
  ) {
    return false;
  }
  if (requirements.audio === "required" && capability.audio === "never") return false;
  if (requirements.audio === "forbidden" && capability.audio === "always") return false;
  return true;
}

function hintMatches(candidate: Candidate, hint: RouteHint): boolean {
  return (
    (hint.providerId === undefined || hint.providerId === candidate.adapter.manifest.providerId)
    && (hint.modelId === undefined || hint.modelId === candidate.capability.modelId)
  );
}

function isConfigured(candidate: Candidate, credentials: CredentialAvailability): boolean {
  return candidate.adapter.manifest.credentialEnv === undefined
    || credentials.has(candidate.adapter.manifest.providerId);
}

function resolved(candidate: Candidate, selectionSource: ResolvedRoute["selectionSource"]): ResolvedRoute {
  return {
    providerId: candidate.adapter.manifest.providerId,
    modelId: candidate.capability.modelId,
    selectionSource,
  };
}

/**
 * Select only from adapters that the caller has deliberately registered.
 * Production callers omit MockProviderAdapter unless the user explicitly asks
 * for deterministic local demo output.
 */
export function selectProviderRoute(
  adapters: readonly ProviderAdapter[],
  selection: RouteSelection,
): ResolvedRoute {
  const candidates = adapters.flatMap((adapter) =>
    adapter.manifest.capabilities
      .filter((capability) => capabilityMatches(selection.request, capability))
      .map((capability) => ({ adapter, capability })),
  ).sort(candidateOrder);

  if (selection.promptOverride !== undefined) {
    const matching = candidates.filter((candidate) => hintMatches(candidate, selection.promptOverride!));
    if (matching.length === 0) {
      throw new ProviderRoutingError(
        "invalid_override",
        "The requested provider or model cannot satisfy this generation request",
      );
    }
    const configured = matching.filter((candidate) => isConfigured(candidate, selection.credentials));
    if (configured.length === 0) {
      const candidate = matching.find((item) => item.adapter.manifest.credentialEnv !== undefined);
      const credentialEnv = candidate?.adapter.manifest.credentialEnv;
      throw new ProviderRoutingError(
        "missing_credential",
        credentialEnv === undefined
          ? "No configured provider can satisfy this generation request"
          : "The requested provider requires " + credentialEnv,
        {
          ...(candidate === undefined ? {} : { providerId: candidate.adapter.manifest.providerId }),
          ...(credentialEnv === undefined ? {} : { credentialEnv }),
        },
      );
    }
    return resolved(configured[0]!, "prompt_override");
  }

  const configured = candidates.filter((candidate) => isConfigured(candidate, selection.credentials));
  if (selection.aiChoice !== undefined) {
    const planned = configured.find((candidate) => hintMatches(candidate, selection.aiChoice!));
    if (planned !== undefined) return resolved(planned, "ai_choice");
  }
  if (configured.length > 0) return resolved(configured[0]!, "registry_default");
  throw new ProviderRoutingError(
    "no_matching_provider",
    "No configured provider can satisfy this generation request",
  );
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function bytesFromBase64(value: string, provider: string): Buffer {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0) {
    throw new ProviderAdapterError(
      "provider_protocol",
      false,
      provider + " returned an empty media artifact",
    );
  }
  return bytes;
}

function artifactForBytes(
  artifactId: string,
  kind: MediaKind,
  mediaType: string,
  bytes: Uint8Array,
): ProviderArtifact {
  const buffer = Buffer.from(bytes);
  const digest = createHash("sha256").update(buffer).digest("hex");
  return {
    artifactId,
    kind,
    mediaType,
    byteLength: buffer.length,
    checksumSha256: "sha256:" + digest,
  };
}

function requireCapability(
  manifest: ProviderManifest,
  request: GenerationRequest,
  modelId: string,
): ModelCapability {
  if (request.prompt.trim() === "") throw new Error("Generation prompt must not be empty");
  const capability = manifest.capabilities.find((candidate) => candidate.modelId === modelId);
  if (capability === undefined || !capabilityMatches(request, capability)) {
    throw new ProviderAdapterError(
      "provider_protocol",
      false,
      "The selected " + manifest.providerId + " model cannot satisfy this generation request",
    );
  }
  return capability;
}

function providerFailure(provider: string, status: number): ProviderAdapterError {
  const rejected = status >= 400 && status < 500;
  return new ProviderAdapterError(
    rejected ? "provider_rejected" : "provider_unavailable",
    !rejected,
    provider + " request failed with HTTP " + String(status),
  );
}

async function requestJson(
  fetcher: FetchLike,
  provider: string,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new ProviderAdapterError("provider_unavailable", true, provider + " request could not be reached");
  }
  if (!response.ok) throw providerFailure(provider, response.status);
  try {
    return await response.json();
  } catch {
    throw new ProviderAdapterError("provider_protocol", false, provider + " returned an invalid response");
  }
}

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const MP4_BYTES = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAALubW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAE4gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhl0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAE4gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAASAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAABOIAAAAAAABAAAAAAGRbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAABQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABPG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPxzdGJsAAAAmHN0c2QAAAAAAAAAAQAAAIhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAEgBIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMmF2Y0MBZAAK/+EAGWdkAAqs2Ul+IwEQAAADAFAAAAMAIPEiWWABAAZo6+PLIsAAAAAYc3R0cwAAAAAAAAABAAAAAQABQAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACywAAAAEAAAAUc3RjbwAAAAAAAAABAAADHgAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNTYuNC4xMDEAAAAIZnJlZQAAAtNtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0MiByMjQ5MSAyNGU0ZmVkIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNCAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTQ4IGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJldD0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAFWWIhAAV//73ye/Apuvb3rW/YAEA+Q==",
  "base64",
);

function artifact(kind: MediaKind): { record: ProviderArtifact; bytes: Buffer } {
  const bytes = kind === "image" ? PNG_BYTES : MP4_BYTES;
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    record: {
      artifactId: `mock-${kind}-fixture-v1`,
      kind,
      mediaType: kind === "image" ? "image/png" : "video/mp4",
      byteLength: bytes.length,
      checksumSha256: `sha256:${digest}`,
    },
    bytes,
  };
}

const OPENAI_IMAGE_PRESET_SIZES = [
  { width: 1024, height: 1024 },
  { width: 1792, height: 1008 },
  { width: 1008, height: 1792 },
] as const;

function configuredIdentifier(value: string | undefined, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (normalized === "") throw new Error(label + " must not be empty");
  return normalized;
}

function configuredRegistryPriority(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + " must be a non-negative integer");
  return value;
}

function imageOutput(mediaType: string | undefined): { mediaType: string; outputFormat: "png" | "jpeg" | "webp" } {
  switch (mediaType ?? "image/png") {
    case "image/png":
      return { mediaType: "image/png", outputFormat: "png" };
    case "image/jpeg":
      return { mediaType: "image/jpeg", outputFormat: "jpeg" };
    case "image/webp":
      return { mediaType: "image/webp", outputFormat: "webp" };
    default:
      throw new ProviderAdapterError(
        "provider_protocol",
        false,
        "OpenAI image output type is not supported by this adapter",
      );
  }
}

function imageSize(request: GenerationRequest): string | undefined {
  const { width, height, aspectRatio } = request.requirements;
  if (width !== undefined && height !== undefined) return String(width) + "x" + String(height);
  if (aspectRatio === "16:9") return "1792x1008";
  if (aspectRatio === "9:16") return "1008x1792";
  if (aspectRatio === "1:1") return "1024x1024";
  return undefined;
}

type StoredArtifact = {
  artifact: ProviderArtifact;
  bytes: Buffer;
};

type StoredArtifacts = Map<string, StoredArtifact>;

function openAIImageExtension(mediaType: string): string {
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      throw new ProviderAdapterError(
        "provider_protocol",
        false,
        "OpenAI image references must be PNG, JPEG, or WebP assets",
      );
  }
}

function openAIImageEditForm(
  request: GenerationRequest,
  modelId: string,
  output: ReturnType<typeof imageOutput>,
  size: string | undefined,
  context: ProviderExecutionContext | undefined,
): FormData {
  if (context?.inputBytes === undefined) {
    throw new ProviderAdapterError(
      "provider_protocol",
      false,
      "OpenAI image reference bytes are unavailable in the local project store",
    );
  }
  const form = new FormData();
  form.append("model", modelId);
  form.append("prompt", request.prompt);
  form.append("output_format", output.outputFormat);
  if (size !== undefined) form.append("size", size);
  if ((request.requirements.count ?? 1) > 1) form.append("n", String(request.requirements.count));
  for (const [index, reference] of request.inputs.entries()) {
    if (reference.kind !== "image") {
      throw new ProviderAdapterError(
        "provider_protocol",
        false,
        "OpenAI image adapter accepts only image references in this version",
      );
    }
    const bytes = context.inputBytes.get(reference.assetId);
    if (bytes === undefined || bytes.length === 0) {
      throw new ProviderAdapterError(
        "provider_protocol",
        false,
        "OpenAI image reference bytes are unavailable in the local project store",
      );
    }
    const extension = openAIImageExtension(reference.mediaType);
    form.append(
      "image[]",
      new Blob([new Uint8Array(bytes)], { type: reference.mediaType }),
      "reference-" + String(index + 1) + "." + extension,
    );
  }
  return form;
}

/**
 * OpenAI's Image API has a JSON generations endpoint for text-only work and
 * a multipart edits endpoint when a project-local image is a reference. Both
 * paths materialize Base64 output only in process memory before Core writes
 * a content-addressed asset into the project store.
 */
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2";

export interface OpenAIImageAdapterOptions {
  providerId?: string;
  credentialEnv?: string;
  modelId?: string;
  registryPriority?: number;
  fetcher?: FetchLike;
}

export class OpenAIImageAdapter implements ProviderAdapter {
  readonly manifest: ProviderManifest;
  readonly #jobs = new Map<string, StoredArtifacts>();
  readonly #fetch: FetchLike;

  constructor(options: FetchLike | OpenAIImageAdapterOptions = {}) {
    const configuration: OpenAIImageAdapterOptions = typeof options === "function" ? { fetcher: options } : options;
    const providerId = configuredIdentifier(configuration.providerId, "openai", "OpenAI provider identifier");
    const credentialEnv = configuredIdentifier(configuration.credentialEnv, "OPENAI_API_KEY", "OpenAI credential environment variable");
    const modelId = configuredIdentifier(configuration.modelId, DEFAULT_OPENAI_IMAGE_MODEL, "OpenAI image model identifier");
    const registryPriority = configuredRegistryPriority(configuration.registryPriority, 100, "OpenAI registry priority");
    this.manifest = {
      providerId,
      credentialEnv,
      capabilities: [
        {
          modelId,
          kind: "image",
          inputKinds: ["text", "image"],
          inputMediaTypes: ["image/png", "image/jpeg", "image/webp"],
          outputMediaTypes: ["image/png", "image/jpeg", "image/webp"],
          aspectRatios: ["1:1", "16:9", "9:16"],
          // Keep common UI choices discoverable, while allowing every published
          // GPT Image 2 size that satisfies the documented constraints. This
          // includes the canvas's 2048 x 1152 landscape setting.
          sizes: OPENAI_IMAGE_PRESET_SIZES,
          sizeConstraints: {
            maxEdgeLength: 3840,
            minPixels: 655360,
            maxPixels: 8294400,
            multipleOf: 16,
            maxAspectRatio: 3,
          },
          // The local Studio deliberately exposes a small candidate set. The
          // Image API's `n` parameter supports multiple outputs in one request;
          // routing keeps the UI inside this tested adapter boundary.
          maxOutputs: 4,
          audio: "never",
          registryPriority,
        },
      ],
    };
    this.#fetch = configuration.fetcher ?? globalThis.fetch;
  }

  async submit(
    request: GenerationRequest,
    modelId: string,
    context?: ProviderExecutionContext,
  ): Promise<ProviderSnapshot> {
    requireCapability(this.manifest, request, modelId);
    const credential = credentialValue(context?.credential);
    const output = imageOutput(request.requirements.mediaType);
    const size = imageSize(request);
    const headers = {
      Authorization: "Bearer " + credential,
      "Idempotency-Key": request.jobId,
    };
    const isImageEdit = request.inputs.length > 0;
    const payload = await requestJson(
      this.#fetch,
      "OpenAI image",
      "https://api.openai.com/v1/images/" + (isImageEdit ? "edits" : "generations"),
      isImageEdit
        ? {
          method: "POST",
          headers,
          body: openAIImageEditForm(request, modelId, output, size, context),
        }
        : {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: modelId,
            prompt: request.prompt,
            output_format: output.outputFormat,
            ...(size === undefined ? {} : { size }),
            ...((request.requirements.count ?? 1) > 1 ? { n: request.requirements.count } : {}),
          }),
        },
    );
    const root = objectValue(payload);
    const records = root !== undefined && Array.isArray(root.data)
      ? root.data.map((entry) => objectValue(entry))
      : [];
    const expectedCount = request.requirements.count ?? 1;
    if (records.length !== expectedCount) {
      throw new ProviderAdapterError(
        "provider_protocol",
        false,
        "OpenAI image response did not contain the requested number of image outputs",
      );
    }
    const providerJobId = "openai-image:" + request.jobId;
    const artifacts = new Map<string, StoredArtifact>();
    const outputs = records.map((record, index) => {
      const encoded = record === undefined ? undefined : stringValue(record.b64_json);
      if (encoded === undefined) {
        throw new ProviderAdapterError(
          "provider_protocol",
          false,
          "OpenAI image response did not contain image bytes",
        );
      }
      const bytes = bytesFromBase64(encoded, "OpenAI image");
      const artifact = artifactForBytes(
        providerJobId + ":image:" + String(index + 1),
        "image",
        output.mediaType,
        bytes,
      );
      artifacts.set(artifact.artifactId, { artifact, bytes });
      return artifact;
    });
    this.#jobs.set(providerJobId, artifacts);
    return {
      providerJobId,
      status: "succeeded",
      progress: 1,
      outputs,
    };
  }

  async poll(providerJobId: string): Promise<ProviderSnapshot> {
    const job = this.#jobs.get(providerJobId);
    if (job === undefined) {
      throw new ProviderAdapterError(
        "provider_protocol",
        true,
        "OpenAI image job cannot be resumed after an incomplete local materialization",
      );
    }
    return { providerJobId, status: "succeeded", progress: 1, outputs: [...job.values()].map(({ artifact }) => artifact) };
  }

  async *openArtifact(providerJobId: string, artifactId: string): AsyncIterable<Uint8Array> {
    const job = this.#jobs.get(providerJobId);
    const artifact = job?.get(artifactId);
    if (artifact === undefined) {
      throw new ProviderAdapterError("provider_protocol", false, "OpenAI image artifact is unavailable");
    }
    yield artifact.bytes;
  }
}

type GeminiVideoOutput = {
  data?: string;
  uri?: string;
  mediaType?: string;
};

function geminiVideoOutput(payload: unknown): GeminiVideoOutput | undefined {
  const root = objectValue(payload);
  if (root === undefined) return undefined;
  const direct = objectValue(root.output_video);
  const directData = direct === undefined ? undefined : stringValue(direct.data);
  const directUri = direct === undefined ? undefined : stringValue(direct.uri);
  const directMediaType = direct === undefined ? undefined : stringValue(direct.mime_type);
  const fromDirect = direct === undefined ? undefined : {
    ...(directData === undefined ? {} : { data: directData }),
    ...(directUri === undefined ? {} : { uri: directUri }),
    ...(directMediaType === undefined ? {} : { mediaType: directMediaType }),
  };
  if (fromDirect !== undefined && (fromDirect.data !== undefined || fromDirect.uri !== undefined)) return fromDirect;
  if (!Array.isArray(root.steps)) return undefined;
  for (const step of root.steps) {
    const record = objectValue(step);
    if (record?.type !== "model_output" || !Array.isArray(record.content)) continue;
    for (const entry of record.content) {
      const media = objectValue(entry);
      if (media?.type !== "video") continue;
      const data = stringValue(media.data);
      const uri = stringValue(media.uri);
      const mediaType = stringValue(media.mime_type);
      if (data !== undefined || uri !== undefined) {
        return {
          ...(data === undefined ? {} : { data }),
          ...(uri === undefined ? {} : { uri }),
          ...(mediaType === undefined ? {} : { mediaType }),
        };
      }
    }
  }
  return undefined;
}

function geminiStatus(payload: unknown): string | undefined {
  return stringValue(objectValue(payload)?.status)?.toLowerCase();
}

function geminiInteractionId(providerJobId: string): string {
  const prefix = "gemini-omni:";
  if (!providerJobId.startsWith(prefix) || providerJobId.length === prefix.length) {
    throw new ProviderAdapterError("provider_protocol", false, "Gemini video job identifier is invalid");
  }
  return providerJobId.slice(prefix.length);
}

/**
 * Gemini Omni Flash is the current recommended Gemini API default for video
 * generation. The adapter sends user-owned keys only in x-goog-api-key, keeps
 * generated bytes in memory until core stores them locally, and never writes
 * interaction URLs into the canvas document.
 */
export const DEFAULT_GEMINI_OMNI_VIDEO_MODEL = "gemini-omni-flash-preview";

export interface GeminiOmniVideoAdapterOptions {
  providerId?: string;
  credentialEnv?: string;
  modelId?: string;
  registryPriority?: number;
  fetcher?: FetchLike;
}

export class GeminiOmniVideoAdapter implements ProviderAdapter {
  readonly manifest: ProviderManifest;
  readonly #jobs = new Map<string, StoredArtifact>();
  readonly #fetch: FetchLike;

  constructor(options: FetchLike | GeminiOmniVideoAdapterOptions = {}) {
    const configuration: GeminiOmniVideoAdapterOptions = typeof options === "function" ? { fetcher: options } : options;
    const providerId = configuredIdentifier(configuration.providerId, "google-gemini", "Gemini provider identifier");
    const credentialEnv = configuredIdentifier(configuration.credentialEnv, "GEMINI_API_KEY", "Gemini credential environment variable");
    const modelId = configuredIdentifier(configuration.modelId, DEFAULT_GEMINI_OMNI_VIDEO_MODEL, "Gemini video model identifier");
    const registryPriority = configuredRegistryPriority(configuration.registryPriority, 100, "Gemini registry priority");
    this.manifest = {
      providerId,
      credentialEnv,
      capabilities: [
        {
          modelId,
          kind: "video",
          inputKinds: ["text", "image"],
          outputMediaTypes: ["video/mp4"],
          aspectRatios: ["16:9", "9:16"],
          maxOutputs: 1,
          audio: "always",
          registryPriority,
        },
      ],
    };
    this.#fetch = configuration.fetcher ?? globalThis.fetch;
  }

  async submit(
    request: GenerationRequest,
    modelId: string,
    context?: ProviderExecutionContext,
  ): Promise<ProviderSnapshot> {
    requireCapability(this.manifest, request, modelId);
    const credential = credentialValue(context?.credential);
    const input = this.inputFor(request, context);
    const responseFormat: Record<string, unknown> = { type: "video", delivery: "uri" };
    if (request.requirements.aspectRatio !== undefined) {
      responseFormat.aspect_ratio = request.requirements.aspectRatio;
    }
    const body: Record<string, unknown> = {
      model: modelId,
      input,
      response_format: responseFormat,
    };
    if (request.inputs.length > 0) {
      body.generation_config = { video_config: { task: "image_to_video" } };
    }
    const payload = await requestJson(
      this.#fetch,
      "Gemini video",
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": credential,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const interactionId = stringValue(objectValue(payload)?.id);
    if (interactionId === undefined) {
      throw new ProviderAdapterError("provider_protocol", false, "Gemini video response did not contain an interaction id");
    }
    const providerJobId = "gemini-omni:" + interactionId;
    const output = geminiVideoOutput(payload);
    if (output?.data !== undefined) return this.storeVideo(providerJobId, output);
    if (geminiStatus(payload) === "failed" || geminiStatus(payload) === "error") {
      return {
        providerJobId,
        status: "failed",
        error: {
          code: "provider_rejected",
          retryable: false,
          message: "Gemini video request was rejected",
        },
      };
    }
    if (output?.uri === undefined && geminiStatus(payload) === "completed") {
      throw new ProviderAdapterError(
        "provider_protocol",
        false,
        "Gemini video response completed without a video artifact",
      );
    }
    return { providerJobId, status: "running", progress: 0 };
  }

  async poll(
    providerJobId: string,
    context?: ProviderExecutionContext,
  ): Promise<ProviderSnapshot> {
    const stored = this.#jobs.get(providerJobId);
    if (stored !== undefined) {
      return { providerJobId, status: "succeeded", progress: 1, outputs: [stored.artifact] };
    }
    const credential = credentialValue(context?.credential);
    const interactionId = geminiInteractionId(providerJobId);
    const payload = await requestJson(
      this.#fetch,
      "Gemini video",
      "https://generativelanguage.googleapis.com/v1beta/interactions/" + encodeURIComponent(interactionId),
      {
        method: "GET",
        headers: { "x-goog-api-key": credential },
      },
    );
    const output = geminiVideoOutput(payload);
    if (output?.data !== undefined) return this.storeVideo(providerJobId, output);
    if (geminiStatus(payload) === "failed" || geminiStatus(payload) === "error") {
      return {
        providerJobId,
        status: "failed",
        error: {
          code: "provider_rejected",
          retryable: false,
          message: "Gemini video request was rejected",
        },
      };
    }
    if (geminiStatus(payload) === "completed" && output?.uri === undefined) {
      return {
        providerJobId,
        status: "failed",
        error: {
          code: "provider_protocol",
          retryable: false,
          message: "Gemini video completed without a retrievable artifact",
        },
      };
    }
    return { providerJobId, status: "running" };
  }

  async *openArtifact(providerJobId: string, artifactId: string): AsyncIterable<Uint8Array> {
    const job = this.#jobs.get(providerJobId);
    if (job === undefined || job.artifact.artifactId !== artifactId) {
      throw new ProviderAdapterError("provider_protocol", false, "Gemini video artifact is unavailable");
    }
    yield job.bytes;
  }

  private inputFor(request: GenerationRequest, context?: ProviderExecutionContext): string | Array<Record<string, string>> {
    if (request.inputs.length === 0) return request.prompt;
    if (context?.inputBytes === undefined) {
      throw new ProviderAdapterError(
        "provider_protocol",
        false,
        "Gemini video input bytes are unavailable in the local project store",
      );
    }
    const input: Array<Record<string, string>> = [];
    for (const reference of request.inputs) {
      if (reference.kind !== "image") {
        throw new ProviderAdapterError(
          "provider_protocol",
          false,
          "Gemini video adapter accepts only image references in this version",
        );
      }
      const bytes = context.inputBytes.get(reference.assetId);
      if (bytes === undefined || bytes.length === 0) {
        throw new ProviderAdapterError(
          "provider_protocol",
          false,
          "Gemini video input bytes are unavailable in the local project store",
        );
      }
      input.push({
        type: "image",
        data: Buffer.from(bytes).toString("base64"),
        mime_type: reference.mediaType,
      });
    }
    input.push({ type: "text", text: request.prompt });
    return input;
  }

  private storeVideo(providerJobId: string, output: GeminiVideoOutput): ProviderSnapshot {
    if (output.data === undefined) {
      throw new ProviderAdapterError("provider_protocol", false, "Gemini video response did not contain video bytes");
    }
    const mediaType = output.mediaType ?? "video/mp4";
    if (mediaType !== "video/mp4") {
      throw new ProviderAdapterError("provider_protocol", false, "Gemini video response returned an unsupported media type");
    }
    const bytes = bytesFromBase64(output.data, "Gemini video");
    const artifact = artifactForBytes(providerJobId + ":video", "video", mediaType, bytes);
    this.#jobs.set(providerJobId, { artifact, bytes });
    return { providerJobId, status: "succeeded", progress: 1, outputs: [artifact] };
  }
}

export const DEFAULT_ARK_SEEDREAM_MODEL = "doubao-seedream-5-0-260128";
/**
 * Public Ark Seedance 2.5 model identifier. Consumers may still supply their
 * own authorized Ark endpoint ID with OPEN_CANVAS_ARK_VIDEO_MODEL.
 */
export const DEFAULT_ARK_SEEDANCE_MODEL = "doubao-seedance-2-5-260628";

const ARK_API_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const ARK_IMAGE_PRESET_SIZES = [
  { width: 2048, height: 2048 },
  { width: 2048, height: 1152 },
  { width: 1152, height: 2048 },
] as const;
// Seedance 2.5 accepts whole-second video durations from 4 through 30.
const ARK_VIDEO_DURATIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
] as const;

export interface VolcengineArkAdapterOptions {
  providerId?: string;
  credentialEnv?: string;
  /**
   * A public model identifier or a user-owned Ark endpoint identifier. Model
   * identifiers are configuration, not credentials, and remain outside the
   * canvas document.
   */
  imageModelId?: string | null;
  /** A public model identifier or a user-owned Ark endpoint identifier. */
  videoModelId?: string | null;
  registryPriority?: number;
  fetcher?: FetchLike;
}

function configuredModelId(value: string | null | undefined, fallback: string, label: string): string | undefined {
  if (value === null) return undefined;
  return configuredIdentifier(value, fallback, label);
}

function arkImageSize(request: GenerationRequest): string {
  const { width, height, aspectRatio } = request.requirements;
  if (width !== undefined && height !== undefined) return String(width) + "x" + String(height);
  switch (aspectRatio) {
    case "16:9":
      return "2048x1152";
    case "9:16":
      return "1152x2048";
    case "1:1":
    default:
      return "2048x2048";
  }
}

function arkImageReferences(
  request: GenerationRequest,
  context: ProviderExecutionContext | undefined,
): string[] {
  if (request.inputs.length === 0) return [];
  if (context?.inputBytes === undefined) {
    throw new ProviderAdapterError(
      "provider_protocol",
      false,
      "Ark image reference bytes are unavailable in the local project store",
    );
  }
  return request.inputs.map((reference) => {
    if (reference.kind !== "image") {
      throw new ProviderAdapterError(
        "provider_protocol",
        false,
        "Ark image adapter accepts only image references in this version",
      );
    }
    const bytes = context.inputBytes!.get(reference.assetId);
    if (bytes === undefined || bytes.length === 0) {
      throw new ProviderAdapterError(
        "provider_protocol",
        false,
        "Ark image reference bytes are unavailable in the local project store",
      );
    }
    return "data:" + reference.mediaType + ";base64," + Buffer.from(bytes).toString("base64");
  });
}

function arkVideoContent(
  request: GenerationRequest,
  context: ProviderExecutionContext | undefined,
): Array<Record<string, unknown>> {
  if (request.inputs.length > 1) {
    throw new ProviderAdapterError(
      "provider_protocol",
      false,
      "Ark video adapter accepts one project-local image as a first-frame reference in this version",
    );
  }
  const content: Array<Record<string, unknown>> = [{ type: "text", text: request.prompt }];
  const reference = request.inputs[0];
  if (reference === undefined) return content;
  if (reference.kind !== "image") {
    throw new ProviderAdapterError(
      "provider_protocol",
      false,
      "Ark video adapter accepts only image references in this version",
    );
  }
  const bytes = context?.inputBytes?.get(reference.assetId);
  if (bytes === undefined || bytes.length === 0) {
    throw new ProviderAdapterError(
      "provider_protocol",
      false,
      "Ark video input bytes are unavailable in the local project store",
    );
  }
  content.push({
    type: "image_url",
    image_url: {
      url: "data:" + reference.mediaType + ";base64," + Buffer.from(bytes).toString("base64"),
    },
    // Ark documents `first_frame` (or an omitted role) for one-image
    // image-to-video. `reference_image` denotes a different multimodal
    // reference-generation mode and does not preserve this image as frame 1.
    role: "first_frame",
  });
  return content;
}

function arkTaskId(providerJobId: string): string {
  const prefix = "ark-video:";
  if (!providerJobId.startsWith(prefix) || providerJobId.length === prefix.length) {
    throw new ProviderAdapterError("provider_protocol", false, "Ark video job identifier is invalid");
  }
  return providerJobId.slice(prefix.length);
}

function arkArtifactUrl(value: string, provider: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString();
  } catch {
    throw new ProviderAdapterError(
      "provider_protocol",
      false,
      provider + " returned an invalid artifact URL",
    );
  }
}

async function requestArtifactBytes(fetcher: FetchLike, provider: string, url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    throw new ProviderAdapterError("provider_unavailable", true, provider + " artifact could not be reached");
  }
  if (!response.ok) throw providerFailure(provider, response.status);
  try {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) {
      throw new ProviderAdapterError("provider_protocol", false, provider + " returned an empty media artifact");
    }
    return bytes;
  } catch (error) {
    if (error instanceof ProviderAdapterError) throw error;
    throw new ProviderAdapterError("provider_protocol", false, provider + " returned an unreadable media artifact");
  }
}

type ArkImageRecord = {
  b64Json?: string;
  url?: string;
};

function arkImageRecords(payload: unknown): ArkImageRecord[] {
  const root = objectValue(payload);
  if (root === undefined || !Array.isArray(root.data)) return [];
  return root.data.map((entry) => {
    const record = objectValue(entry);
    const b64Json = record === undefined ? undefined : stringValue(record.b64_json);
    const url = record === undefined ? undefined : stringValue(record.url);
    return {
      ...(b64Json === undefined ? {} : { b64Json }),
      ...(url === undefined ? {} : { url }),
    };
  });
}

type ArkVideoTask = {
  id?: string;
  status?: string;
  videoUrl?: string;
};

function arkVideoTask(payload: unknown): ArkVideoTask {
  const root = objectValue(payload);
  const content = root === undefined ? undefined : objectValue(root.content);
  const id = root === undefined ? undefined : stringValue(root.id);
  const status = root === undefined ? undefined : stringValue(root.status)?.toLowerCase();
  const videoUrl = content === undefined ? undefined : stringValue(content.video_url);
  return {
    ...(id === undefined ? {} : { id }),
    ...(status === undefined ? {} : { status }),
    ...(videoUrl === undefined ? {} : { videoUrl }),
  };
}

/**
 * Direct Ark adapter for user-owned keys. It deliberately uses the public
 * Ark HTTP surface rather than any product-specific SDK, routing service, or
 * credentials. Generated bytes are held only long enough for Core to write
 * them into the project's content-addressed asset store.
 */
export class VolcengineArkAdapter implements ProviderAdapter {
  readonly manifest: ProviderManifest;
  readonly #jobs = new Map<string, StoredArtifact>();
  readonly #fetch: FetchLike;

  constructor(options: VolcengineArkAdapterOptions = {}) {
    const imageModelId = configuredModelId(options.imageModelId, DEFAULT_ARK_SEEDREAM_MODEL, "Ark image model identifier");
    const videoModelId = configuredModelId(options.videoModelId, DEFAULT_ARK_SEEDANCE_MODEL, "Ark video model identifier");
    if (imageModelId === undefined && videoModelId === undefined) {
      throw new Error("Ark provider must configure an image or video model");
    }
    const providerId = configuredIdentifier(options.providerId, "volcengine-ark", "Ark provider identifier");
    const credentialEnv = configuredIdentifier(options.credentialEnv, "ARK_API_KEY", "Ark credential environment variable");
    const registryPriority = configuredRegistryPriority(options.registryPriority, 90, "Ark registry priority");
    const capabilities: ModelCapability[] = [];
    if (imageModelId !== undefined) {
      capabilities.push({
        modelId: imageModelId,
        kind: "image",
        inputKinds: ["text", "image"],
        inputMediaTypes: ["image/png", "image/jpeg", "image/webp"],
        outputMediaTypes: ["image/png"],
        aspectRatios: ["1:1", "16:9", "9:16"],
        sizes: ARK_IMAGE_PRESET_SIZES,
        maxOutputs: 1,
        audio: "never",
        registryPriority,
      });
    }
    if (videoModelId !== undefined) {
      capabilities.push({
        modelId: videoModelId,
        kind: "video",
        inputKinds: ["text", "image"],
        inputMediaTypes: ["image/png", "image/jpeg", "image/webp"],
        maxInputs: 1,
        outputMediaTypes: ["video/mp4"],
        aspectRatios: ["1:1", "16:9", "9:16"],
        durationsSeconds: ARK_VIDEO_DURATIONS,
        maxOutputs: 1,
        audio: "optional",
        registryPriority,
      });
    }
    this.manifest = {
      providerId,
      credentialEnv,
      capabilities,
    };
    this.#fetch = options.fetcher ?? globalThis.fetch;
  }

  async submit(
    request: GenerationRequest,
    modelId: string,
    context?: ProviderExecutionContext,
  ): Promise<ProviderSnapshot> {
    const capability = requireCapability(this.manifest, request, modelId);
    const credential = credentialValue(context?.credential);
    return capability.kind === "image"
      ? this.submitImage(request, modelId, credential, context)
      : this.submitVideo(request, modelId, credential, context);
  }

  async poll(providerJobId: string, context?: ProviderExecutionContext): Promise<ProviderSnapshot> {
    const completed = this.#jobs.get(providerJobId);
    if (completed !== undefined) {
      return { providerJobId, status: "succeeded", progress: 1, outputs: [completed.artifact] };
    }
    if (providerJobId.startsWith("ark-image:")) {
      throw new ProviderAdapterError(
        "provider_protocol",
        true,
        "Ark image job cannot be resumed after an incomplete local materialization",
      );
    }
    const credential = credentialValue(context?.credential);
    const taskId = arkTaskId(providerJobId);
    const payload = await requestJson(
      this.#fetch,
      "Ark video",
      ARK_API_BASE_URL + "/contents/generations/tasks/" + encodeURIComponent(taskId),
      { method: "GET", headers: { Authorization: "Bearer " + credential } },
    );
    return this.snapshotForVideoTask(providerJobId, arkVideoTask(payload));
  }

  async *openArtifact(providerJobId: string, artifactId: string): AsyncIterable<Uint8Array> {
    const artifact = this.#jobs.get(providerJobId);
    if (artifact === undefined || artifact.artifact.artifactId !== artifactId) {
      throw new ProviderAdapterError("provider_protocol", false, "Ark artifact is unavailable");
    }
    yield artifact.bytes;
  }

  private async submitImage(
    request: GenerationRequest,
    modelId: string,
    credential: string,
    context: ProviderExecutionContext | undefined,
  ): Promise<ProviderSnapshot> {
    const payload = await requestJson(
      this.#fetch,
      "Ark image",
      ARK_API_BASE_URL + "/images/generations",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + credential,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          prompt: request.prompt,
          ...(request.inputs.length === 0 ? {} : { image: arkImageReferences(request, context) }),
          size: arkImageSize(request),
          response_format: "b64_json",
          output_format: "png",
          sequential_image_generation: "disabled",
          watermark: false,
        }),
      },
    );
    const records = arkImageRecords(payload);
    if (records.length !== 1) {
      throw new ProviderAdapterError("provider_protocol", false, "Ark image response did not contain one image output");
    }
    const record = records[0]!;
    const bytes = record.b64Json !== undefined
      ? bytesFromBase64(record.b64Json, "Ark image")
      : record.url === undefined
        ? undefined
        : await requestArtifactBytes(this.#fetch, "Ark image", arkArtifactUrl(record.url, "Ark image"));
    if (bytes === undefined) {
      throw new ProviderAdapterError("provider_protocol", false, "Ark image response did not contain image bytes");
    }
    const providerJobId = "ark-image:" + request.jobId;
    const artifact = artifactForBytes(providerJobId + ":image", "image", "image/png", bytes);
    this.#jobs.set(providerJobId, { artifact, bytes });
    return { providerJobId, status: "succeeded", progress: 1, outputs: [artifact] };
  }

  private async submitVideo(
    request: GenerationRequest,
    modelId: string,
    credential: string,
    context: ProviderExecutionContext | undefined,
  ): Promise<ProviderSnapshot> {
    const payload = await requestJson(
      this.#fetch,
      "Ark video",
      ARK_API_BASE_URL + "/contents/generations/tasks",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + credential,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          content: arkVideoContent(request, context),
          ...(request.requirements.aspectRatio === undefined ? {} : { ratio: request.requirements.aspectRatio }),
          ...(request.requirements.durationSeconds === undefined ? {} : { duration: request.requirements.durationSeconds }),
          ...(request.requirements.audio === "required" ? { generate_audio: true } : {}),
          ...(request.requirements.audio === "forbidden" ? { generate_audio: false } : {}),
          watermark: false,
        }),
      },
    );
    const task = arkVideoTask(payload);
    if (task.id === undefined) {
      throw new ProviderAdapterError("provider_protocol", false, "Ark video response did not contain a task id");
    }
    return this.snapshotForVideoTask("ark-video:" + task.id, task);
  }

  private async snapshotForVideoTask(providerJobId: string, task: ArkVideoTask): Promise<ProviderSnapshot> {
    if (task.status === "succeeded" || task.status === "completed") {
      if (task.videoUrl === undefined) {
        throw new ProviderAdapterError("provider_protocol", false, "Ark video task completed without an artifact URL");
      }
      const bytes = await requestArtifactBytes(this.#fetch, "Ark video", arkArtifactUrl(task.videoUrl, "Ark video"));
      const artifact = artifactForBytes(providerJobId + ":video", "video", "video/mp4", bytes);
      this.#jobs.set(providerJobId, { artifact, bytes });
      return { providerJobId, status: "succeeded", progress: 1, outputs: [artifact] };
    }
    if (task.status === "failed" || task.status === "cancelled" || task.status === "expired") {
      return {
        providerJobId,
        status: "failed",
        error: {
          code: "provider_rejected",
          retryable: false,
          message: "Ark video task was rejected or expired",
        },
      };
    }
    return { providerJobId, status: task.status === "queued" ? "queued" : "running", progress: 0 };
  }
}

export class MockProviderAdapter implements ProviderAdapter {
  readonly manifest: ProviderManifest = {
    providerId: "mock",
    capabilities: [
      {
        modelId: "mock-image-v1",
        kind: "image",
        inputKinds: ["text", "image", "video"],
        outputMediaTypes: ["image/png"],
        aspectRatios: ["1:1"],
        sizes: [{ width: 1, height: 1 }],
        maxOutputs: 1,
        audio: "never",
        registryPriority: 1000,
      },
      {
        modelId: "mock-video-v1",
        kind: "video",
        inputKinds: ["text", "image", "video"],
        outputMediaTypes: ["video/mp4"],
        aspectRatios: ["16:9"],
        sizes: [{ width: 32, height: 18 }],
        durationsSeconds: [5],
        maxOutputs: 1,
        audio: "never",
        registryPriority: 1000,
      },
    ],
  };
  readonly #jobs = new Map<string, { request: GenerationRequest; polls: number }>();

  async submit(request: GenerationRequest, modelId: string): Promise<ProviderSnapshot> {
    if (request.prompt.trim() === "") throw new Error("Generation prompt must not be empty");
    const capability = this.manifest.capabilities.find((candidate) => candidate.modelId === modelId);
    if (!capability || capability.kind !== request.kind) throw new Error(`Unsupported mock model: ${modelId}`);
    const providerJobId = `mock:${canonicalSha256(request).slice("sha256:".length)}`;
    this.#jobs.set(providerJobId, { request: structuredClone(request), polls: 0 });
    return { providerJobId, status: "queued", progress: 0 };
  }

  async poll(providerJobId: string): Promise<ProviderSnapshot> {
    const job = this.#jobs.get(providerJobId);
    if (!job) throw new Error(`Unknown mock job: ${providerJobId}`);
    job.polls += 1;
    if (job.request.prompt.startsWith("[mock:fail]")) {
      return {
        providerJobId,
        status: "failed",
        error: { code: "provider_rejected", retryable: false, message: "deterministic mock failure" },
      };
    }
    if (job.polls === 1) return { providerJobId, status: "running", progress: 0.5 };
    return { providerJobId, status: "succeeded", progress: 1, outputs: [artifact(job.request.kind).record] };
  }

  async *openArtifact(providerJobId: string, artifactId: string): AsyncIterable<Uint8Array> {
    const job = this.#jobs.get(providerJobId);
    if (!job) throw new Error(`Unknown mock job: ${providerJobId}`);
    const output = artifact(job.request.kind);
    if (output.record.artifactId !== artifactId) throw new Error(`Unknown mock artifact: ${artifactId}`);
    yield output.bytes;
  }
}
