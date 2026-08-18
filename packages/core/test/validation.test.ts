import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { CanvasValidationError, parseCanvasDocument } from "../src/index.js";

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
