import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addNode, completeGeneration, connectNodes, copyDraft, createProject, createProviderCredential,
  effectiveOutputAssetIds, MockProviderAdapter, OpenAISpeechAdapter, parseCanvasDocument,
  resetNodeGeneration, selectNodeOutput, selectProviderRoute, startGeneration, updateNode,
  type CanvasDocument, type GenerationRequest,
} from "../src/index.js";

function revisions(document: CanvasDocument) {
  return { draftId: document.activeDraftId, expectedProjectRevision: document.revision, expectedDraftRevision: document.drafts[0]!.revision };
}

async function wav() {
  const adapter = new MockProviderAdapter();
  const started = await adapter.submit({ jobId: "fixture", kind: "audio", prompt: "test", inputs: [], requirements: {} }, "mock-audio-v1");
  await adapter.poll(started.providerJobId);
  const done = await adapter.poll(started.providerJobId);
  const chunks = [];
  for await (const bytes of adapter.openArtifact(done.providerJobId, done.outputs![0]!.artifactId)) chunks.push(Buffer.from(bytes));
  return Buffer.concat(chunks);
}

test("speech adapter sends official parameters and retains only safe artifact metadata", async () => {
  const bytes = await wav();
  let calls = 0;
  const adapter = new OpenAISpeechAdapter({ fetcher: async (url, init) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/audio/speech");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: "gpt-4o-mini-tts", input: "你好", voice: "coral", speed: 1.25, response_format: "wav",
    });
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "audio/wav" } });
  } });
  const request: GenerationRequest = { jobId: "speech-test", kind: "audio", prompt: "你好", inputs: [], requirements: { voice: "coral", speed: 1.25 } };
  const snapshot = await adapter.submit(request, "gpt-4o-mini-tts", { credential: createProviderCredential("synthetic-test-credential") });
  assert.equal(snapshot.status, "succeeded");
  assert.equal(snapshot.outputs![0]!.mediaType, "audio/wav");
  assert.doesNotMatch(JSON.stringify(snapshot), /synthetic-test|https:|你好/);
  assert.equal(calls, 1);
  const chunks = [];
  for await (const chunk of adapter.openArtifact(snapshot.providerJobId, snapshot.outputs![0]!.artifactId)) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), bytes);
  await assert.rejects(new OpenAISpeechAdapter().poll(snapshot.providerJobId), /synchronous/);
});

test("speech routing rejects image references, unsupported voices, visual constraints and missing BYOK", () => {
  const adapter = new OpenAISpeechAdapter();
  const base: GenerationRequest = { jobId: "test", kind: "audio", prompt: "你好", inputs: [], requirements: {} };
  const route = (request: GenerationRequest, configured = true) => selectProviderRoute([adapter], { request, credentials: { has: () => configured } });
  assert.equal(route(base).providerId, "openai-speech");
  assert.throws(() => route(base, false));
  assert.throws(() => route({ ...base, requirements: { voice: "custom-clone" } }));
  assert.throws(() => route({ ...base, requirements: { width: 1024, height: 1024 } }));
  assert.throws(() => route({ ...base, inputs: [{ assetId: "image", kind: "image", mediaType: "image/png" }] }));
});

test("speech adapter rejects malformed output and sanitizes transport errors", async () => {
  const request: GenerationRequest = { jobId: "test", kind: "audio", prompt: "hello", inputs: [], requirements: {} };
  const context = { credential: createProviderCredential("synthetic-test-credential") };
  await assert.rejects(new OpenAISpeechAdapter({ fetcher: async () => new Response("not-audio") }).submit(request, "gpt-4o-mini-tts", context), /requested audio format/);
  await assert.rejects(new OpenAISpeechAdapter({ fetcher: async () => { throw new Error("synthetic-test-credential"); } }).submit(request, "gpt-4o-mini-tts", context), (error: Error) => !error.message.includes("synthetic-test-credential") && error.message.includes("unknown"));
});

test("audio generation uses plain upstream text and remains compatible with legacy audio context", async () => {
  let document = createProject({ title: "Audio" });
  document = addNode(document, { ...revisions(document), title: "旁白文字", spec: { kind: "composition", role: "text", prompt: "上游正文", mediaType: "text/plain" } });
  const textId = document.drafts[0]!.nodes[0]!.id;
  document = addNode(document, { ...revisions(document), title: "声音", spec: { kind: "shot", mediaKind: "audio", prompt: "你好", inputAssetIds: [], requirements: { voice: "coral", speed: 1 } } });
  const nodeId = document.drafts[0]!.nodes[1]!.id;
  document = connectNodes(document, { ...revisions(document), sourceNodeId: textId, targetNodeId: nodeId, kind: "dependency" });
  const start = startGeneration(document, { ...revisions(document), nodeId });
  assert.equal(start.request.prompt, "上游正文\n\n你好");
  assert.equal(start.route.modelId, "mock-audio-v1");
  document = completeGeneration(start.document, { draftId: document.activeDraftId, jobId: start.request.jobId, providerJobId: "mock:speech", artifact: { kind: "audio", mediaType: "audio/wav", bytes: await wav() } });
  assert.equal(document.assets[0]!.kind, "audio");
  document = addNode(document, { ...revisions(document), title: "旧音频意图", spec: { kind: "composition", role: "audio", prompt: "配乐要求", mediaType: "application/json" } });
  assert.equal(parseCanvasDocument(document).drafts[0]!.nodes.at(-1)!.execution.status, "dirty");
  assert.throws(() => addNode(document, { ...revisions(document), title: "Bad audio", spec: { kind: "shot", mediaKind: "audio", prompt: "hello", inputAssetIds: [], requirements: { aspectRatio: "16:9" } } }), /audio node/);
});

test("historical output selection preserves truthful jobs, invalidates descendants and survives reload", async () => {
  let document = createProject({ title: "History" });
  document = addNode(document, { ...revisions(document), title: "Audio", spec: { kind: "shot", mediaKind: "audio", prompt: "old", inputAssetIds: [] } });
  const nodeId = document.drafts[0]!.nodes[0]!.id;
  const started = startGeneration(document, { ...revisions(document), nodeId });
  document = completeGeneration(started.document, { draftId: document.activeDraftId, jobId: started.request.jobId, providerJobId: "mock:speech", artifact: { kind: "audio", mediaType: "audio/wav", bytes: await wav() } });
  const assetId = document.assets[0]!.id;
  const previousJob = structuredClone(document.drafts[0]!.jobs[0]);
  document = updateNode(document, { ...revisions(document), nodeId, spec: { kind: "shot", mediaKind: "audio", prompt: "new", inputAssetIds: [] } });
  document = addNode(document, { ...revisions(document), title: "Downstream", spec: { kind: "shot", mediaKind: "video", prompt: "consume", inputAssetIds: [] } });
  const targetId = document.drafts[0]!.nodes[1]!.id;
  document = connectNodes(document, { ...revisions(document), sourceNodeId: nodeId, targetNodeId: targetId, kind: "dependency" });
  const fingerprint = document.drafts[0]!.nodes[1]!.execution.inputFingerprint;
  document = selectNodeOutput(document, { ...revisions(document), nodeId, assetId });
  document = parseCanvasDocument(JSON.parse(JSON.stringify(document)));
  assert.equal(document.drafts[0]!.nodes[0]!.execution.status, "dirty");
  assert.deepEqual(effectiveOutputAssetIds(document.drafts[0]!.nodes[0]!), [assetId]);
  assert.deepEqual(document.drafts[0]!.jobs[0], previousJob);
  assert.notEqual(document.drafts[0]!.nodes[1]!.execution.inputFingerprint, fingerprint);
  assert.throws(() => selectNodeOutput(document, { ...revisions(document), nodeId: targetId, assetId }));
  const copy = copyDraft(document, { expectedProjectRevision: document.revision, sourceDraftId: document.activeDraftId, title: "copy" });
  assert.equal(copy.drafts.at(-1)!.nodes[0]!.execution.selectedOutputAssetId, assetId);
  document = resetNodeGeneration(document, { ...revisions(document), nodeId });
  assert.equal(document.drafts[0]!.nodes[0]!.execution.selectedOutputAssetId, undefined);
  assert.equal(document.drafts[0]!.jobs.length, 1);
});
