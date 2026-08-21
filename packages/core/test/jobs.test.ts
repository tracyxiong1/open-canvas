import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MockProviderAdapter,
  addNode,
  applyProviderSnapshot,
  canonicalJson,
  canonicalSha256,
  completeGeneration,
  copyDraft,
  createProject,
  connectNodes,
  parseCanvasDocument,
  registerImportedAsset,
  resumeGeneration,
  startGeneration,
  updateNode,
} from "../src/index.js";

const request = {
  jobId: "job_019c8f55-9200-7000-8000-000000000920",
  kind: "image" as const,
  prompt: "A quiet orbital city",
  inputs: [],
  requirements: { aspectRatio: "1:1" as const },
};

function reverseOrderedGenerationChain() {
  let document = createProject({ title: "Reverse generation order" });
  for (const [title, spec] of [
    ["Shot", { kind: "shot", prompt: "Generate", mediaKind: "image", inputAssetIds: [] }],
    ["Inner", { kind: "composition", mediaType: "video/mp4" }],
    ["Outer", { kind: "composition", mediaType: "video/mp4" }],
  ] as const) {
    const draft = document.drafts[0];
    document = addNode(document, {
      draftId: draft.id,
      expectedProjectRevision: document.revision,
      expectedDraftRevision: draft.revision,
      title,
      spec,
    });
  }
  const [shot, inner, outer] = document.drafts[0].nodes;
  for (const [sourceNodeId, targetNodeId] of [
    [shot!.id, inner!.id],
    [inner!.id, outer!.id],
  ]) {
    const draft = document.drafts[0];
    document = connectNodes(document, {
      draftId: draft.id,
      expectedProjectRevision: document.revision,
      expectedDraftRevision: draft.revision,
      kind: "dependency",
      sourceNodeId,
      targetNodeId,
    });
  }
  const currentNodes = new Map(document.drafts[0].nodes.map((node) => [node.id, node]));
  document.drafts[0].nodes = [currentNodes.get(outer!.id)!, currentNodes.get(inner!.id)!, currentNodes.get(shot!.id)!];
  parseCanvasDocument(document);
  return { document, shotId: shot!.id, innerId: inner!.id, outerId: outer!.id };
}

test("canonical JSON key order is locale independent", () => {
  assert.equal(canonicalJson({ "ä": 1, z: 2, A: 3 }), '{"A":3,"z":2,"ä":1}');
});

test("mock jobs have deterministic ids, transitions, and artifact bytes", async () => {
  const first = new MockProviderAdapter();
  const second = new MockProviderAdapter();
  const submittedA = await first.submit(request, "mock-image-v1");
  const submittedB = await second.submit(request, "mock-image-v1");
  assert.deepEqual(submittedA, submittedB);
  assert.equal(submittedA.providerJobId, `mock:${canonicalSha256(request).slice(7)}`);
  assert.equal((await first.poll(submittedA.providerJobId)).status, "running");
  const success = await first.poll(submittedA.providerJobId);
  assert.equal(success.status, "succeeded");
  const bytes = Buffer.concat(
    await Array.fromAsync(first.openArtifact(submittedA.providerJobId, success.outputs![0].artifactId)),
  );
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
});

test("mock failure is stable and contains no prompt or credential value", async () => {
  const adapter = new MockProviderAdapter();
  const failedRequest = { ...request, prompt: "[mock:fail] secret material" };
  const submitted = await adapter.submit(failedRequest, "mock-image-v1");
  const failed = await adapter.poll(submitted.providerJobId);
  assert.deepEqual(failed.error, {
    code: "provider_rejected",
    retryable: false,
    message: "deterministic mock failure",
  });
});

test("an image job keeps every provider candidate as a project-local output", () => {
  const empty = createProject({ title: "Multiple image candidates" });
  const withShot = addNode(empty, {
    draftId: empty.activeDraftId,
    expectedProjectRevision: empty.revision,
    expectedDraftRevision: empty.drafts[0].revision,
    title: "候选镜头",
    spec: {
      kind: "shot",
      prompt: "A quiet orbital city",
      mediaKind: "image",
      inputAssetIds: [],
      requirements: { mediaType: "image/png", count: 2 },
    },
  });
  const nodeId = withShot.drafts[0].nodes[0].id;
  assert.throws(
    () => startGeneration(withShot, {
      draftId: withShot.activeDraftId,
      nodeId,
      expectedProjectRevision: withShot.revision,
      expectedDraftRevision: withShot.drafts[0].revision,
    }),
    /Mock provider cannot satisfy output requirements/,
  );
  const started = startGeneration(withShot, {
    draftId: withShot.activeDraftId,
    nodeId,
    expectedProjectRevision: withShot.revision,
    expectedDraftRevision: withShot.drafts[0].revision,
    resolveRoute: () => ({ providerId: "openai", modelId: "gpt-image-2", selectionSource: "registry_default" }),
  });

  assert.throws(
    () => completeGeneration(started.document, {
      draftId: started.document.activeDraftId,
      jobId: started.request.jobId,
      providerJobId: "openai-image:test",
      artifacts: [{ kind: "image", mediaType: "image/png", bytes: Buffer.from("candidate-one") }],
    }),
    /output count/,
  );

  const completed = completeGeneration(started.document, {
    draftId: started.document.activeDraftId,
    jobId: started.request.jobId,
    providerJobId: "openai-image:test",
    artifacts: [
      { kind: "image", mediaType: "image/png", bytes: Buffer.from("candidate-one") },
      { kind: "image", mediaType: "image/png", bytes: Buffer.from("candidate-two") },
    ],
  });
  const draft = completed.drafts[0];
  const node = draft.nodes.find((candidate) => candidate.id === nodeId)!;
  assert.equal(node.execution.status, "succeeded");
  assert.equal(node.execution.outputAssetIds.length, 2);
  assert.notEqual(node.execution.outputAssetIds[0], node.execution.outputAssetIds[1]);
  assert.deepEqual(draft.jobs[0]?.outputAssetIds, node.execution.outputAssetIds);
  assert.equal(completed.assets.length, 2);
});

test("mock video artifact is a self-contained MP4 with media metadata", async () => {
  const adapter = new MockProviderAdapter();
  const videoRequest = { ...request, kind: "video" as const };
  const submitted = await adapter.submit(videoRequest, "mock-video-v1");
  await adapter.poll(submitted.providerJobId);
  const success = await adapter.poll(submitted.providerJobId);
  const bytes = Buffer.concat(
    await Array.fromAsync(adapter.openArtifact(submitted.providerJobId, success.outputs![0].artifactId)),
  );
  const atoms = bytes.toString("latin1");
  assert.equal(atoms.includes("ftyp"), true);
  assert.equal(atoms.includes("moov"), true);
  assert.equal(atoms.includes("mdat"), true);
});

test("project creation never reads environment credentials", () => {
  process.env.OPEN_CANVAS_TEST_SECRET = "do-not-persist";
  const project = createProject({ title: "Safe" });
  assert.equal(JSON.stringify(project).includes(process.env.OPEN_CANVAS_TEST_SECRET), false);
});

test("a stale completion updates history without attaching to an invalidated or copied node", () => {
  const empty = createProject({ title: "Isolation" });
  const withShot = addNode(empty, {
    draftId: empty.activeDraftId,
    expectedProjectRevision: empty.revision,
    expectedDraftRevision: empty.drafts[0].revision,
    title: "Shot",
    spec: { kind: "shot", prompt: "Day", mediaKind: "image", inputAssetIds: [] },
  });
  const nodeId = withShot.drafts[0].nodes[0].id;
  const started = startGeneration(withShot, {
    draftId: withShot.activeDraftId,
    nodeId,
    expectedProjectRevision: withShot.revision,
    expectedDraftRevision: withShot.drafts[0].revision,
  });
  const jobId = started.document.drafts[0].jobs[0].id;
  const copied = copyDraft(started.document, {
    sourceDraftId: started.document.activeDraftId,
    title: "Copy",
    expectedProjectRevision: started.document.revision,
  });
  const edited = updateNode(copied, {
    draftId: copied.drafts[0].id,
    nodeId,
    expectedProjectRevision: copied.revision,
    expectedDraftRevision: copied.drafts[0].revision,
    prompt: "Night",
  });
  const running = applyProviderSnapshot(edited, {
    draftId: edited.drafts[0].id,
    jobId,
    snapshot: { providerJobId: "mock:stale", status: "running", progress: 0.5 },
  });
  const completed = completeGeneration(running, {
    draftId: running.drafts[0].id,
    jobId,
    providerJobId: "mock:stale",
    artifact: { kind: "image", mediaType: "image/png", bytes: Buffer.from("stale") },
  });

  assert.equal(completed.drafts[0].jobs[0].status, "succeeded");
  assert.equal(completed.drafts[0].nodes[0].execution.status, "dirty");
  assert.equal(completed.drafts[1].nodes[0].execution.status, "dirty");
  assert.deepEqual(completed.drafts[0].nodes[0].execution.outputAssetIds, []);
  assert.deepEqual(completed.drafts[1].nodes[0].execution.outputAssetIds, []);
});

test("active mock generation can be reconstructed after a process restart", () => {
  const empty = createProject({ title: "Resume" });
  const withShot = addNode(empty, {
    draftId: empty.activeDraftId,
    expectedProjectRevision: empty.revision,
    expectedDraftRevision: empty.drafts[0].revision,
    title: "Shot",
    spec: { kind: "shot", prompt: "Resume me", mediaKind: "image", inputAssetIds: [] },
  });
  const nodeId = withShot.drafts[0].nodes[0].id;
  const started = startGeneration(withShot, {
    draftId: withShot.activeDraftId,
    nodeId,
    expectedProjectRevision: withShot.revision,
    expectedDraftRevision: withShot.drafts[0].revision,
  });
  const resumed = resumeGeneration(started.document, { draftId: withShot.activeDraftId, nodeId });
  assert.equal(resumed.request.jobId, started.request.jobId);
  assert.deepEqual(resumed.route, started.route);
});

test("generation starts only from dirty or failed nodes", async () => {
  const completed = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("../../../docs/examples/canvas-v1-three-shot.json", import.meta.url),
      "utf8",
    ),
  );
  const draft = completed.drafts[0];
  assert.throws(
    () =>
      startGeneration(completed, {
        draftId: draft.id,
        nodeId: draft.nodes[0].id,
        expectedProjectRevision: completed.revision,
        expectedDraftRevision: draft.revision,
      }),
    /dirty or failed/,
  );
});

test("composition generation waits for every dependency output", () => {
  const empty = createProject({ title: "Composition readiness" });
  const shot = addNode(empty, {
    draftId: empty.activeDraftId,
    expectedProjectRevision: empty.revision,
    expectedDraftRevision: empty.drafts[0].revision,
    title: "Shot",
    spec: { kind: "shot", prompt: "Pending", mediaKind: "video", inputAssetIds: [] },
  });
  const composition = addNode(shot, {
    draftId: shot.activeDraftId,
    expectedProjectRevision: shot.revision,
    expectedDraftRevision: shot.drafts[0].revision,
    title: "Final",
    spec: { kind: "composition", mediaType: "video/mp4" },
  });
  const connected = connectNodes(composition, {
    draftId: composition.activeDraftId,
    expectedProjectRevision: composition.revision,
    expectedDraftRevision: composition.drafts[0].revision,
    kind: "dependency",
    sourceNodeId: composition.drafts[0].nodes[0].id,
    targetNodeId: composition.drafts[0].nodes[1].id,
  });
  assert.throws(
    () =>
      startGeneration(connected, {
        draftId: connected.activeDraftId,
        nodeId: connected.drafts[0].nodes[1].id,
        expectedProjectRevision: connected.revision,
        expectedDraftRevision: connected.drafts[0].revision,
      }),
    /dependencies are not ready/,
  );
});

test("context nodes remain editable prompt context and never create a generation job", () => {
  const empty = createProject({ title: "Audio context" });
  const withContext = addNode(empty, {
    draftId: empty.activeDraftId,
    expectedProjectRevision: empty.revision,
    expectedDraftRevision: empty.drafts[0].revision,
    title: "Sound design",
    spec: {
      kind: "composition",
      mediaType: "audio/mpeg",
      role: "audio",
      prompt: "A quiet prologue with a distant train.",
    },
  });
  const draft = withContext.drafts[0];
  assert.throws(
    () => startGeneration(withContext, {
      draftId: draft.id,
      nodeId: draft.nodes[0].id,
      expectedProjectRevision: withContext.revision,
      expectedDraftRevision: draft.revision,
    }),
    /Context nodes are prompts/,
  );
});

test("a role or local-reference node can condition a shot and contribute imported inputs", () => {
  const empty = createProject({ title: "Context conditioned shot" });
  const imported = registerImportedAsset(empty, {
    expectedProjectRevision: empty.revision,
    kind: "image",
    mediaType: "image/png",
    byteLength: 18,
    checksumSha256: `sha256:${"b".repeat(64)}`,
  });
  const context = addNode(imported.document, {
    draftId: imported.document.activeDraftId,
    expectedProjectRevision: imported.document.revision,
    expectedDraftRevision: imported.document.drafts[0].revision,
    title: "主角设定",
    spec: {
      kind: "composition",
      mediaType: "application/json",
      role: "character",
      prompt: "短发摄影师，深蓝外套，保持跨镜头一致性。",
      referenceAssetIds: [imported.asset.id],
    },
  });
  const shot = addNode(context, {
    draftId: context.activeDraftId,
    expectedProjectRevision: context.revision,
    expectedDraftRevision: context.drafts[0].revision,
    title: "城市夜景",
    spec: { kind: "shot", prompt: "雨夜街头的跟拍镜头。", mediaKind: "image", inputAssetIds: [] },
  });
  const contextNodeId = shot.drafts[0].nodes[0]!.id;
  const shotNodeId = shot.drafts[0].nodes[1]!.id;
  const connected = connectNodes(shot, {
    draftId: shot.activeDraftId,
    expectedProjectRevision: shot.revision,
    expectedDraftRevision: shot.drafts[0].revision,
    kind: "dependency",
    sourceNodeId: contextNodeId,
    targetNodeId: shotNodeId,
  });

  const started = startGeneration(connected, {
    draftId: connected.activeDraftId,
    nodeId: shotNodeId,
    expectedProjectRevision: connected.revision,
    expectedDraftRevision: connected.drafts[0].revision,
  });
  assert.match(started.request.prompt, /主角设定/);
  assert.match(started.request.prompt, /短发摄影师/);
  assert.deepEqual(started.request.inputs.map((input) => input.assetId), [imported.asset.id]);
  assert.equal(started.document.drafts[0]!.nodes[0]!.execution.status, "dirty");
  assert.equal(started.document.drafts[0]!.nodes[1]!.execution.status, "queued");
});

test("a project-local script can condition a video shot and contribute its local reference", () => {
  const empty = createProject({ title: "Script conditioned video" });
  const imported = registerImportedAsset(empty, {
    expectedProjectRevision: empty.revision,
    kind: "image",
    mediaType: "image/png",
    byteLength: 20,
    checksumSha256: `sha256:${"c".repeat(64)}`,
  });
  const script = addNode(imported.document, {
    draftId: imported.document.activeDraftId,
    expectedProjectRevision: imported.document.revision,
    expectedDraftRevision: imported.document.drafts[0].revision,
    title: "三镜头脚本",
    spec: {
      kind: "composition",
      mediaType: "text/plain",
      role: "script",
      prompt: "第一镜：雨夜抵达。第二镜：穿过车站。第三镜：列车驶离。",
      referenceAssetIds: [imported.asset.id],
    },
  });
  const shot = addNode(script, {
    draftId: script.activeDraftId,
    expectedProjectRevision: script.revision,
    expectedDraftRevision: script.drafts[0].revision,
    title: "镜头 1",
    spec: { kind: "shot", prompt: "镜头化脚本的第一段。", mediaKind: "video", inputAssetIds: [] },
  });
  const scriptNodeId = shot.drafts[0]!.nodes[0]!.id;
  const shotNodeId = shot.drafts[0]!.nodes[1]!.id;
  const connected = connectNodes(shot, {
    draftId: shot.activeDraftId,
    expectedProjectRevision: shot.revision,
    expectedDraftRevision: shot.drafts[0].revision,
    kind: "dependency",
    sourceNodeId: scriptNodeId,
    targetNodeId: shotNodeId,
  });

  const started = startGeneration(connected, {
    draftId: connected.activeDraftId,
    nodeId: shotNodeId,
    expectedProjectRevision: connected.revision,
    expectedDraftRevision: connected.drafts[0].revision,
    resolveRoute: () => ({ providerId: "test", modelId: "test-video", selectionSource: "registry_default" }),
  });
  assert.equal(started.request.kind, "video");
  assert.match(started.request.prompt, /三镜头脚本/);
  assert.match(started.request.prompt, /第一镜：雨夜抵达/);
  assert.deepEqual(started.request.inputs.map((input) => input.assetId), [imported.asset.id]);
});

test("mock routing accepts partial compatible hints and rejects impossible requirements", () => {
  const createShot = (routing: any, requirements: any = {}) => {
    const empty = createProject({ title: "Routing" });
    return addNode(empty, {
      draftId: empty.activeDraftId,
      expectedProjectRevision: empty.revision,
      expectedDraftRevision: empty.drafts[0].revision,
      title: "Shot",
      spec: {
        kind: "shot",
        prompt: "Route",
        mediaKind: "image",
        inputAssetIds: [],
        ...(Object.keys(requirements).length === 0 ? {} : { requirements }),
        ...(Object.keys(routing).length === 0 ? {} : { routing }),
      },
    });
  };
  const override = createShot({ promptOverride: { modelId: "mock-image-v1" } });
  const overrideStart = startGeneration(override, {
    draftId: override.activeDraftId,
    nodeId: override.drafts[0].nodes[0].id,
    expectedProjectRevision: override.revision,
    expectedDraftRevision: override.drafts[0].revision,
  });
  assert.equal(overrideStart.route.selectionSource, "prompt_override");

  const choice = createShot({ aiChoice: { providerId: "mock" } });
  const choiceStart = startGeneration(choice, {
    draftId: choice.activeDraftId,
    nodeId: choice.drafts[0].nodes[0].id,
    expectedProjectRevision: choice.revision,
    expectedDraftRevision: choice.drafts[0].revision,
  });
  assert.equal(choiceStart.route.selectionSource, "ai_choice");

  for (const requirements of [
    { mediaType: "video/mp4" },
    { audio: "required" },
    { aspectRatio: "16:9" },
    { width: 2 },
    { height: 2 },
    { durationSeconds: 5 },
  ]) {
    const impossible = createShot({}, requirements);
    assert.throws(
      () => startGeneration(impossible, {
        draftId: impossible.activeDraftId,
        nodeId: impossible.drafts[0].nodes[0].id,
        expectedProjectRevision: impossible.revision,
        expectedDraftRevision: impossible.drafts[0].revision,
      }),
      /requirements/,
    );
  }
});

test("a caller-provided production route persists before submission without mock limits", () => {
  const empty = createProject({ title: "Production route" });
  const withShot = addNode(empty, {
    draftId: empty.activeDraftId,
    expectedProjectRevision: empty.revision,
    expectedDraftRevision: empty.drafts[0].revision,
    title: "Poster",
    spec: {
      kind: "shot",
      prompt: "A vertical orbital-city poster",
      mediaKind: "image",
      inputAssetIds: [],
      requirements: {
        aspectRatio: "9:16",
        width: 1008,
        height: 1792,
        mediaType: "image/png",
      },
    },
  });
  const started = startGeneration(withShot, {
    draftId: withShot.activeDraftId,
    nodeId: withShot.drafts[0].nodes[0]!.id,
    expectedProjectRevision: withShot.revision,
    expectedDraftRevision: withShot.drafts[0].revision,
    resolveRoute: () => ({
      providerId: "openai",
      modelId: "gpt-image-2",
      selectionSource: "registry_default",
    }),
  });
  assert.deepEqual(started.route, {
    providerId: "openai",
    modelId: "gpt-image-2",
    selectionSource: "registry_default",
  });
  assert.deepEqual(started.document.drafts[0]!.jobs[0]!.route, started.route);
});

test("composition provider inputs follow sequence order rather than edge insertion order", async () => {
  const completed = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("../../../docs/examples/canvas-v1-three-shot.json", import.meta.url),
      "utf8",
    ),
  );
  const draft = completed.drafts[0];
  const composition = draft.nodes.find((node: any) => node.spec.kind === "composition");
  const sourceIds = draft.edges
    .filter((edge: any) => edge.kind === "dependency" && edge.targetNodeId === composition.id)
    .map((edge: any) => edge.sourceNodeId);
  draft.edges = [
    ...draft.edges.filter((edge: any) => edge.kind !== "dependency"),
    ...draft.edges.filter((edge: any) => edge.kind === "dependency").reverse(),
  ];
  composition.execution = { ...composition.execution, status: "dirty", outputAssetIds: [] };
  delete composition.execution.activeJobId;
  const started = startGeneration(completed, {
    draftId: draft.id,
    nodeId: composition.id,
    expectedProjectRevision: completed.revision,
    expectedDraftRevision: draft.revision,
  });
  const expectedAssetIds = sourceIds.flatMap((nodeId: string) =>
    draft.nodes.find((node: any) => node.id === nodeId).execution.outputAssetIds,
  );
  assert.deepEqual(started.request.inputs.map((input) => input.assetId), expectedAssetIds);
});

test("shot completion recomputes reverse-ordered dependency descendants topologically", () => {
  const { document, shotId, innerId, outerId } = reverseOrderedGenerationChain();
  const draft = document.drafts[0];
  const started = startGeneration(document, {
    draftId: draft.id,
    nodeId: shotId,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: draft.revision,
  });
  const completed = completeGeneration(started.document, {
    draftId: draft.id,
    jobId: started.request.jobId,
    providerJobId: "mock:reverse-order",
    artifact: { kind: "image", mediaType: "image/png", bytes: Buffer.from("topological") },
  });

  assert.deepEqual(completed.drafts[0].nodes.map((node) => node.id), [outerId, innerId, shotId]);
  assert.deepEqual(completed.drafts[0].nodes.map((node) => node.execution.status), ["dirty", "dirty", "succeeded"]);
});
