import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { addNode, applyProviderSnapshot, createProject, loadProject, saveProjectAtomic, startGeneration } from "@open-canvas/core";

import { startPreviewBridge } from "../src/preview-bridge.ts";

const workspace = resolve(import.meta.dirname, "../../..");
const main = resolve(workspace, "packages/cli/src/main.ts");

async function cliProcess(
  args: string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", main, ...args], {
    cwd: workspace,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolveExit) => child.on("close", resolveExit));
  return { code, stdout, stderr };
}

async function cli(args: string[]): Promise<any> {
  const { code, stdout, stderr } = await cliProcess(args);
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
}

test("CLI audio generates, resumes, regenerates, imports, selects history and exports locally", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-audio-"));
  const project = join(root, "project");
  await cli(["init", project, "--title", "Audio QA"]);
  const node = await cli(["node", "add", "--project", project, "--kind", "shot", "--media-kind", "audio", "--title", "旁白", "--prompt", "测试", "--provider", "mock"]);
  const queued = await cli(["generate", "--project", project, "--node", node.nodeId, "--max-polls", "0"]);
  assert.equal(queued.resumable, true);
  const first = await cli(["generate", "--project", project, "--node", node.nodeId]);
  assert.equal(first.jobId, queued.jobId);
  const second = await cli(["generate", "--project", project, "--node", node.nodeId]);
  assert.notEqual(first.jobId, second.jobId);
  const document = await loadProject(project);
  assert.equal(document.assets[0]!.kind, "audio");
  const file = join(root, "speech.wav");
  await cli(["export", "--project", project, "--draft", document.activeDraftId, "--node", node.nodeId, "--output", file]);
  const bytes = await readFile(file);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  const imported = await cli(["asset", "import", "--project", project, "--file", file]);
  assert.equal(imported.mediaType, "audio/wav");
  const copy = await cli(["node", "add", "--project", project, "--kind", "shot", "--media-kind", "audio", "--title", "本地录音", "--prompt", "导入录音", "--media-type", "audio/mpeg"]);
  const result = await cli(["result", "import", "--project", project, "--node", copy.nodeId, "--file", file]);
  assert.equal(result.status, "succeeded");
  const importedNode = (await loadProject(project)).drafts[0]!.nodes.find((node) => node.id === copy.nodeId)!;
  assert.equal(importedNode.spec.kind === "shot" && importedNode.spec.requirements?.mediaType, "audio/wav");
  await cli(["node", "update", "--project", project, "--node", node.nodeId, "--prompt", "新版本"]);
  await cli(["result", "select", "--project", project, "--node", node.nodeId, "--asset", first.assetId]);
  const selected = await loadProject(project);
  assert.equal(selected.drafts[0]!.nodes[0]!.execution.status, "dirty");
  assert.equal(selected.drafts[0]!.nodes[0]!.execution.selectedOutputAssetId, first.assetId);
  const oldExport = join(root, "selected.wav");
  await cli(["export", "--project", project, "--draft", selected.activeDraftId, "--node", node.nodeId, "--output", oldExport]);
  assert.deepEqual(await readFile(oldExport), bytes);
});

test("interrupted synchronous speech does not silently resubmit on resume", async () => {
  const project = await mkdtemp(join(tmpdir(), "open-canvas-speech-resume-"));
  let document = createProject({ title: "Speech resume" });
  document = addNode(document, { draftId: document.activeDraftId, expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0]!.revision, title: "Audio", spec: { kind: "shot", mediaKind: "audio", prompt: "test", inputAssetIds: [] } });
  const nodeId = document.drafts[0]!.nodes[0]!.id;
  const started = startGeneration(document, { draftId: document.activeDraftId, nodeId,
    expectedProjectRevision: document.revision, expectedDraftRevision: document.drafts[0]!.revision,
    resolveRoute: () => ({ providerId: "openai-speech", modelId: "gpt-4o-mini-tts", selectionSource: "registry_default" }) });
  document = applyProviderSnapshot(started.document, { draftId: document.activeDraftId, jobId: started.request.jobId,
    snapshot: { providerJobId: "openai-speech:" + started.request.jobId, status: "queued" } });
  await saveProjectAtomic(project, document);
  const result = await cliProcess(["generate", "--project", project, "--node", nodeId], { OPENAI_API_KEY: "synthetic-test-credential" });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /synchronous/);
  assert.doesNotMatch(result.stderr, /synthetic-test-credential/);
  const after = await loadProject(project);
  assert.equal(after.drafts[0]!.jobs.length, 1);
  assert.equal(after.drafts[0]!.nodes[0]!.execution.status, "failed");
});

test("CLI prints machine-readable help without requiring a project", async () => {
  const long = await cliProcess(["--help"]);
  assert.equal(long.code, 0, long.stderr);
  const longHelp = JSON.parse(long.stdout);
  assert.match(longHelp.usage, /^open-canvas /);
  assert.ok(longHelp.commands.some((command: string) => command.startsWith("node add")));
  assert.ok(longHelp.commands.some((command: string) => command.startsWith("node delete")));
  assert.ok(longHelp.commands.some((command: string) => command.startsWith("context")));
  assert.ok(longHelp.commands.some((command: string) => command.startsWith("node move")));
  assert.ok(longHelp.commands.some((command: string) => command.startsWith("edge disconnect")));
  assert.ok(longHelp.commands.some((command: string) => command.startsWith("script expand")));
  assert.ok(longHelp.commands.some((command: string) => command.startsWith("result import")));
  assert.match(longHelp.generation.configuredRoutes.join("\n"), /ARK_API_KEY/);
  assert.match(longHelp.generation.configuredRoutes.join("\n"), /OPENAI_API_KEY/);
  assert.doesNotMatch(long.stdout, /sk-[A-Za-z0-9]/);

  const short = await cliProcess(["-h"]);
  assert.equal(short.code, 0, short.stderr);
  assert.deepEqual(JSON.parse(short.stdout), longHelp);
});

test("generate rejects ignored routing flags before changing a node or starting a job", async () => {
  const project = await mkdtemp(join(tmpdir(), "open-canvas-routing-flags-"));
  await cli(["init", project, "--title", "Routing flags"]);
  const node = await cli(["node", "add", "--project", project, "--kind", "shot", "--media-kind", "image",
    "--title", "Image", "--prompt", "test", "--provider", "mock"]);
  const before = await readFile(join(project, "project.json"), "utf8");
  for (const flag of ["provider", "model", "ai-provider", "ai-model"]) {
    const result = await cliProcess(["generate", "--project", project, "--node", node.nodeId, `--${flag}`, "mock"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /node add\/update/);
    assert.equal(await readFile(join(project, "project.json"), "utf8"), before);
  }
});

test("CLI loads a safe user provider configuration without exposing credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-provider-config-"));
  const configPath = join(root, "providers.json");
  await writeFile(configPath, JSON.stringify({
    version: 1,
    providers: [{
      id: "studio-ark",
      adapter: "volcengine-ark",
      credentialEnv: "STUDIO_ARK_KEY",
      models: { image: "studio-image-endpoint", video: "studio-video-endpoint" },
      priority: 20,
    }],
  }));

  const result = await cliProcess(["provider", "list", "--provider-config", configPath], { STUDIO_ARK_KEY: "" });
  assert.equal(result.code, 0, result.stderr);
  const listed = JSON.parse(result.stdout);
  assert.equal(listed.source, "file");
  assert.equal(listed.providers[0].id, "studio-ark");
  assert.equal(listed.providers[0].credentialEnv, "STUDIO_ARK_KEY");
  assert.equal(listed.providers[0].configured, false);
  assert.deepEqual(listed.providers[0].capabilities.map((capability: any) => capability.modelId), [
    "studio-image-endpoint",
    "studio-video-endpoint",
  ]);
  assert.doesNotMatch(result.stdout, /STUDIO_ARK_KEY=/);
});

test("CLI deletes a node together with its incident edges", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-delete-"));
  const projectDir = join(root, "demo");
  await cli(["init", projectDir, "--title", "Delete node"]);
  const source = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Source",
    "--prompt", "A source frame", "--media-kind", "image",
  ]);
  const target = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Target",
    "--prompt", "A dependent frame", "--media-kind", "image",
  ]);
  await cli([
    "edge", "connect", "--project", projectDir, "--source", source.nodeId,
    "--target", target.nodeId, "--kind", "dependency",
  ]);

  const deleted = await cli(["node", "delete", "--project", projectDir, "--node", source.nodeId]);
  assert.equal(deleted.nodeId, source.nodeId);
  assert.equal(deleted.removedEdgeCount, 1);
  assert.equal(deleted.removedJobCount, 0);
  const document = await loadProject(projectDir);
  assert.equal(document.drafts[0].nodes.some((node) => node.id === source.nodeId), false);
  assert.equal(document.drafts[0].edges.length, 0);
  assert.equal(document.drafts[0].nodes.find((node) => node.id === target.nodeId)?.execution.status, "dirty");
});

test("local preview bridge reads and saves one project without exposing arbitrary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-preview-bridge-"));
  const projectDir = join(root, "demo");
  const initial = createProject({ title: "Bridge project" });
  await saveProjectAtomic(projectDir, initial, { createOnly: true });
  const bridge = await startPreviewBridge({ projectDirectory: projectDir, token: "test-preview-bridge-token" });
  const projectUrl = `${bridge.bridgeUrl}/project.json?token=${bridge.token}`;

  try {
    const loaded = await fetch(projectUrl);
    assert.equal(loaded.status, 200);
    const loadedDocument = await loaded.json();
    assert.equal(loadedDocument.project.title, "Bridge project");

    const unchanged = await fetch(`${projectUrl}&revision=${loadedDocument.revision}`);
    assert.equal(unchanged.status, 204);

    const changed = addNode(initial, {
      draftId: initial.activeDraftId,
      expectedProjectRevision: initial.revision,
      expectedDraftRevision: initial.drafts[0]!.revision,
      title: "本地镜头",
      spec: {
        kind: "shot",
        prompt: "一艘飞船越过城市夜空。",
        mediaKind: "image",
        inputAssetIds: [],
      },
    });
    const saved = await fetch(projectUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: initial.revision, document: changed }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revision, changed.revision);
    assert.equal((await loadProject(projectDir)).drafts[0]!.nodes[0]!.title, "本地镜头");

    const changedSinceInitial = await fetch(`${projectUrl}&revision=${loadedDocument.revision}`);
    assert.equal(changedSinceInitial.status, 200);
    assert.equal((await changedSinceInitial.json()).revision, changed.revision);
    const unchangedAgain = await fetch(`${projectUrl}&revision=${changed.revision}`);
    assert.equal(unchangedAgain.status, 204);

    const stale = await fetch(projectUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: initial.revision, document: changed }),
    });
    assert.equal(stale.status, 409);

    const forbidden = await fetch(`${bridge.bridgeUrl}/project.json`);
    assert.equal(forbidden.status, 404);
    const fileProbe = await fetch(`${bridge.bridgeUrl}/asset?token=${bridge.token}&id=../../project.json`);
    assert.equal(fileProbe.status, 404);
  } finally {
    await bridge.close();
  }
});

test("CLI exposes context-first atomic canvas operations without leaking local paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-atomic-"));
  const projectDir = join(root, "demo");
  const source = join(root, "reference.png");
  await writeFile(source, Buffer.from("context-asset\n", "utf8"));
  await cli(["init", projectDir, "--title", "Atomic canvas"]);
  const imported = await cli(["asset", "import", "--project", projectDir, "--file", source]);
  const character = await cli([
    "node", "add", "--project", projectDir, "--kind", "composition", "--role", "character",
    "--title", "旅行者设定", "--prompt", "蓝色风衣的独行旅者，跨镜头保持一致。", "--x", "120", "--y", "180",
  ]);
  const shot = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--media-kind", "image",
    "--title", "雨夜街道", "--prompt", "旅者走过雨后的霓虹街道。", "--input-assets", imported.assetId,
    "--aspect-ratio", "16:9", "--x", "520", "--y", "180",
  ]);
  const connected = await cli([
    "edge", "connect", "--project", projectDir, "--kind", "dependency",
    "--source", character.nodeId, "--target", shot.nodeId,
  ]);
  const grouped = await cli([
    "group", "create", "--project", projectDir, "--title", "开场", "--members", `${character.nodeId},${shot.nodeId}`,
  ]);

  const focused = await cli([
    "context", "--project", projectDir, "--node", shot.nodeId, "--depth", "0",
  ]);
  assert.equal(focused.project.title, "Atomic canvas");
  assert.deepEqual(focused.focus, { nodeId: shot.nodeId, depth: 0 });
  assert.equal(focused.draft.nodeCount, 3);
  const focusedShot = focused.nodes.find((node: any) => node.id === shot.nodeId);
  assert.equal(focusedShot.prompt, "旅者走过雨后的霓虹街道。");
  assert.deepEqual(focusedShot.inputAssetIds, [imported.assetId]);
  assert.deepEqual(focusedShot.upstream, [{
    edgeId: connected.edgeId,
    kind: "dependency",
    nodeId: character.nodeId,
    title: "旅行者设定",
    nodeKind: "composition",
    role: "character",
  }]);
  assert.ok(focused.nodes.some((node: any) => node.id === grouped.groupNodeId));
  assert.deepEqual(focused.assets, [{
    id: imported.assetId,
    kind: "image",
    mediaType: "image/png",
    byteLength: Buffer.byteLength("context-asset\n"),
    origin: { kind: "import" },
  }]);
  assert.equal(focused.jobs.length, 0);
  assert.doesNotMatch(JSON.stringify(focused), /"path"|checksumSha256|reference\.png/);

  const moved = await cli([
    "node", "move", "--project", projectDir, "--node", shot.nodeId, "--x", "760", "--y", "360",
  ]);
  assert.deepEqual(moved.position, { x: 760, y: 360 });
  const copied = await cli(["node", "copy", "--project", projectDir, "--node", shot.nodeId]);
  assert.equal(copied.sourceNodeId, shot.nodeId);
  assert.deepEqual(copied.position, { x: 808, y: 408 });
  const afterCopy = await cli(["context", "--project", projectDir]);
  const copyNode = afterCopy.nodes.find((node: any) => node.id === copied.nodeId);
  assert.equal(copyNode.title, "雨夜街道 副本");
  assert.deepEqual(copyNode.position, { x: 808, y: 408 });
  assert.deepEqual(copyNode.execution, { status: "dirty", outputAssetIds: [] });

  const disconnected = await cli(["edge", "disconnect", "--project", projectDir, "--edge", connected.edgeId]);
  assert.equal(disconnected.edgeId, connected.edgeId);
  const afterDisconnect = await cli(["context", "--project", projectDir, "--node", shot.nodeId, "--depth", "1"]);
  assert.equal(afterDisconnect.edges.length, 0);
  assert.deepEqual(
    afterDisconnect.nodes.find((node: any) => node.id === shot.nodeId).upstream,
    [],
  );

  const copyGroup = await cliProcess([
    "node", "copy", "--project", projectDir, "--node", grouped.groupNodeId,
  ]);
  assert.equal(copyGroup.code, 1);
  assert.match(copyGroup.stderr, /cannot copy a layout group/);
  const invalidDepth = await cliProcess(["context", "--project", projectDir, "--depth", "1"]);
  assert.equal(invalidDepth.code, 1);
  assert.match(invalidDepth.stderr, /--depth requires --node/);
});

test("CLI creates, connects, generates, inspects, previews, and exports from project.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-"));
  const projectDir = join(root, "demo");
  const initialized = await cli(["init", projectDir, "--title", "Science fiction short"]);
  assert.equal(initialized.revision, 0);
  const duplicateInit = await cliProcess(["init", projectDir, "--title", "Overwrite"]);
  assert.equal(duplicateInit.code, 1);
  assert.equal(JSON.parse(await readFile(join(projectDir, "project.json"), "utf8")).project.title, "Science fiction short");

  const shot = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Arrival",
    "--prompt", "A ship arrives", "--media-kind", "image",
    "--model", "mock-image-v1",
  ]);
  const composition = await cli([
    "node", "add", "--project", projectDir, "--kind", "composition", "--title", "Final",
  ]);
  await cli([
    "edge", "connect", "--project", projectDir, "--kind", "dependency",
    "--source", shot.nodeId, "--target", composition.nodeId,
  ]);
  const generated = await cli(["generate", "--project", projectDir, "--node", shot.nodeId]);
  assert.equal(generated.status, "succeeded");
  await access(join(projectDir, generated.assetPath));
  const generatedDocument = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  assert.equal(generatedDocument.drafts[0].jobs[0].route.selectionSource, "prompt_override");
  const conditioned = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Conditioned",
    "--prompt", "Animate the input", "--media-kind", "video",
    "--input-assets", generated.assetId, "--aspect-ratio", "16:9",
    "--width", "32", "--height", "18", "--duration-seconds", "5",
    "--audio", "either", "--media-type", "video/mp4",
    "--ai-provider", "mock",
  ]);
  const conditionedDocument = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  const conditionedNode = conditionedDocument.drafts[0].nodes.find((node: any) => node.id === conditioned.nodeId);
  assert.deepEqual(conditionedNode.spec.inputAssetIds, [generated.assetId]);
  assert.deepEqual(conditionedNode.spec.requirements, {
    aspectRatio: "16:9",
    width: 32,
    height: 18,
    durationSeconds: 5,
    audio: "either",
    mediaType: "video/mp4",
  });

  const status = await cli(["status", "--project", projectDir]);
  assert.equal(status.nodes.find((node: any) => node.id === shot.nodeId).status, "succeeded");
  assert.equal(status.projectPath, join(projectDir, "project.json"));
  assert.deepEqual(status.jobs[0].route, {
    providerId: "mock",
    modelId: "mock-image-v1",
    selectionSource: "prompt_override",
  });

  const preview = await cli(["open", "--project", projectDir, "--no-open"]);
  assert.match(preview.url, /^http:\/\/127\.0\.0\.1:4173\//);
  assert.equal(preview.draftId, initialized.activeDraftId);
  const previewProjectUrl = new URL(preview.url).searchParams.get("project-url");
  assert.ok(previewProjectUrl);
  const previewDocument = await fetch(previewProjectUrl);
  assert.equal(previewDocument.status, 200);
  assert.equal((await previewDocument.json()).project.title, "Science fiction short");
  const bridgeShutdownUrl = new URL(previewProjectUrl);
  bridgeShutdownUrl.pathname = "/bridge";
  await fetch(bridgeShutdownUrl, { method: "DELETE" });

  const output = join(root, "arrival.png");
  const exported = await cli([
    "export", "--project", projectDir, "--draft", initialized.activeDraftId,
    "--node", shot.nodeId, "--output", output,
  ]);
  assert.equal(exported.draftId, initialized.activeDraftId);
  assert.equal(exported.output, output);
  await access(output);
});

test("CLI copies a draft and applies a revision-checked targeted update", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-copy-"));
  const projectDir = join(root, "demo");
  const initialized = await cli(["init", projectDir, "--title", "Variations"]);
  const shot = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Crossing",
    "--prompt", "Day crossing", "--media-kind", "video",
    "--ai-provider", "mock",
  ]);
  const planned = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  assert.deepEqual(planned.drafts[0].nodes[0].spec.routing.aiChoice, {
    providerId: "mock",
  });
  const copied = await cli([
    "draft", "copy", "--project", projectDir, "--source", initialized.activeDraftId,
    "--title", "Night",
  ]);
  const before = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  await cli([
    "node", "update", "--project", projectDir, "--draft", copied.draftId,
    "--node", shot.nodeId, "--prompt", "Night crossing",
    "--duration-seconds", "8",
    "--expected-project-revision", String(before.revision),
    "--expected-draft-revision", String(before.drafts[1].revision),
  ]);
  const after = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  assert.equal(after.drafts[0].nodes[0].spec.prompt, "Day crossing");
  assert.equal(after.drafts[1].nodes[0].spec.prompt, "Night crossing");
  assert.equal(after.drafts[1].nodes[0].spec.requirements.durationSeconds, 8);
});

test("CLI persists image candidate count and rejects invalid local count values", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-count-"));
  const projectDir = join(root, "demo");
  await cli(["init", projectDir, "--title", "Candidates"]);
  const image = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "候选图",
    "--prompt", "一座安静的轨道城市", "--media-kind", "image", "--count", "2",
  ]);
  let document = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  assert.equal(document.drafts[0].nodes[0].spec.requirements.count, 2);

  await cli([
    "node", "update", "--project", projectDir, "--node", image.nodeId,
    "--count", "4",
    "--expected-project-revision", String(document.revision),
    "--expected-draft-revision", String(document.drafts[0].revision),
  ]);
  document = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  assert.equal(document.drafts[0].nodes[0].spec.requirements.count, 4);

  const invalid = await cliProcess([
    "node", "update", "--project", projectDir, "--node", image.nodeId, "--count", "5",
  ]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /--count must be an integer from 1 to 4/);

  const videoCount = await cliProcess([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "不支持的视频数量",
    "--prompt", "一个慢速推进镜头", "--media-kind", "video", "--count", "1",
  ]);
  assert.equal(videoCount.code, 1);
  assert.match(videoCount.stderr, /--count is currently supported only for image shots/);
});

test("CLI creates project-scoped context nodes without a global role or asset library", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-context-"));
  const projectDir = join(root, "demo");
  const source = join(root, "city.png");
  await writeFile(source, Buffer.from("local-city-reference\n", "utf8"));
  await cli(["init", projectDir, "--title", "Local context"]);
  const imported = await cli(["asset", "import", "--project", projectDir, "--file", source]);

  const character = await cli([
    "node", "add", "--project", projectDir, "--kind", "composition", "--role", "character",
    "--title", "主角设定", "--prompt", "短发摄影师，蓝色外套，跨镜头保持同一外观。",
  ]);
  const localReference = await cli([
    "node", "add", "--project", projectDir, "--kind", "composition", "--role", "asset-reference",
    "--title", "本地参考", "--prompt", "使用项目中已导入的城市夜景作为构图参考。",
    "--reference-assets", imported.assetId,
  ]);

  const document = await loadProject(projectDir);
  const nodes = document.drafts[0]!.nodes;
  const characterNode = nodes.find((node) => node.id === character.nodeId)!;
  const referenceNode = nodes.find((node) => node.id === localReference.nodeId)!;
  assert.deepEqual(characterNode.spec, {
    kind: "composition",
    mediaType: "application/json",
    role: "character",
    prompt: "短发摄影师，蓝色外套，跨镜头保持同一外观。",
  });
  assert.equal(referenceNode.spec.kind, "composition");
  assert.equal(referenceNode.spec.role, "asset-reference");
  assert.deepEqual(referenceNode.spec.referenceAssetIds, [imported.assetId]);
  assert.equal(document.assets.length, 1);

  const beforeUpdate = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  await cli([
    "node", "update", "--project", projectDir, "--node", localReference.nodeId,
    "--reference-assets", "",
    "--expected-project-revision", String(beforeUpdate.revision),
    "--expected-draft-revision", String(beforeUpdate.drafts[0].revision),
  ]);
  const afterUpdate = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  const clearedReference = afterUpdate.drafts[0].nodes.find((node: any) => node.id === localReference.nodeId);
  assert.equal("referenceAssetIds" in clearedReference.spec, false);

  const legacyLibrary = await cliProcess([
    "node", "add", "--project", projectDir, "--kind", "composition", "--role", "asset-library",
    "--title", "不应创建", "--prompt", "不应创建全局素材库。",
  ]);
  assert.equal(legacyLibrary.code, 1);
  assert.match(legacyLibrary.stderr, /Invalid composition role: asset-library/);
});

test("CLI persists a project-local layout group without creating a global resource library", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-group-"));
  const projectDir = join(root, "demo");
  await cli(["init", projectDir, "--title", "Layout group"]);
  const first = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "镜头 A",
    "--prompt", "第一幕", "--media-kind", "image", "--x", "120", "--y", "180",
  ]);
  const second = await cli([
    "node", "add", "--project", projectDir, "--kind", "composition", "--role", "character",
    "--title", "主角", "--prompt", "跨镜头保持一致。", "--x", "520", "--y", "180",
  ]);
  const grouped = await cli([
    "group", "create", "--project", projectDir,
    "--members", `${first.nodeId},${second.nodeId}`, "--title", "第一幕",
  ]);
  const document = await loadProject(projectDir);
  const group = document.drafts[0]!.nodes.find((node) => node.id === grouped.groupNodeId)!;
  assert.deepEqual(group.spec, {
    kind: "composition",
    mediaType: "application/json",
    role: "group",
    memberNodeIds: [first.nodeId, second.nodeId],
  });
  assert.equal(group.title, "第一幕");
  assert.deepEqual(grouped.memberNodeIds, [first.nodeId, second.nodeId]);

  const invalid = await cliProcess([
    "group", "create", "--project", projectDir, "--members", first.nodeId,
  ]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /at least two/);
});

test("CLI expands a project-local script into editable video shots and ordered edges", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-script-"));
  const projectDir = join(root, "demo");
  await cli(["init", projectDir, "--title", "Script expansion"]);
  const script = await cli([
    "node", "add", "--project", projectDir, "--kind", "composition", "--role", "script",
    "--title", "三镜头短片", "--prompt", "1. 雨夜的高架桥上，信使抵达。\n2. 她穿过空旷的车站。\n3. 远处的列车亮起。",
    "--x", "120", "--y", "240",
  ]);

  const expanded = await cli([
    "script", "expand", "--project", projectDir, "--node", script.nodeId,
  ]);
  assert.equal(expanded.revision, script.revision + 1);
  assert.equal(expanded.shotNodeIds.length, 3);
  assert.deepEqual(expanded.shotPrompts, [
    "雨夜的高架桥上，信使抵达。",
    "她穿过空旷的车站。",
    "远处的列车亮起。",
  ]);

  const document = await loadProject(projectDir);
  const draft = document.drafts[0]!;
  const shots = expanded.shotNodeIds.map((nodeId: string) => draft.nodes.find((node) => node.id === nodeId)!);
  assert.ok(shots.every((node) => node.spec.kind === "shot" && node.spec.mediaKind === "video"));
  assert.deepEqual(
    shots.map((node) => node.position),
    [{ x: 420, y: 84 }, { x: 420, y: 240 }, { x: 420, y: 396 }],
  );
  assert.deepEqual(
    draft.edges.map((edge) => ({
      kind: edge.kind,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
    })),
    [
      ...expanded.shotNodeIds.map((targetNodeId: string) => ({
        kind: "dependency",
        sourceNodeId: script.nodeId,
        targetNodeId,
      })),
      { kind: "sequence", sourceNodeId: expanded.shotNodeIds[0], targetNodeId: expanded.shotNodeIds[1] },
      { kind: "sequence", sourceNodeId: expanded.shotNodeIds[1], targetNodeId: expanded.shotNodeIds[2] },
    ],
  );

  const invalidLimit = await cliProcess([
    "script", "expand", "--project", projectDir, "--node", script.nodeId, "--limit", "9",
  ]);
  assert.equal(invalidLimit.code, 1);
  assert.match(invalidLimit.stderr, /--limit must be an integer from 1 to 8/);
});

test("CLI imports a local reference asset into the project asset store", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-import-"));
  const projectDir = join(root, "demo");
  const source = join(root, "reference.png");
  await writeFile(source, Buffer.from("open-canvas-local-reference\n", "utf8"));
  await cli(["init", projectDir, "--title", "Local references"]);

  const imported = await cli(["asset", "import", "--project", projectDir, "--file", source]);
  assert.equal(imported.kind, "image");
  assert.equal(imported.mediaType, "image/png");
  assert.equal(imported.imported, true);
  await access(join(projectDir, imported.assetPath));

  const document = await loadProject(projectDir);
  assert.equal(document.assets.length, 1);
  assert.equal(document.assets[0]?.origin.kind, "import");
  assert.equal(document.assets[0]?.id, imported.assetId);

  const duplicate = await cli(["asset", "import", "--project", projectDir, "--file", source]);
  assert.equal(duplicate.imported, false);
  assert.equal(duplicate.assetId, imported.assetId);
  assert.equal(duplicate.revision, imported.revision);
});

test("CLI materializes an agent-produced local file as a node result", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-result-import-"));
  const projectDir = join(root, "demo");
  const source = join(root, "codex-output.png");
  const bytes = Buffer.from("codex-generated-image-result\n", "utf8");
  await writeFile(source, bytes);
  await cli(["init", projectDir, "--title", "Agent result"]);
  const shot = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Cover",
    "--prompt", "A generated cover", "--media-kind", "image", "--aspect-ratio", "1:1",
  ]);

  const result = await cli([
    "result", "import", "--project", projectDir, "--node", shot.nodeId, "--file", source,
    "--provider", "codex-imagegen", "--model", "demo-image-v1",
  ]);
  assert.equal(result.status, "succeeded");
  assert.equal(result.route.providerId, "codex-imagegen");
  assert.equal(result.route.modelId, "demo-image-v1");
  await access(join(projectDir, result.assetPath));

  const document = await loadProject(projectDir);
  const draft = document.drafts[0]!;
  const node = draft.nodes.find((candidate) => candidate.id === shot.nodeId)!;
  const job = draft.jobs.find((candidate) => candidate.id === result.jobId)!;
  const asset = document.assets.find((candidate) => candidate.id === result.assetId)!;
  assert.equal(node.execution.status, "succeeded");
  assert.deepEqual(node.execution.outputAssetIds, [result.assetId]);
  assert.equal(job.status, "succeeded");
  assert.equal(job.providerJobId.startsWith("local:"), true);
  assert.equal(asset.origin.kind, "job");
  assert.equal(asset.origin.kind === "job" ? asset.origin.jobId : null, result.jobId);
  assert.deepEqual(await readFile(join(projectDir, result.assetPath)), bytes);
});

test("CLI materializes a PNG result for an image composition node", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-image-composition-result-"));
  const projectDir = join(root, "demo");
  const source = join(root, "source.png");
  const resultFile = join(root, "composition.png");
  await writeFile(source, Buffer.from("source-image-result\n", "utf8"));
  await writeFile(resultFile, Buffer.from("composition-image-result\n", "utf8"));
  await cli(["init", projectDir, "--title", "Image composition"]);
  const shot = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Source",
    "--prompt", "A source image", "--media-kind", "image",
  ]);
  await cli([
    "result", "import", "--project", projectDir, "--node", shot.nodeId, "--file", source,
  ]);
  const composition = await cli([
    "node", "add", "--project", projectDir, "--kind", "composition", "--title", "Image output",
    "--role", "composition", "--media-type", "image/png",
  ]);
  await cli([
    "edge", "connect", "--project", projectDir, "--kind", "dependency",
    "--source", shot.nodeId, "--target", composition.nodeId,
  ]);

  const result = await cli([
    "result", "import", "--project", projectDir, "--node", composition.nodeId, "--file", resultFile,
  ]);
  assert.equal(result.status, "succeeded");
  const document = await loadProject(projectDir);
  const asset = document.assets.find((candidate) => candidate.id === result.assetId)!;
  assert.equal(asset.kind, "image");
  assert.equal(asset.mediaType, "image/png");
});

test("invalid mock routing fails before a job is persisted", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-route-"));
  const projectDir = join(root, "demo");
  await cli(["init", projectDir, "--title", "Invalid route"]);
  const shot = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Shot",
    "--prompt", "No submit", "--media-kind", "image",
    "--provider", "mock", "--model", "mock-nonexistent",
  ]);
  const result = await cliProcess(["generate", "--project", projectDir, "--node", shot.nodeId]);
  assert.equal(result.code, 1);
  const document = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  assert.equal(document.drafts[0].nodes[0].execution.status, "dirty");
  assert.equal(document.drafts[0].jobs.length, 0);
});

test("CLI requires an explicit mock route or a configured BYOK provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-byok-"));
  const projectDir = join(root, "demo");
  await cli(["init", projectDir, "--title", "BYOK"]);
  const shot = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Shot",
    "--prompt", "No silent fallback", "--media-kind", "image",
  ]);
  const environment = { ARK_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" };
  const defaultRoute = await cliProcess(
    ["generate", "--project", projectDir, "--node", shot.nodeId],
    environment,
  );
  assert.equal(defaultRoute.code, 1);
  assert.match(defaultRoute.stderr, /No configured provider can satisfy/);
  let document = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  assert.equal(document.drafts[0].nodes[0].execution.status, "dirty");
  assert.equal(document.drafts[0].jobs.length, 0);

  const overridden = await cli([
    "node", "update", "--project", projectDir, "--node", shot.nodeId,
    "--provider", "openai", "--model", "gpt-image-2",
  ]);
  assert.equal(typeof overridden.revision, "number");
  const explicitRoute = await cliProcess(
    ["generate", "--project", projectDir, "--node", shot.nodeId],
    environment,
  );
  assert.equal(explicitRoute.code, 1);
  assert.match(explicitRoute.stderr, /OPENAI_API_KEY/);
  document = JSON.parse(await readFile(join(projectDir, "project.json"), "utf8"));
  assert.equal(document.drafts[0].nodes[0].execution.status, "dirty");
  assert.equal(document.drafts[0].jobs.length, 0);
});

test("generate resolves an explicitly selected user provider instance from local configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-custom-provider-route-"));
  const projectDir = join(root, "demo");
  const configPath = join(root, "providers.json");
  await writeFile(configPath, JSON.stringify({
    version: 1,
    providers: [{
      id: "studio-images",
      adapter: "openai",
      credentialEnv: "STUDIO_IMAGES_KEY",
      models: { image: "studio-image-endpoint" },
      priority: 5,
    }],
  }));
  await cli(["init", projectDir, "--title", "Custom provider route"]);
  const shot = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Shot",
    "--prompt", "A studio image", "--media-kind", "image",
    "--provider", "studio-images", "--model", "studio-image-endpoint",
  ]);

  const result = await cliProcess([
    "generate", "--project", projectDir, "--node", shot.nodeId, "--provider-config", configPath,
  ], { STUDIO_IMAGES_KEY: "" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /STUDIO_IMAGES_KEY/);
  const document = await loadProject(projectDir);
  assert.equal(document.drafts[0]!.nodes[0]!.execution.status, "dirty");
  assert.equal(document.drafts[0]!.jobs.length, 0);
});

test("generate resumes a queued job persisted by an interrupted process", async () => {
  const root = await mkdtemp(join(tmpdir(), "open-canvas-cli-resume-"));
  const projectDir = join(root, "demo");
  await cli(["init", projectDir, "--title", "Resume"]);
  const shot = await cli([
    "node", "add", "--project", projectDir, "--kind", "shot", "--title", "Shot",
    "--prompt", "Resume", "--media-kind", "image",
  ]);
  const before = await loadProject(projectDir);
  const draft = before.drafts[0];
  const started = startGeneration(before, {
    draftId: draft.id,
    nodeId: shot.nodeId,
    expectedProjectRevision: before.revision,
    expectedDraftRevision: draft.revision,
  });
  await saveProjectAtomic(projectDir, started.document, { expectedCurrentRevision: before.revision });

  const resumed = await cli(["generate", "--project", projectDir, "--node", shot.nodeId]);
  assert.equal(resumed.status, "succeeded");
  assert.equal(resumed.jobId, started.request.jobId);
});
