import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_SCRIPT_SHOTS,
  addNode,
  buildScriptShotConnections,
  createProject,
  expandScriptIntoShots,
  parseCanvasDocument,
  splitScriptIntoShotPrompts,
} from "../src/index.js";

test("script planning keeps explicit lines editable and caps accidental bulk creation", () => {
  assert.deepEqual(
    splitScriptIntoShotPrompts("1. 雨夜的高架桥上，信使抵达。\n2. 她穿过空旷的车站。\n3. 远处的列车亮起。"),
    ["雨夜的高架桥上，信使抵达。", "她穿过空旷的车站。", "远处的列车亮起。"],
  );
  assert.deepEqual(
    splitScriptIntoShotPrompts("第一幕开始。角色进入站台！列车驶离？"),
    ["第一幕开始。", "角色进入站台！", "列车驶离？"],
  );
  assert.equal(
    splitScriptIntoShotPrompts(
      Array.from({ length: MAX_SCRIPT_SHOTS + 2 }, (_, index) => `镜头 ${index + 1}：画面 ${index + 1}`).join("\n"),
    ).length,
    MAX_SCRIPT_SHOTS,
  );
  assert.throws(() => splitScriptIntoShotPrompts("一个镜头", 0), /Script shot limit/);
});

test("Core expands one script into local video shots with dependency and sequence relations", () => {
  const initial = createProject({ title: "Script expansion", now: "2026-08-21T09:00:00.000Z" });
  const scriptDocument = addNode(initial, {
    draftId: initial.activeDraftId,
    expectedProjectRevision: initial.revision,
    expectedDraftRevision: initial.drafts[0]!.revision,
    nodeId: "node_019c8f55-9000-7000-8000-000000000901",
    title: "三镜头短片",
    position: { x: 120, y: 240 },
    spec: {
      kind: "composition",
      mediaType: "text/plain",
      role: "script",
      prompt: "待替换",
    },
    now: "2026-08-21T09:00:00.000Z",
  });
  const draft = scriptDocument.drafts[0]!;
  const callbackNodeCounts: number[] = [];
  const expanded = expandScriptIntoShots(scriptDocument, {
    draftId: draft.id,
    scriptNodeId: draft.nodes[0]!.id,
    prompt: "1. 雨夜的高架桥上，信使抵达。\n2. 她穿过空旷的车站。\n3. 远处的列车亮起。",
    expectedProjectRevision: scriptDocument.revision,
    expectedDraftRevision: draft.revision,
    positionForShot: ({ draft: currentDraft, index }) => {
      callbackNodeCounts.push(currentDraft.nodes.length);
      return { x: 420, y: 84 + index * 156 };
    },
    now: "2026-08-21T09:01:00.000Z",
  });

  assert.deepEqual(callbackNodeCounts, [1, 2, 3]);
  assert.equal(expanded.document.revision, scriptDocument.revision + 1);
  assert.equal(expanded.document.drafts[0]!.revision, draft.revision + 1);
  assert.equal(expanded.document.drafts[0]!.nodes[0]!.spec.kind, "composition");
  assert.equal(expanded.document.drafts[0]!.nodes[0]!.spec.prompt, "1. 雨夜的高架桥上，信使抵达。\n2. 她穿过空旷的车站。\n3. 远处的列车亮起。");
  const shots = expanded.shotNodeIds.map((nodeId) => expanded.document.drafts[0]!.nodes.find((node) => node.id === nodeId)!);
  assert.deepEqual(shots.map((node) => node.title), ["镜头 1", "镜头 2", "镜头 3"]);
  assert.ok(shots.every((node) => node.spec.kind === "shot" && node.spec.mediaKind === "video"));
  assert.deepEqual(shots.map((node) => node.position), [{ x: 420, y: 84 }, { x: 420, y: 240 }, { x: 420, y: 396 }]);
  assert.deepEqual(
    expanded.document.drafts[0]!.edges.map((edge) => ({
      kind: edge.kind,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
    })),
    buildScriptShotConnections(draft.nodes[0]!.id, expanded.shotNodeIds),
  );
  assert.equal(parseCanvasDocument(expanded.document), expanded.document);
});

test("script expansion preserves revision checks and rejects non-script context", () => {
  const initial = createProject({ title: "Invalid script" });
  const textDocument = addNode(initial, {
    draftId: initial.activeDraftId,
    expectedProjectRevision: initial.revision,
    expectedDraftRevision: initial.drafts[0]!.revision,
    title: "普通文本",
    spec: { kind: "composition", mediaType: "text/plain", role: "text", prompt: "内容" },
  });
  const draft = textDocument.drafts[0]!;
  assert.throws(
    () => expandScriptIntoShots(textDocument, {
      draftId: draft.id,
      scriptNodeId: draft.nodes[0]!.id,
      expectedProjectRevision: textDocument.revision,
      expectedDraftRevision: draft.revision,
    }),
    /requires a script context node/,
  );
  assert.throws(
    () => expandScriptIntoShots(textDocument, {
      draftId: draft.id,
      scriptNodeId: draft.nodes[0]!.id,
      expectedProjectRevision: textDocument.revision - 1,
      expectedDraftRevision: draft.revision,
    }),
    /project revision conflict/,
  );
});
