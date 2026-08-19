import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  RevisionConflictError,
  addNode,
  connectNodes,
  copyDraft,
  createProject,
  disconnectEdge,
  parseCanvasDocument,
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

function reverseOrderedDependencyChain() {
  let document = createProject({ title: "Reverse dependency order" });
  for (const [title, spec] of [
    ["Shot", { kind: "shot", prompt: "Day", mediaKind: "image", inputAssetIds: [] }],
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

test("disconnecting an edge is revision checked and keeps the document valid", () => {
  let document = createProject({ title: "Disconnect" });
  for (const title of ["One", "Two"]) {
    const draft = document.drafts[0];
    document = addNode(document, {
      draftId: draft.id,
      expectedProjectRevision: document.revision,
      expectedDraftRevision: draft.revision,
      title,
      spec: { kind: "shot", prompt: title, mediaKind: "image", inputAssetIds: [] },
    });
  }
  const draft = document.drafts[0];
  document = connectNodes(document, {
    draftId: draft.id,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: draft.revision,
    kind: "sequence",
    sourceNodeId: draft.nodes[0].id,
    targetNodeId: draft.nodes[1].id,
  });
  const connectedDraft = document.drafts[0];
  const disconnected = disconnectEdge(document, {
    draftId: connectedDraft.id,
    edgeId: connectedDraft.edges[0].id,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: connectedDraft.revision,
  });

  assert.equal(disconnected.drafts[0].edges.length, 0);
  assert.equal(disconnected.revision, document.revision + 1);
  assert.equal(disconnected.drafts[0].revision, connectedDraft.revision + 1);
});

test("prompt updates reject generated composition nodes instead of committing a no-op", async () => {
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
    /shot and editable context nodes/,
  );
});

test("canvas context nodes persist their editable prompt", () => {
  const empty = createProject({ title: "Context canvas" });
  const withContext = addNode(empty, {
    draftId: empty.activeDraftId,
    expectedProjectRevision: empty.revision,
    expectedDraftRevision: empty.drafts[0].revision,
    title: "Director",
    spec: {
      kind: "composition",
      mediaType: "application/json",
      role: "director",
      prompt: "Plan an uneasy reunion at dusk.",
    },
  });
  const draft = withContext.drafts[0];
  const updated = updateNode(withContext, {
    draftId: draft.id,
    nodeId: draft.nodes[0].id,
    expectedProjectRevision: withContext.revision,
    expectedDraftRevision: draft.revision,
    prompt: "An uneasy reunion in a rain-soaked station at dusk.",
  });

  const node = updated.drafts[0].nodes[0];
  assert.equal(node.spec.kind, "composition");
  assert.equal(node.spec.role, "director");
  assert.equal(node.spec.prompt, "An uneasy reunion in a rain-soaked station at dusk.");
  assert.equal(node.specRevision, 2);
  assert.equal(node.execution.status, "dirty");
});

test("shot updates recompute reverse-ordered dependency descendants topologically", () => {
  const { document, shotId, innerId, outerId } = reverseOrderedDependencyChain();
  const draft = document.drafts[0];
  const updated = updateNode(document, {
    draftId: draft.id,
    nodeId: shotId,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: draft.revision,
    prompt: "Night",
  });

  assert.deepEqual(updated.drafts[0].nodes.map((node) => node.id), [outerId, innerId, shotId]);
  assert.deepEqual(updated.drafts[0].nodes.map((node) => node.execution.status), ["dirty", "dirty", "dirty"]);
});
