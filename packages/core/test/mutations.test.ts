import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  RevisionConflictError,
  addNode,
  connectNodes,
  copyDraft,
  createProject,
  updateNode,
} from "../src/index.js";

async function example() {
  return JSON.parse(
    await readFile(
      new URL("../../../docs/examples/canvas-v1-three-shot.json", import.meta.url),
      "utf8",
    ),
  );
}

test("presentation edits preserve fingerprints and execution state", async () => {
  const source = await example();
  const draft = source.drafts[0];
  const before = structuredClone(draft.nodes[0].execution);
  const updated = updateNode(source, {
    draftId: draft.id,
    nodeId: draft.nodes[0].id,
    expectedProjectRevision: source.revision,
    expectedDraftRevision: draft.revision,
    title: "Arrival close-up",
  });

  assert.deepEqual(updated.drafts[0].nodes[0].execution, before);
  assert.equal(updated.drafts[0].nodes[0].specRevision, draft.nodes[0].specRevision);
  assert.equal(updated.revision, source.revision + 1);
});

test("copy plus shot edit dirties only dependency descendants", async () => {
  const source = await example();
  const copied = copyDraft(source, {
    sourceDraftId: source.activeDraftId,
    title: "Night variation",
    expectedProjectRevision: source.revision,
    draftId: "draft_019c8f55-9000-7000-8000-000000000900",
    now: "2026-08-12T09:00:00Z",
  });
  const variation = copied.drafts[1];
  const shot2 = variation.nodes.find((node: any) => node.title.includes("Shot 2"));
  const updated = updateNode(copied, {
    draftId: variation.id,
    nodeId: shot2.id,
    expectedProjectRevision: copied.revision,
    expectedDraftRevision: variation.revision,
    prompt: "The courier crosses the city at night.",
    now: "2026-08-12T09:01:00Z",
  });

  assert.deepEqual(updated.drafts[0], source.drafts[0]);
  assert.deepEqual(
    updated.drafts[1].nodes.map((node: any) => node.execution.status),
    ["succeeded", "dirty", "succeeded", "dirty"],
  );
  assert.equal(updated.drafts[1].nodes[1].specRevision, 2);
});

test("stale revisions fail without mutating the input document", async () => {
  const source = await example();
  const snapshot = structuredClone(source);
  assert.throws(
    () =>
      updateNode(source, {
        draftId: source.activeDraftId,
        nodeId: source.drafts[0].nodes[0].id,
        expectedProjectRevision: source.revision - 1,
        expectedDraftRevision: source.drafts[0].revision,
        title: "stale",
      }),
    RevisionConflictError,
  );
  assert.deepEqual(source, snapshot);
});

test("sequence edges reject cycles even before a composition exists", () => {
  const empty = createProject({ title: "Sequence" });
  const first = addNode(empty, {
    draftId: empty.activeDraftId,
    expectedProjectRevision: empty.revision,
    expectedDraftRevision: empty.drafts[0].revision,
    title: "One",
    spec: { kind: "shot", prompt: "One", mediaKind: "image", inputAssetIds: [] },
  });
  const second = addNode(first, {
    draftId: first.activeDraftId,
    expectedProjectRevision: first.revision,
    expectedDraftRevision: first.drafts[0].revision,
    title: "Two",
    spec: { kind: "shot", prompt: "Two", mediaKind: "image", inputAssetIds: [] },
  });
  const oneId = second.drafts[0].nodes[0].id;
  const twoId = second.drafts[0].nodes[1].id;
  const connected = connectNodes(second, {
    draftId: second.activeDraftId,
    expectedProjectRevision: second.revision,
    expectedDraftRevision: second.drafts[0].revision,
    kind: "sequence",
    sourceNodeId: oneId,
    targetNodeId: twoId,
  });
  assert.throws(
    () =>
      connectNodes(connected, {
        draftId: connected.activeDraftId,
        expectedProjectRevision: connected.revision,
        expectedDraftRevision: connected.drafts[0].revision,
        kind: "sequence",
        sourceNodeId: twoId,
        targetNodeId: oneId,
      }),
    /sequence cycle/,
  );
});

test("prompt updates reject composition nodes instead of committing a no-op", async () => {
  const source = await example();
  const draft = source.drafts[0];
  const composition = draft.nodes.find((node: any) => node.spec.kind === "composition");
  assert.throws(
    () =>
      updateNode(source, {
        draftId: draft.id,
        nodeId: composition.id,
        expectedProjectRevision: source.revision,
        expectedDraftRevision: draft.revision,
        prompt: "not applicable",
      }),
    /shot nodes/,
  );
});
