import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { loadProject, saveProjectAtomic, startGeneration } from "@creator-canvas/core";

const workspace = resolve(import.meta.dirname, "../../..");
const main = resolve(workspace, "packages/cli/src/main.ts");

async function cliProcess(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", main, ...args], {
    cwd: workspace,
    env: { ...process.env },
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

test("CLI creates, connects, generates, inspects, previews, and exports from project.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "creator-canvas-cli-"));
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

  const preview = await cli(["open", "--project", projectDir, "--no-open"]);
  assert.match(preview.url, /^http:\/\/127\.0\.0\.1:4173\//);
  assert.equal(preview.draftId, initialized.activeDraftId);

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
  const root = await mkdtemp(join(tmpdir(), "creator-canvas-cli-copy-"));
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

test("invalid mock routing fails before a job is persisted", async () => {
  const root = await mkdtemp(join(tmpdir(), "creator-canvas-cli-route-"));
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

test("generate resumes a queued job persisted by an interrupted process", async () => {
  const root = await mkdtemp(join(tmpdir(), "creator-canvas-cli-resume-"));
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
