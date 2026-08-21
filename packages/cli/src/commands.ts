import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  GeminiOmniVideoAdapter,
  MockProviderAdapter,
  OpenAIImageAdapter,
  ProviderAdapterError,
  addNode,
  applyProviderSnapshot,
  completeGeneration,
  connectNodes,
  copyDraft,
  createGroup,
  createProject,
  deleteNode,
  expandScriptIntoShots,
  failGeneration,
  loadProject,
  MAX_SCRIPT_SHOTS,
  resumeGeneration,
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

function providerAdaptersFor(node: Node, route?: ResolvedRoute): ProviderAdapter[] {
  const adapters: ProviderAdapter[] = [
    new OpenAIImageAdapter(),
    new GeminiOmniVideoAdapter(),
  ];
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

function resolveRouteForNode(request: GenerationRequest, node: Node): ResolvedRoute {
  if (node.spec.kind !== "shot") {
    throw new CliUsageError("Composition rendering is not implemented; generate the underlying shot nodes first");
  }
  const adapters = providerAdaptersFor(node);
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

function providerRuntimeFor(route: ResolvedRoute, node: Node): ProviderRuntime {
  const adapters = providerAdaptersFor(node, route);
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
  }[extension];
}

function importedAssetKind(mediaType: string, requestedKind?: string): "image" | "video" {
  if (requestedKind !== undefined) {
    if (requestedKind !== "image" && requestedKind !== "video") {
      throw new CliUsageError(`Invalid asset kind: ${requestedKind}`);
    }
    if (!mediaType.startsWith(`${requestedKind}/`)) {
      throw new CliUsageError(`Asset kind ${requestedKind} does not match media type ${mediaType}`);
    }
    return requestedKind;
  }
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("video/")) return "video";
  throw new CliUsageError("Cannot infer asset kind; pass --kind image or --kind video with a matching --media-type");
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
      "node add --project <directory> --kind shot|composition --title <title> ... [--count 1|2|4 for image]",
      "node update --project <directory> --node <id> ...",
      "node delete --project <directory> --node <id>",
      "group create --project <directory> --members <node-id,node-id,...> [--title <title>]",
      "edge connect --project <directory> --source <id> --target <id> --kind dependency|sequence",
      "script expand --project <directory> --node <script-node-id> [--limit 1..8] [--prompt <script>]",
      "asset import --project <directory> --file <path>",
      "draft copy --project <directory> --title <title> [--source <id>]",
      "generate --project <directory> --node <id>",
      "open --project <directory> [--no-open]",
      "export --project <directory> --draft <id> --output <path> [--node <id>]",
    ],
    localContext: [
      "Use composition roles text, script, character, scene-style, or asset-reference for project-local context.",
      "Use group create to persist a project-local layout frame around two or more canvas nodes; it never creates a global library.",
      "Use script expand to turn one project-local script node into editable video shots plus explicit dependency and sequence edges.",
      "Import media with asset import, then associate it with a node; no global role or material library is created.",
      "open starts a loopback bridge for the selected local project; Studio saves explicitly through revision-checked CLI persistence.",
    ],
    generation: {
      default: "Selects an eligible configured local BYOK route; it never silently falls back to mock.",
      configuredRoutes: [
        "OPENAI_API_KEY for openai / gpt-image-2 image generation",
        "GEMINI_API_KEY for google-gemini / gemini-omni-flash-preview video generation",
      ],
      deterministicDemo: "Use an explicit mock route only for local demos or tests.",
    },
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
  if (mediaKind !== "image" && mediaKind !== "video") throw new CliUsageError(`Invalid media kind: ${mediaKind}`);
  const requestedCount = optionalNumber(args, "count");
  if (requestedCount !== undefined && (!Number.isSafeInteger(requestedCount) || requestedCount < 1 || requestedCount > 4)) {
    throw new CliUsageError("--count must be an integer from 1 to 4");
  }
  if (mediaKind === "video" && requestedCount !== undefined) {
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
  const requirements = {
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
  if (command === "group" && subcommand === "create") return createGroupCommand(args);
  if (command === "edge" && subcommand === "connect") return connectCommand(args);
  if (command === "script" && subcommand === "expand") return expandScriptCommand(args);
  if (command === "asset" && subcommand === "import") return importAssetCommand(args);
  if (command === "draft" && subcommand === "copy") return copyDraftCommand(args);
  if (command === "generate") return generateCommand(args);
  if (command === "status") return statusCommand(args);
  if (command === "preview-bridge") return previewBridgeCommand(args);
  if (command === "preview" || command === "open") return previewCommand(args);
  if (command === "export") return exportCommand(args);
  throw new CliUsageError("Unknown command. Use init, node add/update/delete, group create, edge connect, script expand, asset import, draft copy, generate, status, open/preview, or export.");
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
  const filePath = resolve(requiredFlag(args, "file"));
  const bytes = await readFile(filePath);
  if (bytes.length === 0) throw new CliUsageError("Cannot import an empty file");
  const mediaType = optionalFlag(args, "media-type") ?? inferredMediaType(filePath);
  if (!mediaType) throw new CliUsageError("Cannot infer media type; pass --media-type");
  const kind = importedAssetKind(mediaType, optionalFlag(args, "kind"));
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

async function generateCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const initial = await loadProject(projectDirectory);
  const draft = draftFor(initial, optionalFlag(args, "draft"));
  const nodeId = requiredFlag(args, "node");
  const node = draft.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new CliUsageError(`Unknown node: ${nodeId}`);
  const expectedProjectRevision = numberFlag(args, "expected-project-revision", initial.revision);
  const expectedDraftRevision = numberFlag(args, "expected-draft-revision", draft.revision);
  if (expectedProjectRevision !== initial.revision || expectedDraftRevision !== draft.revision) {
    throw new CliUsageError("Generation revision check failed");
  }
  const resuming = node.execution.status === "queued" || node.execution.status === "running";
  const operation = resuming
    ? resumeGeneration(initial, { draftId: draft.id, nodeId })
    : startGeneration(initial, {
        draftId: draft.id,
        nodeId,
        expectedProjectRevision,
        expectedDraftRevision,
        resolveRoute: resolveRouteForNode,
      });
  let document = operation.document;
  if (!resuming) await saveMutation(projectDirectory, initial, document);
  const jobId = operation.request.jobId;
  let providerJobId = draftFor(document, draft.id).jobs.find((candidate) => candidate.id === jobId)?.providerJobId;
  try {
    const runtime = providerRuntimeFor(operation.route, node);
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
  if (!node || node.execution.status !== "succeeded" || node.execution.outputAssetIds.length === 0) {
    throw new CliUsageError("Selected draft node has no successful output to export");
  }
  const asset = document.assets.find((candidate) => candidate.id === node.execution.outputAssetIds[0]);
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
