import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  RevisionConflictError,
  addNode,
  connectNodes,
  copyDraft,
  createGroup,
  createProject,
  deleteNode,
  disconnectEdge,
  moveGroup,
  moveNodes,
  isLayoutGroup,
  parseCanvasDocument,
  registerImportedAsset,
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

test("group layout moves are atomic and preserve generation state", async () => {
  const source = await example();
  const draft = source.drafts[0]!;
  const [first, second] = draft.nodes;
  const firstExecution = structuredClone(first!.execution);
  const secondExecution = structuredClone(second!.execution);
  const moved = moveNodes(source, {
    draftId: draft.id,
    expectedProjectRevision: source.revision,
    expectedDraftRevision: draft.revision,
    updates: [
      { nodeId: first!.id, position: { x: 420, y: 180 } },
      { nodeId: second!.id, position: { x: 780, y: 240 } },
    ],
    now: "2026-08-21T10:00:00.000Z",
  });

  const movedDraft = moved.drafts[0]!;
  assert.deepEqual(movedDraft.nodes.slice(0, 2).map((node) => node.position), [
    { x: 420, y: 180 },
    { x: 780, y: 240 },
  ]);
  assert.deepEqual(movedDraft.nodes[0]!.execution, firstExecution);
  assert.deepEqual(movedDraft.nodes[1]!.execution, secondExecution);
  assert.equal(movedDraft.nodes[0]!.specRevision, first!.specRevision);
  assert.equal(movedDraft.nodes[1]!.specRevision, second!.specRevision);
  assert.equal(moved.revision, source.revision + 1);
  assert.equal(movedDraft.revision, draft.revision + 1);
  assert.equal(parseCanvasDocument(moved), moved);
});

test("group layout moves reject an invalid batch without changing the source document", async () => {
  const source = await example();
  const draft = source.drafts[0]!;
  const original = structuredClone(source);

  assert.throws(
    () => moveNodes(source, {
      draftId: draft.id,
      expectedProjectRevision: source.revision,
      expectedDraftRevision: draft.revision,
      updates: [
        { nodeId: draft.nodes[0]!.id, position: { x: 420, y: 180 } },
        { nodeId: "node_missing", position: { x: 780, y: 240 } },
      ],
    }),
    /Unknown node: node_missing/,
  );
  assert.deepEqual(source, original);

  assert.throws(
    () => moveNodes(source, {
      draftId: draft.id,
      expectedProjectRevision: source.revision,
      expectedDraftRevision: draft.revision,
      updates: [
        { nodeId: draft.nodes[0]!.id, position: { x: 420, y: 180 } },
        { nodeId: draft.nodes[0]!.id, position: { x: 780, y: 240 } },
      ],
    }),
    /Duplicate node position update/,
  );
  assert.deepEqual(source, original);
});

test("project-local layout groups persist membership and move all members atomically", async () => {
  const source = await example();
  const draft = source.drafts[0]!;
  const members = draft.nodes.slice(0, 3);
  const grouped = createGroup(source, {
    draftId: draft.id,
    expectedProjectRevision: source.revision,
    expectedDraftRevision: draft.revision,
    memberNodeIds: members.map((node) => node.id),
    title: "第一幕",
    now: "2026-08-21T10:00:00.000Z",
  });
  const groupedDraft = grouped.drafts[0]!;
  const group = groupedDraft.nodes.at(-1)!;
  assert.deepEqual(group.spec, {
    kind: "composition",
    mediaType: "application/json",
    role: "group",
    memberNodeIds: members.map((node) => node.id),
  });
  assert.equal(group.title, "第一幕");
  assert.deepEqual(group.position, {
    x: Math.min(...members.map((node) => node.position.x)),
    y: Math.min(...members.map((node) => node.position.y)),
  });
  assert.equal(group.execution.status, "dirty");

  assert.throws(() => createGroup(grouped, {
    draftId: groupedDraft.id,
    expectedProjectRevision: grouped.revision,
    expectedDraftRevision: groupedDraft.revision,
    memberNodeIds: [members[0]!.id, members[1]!.id],
  }), /already belongs to group/);

  const individuallyMoved = moveNodes(grouped, {
    draftId: groupedDraft.id,
    expectedProjectRevision: grouped.revision,
    expectedDraftRevision: groupedDraft.revision,
    updates: [{ nodeId: members[0]!.id, position: { x: 9_999, y: 8_888 } }],
  });
  const individuallyMovedDraft = individuallyMoved.drafts[0]!;
  const individuallyMovedGroup = individuallyMovedDraft.nodes.find((node) => node.id === group.id)!;
  const individuallyMovedMembers = individuallyMovedDraft.nodes.filter((node) => members.some((member) => member.id === node.id));
  assert.deepEqual(individuallyMovedGroup.position, {
    x: Math.min(...individuallyMovedMembers.map((node) => node.position.x)),
    y: Math.min(...individuallyMovedMembers.map((node) => node.position.y)),
  });
  assert.deepEqual(individuallyMovedGroup.execution, group.execution);
  assert.equal(individuallyMovedGroup.specRevision, group.specRevision);

  const memberExecution = members.map((node) => structuredClone(
    groupedDraft.nodes.find((candidate) => candidate.id === node.id)!.execution,
  ));
  const moved = moveGroup(grouped, {
    draftId: groupedDraft.id,
    groupNodeId: group.id,
    expectedProjectRevision: grouped.revision,
    expectedDraftRevision: groupedDraft.revision,
    delta: { x: 120, y: -40 },
    now: "2026-08-21T10:01:00.000Z",
  });
  const movedDraft = moved.drafts[0]!;
  for (const [index, member] of members.entries()) {
    const movedMember = movedDraft.nodes.find((candidate) => candidate.id === member.id)!;
    assert.deepEqual(movedMember.position, {
      x: member.position.x + 120,
      y: member.position.y - 40,
    });
    assert.deepEqual(movedMember.execution, memberExecution[index]);
  }
  const movedGroup = movedDraft.nodes.find((candidate) => candidate.id === group.id)!;
  assert.deepEqual(movedGroup.position, { x: group.position.x + 120, y: group.position.y - 40 });
  assert.equal(moved.revision, grouped.revision + 1);
  assert.equal(movedDraft.revision, groupedDraft.revision + 1);
  assert.equal(parseCanvasDocument(moved), moved);
});

test("deleting group members updates or removes their layout frame without dangling references", async () => {
  const source = await example();
  const draft = source.drafts[0]!;
  const members = draft.nodes.slice(0, 3);
  const grouped = createGroup(source, {
    draftId: draft.id,
    expectedProjectRevision: source.revision,
    expectedDraftRevision: draft.revision,
    memberNodeIds: members.map((node) => node.id),
  });
  const groupId = grouped.drafts[0]!.nodes.at(-1)!.id;
  const afterFirstDelete = deleteNode(grouped, {
    draftId: grouped.activeDraftId,
    nodeId: members[0]!.id,
    expectedProjectRevision: grouped.revision,
    expectedDraftRevision: grouped.drafts[0]!.revision,
  });
  const updatedGroup = afterFirstDelete.drafts[0]!.nodes.find((node) => node.id === groupId)!;
  assert.ok(isLayoutGroup(updatedGroup));
  assert.deepEqual(updatedGroup.spec.memberNodeIds, members.slice(1).map((node) => node.id));
  assert.equal(updatedGroup.title, "分组 2 个节点");
  assert.equal(updatedGroup.specRevision, 2);
  assert.equal(parseCanvasDocument(afterFirstDelete), afterFirstDelete);

  const afterSecondDelete = deleteNode(afterFirstDelete, {
    draftId: afterFirstDelete.activeDraftId,
    nodeId: members[1]!.id,
    expectedProjectRevision: afterFirstDelete.revision,
    expectedDraftRevision: afterFirstDelete.drafts[0]!.revision,
  });
  assert.equal(afterSecondDelete.drafts[0]!.nodes.some((node) => node.id === groupId), false);
  assert.equal(parseCanvasDocument(afterSecondDelete), afterSecondDelete);

  const namedGrouped = createGroup(source, {
    draftId: source.activeDraftId,
    expectedProjectRevision: source.revision,
    expectedDraftRevision: source.drafts[0]!.revision,
    memberNodeIds: members.map((node) => node.id),
    title: "第一幕",
  });
  const namedAfterDelete = deleteNode(namedGrouped, {
    draftId: namedGrouped.activeDraftId,
    nodeId: members[0]!.id,
    expectedProjectRevision: namedGrouped.revision,
    expectedDraftRevision: namedGrouped.drafts[0]!.revision,
  });
  const namedGroup = namedAfterDelete.drafts[0]!.nodes.find((node) => isLayoutGroup(node))!;
  assert.equal(namedGroup.title, "第一幕");
});

test("registers imported local assets by content hash without duplicating them", () => {
  const source = createProject({ title: "Local asset" });
  const checksumSha256 = `sha256:${"a".repeat(64)}`;
  const imported = registerImportedAsset(source, {
    expectedProjectRevision: source.revision,
    kind: "image",
    mediaType: "image/png",
    byteLength: 42,
    checksumSha256,
    now: "2026-08-20T09:00:00.000Z",
  });

  assert.equal(imported.created, true);
  assert.equal(imported.document.revision, source.revision + 1);
  assert.deepEqual(imported.asset, {
    id: `asset_sha256_${"a".repeat(64)}`,
    kind: "image",
    mediaType: "image/png",
    byteLength: 42,
    checksumSha256,
    path: `assets/sha256/${"a".repeat(64)}`,
    origin: { kind: "import" },
    createdAt: "2026-08-20T09:00:00.000Z",
  });
  assert.equal(parseCanvasDocument(imported.document), imported.document);

  const repeated = registerImportedAsset(imported.document, {
    expectedProjectRevision: imported.document.revision,
    kind: "image",
    mediaType: "image/png",
    byteLength: 42,
    checksumSha256,
  });
  assert.equal(repeated.created, false);
  assert.equal(repeated.document, imported.document);
  assert.equal(repeated.document.assets.length, 1);
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

test("deleting a node prunes incident graph records and dirties surviving targets", async () => {
  const source = await example();
  const draft = source.drafts[0];
  const removed = draft.nodes.find((node: any) => node.title === "Shot 1 — Arrival")!;
  const shot2 = draft.nodes.find((node: any) => node.title === "Shot 2 — Crossing")!;
  const composition = draft.nodes.find((node: any) => node.title === "Final composition")!;
  const deleted = deleteNode(source, {
    draftId: draft.id,
    nodeId: removed.id,
    expectedProjectRevision: source.revision,
    expectedDraftRevision: draft.revision,
  });
  const nextDraft = deleted.drafts[0];
  const nextShot2 = nextDraft.nodes.find((node) => node.id === shot2.id)!;
  const nextComposition = nextDraft.nodes.find((node) => node.id === composition.id)!;

  assert.equal(nextDraft.nodes.some((node) => node.id === removed.id), false);
  assert.equal(nextDraft.edges.some((edge) => edge.sourceNodeId === removed.id || edge.targetNodeId === removed.id), false);
  assert.equal(nextDraft.jobs.some((job) => job.nodeId === removed.id), false);
  assert.equal(nextShot2.execution.status, "dirty");
  assert.deepEqual(nextShot2.execution.outputAssetIds, []);
  assert.equal(nextComposition.execution.status, "dirty");
  assert.deepEqual(nextComposition.execution.outputAssetIds, []);
  assert.equal(deleted.assets.length, source.assets.length - 1);
  assert.equal(deleted.assets.some((asset) => asset.id === removed.execution.outputAssetIds[0]), false);
  assert.equal(parseCanvasDocument(deleted), deleted);
  assert.equal(deleted.revision, source.revision + 1);
  assert.equal(nextDraft.revision, draft.revision + 1);
});

test("deleting a source node retains an asset still used by a sibling draft with explicit provenance", async () => {
  const source = await example();
  const copied = copyDraft(source, {
    sourceDraftId: source.activeDraftId,
    title: "Keep the first result",
    expectedProjectRevision: source.revision,
  });
  const sourceDraft = copied.drafts.find((draft) => draft.id === source.activeDraftId)!;
  const sourceNode = sourceDraft.nodes.find((node) => node.title === "Shot 1 — Arrival")!;
  const sourceJob = sourceDraft.jobs.find((job) => job.nodeId === sourceNode.id)!;
  const sourceAssetId = sourceNode.execution.outputAssetIds[0]!;
  const deleted = deleteNode(copied, {
    draftId: sourceDraft.id,
    nodeId: sourceNode.id,
    expectedProjectRevision: copied.revision,
    expectedDraftRevision: sourceDraft.revision,
  });
  const retained = deleted.assets.find((asset) => asset.id === sourceAssetId)!;

  assert.deepEqual(retained.origin, {
    kind: "deleted-job",
    draftId: sourceDraft.id,
    jobId: sourceJob.id,
  });
  assert.equal(parseCanvasDocument(deleted), deleted);
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
