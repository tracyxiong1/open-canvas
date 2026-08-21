import { addNode, connectNodes, createProject, registerImportedAsset } from "@open-canvas/core";
import { describe, expect, it } from "vitest";
import { createNodeClipboard, pasteNodeClipboard } from "../src/canvas-clipboard.js";

function createConnectedContextGroup() {
  let document = createProject({ title: "节点组复制测试" });
  const imported = registerImportedAsset(document, {
    expectedProjectRevision: document.revision,
    kind: "image",
    mediaType: "image/png",
    byteLength: 12,
    checksumSha256: `sha256:${"d".repeat(64)}`,
  });
  document = imported.document;
  const draftId = document.activeDraftId;

  for (const [title, role, position] of [
    ["角色设定", "character", { x: 120, y: 180 }],
    ["场景风格", "scene-style", { x: 540, y: 260 }],
  ]) {
    const draft = document.drafts[0];
    document = addNode(document, {
      draftId,
      title,
      position,
      spec: {
        kind: "composition",
        mediaType: "application/json",
        role,
        prompt: `${title} 的跨镜头约束。`,
        referenceAssetIds: [imported.asset.id],
      },
      expectedProjectRevision: document.revision,
      expectedDraftRevision: draft.revision,
    });
  }

  const [source, target] = document.drafts[0].nodes;
  document = connectNodes(document, {
    draftId,
    kind: "dependency",
    sourceNodeId: source.id,
    targetNodeId: target.id,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
  });
  return { document, draftId, assetId: imported.asset.id };
}

describe("project-local node clipboard", () => {
  it("copies editable structure, restores only internal edges, and keeps generated state out", () => {
    const { document, draftId, assetId } = createConnectedContextGroup();
    const sourceDraft = document.drafts[0];
    const clipboard = createNodeClipboard(sourceDraft, sourceDraft.nodes.map((node) => node.id));

    expect(clipboard).toMatchObject({ nodes: [{ title: "角色设定" }, { title: "场景风格" }], edges: [{ kind: "dependency" }], pasteCount: 0 });
    expect(clipboard.nodes.every((node) => !("execution" in node))).toBe(true);

    const pasted = pasteNodeClipboard(document, { draftId, clipboard });
    const pastedDraft = pasted.document.drafts[0];
    const pastedNodes = pastedDraft.nodes.filter((node) => pasted.nodeIds.includes(node.id));
    const pastedEdge = pastedDraft.edges.find((edge) => pasted.nodeIds.includes(edge.sourceNodeId) && pasted.nodeIds.includes(edge.targetNodeId));

    expect(pasted.nodeIds).toHaveLength(2);
    expect(pasted.clipboard.pasteCount).toBe(1);
    expect(pastedNodes.map((node) => node.title)).toEqual(["角色设定 副本", "场景风格 副本"]);
    expect(pastedNodes.map((node) => node.execution)).toEqual([
      expect.objectContaining({ status: "dirty", outputAssetIds: [] }),
      expect.objectContaining({ status: "dirty", outputAssetIds: [] }),
    ]);
    expect(pastedNodes.map((node) => node.spec.referenceAssetIds)).toEqual([[assetId], [assetId]]);
    expect(pastedDraft.jobs).toHaveLength(0);
    expect(pastedEdge).toMatchObject({ kind: "dependency" });
    expect(pasted.nodeIds).toContain(pastedEdge.sourceNodeId);
    expect(pasted.nodeIds).toContain(pastedEdge.targetNodeId);

    const originalOffset = {
      x: sourceDraft.nodes[1].position.x - sourceDraft.nodes[0].position.x,
      y: sourceDraft.nodes[1].position.y - sourceDraft.nodes[0].position.y,
    };
    expect({
      x: pastedNodes[1].position.x - pastedNodes[0].position.x,
      y: pastedNodes[1].position.y - pastedNodes[0].position.y,
    }).toEqual(originalOffset);

    const pastedAgain = pasteNodeClipboard(pasted.document, { draftId, clipboard: pasted.clipboard });
    expect(pastedAgain.document.drafts[0].nodes.slice(-2).map((node) => node.title)).toEqual([
      "角色设定 副本 2",
      "场景风格 副本 2",
    ]);
  });
});
