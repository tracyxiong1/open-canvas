import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { addNode, applyProviderSnapshot, createProject, loadProject, saveProjectAtomic, startGeneration, updateNode } from "@open-canvas/core";
import { parseArgs } from "../src/args.ts";
import { runCommand } from "../src/commands.ts";

test("transient video polling errors retain the remote handle and completion preserves concurrent canvas edits", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "canvas-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let document = createProject({ title: "Recovery" });
  const draftId = document.activeDraftId;
  document = addNode(document, { draftId, title: "Video", spec: { kind: "shot", mediaKind: "video", prompt: "A quiet valley", inputAssetIds: [] },
    expectedProjectRevision: document.revision, expectedDraftRevision: document.drafts[0]!.revision });
  const nodeId = document.drafts[0]!.nodes[0]!.id;
  const started = startGeneration(document, { draftId, nodeId, expectedProjectRevision: document.revision, expectedDraftRevision: document.drafts[0]!.revision,
    resolveRoute: () => ({ providerId: "volcengine-ark", modelId: "test-endpoint", selectionSource: "registry_default" }) });
  document = applyProviderSnapshot(started.document, { draftId, jobId: started.request.jobId, snapshot: { providerJobId: "ark-video:original-task", status: "running" } });
  await saveProjectAtomic(directory, document);
  const previousKey = process.env.ARK_API_KEY; const previousFetch = globalThis.fetch;
  process.env.ARK_API_KEY = "synthetic-unit-test-key";
  t.after(() => { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.ARK_API_KEY; else process.env.ARK_API_KEY = previousKey; });
  const args = parseArgs(["generate", "--project", directory, "--node", nodeId, "--max-polls", "0"]);
  globalThis.fetch = async (_url, init) => { assert.equal(init!.method, "GET"); throw new Error("synthetic-unit-test-key should be redacted"); };
  await assert.rejects(runCommand(args), (error: Error) => /remains resumable/.test(error.message) && !error.message.includes("synthetic-unit-test-key"));
  const interrupted = await loadProject(directory);
  assert.equal(interrupted.drafts[0]!.jobs[0]!.status, "running");
  assert.equal(interrupted.drafts[0]!.jobs[0]!.providerJobId, "ark-video:original-task");
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/contents/generations/tasks/")) {
      assert.equal(init!.method, "GET");
      const before = await loadProject(directory);
      const changed = updateNode(before, { draftId, nodeId, title: "Renamed while generating", expectedProjectRevision: before.revision, expectedDraftRevision: before.drafts[0]!.revision });
      await saveProjectAtomic(directory, changed, { expectedCurrentRevision: before.revision });
      return new Response(JSON.stringify({ id: "original-task", status: "succeeded", content: { video_url: "https://media.example.test/video.mp4" } }));
    }
    return new Response(Buffer.from("unit-test-video"));
  };
  const result = await runCommand(args) as { status: string; assetPath: string };
  assert.equal(result.status, "succeeded");
  const completed = await loadProject(directory);
  assert.equal(completed.drafts[0]!.jobs.length, 1);
  assert.equal(completed.drafts[0]!.nodes[0]!.title, "Renamed while generating");
  assert.equal((await readFile(join(directory, result.assetPath))).toString(), "unit-test-video");
});

test("recovery before a provider returned its handle never silently resubmits", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "canvas-unknown-submit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let document = createProject({ title: "Unknown submission" });
  const draftId = document.activeDraftId;
  document = addNode(document, { draftId, title: "Image", spec: { kind: "shot", mediaKind: "image", prompt: "Valley", inputAssetIds: [] }, expectedProjectRevision: document.revision, expectedDraftRevision: document.drafts[0]!.revision });
  const nodeId = document.drafts[0]!.nodes[0]!.id;
  const started = startGeneration(document, { draftId, nodeId, expectedProjectRevision: document.revision, expectedDraftRevision: document.drafts[0]!.revision,
    resolveRoute: () => ({ providerId: "volcengine-ark", modelId: "test-image", selectionSource: "registry_default" }) });
  document = applyProviderSnapshot(started.document, { draftId, jobId: started.request.jobId, snapshot: { providerJobId: "submission-pending:test", status: "queued" } });
  await saveProjectAtomic(directory, document);
  const previousKey = process.env.ARK_API_KEY; const previousFetch = globalThis.fetch;
  process.env.ARK_API_KEY = "synthetic-unit-test-key";
  t.after(() => { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.ARK_API_KEY; else process.env.ARK_API_KEY = previousKey; });
  let called = false; globalThis.fetch = async () => { called = true; throw new Error("must not call"); };
  await assert.rejects(runCommand(parseArgs(["generate", "--project", directory, "--node", nodeId])), /completion is unknown/);
  assert.equal(called, false);
  assert.equal((await loadProject(directory)).drafts[0]!.jobs.length, 1);
});
