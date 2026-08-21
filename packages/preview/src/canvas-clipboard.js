import { addNode, connectNodes } from "@open-canvas/core/browser";
import { findOpenNodePosition } from "./react-flow-model.js";

function findDraft(document, draftId) {
  const draft = document.drafts.find((item) => item.id === draftId);
  if (!draft) throw new Error(`Draft not found: ${draftId}`);
  return draft;
}

export function nextCopiedNodeTitle(draft, sourceTitle) {
  const titleBase = `${sourceTitle} 副本`;
  const existingCopies = draft.nodes.filter((node) => (
    node.title === titleBase || node.title.startsWith(`${titleBase} `)
  )).length;
  return existingCopies === 0 ? titleBase : `${titleBase} ${existingCopies + 1}`;
}

/**
 * The clipboard deliberately contains just editable graph structure. Jobs,
 * generation outputs, and asset bytes stay out of it: pasted nodes start
 * dirty, while existing project-local asset IDs in a spec remain reusable.
 */
export function createNodeClipboard(draft, nodeIds) {
  const selectedNodeIds = new Set(nodeIds);
  const nodes = draft.nodes
    .filter((node) => selectedNodeIds.has(node.id))
    .map((node) => ({
      id: node.id,
      title: node.title,
      position: { ...node.position },
      spec: structuredClone(node.spec),
    }));
  if (nodes.length === 0) return null;

  return {
    nodes,
    edges: draft.edges
      .filter((edge) => selectedNodeIds.has(edge.sourceNodeId) && selectedNodeIds.has(edge.targetNodeId))
      .map((edge) => ({
        kind: edge.kind,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })),
    pasteCount: 0,
  };
}

export function pasteNodeClipboard(document, { draftId, clipboard }) {
  if (!clipboard?.nodes.length) return { document, nodeIds: [], clipboard };

  const currentDraft = findDraft(document, draftId);
  const firstSource = clipboard.nodes[0];
  const offset = 48 * (clipboard.pasteCount + 1);
  const firstPosition = findOpenNodePosition(currentDraft, {
    x: firstSource.position.x + offset,
    y: firstSource.position.y + offset,
  }, firstSource.spec);
  const positionDelta = {
    x: firstPosition.x - firstSource.position.x,
    y: firstPosition.y - firstSource.position.y,
  };
  const copiedIds = new Map();
  const nodeIds = [];
  let next = document;

  for (const source of clipboard.nodes) {
    const draft = findDraft(next, draftId);
    next = addNode(next, {
      draftId,
      title: nextCopiedNodeTitle(draft, source.title),
      spec: structuredClone(source.spec),
      position: {
        x: source.position.x + positionDelta.x,
        y: source.position.y + positionDelta.y,
      },
      expectedProjectRevision: next.revision,
      expectedDraftRevision: draft.revision,
    });
    const copiedNodeId = findDraft(next, draftId).nodes.at(-1)?.id;
    if (!copiedNodeId) throw new Error("无法粘贴节点");
    copiedIds.set(source.id, copiedNodeId);
    nodeIds.push(copiedNodeId);
  }

  for (const edge of clipboard.edges) {
    const sourceNodeId = copiedIds.get(edge.sourceNodeId);
    const targetNodeId = copiedIds.get(edge.targetNodeId);
    if (!sourceNodeId || !targetNodeId) continue;
    const draft = findDraft(next, draftId);
    next = connectNodes(next, {
      draftId,
      kind: edge.kind,
      sourceNodeId,
      targetNodeId,
      expectedProjectRevision: next.revision,
      expectedDraftRevision: draft.revision,
    });
  }

  return {
    document: next,
    nodeIds,
    clipboard: { ...clipboard, pasteCount: clipboard.pasteCount + 1 },
  };
}
