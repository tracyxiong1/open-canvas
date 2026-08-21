import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  CanvasValidationError,
  addNode,
  createGroup,
  createProject,
  parseCanvasDocument,
} from "../src/index.js";

const examples = [
  "../../../docs/examples/canvas-v1-three-shot.json",
  "../../../docs/examples/canvas-v1-shot2-night.json",
];

async function loadExample(relativePath = examples[0]!) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

test("accepts both normative v1 project documents", async () => {
  for (const path of examples) {
    const input = await loadExample(path);
    assert.equal(parseCanvasDocument(input), input);
  }
});

test("rejects unknown fields and credential-shaped values", async () => {
  const unknown = await loadExample();
  unknown.apiKey = "not-a-real-key";
  assert.throws(() => parseCanvasDocument(unknown), CanvasValidationError);

  const credential = await loadExample();
  credential.project.title = "Authorization: Bearer should-never-be-persisted";
  assert.throws(
    () => parseCanvasDocument(credential),
    (error: unknown) =>
      error instanceof CanvasValidationError && error.message.includes("credential-like value"),
  );
});

test("requires prompt content for a canvas context node", async () => {
  const input = await loadExample();
  const composition = input.drafts[0].nodes.find((node: any) => node.spec.kind === "composition");
  composition.spec.role = "text";
  assert.throws(() => parseCanvasDocument(input), CanvasValidationError);
});

test("accepts all persisted canvas context roles", () => {
  const contexts = [
    ["text", "text/plain"],
    ["smart-edit", "video/mp4"],
    ["director", "application/json"],
    ["frame-analysis", "application/json"],
    ["audio", "audio/mpeg"],
    ["script", "text/plain"],
    ["asset-library", "application/json"],
    ["asset-reference", "application/json"],
    ["character", "application/json"],
    ["scene-style", "application/json"],
  ] as const;

  for (const [role, mediaType] of contexts) {
    const empty = createProject({ title: role });
    const document = addNode(empty, {
      draftId: empty.activeDraftId,
      expectedProjectRevision: empty.revision,
      expectedDraftRevision: empty.drafts[0].revision,
      title: role,
      spec: {
        kind: "composition",
        role,
        mediaType,
        prompt: `${role} prompt`,
      },
    });
    assert.equal(parseCanvasDocument(document), document);
  }
});

test("rejects layout groups with non-layout data or graph edges", () => {
  let document = createProject({ title: "Layout group" });
  for (const title of ["A", "B"]) {
    const draft = document.drafts[0]!;
    document = addNode(document, {
      draftId: draft.id,
      expectedProjectRevision: document.revision,
      expectedDraftRevision: draft.revision,
      title,
      spec: { kind: "shot", prompt: title, mediaKind: "image", inputAssetIds: [] },
    });
  }
  const draft = document.drafts[0]!;
  document = createGroup(document, {
    draftId: draft.id,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: draft.revision,
    memberNodeIds: draft.nodes.map((node) => node.id),
  });
  const group = document.drafts[0]!.nodes.at(-1)!;

  const withPrompt = structuredClone(document);
  const promptGroup = withPrompt.drafts[0]!.nodes.at(-1)!;
  if (promptGroup.spec.kind !== "composition") throw new Error("Expected a layout group composition");
  promptGroup.spec.prompt = "not a prompt node";
  assert.throws(() => parseCanvasDocument(withPrompt), CanvasValidationError);

  const withEdge = structuredClone(document);
  withEdge.drafts[0]!.edges.push({
    id: "edge_019c8f55-0000-7000-8000-000000000999",
    kind: "dependency",
    sourceNodeId: group.id,
    targetNodeId: document.drafts[0]!.nodes[0]!.id,
  });
  assert.throws(() => parseCanvasDocument(withEdge), /cannot connect a layout group/);
});

test("rejects persisted generation state for canvas context nodes", async () => {
  const input = await loadExample();
  const draft = input.drafts[0];
  const composition = draft.nodes.find((node: any) => node.spec.kind === "composition");
  composition.spec = {
    kind: "composition",
    role: "director",
    mediaType: "application/json",
    prompt: "Plan the scene.",
  };
  composition.execution.inputFingerprint = "sha256:" + "0".repeat(64);
  assert.throws(() => parseCanvasDocument(input), /context node .*cannot own a generation job/);
});

test("rejects semantic cross-draft references and invalid asset identity", async () => {
  const crossDraft = await loadExample(examples[1]);
  crossDraft.drafts[1].edges[0].targetNodeId = "node_019c8f55-9999-7000-8000-000000000999";
  assert.throws(() => parseCanvasDocument(crossDraft), /unknown node/);

  const asset = await loadExample();
  asset.assets[0].id = `asset_sha256_${"f".repeat(64)}`;
  assert.throws(() => parseCanvasDocument(asset), /asset identity/);
});

test("rejects impossible execution and job relationships", async () => {
  const input = await loadExample();
  input.drafts[0].nodes[0].execution.activeJobId = input.drafts[0].jobs[1].id;
  assert.throws(() => parseCanvasDocument(input), /active job/);
});

test("rejects unsupported versions, unsafe asset paths, and duplicate local ids", async () => {
  const version = await loadExample();
  version.schemaVersion = 2;
  assert.throws(() => parseCanvasDocument(version), CanvasValidationError);

  for (const path of ["/absolute", "../traversal", "https://example.invalid/signed?token=value"]) {
    const input = await loadExample();
    input.assets[0].path = path;
    assert.throws(() => parseCanvasDocument(input), CanvasValidationError);
  }

  const duplicate = await loadExample();
  duplicate.drafts[0].nodes[1].id = duplicate.drafts[0].nodes[0].id;
  assert.throws(() => parseCanvasDocument(duplicate), /duplicate node ID/);
});
