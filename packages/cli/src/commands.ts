import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  MockProviderAdapter,
  addNode,
  applyProviderSnapshot,
  completeGeneration,
  connectNodes,
  copyDraft,
  createProject,
  failGeneration,
  loadProject,
  resumeGeneration,
  saveProjectAtomic,
  startGeneration,
  updateNode,
  writeAssetBytes,
  type CanvasDocument,
  type Draft,
  type ShotSpec,
} from "@open-canvas/core";

import { CliUsageError, numberFlag, optionalFlag, requiredFlag, type ParsedArgs } from "./args.js";

function draftFor(document: CanvasDocument, draftId?: string): Draft {
  const id = draftId ?? document.activeDraftId;
  const draft = document.drafts.find((candidate) => candidate.id === id);
  if (!draft) throw new CliUsageError(`Unknown draft: ${id}`);
  return draft;
}

async function saveMutation(projectDirectory: string, before: CanvasDocument, after: CanvasDocument): Promise<void> {
  await saveProjectAtomic(projectDirectory, after, { expectedCurrentRevision: before.revision });
}

async function collectBytes(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function optionalNumber(args: ParsedArgs, name: string): number | undefined {
  const value = optionalFlag(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CliUsageError(`Invalid number for --${name}`);
  return parsed;
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
  const aspectRatio = optionalFlag(args, "aspect-ratio") ?? current?.requirements?.aspectRatio;
  const width = optionalNumber(args, "width") ?? current?.requirements?.width;
  const height = optionalNumber(args, "height") ?? current?.requirements?.height;
  const durationSeconds = optionalNumber(args, "duration-seconds") ?? current?.requirements?.durationSeconds;
  const audio = optionalFlag(args, "audio") ?? current?.requirements?.audio;
  const mediaType = optionalFlag(args, "media-type") ?? current?.requirements?.mediaType;
  const requirements = {
    ...(aspectRatio === undefined ? {} : { aspectRatio: aspectRatio as "16:9" | "9:16" | "1:1" }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(audio === undefined ? {} : { audio: audio as "required" | "forbidden" | "either" }),
    ...(mediaType === undefined ? {} : { mediaType }),
  };
  const inputAssets = optionalFlag(args, "input-assets");
  const inputAssetIds = inputAssets === undefined
    ? current?.inputAssetIds ?? []
    : inputAssets.split(",").map((value) => value.trim()).filter(Boolean);
  const mediaKind = optionalFlag(args, "media-kind") ?? current?.mediaKind ?? "video";
  if (mediaKind !== "image" && mediaKind !== "video") throw new CliUsageError(`Invalid media kind: ${mediaKind}`);
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
  if (command === "init") return initCommand(args);
  if (command === "node" && subcommand === "add") return addNodeCommand(args);
  if (command === "node" && subcommand === "update") return updateNodeCommand(args);
  if (command === "edge" && subcommand === "connect") return connectCommand(args);
  if (command === "draft" && subcommand === "copy") return copyDraftCommand(args);
  if (command === "generate") return generateCommand(args);
  if (command === "status") return statusCommand(args);
  if (command === "preview" || command === "open") return previewCommand(args);
  if (command === "export") return exportCommand(args);
  throw new CliUsageError("Unknown command. Use init, node add/update, edge connect, draft copy, generate, status, open/preview, or export.");
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
      ? { kind: "composition" as const, mediaType: "video/mp4" as const }
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
    "duration-seconds", "audio", "media-type", "provider", "model", "ai-provider", "ai-model",
  ];
  const hasSpecUpdate = specFlags.some((name) => args.flags.has(name));
  if (title === undefined && !hasSpecUpdate) throw new CliUsageError("node update requires --title or a shot spec field");
  const spec = hasSpecUpdate && node.spec.kind === "shot" ? shotSpecFromArgs(args, node.spec) : undefined;
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
      });
  let document = operation.document;
  if (!resuming) await saveMutation(projectDirectory, initial, document);
  const jobId = operation.request.jobId;
  let providerJobId: string | undefined;
  try {
    const adapter = new MockProviderAdapter();
    const submitted = await adapter.submit(operation.request, operation.route.modelId);
    providerJobId = submitted.providerJobId;
    if (node.execution.status !== "running") {
      const beforeSubmitted = document;
      document = applyProviderSnapshot(document, { draftId: draft.id, jobId, snapshot: submitted });
      await saveMutation(projectDirectory, beforeSubmitted, document);
    }
    const firstPoll = await adapter.poll(submitted.providerJobId);
    const beforeFirstPoll = document;
    document = applyProviderSnapshot(document, { draftId: draft.id, jobId, snapshot: firstPoll });
    await saveMutation(projectDirectory, beforeFirstPoll, document);
    if (firstPoll.status === "failed") return { draftId: draft.id, nodeId, jobId, status: "failed" };
    const success = await adapter.poll(submitted.providerJobId);
    if (success.status !== "succeeded" || !success.outputs?.[0]) throw new Error("provider protocol");
    const output = success.outputs[0];
    const bytes = await collectBytes(adapter.openArtifact(submitted.providerJobId, output.artifactId));
    const completed = completeGeneration(document, {
      draftId: draft.id,
      jobId,
      providerJobId: submitted.providerJobId,
      artifact: { kind: output.kind, mediaType: output.mediaType, bytes },
    });
    const assetId = draftFor(completed, draft.id).nodes.find((candidate) => candidate.id === nodeId)!.execution.outputAssetIds[0]!;
    const asset = completed.assets.find((candidate) => candidate.id === assetId)!;
    await writeAssetBytes(projectDirectory, asset.path, bytes);
    await saveMutation(projectDirectory, document, completed);
    return { draftId: draft.id, nodeId, jobId, status: "succeeded", assetId, assetPath: asset.path };
  } catch {
    try {
      const latest = await loadProject(projectDirectory);
      const latestDraft = draftFor(latest, draft.id);
      const job = latestDraft.jobs.find((candidate) => candidate.id === jobId);
      if (job?.status === "queued" || job?.status === "running") {
        const failed = failGeneration(latest, {
          draftId: draft.id,
          jobId,
          ...(providerJobId === undefined ? {} : { providerJobId }),
        });
        await saveMutation(projectDirectory, latest, failed);
      }
    } catch {
      // A still-active job remains resumable on the next generate invocation.
    }
    throw new Error("Generation failed; provider details were not persisted");
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
    jobs: draft.jobs.map((job) => ({ id: job.id, nodeId: job.nodeId, status: job.status, progress: job.progress })),
  };
}

async function previewCommand(args: ParsedArgs): Promise<unknown> {
  const projectDirectory = resolve(requiredFlag(args, "project"));
  const document = await loadProject(projectDirectory);
  const draft = draftFor(document, optionalFlag(args, "draft"));
  const base = optionalFlag(args, "url") ?? "http://127.0.0.1:4173/";
  const url = new URL(base);
  url.searchParams.set("project", join(projectDirectory, "project.json"));
  url.searchParams.set("draft", draft.id);
  if (!args.flags.has("no-open")) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const commandArgs = process.platform === "win32" ? ["/c", "start", "", url.toString()] : [url.toString()];
    spawn(command, commandArgs, { detached: true, stdio: "ignore" }).unref();
  }
  return { draftId: draft.id, url: url.toString() };
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
