import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  MockProviderAdapter,
  OpenAISpeechAdapter,
  ProviderAdapterError,
  addNode,
  applyProviderSnapshot,
  completeGeneration,
  connectNodes,
  copyDraft,
  createGroup,
  createProject,
  deleteNode,
  disconnectEdge,
  expandScriptIntoShots,
  failGeneration,
  loadProject,
  MAX_SCRIPT_SHOTS,
  moveNodes,
  isLayoutGroup,
  resumeGeneration,
  resetNodeGeneration,
  selectNodeOutput,
  effectiveOutputAssetIds,
  registerImportedAsset,
  saveProjectAtomic,
  selectProviderRoute,
  startGeneration,
  updateNode,
  writeAssetBytes,
  type CanvasDocument,
  type CompositionSpec,
  type Draft,
  type GenerationRequest,
  type LayoutGroupNode,
  type Node,
  type ProviderAdapter,
  type ProviderExecutionContext,
  type ProviderSnapshot,
  type ResolvedRoute,
  type ShotSpec,
  createProviderCredential,
} from "@open-canvas/core";

import { CliUsageError, numberFlag, optionalFlag, requiredFlag, type ParsedArgs } from "./args.js";
import { startPreviewBridge } from "./preview-bridge.js";
import {
  createConfiguredProviderAdapters,
  loadProviderConfiguration,
  withPersistedRouteModel,
  type ProviderConfiguration,
} from "./provider-config.js";

function draftFor(document: CanvasDocument, draftId?: string): Draft {
  const id = draftId ?? document.activeDraftId;
  const draft = document.drafts.find((candidate) => candidate.id === id);
  if (!draft) throw new CliUsageError(`Unknown draft: ${id}`);
  return draft;
}

async function saveMutation(projectDirectory: string, before: CanvasDocument, after: CanvasDocument): Promise<void> {
  await saveProjectAtomic(projectDirectory, after, { expectedCurrentRevision: before.revision });
}

function isLocalStudioOrigin(url: URL): boolean {
  return url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]");
}

async function startDetachedPreviewBridge(projectDirectory: string): Promise<{ bridgeUrl: string; token: string }> {
  const entrypoint = process.argv[1];
  if (!entrypoint) throw new Error("Unable to locate the Open Canvas CLI entrypoint");
  const token = randomBytes(24).toString("base64url");
  const child = spawn(process.execPath, [
    ...process.execArgv,
    entrypoint,
    "preview-bridge",
    "--project", projectDirectory,
    "--token", token,
    "--port", "0",
  ], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  child.unref();
  if (!child.stdout) throw new Error("Unable to start the local Studio bridge");
  child.stdout.setEncoding("utf8");

  return new Promise((resolveBridge, rejectBridge) => {
    let output = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.destroy();
      callback();
    };
    const fail = (error: Error) => finish(() => rejectBridge(error));
    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error("Timed out while starting the local Studio bridge"));
    }, 5_000);
    child.once("error", (error) => fail(error));
    child.once("exit", (code) => {
      if (!settled) fail(new Error(`Local Studio bridge exited before becoming ready (${code ?? "unknown"})`));
    });
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      const lineBreak = output.indexOf("\n");
      if (lineBreak < 0) return;
      try {
        const ready = JSON.parse(output.slice(0, lineBreak)) as { bridgeUrl?: unknown };
        if (typeof ready.bridgeUrl !== "string") throw new Error("Local Studio bridge returned an invalid address");
        const bridgeUrl = new URL(ready.bridgeUrl);
        if (!isLocalStudioOrigin(bridgeUrl)) throw new Error("Local Studio bridge did not bind to a loopback address");
        finish(() => resolveBridge({ bridgeUrl: bridgeUrl.toString().replace(/\/$/, ""), token }));
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Unable to read the local Studio bridge address"));
      }
    });
  });
}

async function collectBytes(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return Buffer.concat(chunks);
}

interface ProviderRuntime {
  adapter: ProviderAdapter;
  context: ProviderExecutionContext;
}

function explicitMockRoute(node: Node, route?: ResolvedRoute): boolean {
  if (route?.providerId === "mock") return true;
  if (node.spec.kind !== "shot") return false;
  const override = node.spec.routing?.promptOverride;
  return override?.providerId === "mock" || override?.modelId?.startsWith("mock-") === true;
}

function providerAdaptersFor(
  node: Node,
  configurations: readonly ProviderConfiguration[],
  route?: ResolvedRoute,
): ProviderAdapter[] {
  const configured = route !== undefined && node.spec.kind === "shot"
    ? withPersistedRouteModel(configurations, route, node.spec.mediaKind)
    : configurations;
  const adapters = createConfiguredProviderAdapters(configured);
  if (explicitMockRoute(node, route)) adapters.push(new MockProviderAdapter());
  return adapters;
}

function configuredProviderAvailability(adapters: readonly ProviderAdapter[]) {
  return {
    has(providerId: string): boolean {
      const adapter = adapters.find((candidate) => candidate.manifest.providerId === providerId);
      const credentialEnv = adapter?.manifest.credentialEnv;
      return credentialEnv === undefined || (process.env[credentialEnv]?.trim() ?? "") !== "";
    },
  };
}

function resolveRouteForNode(
  request: GenerationRequest,
  node: Node,
  configurations: readonly ProviderConfiguration[],
): ResolvedRoute {
  if (node.spec.kind !== "shot") {
    throw new CliUsageError("Composition rendering is not implemented; generate the underlying shot nodes first");
  }
  const adapters = providerAdaptersFor(node, configurations);
  return selectProviderRoute(adapters, {
    request,
    ...(node.spec.routing?.promptOverride === undefined ? {} : { promptOverride: node.spec.routing.promptOverride }),
    ...(node.spec.routing?.aiChoice === undefined ? {} : { aiChoice: node.spec.routing.aiChoice }),
    credentials: configuredProviderAvailability(adapters),
  });
}

function providerContext(adapter: ProviderAdapter): ProviderExecutionContext {
  const credentialEnv = adapter.manifest.credentialEnv;
  if (credentialEnv === undefined) return {};
  const credential = process.env[credentialEnv];
  if (credential === undefined || credential.trim() === "") {
    throw new ProviderAdapterError("missing_credential", false, "The selected provider requires " + credentialEnv);
  }
  return { credential: createProviderCredential(credential) };
}

function providerRuntimeFor(
  route: ResolvedRoute,
  node: Node,
  configurations: readonly ProviderConfiguration[],
): ProviderRuntime {
  const adapters = providerAdaptersFor(node, configurations, route);
  const adapter = adapters.find(
    (candidate) =>
      candidate.manifest.providerId === route.providerId
      && candidate.manifest.capabilities.some((capability) => capability.modelId === route.modelId),
  );
  if (adapter === undefined) {
    throw new Error("The persisted provider route is not available in this local CLI");
  }
  return { adapter, context: providerContext(adapter) };
}

async function localInputBytes(
  projectDirectory: string,
  document: CanvasDocument,
  request: GenerationRequest,
): Promise<Map<string, Uint8Array>> {
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const result = new Map<string, Uint8Array>();
  for (const input of request.inputs) {
    const asset = assets.get(input.assetId);
    if (asset === undefined) throw new Error("Generation input asset is missing from the project document");
    const bytes = await readFile(join(projectDirectory, asset.path));
    const checksumSha256 = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== asset.byteLength || checksumSha256 !== asset.checksumSha256) {
      throw new Error("Generation input asset integrity check failed");
    }
    result.set(input.assetId, bytes);
  }
  return result;
}

function pollSetting(args: ParsedArgs, name: string, fallback: number): number {
  const value = optionalNumber(args, name);
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 0) {
    throw new CliUsageError("--" + name + " must be a non-negative integer");
  }
  return result;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function providerFailure(error: unknown): {
  code: "provider_rejected" | "provider_unavailable" | "provider_protocol" | "missing_credential";
  retryable: boolean;
  message: string;
} {
  if (error instanceof ProviderAdapterError) {
    return { code: error.code, retryable: error.retryable, message: error.message };
  }
  return {
    code: "provider_protocol",
    retryable: true,
    message: "Generation adapter failed without a safe provider response",
  };
}

function optionalNumber(args: ParsedArgs, name: string): number | undefined {
  const value = optionalFlag(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CliUsageError(`Invalid number for --${name}`);
  return parsed;
}

function requiredFiniteNumber(args: ParsedArgs, name: string): number {
  const value = requiredFlag(args, name);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CliUsageError(`Invalid number for --${name}`);
  return parsed;
}

function inferredMediaType(filePath: string): string | undefined {
  const extension = extname(filePath).toLowerCase();
  return {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
  }[extension];
}

function importedAssetKind(mediaType: string, requestedKind?: string): "image" | "video" | "audio" {
  if (requestedKind !== undefined) {
    if (requestedKind !== "image" && requestedKind !== "video" && requestedKind !== "audio") {
      throw new CliUsageError(`Invalid asset kind: ${requestedKind}`);
    }
    if (!mediaType.startsWith(`${requestedKind}/`)) {
      throw new CliUsageError(`Asset kind ${requestedKind} does not match media type ${mediaType}`);
    }
    return requestedKind;
  }
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("audio/")) return "audio";
  throw new CliUsageError("Cannot infer asset kind; pass --kind image, video or audio with a matching --media-type");
}

type LocalMediaInput = {
  bytes: Buffer;
  mediaType: string;
  kind: "image" | "video" | "audio";
};

async function readLocalMediaInput(args: ParsedArgs, emptyFileMessage: string): Promise<LocalMediaInput> {
  const filePath = resolve(requiredFlag(args, "file"));
  const bytes = await readFile(filePath);
  if (bytes.length === 0) throw new CliUsageError(emptyFileMessage);
  const mediaType = optionalFlag(args, "media-type") ?? inferredMediaType(filePath);
  if (!mediaType) throw new CliUsageError("Cannot infer media type; pass --media-type");
  return { bytes, mediaType, kind: importedAssetKind(mediaType, optionalFlag(args, "kind")) };
}

// `asset-library` remains readable in schema v1 for old documents, but new
// local projects intentionally model references and reusable direction as
// ordinary canvas nodes rather than a project-wide library.
const COMPOSITION_NODE_ROLES = [
  "composition",
  "text",
  "smart-edit",
  "director",
  "frame-analysis",
  "audio",
  "script",
  "asset-reference",
  "character",
  "scene-style",
] as const;

type CompositionNodeRole = (typeof COMPOSITION_NODE_ROLES)[number];

function helpCommand() {
  return {
    usage: "open-canvas <command> [options]",
    commands: [
      "init <directory> --title <title>",
      "status --project <directory> [--draft <id>]",
      "context --project <directory> [--draft <id>] [--node <id> --depth 0..4]",
      "node add --project <directory> --kind shot|composition --title <title> ... [--count 1|2|4 for image]",
      "node update --project <directory> --node <id> ...",
      "node delete --project <directory> --node <id>",
      "node move --project <directory> --node <id> --x <number> --y <number>",
      "node copy --project <directory> --node <id> [--title <title>] [--x <number> --y <number>]",
      "group create --project <directory> --members <node-id,node-id,...> [--title <title>]",
      "edge connect --project <directory> --source <id> --target <id> --kind dependency|sequence",
      "edge disconnect --project <directory> --edge <id>",
      "script expand --project <directory> --node <script-node-id> [--limit 1..8] [--prompt <script>]",
      "asset import --project <directory> --file <path>",
      "result import --project <directory> --node <id> --file <path> [--provider <id> --model <id>]",
      "result select --project <directory> --node <id> --asset <asset-id>",
      "node add --project <directory> --kind shot --media-kind audio --title <title> --prompt <speech-text> [--voice coral] [--speed 1] [--media-type audio/wav|audio/mpeg]",
      "draft copy --project <directory> --title <title> [--source <id>]",
      "provider list [--provider-config <path>]",
      "generate --project <directory> --node <id> [--provider-config <path>]",
      "open --project <directory> [--no-open]",
      "export --project <directory> --draft <id> --output <path> [--node <id>]",
    ],
    localContext: [
      "Use composition roles text, script, character, scene-style, or asset-reference for project-local context.",
      "Use group create to persist a project-local layout frame around two or more canvas nodes; it never creates a global library.",
      "Use context before an existing-project edit to obtain semantic nodes, local graph relationships, assets, and safe job state without reading project.json directly.",
      "Use script expand to turn one project-local script node into editable video shots plus explicit dependency and sequence edges.",
      "Import media with asset import, then associate it with a node; no global role or material library is created.",
      "open starts a loopback bridge for the selected local project; Studio saves explicitly through revision-checked CLI persistence.",
    ],
    generation: {
      default: "Selects an eligible configured local BYOK route; it never silently falls back to mock.",
      configuredRoutes: [
        "Use --provider-config <path> or OPEN_CANVAS_PROVIDER_CONFIG to select non-secret provider instances, models/endpoints, priority, and credential environment-variable names.",
        "Without a config file, the legacy defaults are volcengine-ark (ARK_API_KEY, optional OPEN_CANVAS_ARK_IMAGE_MODEL / OPEN_CANVAS_ARK_VIDEO_MODEL), openai (OPENAI_API_KEY), and google-gemini (GEMINI_API_KEY).",
        "provider list exposes only safe provider metadata and whether each local credential environment variable is set.",
      ],
      deterministicDemo: "Use an explicit mock route only for local demos or tests.",
    },
  };
}

async function providerListCommand(args: ParsedArgs): Promise<unknown> {
  const configPath = optionalFlag(args, "provider-config");
  const loaded = await loadProviderConfiguration(configPath === undefined ? {} : { path: configPath });
  const adapters = createConfiguredProviderAdapters(loaded.providers);
  return {
    source: loaded.source,
    ...(loaded.path === undefined ? {} : { configPath: loaded.path }),
    providers: adapters.map((adapter) => ({
      id: adapter.manifest.providerId,
      ...(adapter.manifest.credentialEnv === undefined ? {} : {
        credentialEnv: adapter.manifest.credentialEnv,
        configured: (process.env[adapter.manifest.credentialEnv]?.trim() ?? "") !== "",
      }),
      capabilities: adapter.manifest.capabilities.map((capability) => ({
        modelId: capability.modelId,
        kind: capability.kind,
        inputKinds: [...capability.inputKinds],
        ...(capability.maxInputs === undefined ? {} : { maxInputs: capability.maxInputs }),
        outputMediaTypes: [...capability.outputMediaTypes],
        ...(capability.sizes === undefined ? {} : { sizes: capability.sizes.map((size) => ({ ...size })) }),
        ...(capability.durationsSeconds === undefined ? {} : { durationsSeconds: [...capability.durationsSeconds] }),
        ...(capability.maxOutputs === undefined ? {} : { maxOutputs: capability.maxOutputs }),
        priority: capability.registryPriority,
      })),
    })),
  };
}

const COMPOSITION_ROLE_MEDIA_TYPES: Record<CompositionNodeRole, string> = {
  composition: "video/mp4",
  text: "text/plain",
  "smart-edit": "video/mp4",
  director: "application/json",
  "frame-analysis": "application/json",
  audio: "audio/mpeg",
  script: "text/plain",
  "asset-reference": "application/json",
  character: "application/json",
  "scene-style": "application/json",
};

function splitAssetIds(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function compositionSpecFromArgs(args: ParsedArgs, current?: CompositionSpec): CompositionSpec {
  const requestedRole = optionalFlag(args, "role") ?? current?.role ?? "composition";
  if (!COMPOSITION_NODE_ROLES.includes(requestedRole as CompositionNodeRole)) {
    throw new CliUsageError(`Invalid composition role: ${requestedRole}`);
  }
  const role = requestedRole as CompositionNodeRole;
  const prompt = optionalFlag(args, "prompt") ?? current?.prompt;
  if (role !== "composition" && !prompt) {
    throw new CliUsageError(`Missing --prompt for ${role} context node`);
  }
  if (role === "composition" && prompt !== undefined) {
    throw new CliUsageError("--prompt requires a non-composition --role");
  }
  return {
    kind: "composition",
    mediaType: optionalFlag(args, "media-type") ?? current?.mediaType ?? COMPOSITION_ROLE_MEDIA_TYPES[role],
    ...(role === "composition" ? {} : { role }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(() => {
      const specified = optionalFlag(args, "reference-assets");
      const inherited = Array.isArray(current?.referenceAssetIds)
        ? current.referenceAssetIds.filter((assetId): assetId is string => typeof assetId === "string")
        : undefined;
      const referenceAssetIds = specified === undefined ? inherited : splitAssetIds(specified);
      return referenceAssetIds && referenceAssetIds.length > 0 ? { referenceAssetIds } : {};
    })(),
  };
}

function shotSpecFromArgs(args: ParsedArgs, current?: ShotSpec): ShotSpec {
  const provider = optionalFlag(args, "provider");
  const model = optionalFlag(args, "model");
  const aiProvider = optionalFlag(args, "ai-provider");
  const aiModel = optionalFlag(args, "ai-model");
  const promptProvider = provider ?? current?.routing?.promptOverride?.providerId;
  const promptModel = model ?? current?.routing?.promptOverride?.modelId;
  const promptOverride = provider === undefined && model === undefined
    ? current?.routing?.promptOverride
    : {
        ...(promptProvider === undefined ? {} : { providerId: promptProvider }),
        ...(promptModel === undefined ? {} : { modelId: promptModel }),
      };
  const plannedProvider = aiProvider ?? current?.routing?.aiChoice?.providerId;
  const plannedModel = aiModel ?? current?.routing?.aiChoice?.modelId;
  const aiChoice = aiProvider === undefined && aiModel === undefined
    ? current?.routing?.aiChoice
    : {
        ...(plannedProvider === undefined ? {} : { providerId: plannedProvider }),
        ...(plannedModel === undefined ? {} : { modelId: plannedModel }),
      };
  const routing = {
    ...(promptOverride === undefined ? {} : { promptOverride }),
    ...(aiChoice === undefined ? {} : { aiChoice }),
  };
  const mediaKind = optionalFlag(args, "media-kind") ?? current?.mediaKind ?? "video";
  if (mediaKind !== "image" && mediaKind !== "video" && mediaKind !== "audio") throw new CliUsageError(`Invalid media kind: ${mediaKind}`);
  const requestedCount = optionalNumber(args, "count");
  if (requestedCount !== undefined && (!Number.isSafeInteger(requestedCount) || requestedCount < 1 || requestedCount > 4)) {
    throw new CliUsageError("--count must be an integer from 1 to 4");
  }
  if (mediaKind !== "image" && requestedCount !== undefined) {
    throw new CliUsageError("--count is currently supported only for image shots");
  }
  const aspectRatio = optionalFlag(args, "aspect-ratio") ?? current?.requirements?.aspectRatio;
  const width = optionalNumber(args, "width") ?? current?.requirements?.width;
  const height = optionalNumber(args, "height") ?? current?.requirements?.height;
  // Moving a legacy image node to video drops its image-only candidate
  // constraint instead of leaving a misleading `count: 1` behind.
  const count = mediaKind === "image" ? requestedCount ?? current?.requirements?.count : undefined;
  const durationSeconds = optionalNumber(args, "duration-seconds") ?? current?.requirements?.durationSeconds;
  const audio = optionalFlag(args, "audio") ?? current?.requirements?.audio;
  const mediaType = optionalFlag(args, "media-type") ?? current?.requirements?.mediaType;
  const voice = optionalFlag(args, "voice") ?? current?.requirements?.voice;
  const speed = optionalNumber(args, "speed") ?? current?.requirements?.speed;
  const requirements = {
    ...(voice === undefined ? {} : { voice }),
    ...(speed === undefined ? {} : { speed }),
    ...(aspectRatio === undefined ? {} : { aspectRatio: aspectRatio as "16:9" | "9:16" | "1:1" }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(count === undefined ? {} : { count }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(audio === undefined ? {} : { audio: audio as "required" | "forbidden" | "either" }),
    ...(mediaType === undefined ? {} : { mediaType }),
  };
  const inputAssets = optionalFlag(args, "input-assets");
  const inputAssetIds = inputAssets === undefined
    ? current?.inputAssetIds ?? []
    : inputAssets.split(",").map((value) => value.trim()).filter(Boolean);
  const prompt = optionalFlag(args, "prompt") ?? current?.prompt;
  if (!prompt) throw new CliUsageError("Missing --prompt");
  return {
    kind: "shot",
    prompt,
    mediaKind,
    inputAssetIds,
    ...(Object.keys(requirements).length === 0 ? {} : { requirements }),
    ...(Object.keys(routing).length === 0 ? {} : { routing }),
  };
}

export async function runCommand(args: ParsedArgs): Promise<unknown> {
  const [command, subcommand] = args.positionals;
  if (args.flags.has("help") || command === "help") return helpCommand();
  if (command === "init") return initCommand(args);
  if (command === "node" && subcommand === "add") return addNodeCommand(args);
  if (command === "node" && subcommand === "update") return updateNodeCommand(args);
  if (command === "node" && subcommand === "delete") return deleteNodeCommand(args);
  if (command === "node" && subcommand === "move") return moveNodeCommand(args);
  if (command === "node" && subcommand === "copy") return copyNodeCommand(args);
  if (command === "group" && subcommand === "create") return createGroupCommand(args);
  if (command === "edge" && subcommand === "connect") return connectCommand(args);
  if (command === "edge" && subcommand === "disconnect") return disconnectCommand(args);
  if (command === "script" && subcommand === "expand") return expandScriptCommand(args);
  if (command === "asset" && subcommand === "import") return importAssetCommand(args);
  if (command === "result" && subcommand === "import") return importGenerationResultCommand(args);
  if (command === "result" && subcommand === "select") return selectResultCommand(args);
  if (command === "provider" && subcommand === "list") return providerListCommand(args);
  if (command === "draft" && subcommand === "copy") return copyDraftCommand(args);
  if (command === "generate") return generateCommand(args);
  if (command === "status") return statusCommand(args);
  if (command === "context") return contextCommand(args);
  if (command === "preview-bridge") return previewBridgeCommand(args);
  if (command === "preview" || command === "open") return previewCommand(args);
  if (command === "export") return exportCommand(args);
  throw new CliUsageError("Unknown command. Use init, context, node add/update/delete/move/copy, group create, edge connect/disconnect, script expand, asset import, result import, provider list, draft copy, generate, status, open/preview, or export.");
}

async function initCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = args.positionals[1];
  if (!projectDirectory) throw new CliUsageError("Usage: open-canvas init <directory> --title <title>");
  const draftTitle = optionalFlag(args, "draft-title");
  const document = createProject({
    title: requiredFlag(args, "title"),
    ...(draftTitle === undefined ? {} : { draftTitle }),
  });
  await saveProjectAtomic(resolve(projectDirectory), document, { createOnly: true });
  return { projectPath: join(resolve(projectDirectory), "project.json"), revision: document.revision, activeDraftId: document.activeDraftId };
}

async function addNodeCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const kind = requiredFlag(args, "kind");
  const spec = kind === "shot"
    ? shotSpecFromArgs(args)
    : kind === "composition"
      ? compositionSpecFromArgs(args)
      : (() => { throw new CliUsageError(`Invalid node kind: ${kind}`); })();
  const after = addNode(before, {
    draftId: draft.id,
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
    title: requiredFlag(args, "title"),
    position: { x: numberFlag(args, "x", 0), y: numberFlag(args, "y", 0) },
    spec,
  });
  await saveMutation(projectDirectory, before, after);
  const node = draftFor(after, draft.id).nodes.at(-1)!;
  return { draftId: draft.id, nodeId: node.id, revision: after.revision, draftRevision: draftFor(after, draft.id).revision };
}

async function createGroupCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const memberNodeIds = splitAssetIds(requiredFlag(args, "members"));
  const title = optionalFlag(args, "title");
  if (memberNodeIds.length < 2) throw new CliUsageError("group create requires at least two comma-separated --members");
  if (new Set(memberNodeIds).size !== memberNodeIds.length) {
    throw new CliUsageError("group create --members cannot repeat a node ID");
  }
  const after = createGroup(before, {
    draftId: draft.id,
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
    memberNodeIds,
    ...(title === undefined ? {} : { title }),
  });
  await saveMutation(projectDirectory, before, after);
  const group = draftFor(after, draft.id).nodes.at(-1)!;
  return {
    draftId: draft.id,
    groupNodeId: group.id,
    memberNodeIds: [...memberNodeIds],
    revision: after.revision,
    draftRevision: draftFor(after, draft.id).revision,
  };
}

async function updateNodeCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const title = optionalFlag(args, "title");
  const prompt = optionalFlag(args, "prompt");
  const nodeId = requiredFlag(args, "node");
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new CliUsageError(`Unknown node: ${nodeId}`);
  const specFlags = [
    "prompt", "media-kind", "input-assets", "aspect-ratio", "width", "height",
    "count", "duration-seconds", "audio", "media-type", "provider", "model", "ai-provider", "ai-model",
    "role", "reference-assets",
  ];
  const hasSpecUpdate = specFlags.some((name) => args.flags.has(name));
  if (title === undefined && !hasSpecUpdate) throw new CliUsageError("node update requires --title or a node spec field");
  const spec = hasSpecUpdate
    ? node.spec.kind === "shot"
      ? shotSpecFromArgs(args, node.spec)
      : compositionSpecFromArgs(args, node.spec)
    : undefined;
  const after = updateNode(before, {
    draftId: draft.id,
    nodeId,
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
    ...(title === undefined ? {} : { title }),
    ...(spec === undefined ? {} : { spec }),
    ...(spec === undefined && prompt !== undefined ? { prompt } : {}),
  });
  await saveMutation(projectDirectory, before, after);
  return { draftId: draft.id, nodeId, revision: after.revision, draftRevision: draftFor(after, draft.id).revision };
}

async function deleteNodeCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const nodeId = requiredFlag(args, "node");
  if (!draft.nodes.some((candidate) => candidate.id === nodeId)) {
    throw new CliUsageError(`Unknown node: ${nodeId}`);
  }
  const removedEdgeCount = draft.edges.filter(
    (edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId,
  ).length;
  const removedJobCount = draft.jobs.filter((job) => job.nodeId === nodeId).length;
  const after = deleteNode(before, {
    draftId: draft.id,
    nodeId,
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
  });
  await saveMutation(projectDirectory, before, after);
  return {
    draftId: draft.id,
    nodeId,
    removedEdgeCount,
    removedJobCount,
    revision: after.revision,
    draftRevision: draftFor(after, draft.id).revision,
  };
}

function isLayoutGroupNode(node: Node): node is LayoutGroupNode {
  return isLayoutGroup(node);
}

function copiedNodeTitle(draft: Draft, sourceTitle: string): string {
  const base = `${sourceTitle} 副本`;
  if (!draft.nodes.some((node) => node.title === base)) return base;
  let suffix = 2;
  while (draft.nodes.some((node) => node.title === `${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function copiedNodePosition(args: ParsedArgs, source: Node): { x: number; y: number } {
  const x = optionalNumber(args, "x");
  const y = optionalNumber(args, "y");
  if ((x === undefined) !== (y === undefined)) {
    throw new CliUsageError("node copy requires both --x and --y when positioning a copy");
  }
  return x === undefined || y === undefined
    ? { x: source.position.x + 48, y: source.position.y + 48 }
    : { x, y };
}

async function moveNodeCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const nodeId = requiredFlag(args, "node");
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new CliUsageError(`Unknown node: ${nodeId}`);
  if (isLayoutGroupNode(node)) {
    throw new CliUsageError("node move cannot move a layout group; move its member nodes through this CLI or use Studio");
  }
  const position = { x: requiredFiniteNumber(args, "x"), y: requiredFiniteNumber(args, "y") };
  const after = moveNodes(before, {
    draftId: draft.id,
    updates: [{ nodeId, position }],
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
  });
  await saveMutation(projectDirectory, before, after);
  return {
    draftId: draft.id,
    nodeId,
    position,
    revision: after.revision,
    draftRevision: draftFor(after, draft.id).revision,
  };
}

async function copyNodeCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const sourceNodeId = requiredFlag(args, "node");
  const source = draft.nodes.find((candidate) => candidate.id === sourceNodeId);
  if (!source) throw new CliUsageError(`Unknown node: ${sourceNodeId}`);
  if (isLayoutGroupNode(source)) {
    throw new CliUsageError("node copy cannot copy a layout group; groups are local frames around existing nodes");
  }
  const after = addNode(before, {
    draftId: draft.id,
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
    title: optionalFlag(args, "title") ?? copiedNodeTitle(draft, source.title),
    position: copiedNodePosition(args, source),
    spec: structuredClone(source.spec),
  });
  const copied = draftFor(after, draft.id).nodes.at(-1);
  if (!copied) throw new Error("Unable to copy node");
  await saveMutation(projectDirectory, before, after);
  return {
    draftId: draft.id,
    sourceNodeId,
    nodeId: copied.id,
    position: copied.position,
    revision: after.revision,
    draftRevision: draftFor(after, draft.id).revision,
  };
}

async function connectCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const kind = requiredFlag(args, "kind");
  if (kind !== "dependency" && kind !== "sequence") throw new CliUsageError(`Invalid edge kind: ${kind}`);
  const after = connectNodes(before, {
    draftId: draft.id,
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
    kind,
    sourceNodeId: requiredFlag(args, "source"),
    targetNodeId: requiredFlag(args, "target"),
  });
  await saveMutation(projectDirectory, before, after);
  return { draftId: draft.id, edgeId: draftFor(after, draft.id).edges.at(-1)!.id, revision: after.revision };
}

async function disconnectCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const edgeId = requiredFlag(args, "edge");
  if (!draft.edges.some((edge) => edge.id === edgeId)) {
    throw new CliUsageError(`Unknown edge: ${edgeId}`);
  }
  const after = disconnectEdge(before, {
    draftId: draft.id,
    edgeId,
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
  });
  await saveMutation(projectDirectory, before, after);
  return {
    draftId: draft.id,
    edgeId,
    revision: after.revision,
    draftRevision: draftFor(after, draft.id).revision,
  };
}

function scriptShotLimit(args: ParsedArgs): number | undefined {
  const limit = optionalNumber(args, "limit");
  if (limit === undefined) return undefined;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SCRIPT_SHOTS) {
    throw new CliUsageError(`--limit must be an integer from 1 to ${MAX_SCRIPT_SHOTS}`);
  }
  return limit;
}

async function expandScriptCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const scriptNodeId = requiredFlag(args, "node");
  const scriptNode = draft.nodes.find((node) => node.id === scriptNodeId);
  if (!scriptNode) throw new CliUsageError(`Unknown node: ${scriptNodeId}`);
  if (scriptNode.spec.kind !== "composition" || scriptNode.spec.role !== "script") {
    throw new CliUsageError("script expand requires a node with --role script");
  }
  const prompt = optionalFlag(args, "prompt");
  const limit = scriptShotLimit(args);
  const expanded = expandScriptIntoShots(before, {
    draftId: draft.id,
    scriptNodeId,
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
    ...(prompt === undefined ? {} : { prompt }),
    ...(limit === undefined ? {} : { limit }),
  });
  await saveMutation(projectDirectory, before, expanded.document);
  const nextDraft = draftFor(expanded.document, draft.id);
  return {
    draftId: draft.id,
    scriptNodeId,
    shotNodeIds: expanded.shotNodeIds,
    shotPrompts: expanded.shotPrompts,
    revision: expanded.document.revision,
    draftRevision: nextDraft.revision,
  };
}

async function importAssetCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const { bytes, mediaType, kind } = await readLocalMediaInput(args, "Cannot import an empty file");
  const before = await loadProject(projectDirectory);
  const checksumSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const registered = registerImportedAsset(before, {
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    kind,
    mediaType,
    byteLength: bytes.length,
    checksumSha256,
  });
  await writeAssetBytes(projectDirectory, registered.asset.path, bytes);
  if (registered.created) await saveMutation(projectDirectory, before, registered.document);
  return {
    assetId: registered.asset.id,
    assetPath: registered.asset.path,
    kind: registered.asset.kind,
    mediaType: registered.asset.mediaType,
    byteLength: registered.asset.byteLength,
    revision: registered.document.revision,
    imported: registered.created,
  };
}

/**
 * Materialize a media file already produced by a local agent or tool as the
 * successful output of a canvas node. This is deliberately separate from
 * `asset import`: the latter creates a reusable project-local input, while
 * this command creates a traceable generation job and output asset.
 */
async function importGenerationResultCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const { bytes, mediaType, kind } = await readLocalMediaInput(args, "Cannot import an empty generation result");

  const before = await loadProject(projectDirectory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const nodeId = requiredFlag(args, "node");
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new CliUsageError(`Unknown node: ${nodeId}`);
  if (node.execution.status !== "dirty" && node.execution.status !== "failed") {
    throw new CliUsageError("result import requires a dirty or failed node");
  }
  if (node.spec.kind === "composition" && (node.spec.role ?? "composition") !== "composition") {
    throw new CliUsageError("result import cannot target a context node");
  }
  if (isLayoutGroup(node)) throw new CliUsageError("result import cannot target a layout group");

  const expectedMediaType = node.spec.kind === "shot"
    ? node.spec.requirements?.mediaType ?? (node.spec.mediaKind === "image" ? "image/png" : node.spec.mediaKind === "audio" ? "audio/wav" : "video/mp4")
    : node.spec.mediaType;
  const expectedKind = node.spec.kind === "shot" ? node.spec.mediaKind : importedAssetKind(expectedMediaType);
  const expectedOutputCount = node.spec.kind === "shot" ? node.spec.requirements?.count ?? 1 : 1;
  if (expectedOutputCount !== 1) {
    throw new CliUsageError("result import supports exactly one output; use generate for multi-candidate image jobs");
  }
  if (kind !== expectedKind || (kind !== "audio" && mediaType !== expectedMediaType)) {
    throw new CliUsageError(`Imported result must be ${expectedKind}/${expectedMediaType}`);
  }

  const providerId = optionalFlag(args, "provider") ?? "local-import";
  const modelId = optionalFlag(args, "model") ?? "external-media-v1";
  const route: ResolvedRoute = {
    providerId,
    modelId,
    selectionSource: optionalFlag(args, "provider") === undefined && optionalFlag(args, "model") === undefined
      ? "registry_default"
      : "prompt_override",
  };
  const prepared = kind === "audio" && mediaType !== expectedMediaType && node.spec.kind === "shot"
    ? updateNode(before, {
      draftId: draft.id, nodeId, spec: { ...node.spec, requirements: { ...node.spec.requirements, mediaType } },
      expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
      expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision),
    }) : before;
  const started = startGeneration(prepared, {
    draftId: draft.id,
    nodeId,
    expectedProjectRevision: prepared === before ? numberFlag(args, "expected-project-revision", before.revision) : prepared.revision,
    expectedDraftRevision: prepared === before ? numberFlag(args, "expected-draft-revision", draft.revision) : draftFor(prepared, draft.id).revision,
    resolveRoute: () => route,
  });
  const providerJobId = `local:${createHash("sha256").update(bytes).digest("hex")}`;
  const completed = completeGeneration(started.document, {
    draftId: draft.id,
    jobId: started.request.jobId,
    providerJobId,
    artifact: { kind, mediaType, bytes },
  });
  const completedNode = draftFor(completed, draft.id).nodes.find((candidate) => candidate.id === nodeId)!;
  const assetId = completedNode.execution.outputAssetIds[0]!;
  const asset = completed.assets.find((candidate) => candidate.id === assetId)!;
  await writeAssetBytes(projectDirectory, asset.path, bytes);
  await saveMutation(projectDirectory, before, completed);
  return {
    draftId: draft.id,
    nodeId,
    jobId: started.request.jobId,
    status: "succeeded",
    route,
    assetId,
    assetPath: asset.path,
    revision: completed.revision,
    draftRevision: draftFor(completed, draft.id).revision,
  };
}

async function copyDraftCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(projectDirectory);
  const after = copyDraft(before, {
    sourceDraftId: optionalFlag(args, "source") ?? before.activeDraftId,
    title: requiredFlag(args, "title"),
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
  });
  await saveMutation(projectDirectory, before, after);
  return { draftId: after.activeDraftId, sourceDraftId: optionalFlag(args, "source") ?? before.activeDraftId, revision: after.revision };
}

async function selectResultCommand(args: ParsedArgs): Promise<unknown> {
  const directory = resolve(requiredFlag(args, "project"));
  const before = await loadProject(directory);
  const draft = draftFor(before, optionalFlag(args, "draft"));
  const nodeId = requiredFlag(args, "node");
  const assetId = requiredFlag(args, "asset");
  const after = selectNodeOutput(before, { draftId: draft.id, nodeId, assetId,
    expectedProjectRevision: numberFlag(args, "expected-project-revision", before.revision),
    expectedDraftRevision: numberFlag(args, "expected-draft-revision", draft.revision) });
  await saveMutation(directory, before, after);
  return { nodeId, assetId, revision: after.revision };
}

async function generateCommand(args: ParsedArgs): Promise<unknown> {
  const configPath = optionalFlag(args, "provider-config");
  const providerConfiguration = await loadProviderConfiguration(configPath === undefined ? {} : { path: configPath });
  const projectDirectory = resolve(requiredFlag(args, "project"));
  let initial = await loadProject(projectDirectory);
  const draft = draftFor(initial, optionalFlag(args, "draft"));
  const nodeId = requiredFlag(args, "node");
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new CliUsageError(`Unknown node: ${nodeId}`);
  const expectedProjectRevision = numberFlag(args, "expected-project-revision", initial.revision);
  const expectedDraftRevision = numberFlag(args, "expected-draft-revision", draft.revision);
  if (expectedProjectRevision !== initial.revision || expectedDraftRevision !== draft.revision) {
    throw new CliUsageError("Generation revision check failed");
  }
  if (node.execution.status === "succeeded") {
    const reset = resetNodeGeneration(initial, { draftId: draft.id, nodeId, expectedProjectRevision, expectedDraftRevision });
    // Check routing before invalidating a usable output (e.g. when BYOK is absent).
    const target = draftFor(reset, draft.id).nodes.find((candidate) => candidate.id === nodeId)!;
    startGeneration(reset, { draftId: draft.id, nodeId, expectedProjectRevision: reset.revision,
      expectedDraftRevision: draftFor(reset, draft.id).revision,
      resolveRoute: (request) => resolveRouteForNode(request, target, providerConfiguration.providers) });
    await saveMutation(projectDirectory, initial, reset);
    initial = reset;
  }
  const resuming = node.execution.status === "queued" || node.execution.status === "running";
  const operation = resuming
    ? resumeGeneration(initial, { draftId: draft.id, nodeId })
      : startGeneration(initial, {
        draftId: draft.id,
        nodeId,
        expectedProjectRevision: initial.revision,
        expectedDraftRevision: draftFor(initial, draft.id).revision,
        resolveRoute: (request, targetNode) => resolveRouteForNode(request, targetNode, providerConfiguration.providers),
      });
  let document = operation.document;
  if (!resuming) await saveMutation(projectDirectory, initial, document);
  const jobId = operation.request.jobId;
  let providerJobId = draftFor(document, draft.id).jobs.find((candidate) => candidate.id === jobId)?.providerJobId;
  try {
    const runtime = providerRuntimeFor(operation.route, node, providerConfiguration.providers);
    const inputBytes = await localInputBytes(projectDirectory, document, operation.request);
    const context: ProviderExecutionContext = {
      ...runtime.context,
      ...(inputBytes.size === 0 ? {} : { inputBytes }),
    };
    const maxPolls = pollSetting(
      args,
      "max-polls",
      runtime.adapter.manifest.providerId === "mock" ? 2 : 60,
    );
    const pollMilliseconds = pollSetting(
      args,
      "poll-ms",
      runtime.adapter.manifest.providerId === "mock" ? 0 : 5000,
    );

    const materialize = async (snapshot: ProviderSnapshot): Promise<{
      draftId: string;
      nodeId: string;
      jobId: string;
      status: "succeeded";
      assetId: string;
      assetPath: string;
      assetIds: string[];
      assetPaths: string[];
    }> => {
      const outputs = snapshot.outputs ?? [];
      if (outputs.length === 0) throw new Error("Provider succeeded without an output artifact");
      const artifacts = await Promise.all(outputs.map(async (output) => ({
        kind: output.kind,
        mediaType: output.mediaType,
        bytes: await collectBytes(runtime.adapter.openArtifact(snapshot.providerJobId, output.artifactId, context)),
      })));
      const completed = completeGeneration(document, {
        draftId: draft.id,
        jobId,
        providerJobId: snapshot.providerJobId,
        artifacts,
      });
      const assetIds = draftFor(completed, draft.id).nodes.find((candidate) => candidate.id === nodeId)!.execution.outputAssetIds;
      const outputAssets = assetIds.map((assetId) => completed.assets.find((candidate) => candidate.id === assetId)!);
      for (const [index, asset] of outputAssets.entries()) {
        await writeAssetBytes(projectDirectory, asset.path, artifacts[index]!.bytes);
      }
      await saveMutation(projectDirectory, document, completed);
      document = completed;
      return {
        draftId: draft.id,
        nodeId,
        jobId,
        status: "succeeded",
        assetId: assetIds[0]!,
        assetPath: outputAssets[0]!.path,
        assetIds,
        assetPaths: outputAssets.map((asset) => asset.path),
      };
    };

    const persist = async (snapshot: ProviderSnapshot): Promise<void> => {
      const beforeSnapshot = document;
      document = applyProviderSnapshot(document, { draftId: draft.id, jobId, snapshot });
      await saveMutation(projectDirectory, beforeSnapshot, document);
    };

    const resumableJob = draftFor(document, draft.id).jobs.find((candidate) => candidate.id === jobId);
    const resubmit = providerJobId === undefined || runtime.adapter.manifest.providerId === "mock";
    // Speech has no remote retrieval endpoint. Record the submission boundary
    // first so a restart never silently sends the same paid speech request again.
    if (resubmit && runtime.adapter instanceof OpenAISpeechAdapter) {
      providerJobId = "openai-speech:" + jobId;
      await persist({ providerJobId, status: "queued", progress: 0 });
    }
    let snapshot: ProviderSnapshot;
    if (resubmit) {
      snapshot = await runtime.adapter.submit(operation.request, operation.route.modelId, context);
      providerJobId = snapshot.providerJobId;
      const currentStatus = resumableJob?.status;
      if (snapshot.status === "queued" && currentStatus === "running") {
        snapshot = await runtime.adapter.poll(snapshot.providerJobId, context);
      }
    } else {
      const resumedProviderJobId = providerJobId;
      if (resumedProviderJobId === undefined) throw new Error("Persisted provider job identifier is missing");
      snapshot = await runtime.adapter.poll(resumedProviderJobId, context);
    }

    if (snapshot.status === "succeeded") return materialize(snapshot);
    await persist(snapshot);
    if (snapshot.status === "failed") {
      return { draftId: draft.id, nodeId, jobId, status: "failed", providerJobId: snapshot.providerJobId };
    }

    if (providerJobId === undefined) throw new Error("Provider did not return a job identifier");
    for (let pollCount = 0; pollCount < maxPolls; pollCount += 1) {
      if (pollMilliseconds > 0) await sleep(pollMilliseconds);
      snapshot = await runtime.adapter.poll(providerJobId, context);
      if (snapshot.status === "succeeded") return materialize(snapshot);
      await persist(snapshot);
      if (snapshot.status === "failed") {
        return { draftId: draft.id, nodeId, jobId, status: "failed", providerJobId: snapshot.providerJobId };
      }
    }
    return { draftId: draft.id, nodeId, jobId, status: "running", providerJobId, resumable: true };
  } catch (error) {
    const failure = providerFailure(error);
    try {
      const latest = await loadProject(projectDirectory);
      const latestDraft = draftFor(latest, draft.id);
      const job = latestDraft.jobs.find((candidate) => candidate.id === jobId);
      if (job?.status === "queued" || job?.status === "running") {
        const failed = failGeneration(latest, {
          draftId: draft.id,
          jobId,
          ...(providerJobId === undefined ? {} : { providerJobId }),
          code: failure.code,
          retryable: failure.retryable,
          message: failure.message,
        });
        await saveMutation(projectDirectory, latest, failed);
      }
    } catch {
      // A still-active job remains resumable on the next generate invocation.
    }
    throw new Error(failure.message);
  }
}

function contextDepth(args: ParsedArgs): number {
  const depth = optionalNumber(args, "depth") ?? 1;
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > 4) {
    throw new CliUsageError("--depth must be an integer from 0 to 4");
  }
  return depth;
}

function relatedNodeSummary(node: Node): Record<string, unknown> {
  return {
    nodeId: node.id,
    title: node.title,
    nodeKind: node.spec.kind,
    ...(node.spec.kind === "composition" ? { role: node.spec.role ?? "composition" } : {}),
  };
}

function contextNodeConnections(draft: Draft, node: Node, direction: "upstream" | "downstream"): Array<Record<string, unknown>> {
  const edges = draft.edges.filter((edge) => direction === "upstream"
    ? edge.targetNodeId === node.id
    : edge.sourceNodeId === node.id);
  return edges.map((edge) => {
    const relatedNodeId = direction === "upstream" ? edge.sourceNodeId : edge.targetNodeId;
    const relatedNode = draft.nodes.find((candidate) => candidate.id === relatedNodeId);
    if (!relatedNode) throw new Error(`Context edge references an unknown node: ${edge.id}`);
    return { edgeId: edge.id, kind: edge.kind, ...relatedNodeSummary(relatedNode) };
  });
}

function semanticContextNode(draft: Draft, node: Node): Record<string, unknown> {
  const base = {
    id: node.id,
    title: node.title,
    position: { ...node.position },
    kind: node.spec.kind,
    execution: {
      status: node.execution.status,
      ...(node.execution.activeJobId === undefined ? {} : { activeJobId: node.execution.activeJobId }),
      outputAssetIds: [...node.execution.outputAssetIds],
      ...(node.execution.selectedOutputAssetId === undefined ? {} : { selectedOutputAssetId: node.execution.selectedOutputAssetId }),
    },
    upstream: contextNodeConnections(draft, node, "upstream"),
    downstream: contextNodeConnections(draft, node, "downstream"),
  };
  if (node.spec.kind === "shot") {
    return {
      ...base,
      mediaKind: node.spec.mediaKind,
      prompt: node.spec.prompt,
      inputAssetIds: [...node.spec.inputAssetIds],
      ...(node.spec.requirements === undefined ? {} : { requirements: structuredClone(node.spec.requirements) }),
      ...(node.spec.routing === undefined ? {} : { routing: structuredClone(node.spec.routing) }),
    };
  }
  return {
    ...base,
    role: node.spec.role ?? "composition",
    ...(node.spec.prompt === undefined ? {} : { prompt: node.spec.prompt }),
    ...(node.spec.referenceAssetIds === undefined ? {} : { referenceAssetIds: [...node.spec.referenceAssetIds] }),
    ...(isLayoutGroupNode(node) ? { memberNodeIds: [...(node.spec.memberNodeIds ?? [])] } : {}),
  };
}

function contextNodeIds(draft: Draft, focusNodeId: string | undefined, depth: number): Set<string> {
  if (focusNodeId === undefined) return new Set(draft.nodes.map((node) => node.id));
  const focusNode = draft.nodes.find((node) => node.id === focusNodeId);
  if (!focusNode) throw new CliUsageError(`Unknown node: ${focusNodeId}`);

  const selectedNodeIds = new Set<string>([focusNode.id]);
  let frontier = [focusNode.id];
  if (isLayoutGroupNode(focusNode)) {
    for (const memberNodeId of focusNode.spec.memberNodeIds ?? []) {
      selectedNodeIds.add(memberNodeId);
      frontier.push(memberNodeId);
    }
  }

  for (let hop = 0; hop < depth; hop += 1) {
    const frontierIds = new Set(frontier);
    const nextFrontier: string[] = [];
    for (const edge of draft.edges) {
      const adjacentNodeId = frontierIds.has(edge.sourceNodeId)
        ? edge.targetNodeId
        : frontierIds.has(edge.targetNodeId)
          ? edge.sourceNodeId
          : undefined;
      if (adjacentNodeId === undefined || selectedNodeIds.has(adjacentNodeId)) continue;
      selectedNodeIds.add(adjacentNodeId);
      nextFrontier.push(adjacentNodeId);
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // Layout frames are part of a node's visible context even though graph edges
  // never connect to them. Include the complete local group when any member is
  // selected so Codex can reason about the same frame Studio will render.
  let addedMembership = true;
  while (addedMembership) {
    addedMembership = false;
    for (const group of draft.nodes.filter(isLayoutGroupNode)) {
      const members = group.spec.memberNodeIds ?? [];
      if (!selectedNodeIds.has(group.id) && !members.some((memberNodeId) => selectedNodeIds.has(memberNodeId))) continue;
      if (!selectedNodeIds.has(group.id)) {
        selectedNodeIds.add(group.id);
        addedMembership = true;
      }
      for (const memberNodeId of members) {
        if (!selectedNodeIds.has(memberNodeId)) {
          selectedNodeIds.add(memberNodeId);
          addedMembership = true;
        }
      }
    }
  }
  return selectedNodeIds;
}

function contextAssetIds(draft: Draft, selectedNodeIds: Set<string>): Set<string> {
  const assetIds = new Set<string>();
  for (const node of draft.nodes) {
    if (!selectedNodeIds.has(node.id)) continue;
    for (const assetId of node.execution.outputAssetIds) assetIds.add(assetId);
    if (node.spec.kind === "shot") {
      for (const assetId of node.spec.inputAssetIds) assetIds.add(assetId);
    } else {
      for (const assetId of node.spec.referenceAssetIds ?? []) assetIds.add(assetId);
    }
  }
  for (const job of draft.jobs) {
    if (!selectedNodeIds.has(job.nodeId)) continue;
    for (const assetId of job.outputAssetIds) assetIds.add(assetId);
  }
  return assetIds;
}

async function contextCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const document = await loadProject(projectDirectory);
  const draft = draftFor(document, optionalFlag(args, "draft"));
  const focusNodeId = optionalFlag(args, "node");
  if (focusNodeId === undefined && args.flags.has("depth")) {
    throw new CliUsageError("--depth requires --node");
  }
  const depth = focusNodeId === undefined ? 0 : contextDepth(args);
  const selectedNodeIds = contextNodeIds(draft, focusNodeId, depth);
  const assetIds = contextAssetIds(draft, selectedNodeIds);
  return {
    project: {
      id: document.project.id,
      title: document.project.title,
      revision: document.revision,
      activeDraftId: document.activeDraftId,
    },
    draft: {
      id: draft.id,
      title: draft.title,
      revision: draft.revision,
      ...(draft.sourceDraftId === undefined ? {} : { sourceDraftId: draft.sourceDraftId }),
      nodeCount: draft.nodes.length,
      edgeCount: draft.edges.length,
      jobCount: draft.jobs.length,
    },
    ...(focusNodeId === undefined ? {} : { focus: { nodeId: focusNodeId, depth } }),
    nodes: draft.nodes
      .filter((node) => selectedNodeIds.has(node.id))
      .map((node) => semanticContextNode(draft, node)),
    edges: draft.edges
      .filter((edge) => selectedNodeIds.has(edge.sourceNodeId) && selectedNodeIds.has(edge.targetNodeId))
      .map((edge) => ({
        id: edge.id,
        kind: edge.kind,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })),
    assets: document.assets
      .filter((asset) => assetIds.has(asset.id))
      .map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        mediaType: asset.mediaType,
        byteLength: asset.byteLength,
        origin: structuredClone(asset.origin),
      })),
    jobs: draft.jobs
      .filter((job) => selectedNodeIds.has(job.nodeId))
      .map((job) => ({
        id: job.id,
        nodeId: job.nodeId,
        attempt: job.attempt,
        status: job.status,
        ...(job.progress === undefined ? {} : { progress: job.progress }),
        route: structuredClone(job.route),
        outputAssetIds: [...job.outputAssetIds],
        ...(job.error === undefined ? {} : { error: structuredClone(job.error) }),
      })),
  };
}

async function statusCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const document = await loadProject(projectDirectory);
  const draft = draftFor(document, optionalFlag(args, "draft"));
  return {
    projectPath: join(projectDirectory, "project.json"),
    projectId: document.project.id,
    revision: document.revision,
    draftId: draft.id,
    draftRevision: draft.revision,
    nodes: draft.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      kind: node.spec.kind,
      status: node.execution.status,
      outputAssetIds: node.execution.outputAssetIds,
    })),
    jobs: draft.jobs.map((job) => ({
      id: job.id,
      nodeId: job.nodeId,
      status: job.status,
      progress: job.progress,
      route: job.route,
    })),
  };
}

async function previewCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const document = await loadProject(projectDirectory);
  const draft = draftFor(document, optionalFlag(args, "draft"));
  const base = optionalFlag(args, "url") ?? "http://127.0.0.1:4173/";
  const url = new URL(base);
  if (!isLocalStudioOrigin(url)) {
    throw new CliUsageError("open --url must use a local Studio origin");
  }
  const bridge = await startDetachedPreviewBridge(projectDirectory);
  const projectUrl = new URL("/project.json", `${bridge.bridgeUrl}/`);
  projectUrl.searchParams.set("token", bridge.token);
  const assetUrl = new URL("/asset", `${bridge.bridgeUrl}/`);
  assetUrl.searchParams.set("token", bridge.token);
  url.searchParams.set("project-url", projectUrl.toString());
  url.searchParams.set("asset-url", assetUrl.toString());
  url.searchParams.set("draft", draft.id);
  if (!args.flags.has("no-open")) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const commandArgs = process.platform === "win32" ? ["/c", "start", "", url.toString()] : [url.toString()];
    spawn(command, commandArgs, { detached: true, stdio: "ignore" }).unref();
  }
  return { draftId: draft.id, url: url.toString(), bridgeUrl: bridge.bridgeUrl };
}

async function previewBridgeCommand(args: ParsedArgs): Promise<never> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const port = numberFlag(args, "port", 0);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new CliUsageError("--port must be an integer between 0 and 65535");
  }
  const bridge = await startPreviewBridge({
    projectDirectory,
    token: requiredFlag(args, "token"),
    port,
  });
  process.stdout.write(`${JSON.stringify({ bridgeUrl: bridge.bridgeUrl })}\n`);
  await new Promise<never>(() => undefined);
  throw new Error("Preview bridge unexpectedly stopped");
}

async function exportCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const document = await loadProject(projectDirectory);
  const draftId = requiredFlag(args, "draft");
  const draft = draftFor(document, draftId);
  const nodeId = optionalFlag(args, "node");
  const node = nodeId
    ? draft.nodes.find((candidate) => candidate.id === nodeId)
    : draft.nodes.find((candidate) => candidate.spec.kind === "composition" && candidate.execution.status === "succeeded");
  if (!node || effectiveOutputAssetIds(node).length === 0) {
    throw new CliUsageError("Selected draft node has no successful output to export");
  }
  const asset = document.assets.find((candidate) => candidate.id === effectiveOutputAssetIds(node)[0]);
  if (!asset) throw new Error("Successful node references an unknown asset");
  const source = join(projectDirectory, asset.path);
  const bytes = await readFile(source);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== asset.byteLength || asset.checksumSha256 !== `sha256:${digest}`) {
    throw new Error("Asset integrity check failed");
  }
  const output = resolve(requiredFlag(args, "output"));
  await mkdir(dirname(output), { recursive: true });
  await copyFile(source, output, constants.COPYFILE_EXCL);
  return { draftId: draft.id, nodeId: node.id, assetId: asset.id, output };
}
