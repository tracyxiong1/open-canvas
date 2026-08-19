import {
  COMPOSITION_HEIGHT,
  getNodeHeight,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./project-document.js";

const PARAMETER_PANEL_WIDTH = NODE_WIDTH;
const PARAMETER_PANEL_HEIGHT_WITH_GAP = 238;

export const HANDLE_IDS = Object.freeze({
  sequenceSource: "sequence-source",
  sequenceTarget: "sequence-target",
  dependencySource: "dependency-source",
  dependencyTarget: "dependency-target",
});

export function toFlowNodes(draft, selectedNodeId, data = {}) {
  return draft.nodes.map((node) => {
    const selected = node.id === selectedNodeId;
    const cardHeight = getNodeHeight(node);
    return {
      id: node.id,
      type: "creatorNode",
      position: { ...node.position },
      selected,
      deletable: false,
      width: selected ? PARAMETER_PANEL_WIDTH : NODE_WIDTH,
      height: selected ? cardHeight + PARAMETER_PANEL_HEIGHT_WITH_GAP : cardHeight,
      data: {
        ...data,
        cardHeight,
        node,
      },
    };
  });
}

export function toFlowEdges(draft) {
  const nodesById = new Map(draft.nodes.map((node) => [node.id, node]));
  return draft.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: edge.kind === "sequence"
      ? HANDLE_IDS.sequenceSource
      : nodesById.get(edge.sourceNodeId)?.kind === "shot"
        ? HANDLE_IDS.sequenceSource
        : HANDLE_IDS.dependencySource,
    targetHandle: edge.kind === "sequence" ? HANDLE_IDS.sequenceTarget : HANDLE_IDS.dependencyTarget,
    // Both relationship types share the same curved visual grammar. Their
    // semantic kind remains intact for validation and browser mutations.
    type: "default",
    className: `canvas-edge ${edge.kind}`,
    markerEnd: undefined,
    deletable: true,
    data: { kind: edge.kind },
  }));
}

function overlaps(left, right, gap = 36) {
  return (
    left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y
  );
}

export function findOpenNodePosition(draft, preferredPosition, kind) {
  const width = NODE_WIDTH;
  const height = kind === "composition" ? COMPOSITION_HEIGHT : NODE_HEIGHT;
  const occupied = draft.nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: NODE_WIDTH,
    height: getNodeHeight(node),
  }));
  const candidates = [{ x: 0, y: 0 }];
  for (let ring = 1; ring <= 8; ring += 1) {
    candidates.push(
      { x: ring, y: ring },
      { x: -ring, y: ring },
      { x: ring, y: 0 },
      { x: -ring, y: 0 },
      { x: 0, y: ring },
      { x: ring, y: -ring },
      { x: -ring, y: -ring },
      { x: 0, y: -ring },
    );
  }

  for (const offset of candidates) {
    const candidate = {
      x: Math.round(preferredPosition.x + offset.x * (NODE_WIDTH + 64)),
      y: Math.round(preferredPosition.y + offset.y * (Math.max(NODE_HEIGHT, COMPOSITION_HEIGHT) + 64)),
    };
    const candidateRect = { ...candidate, width, height };
    if (!occupied.some((rect) => overlaps(candidateRect, rect))) return candidate;
  }
  return {
    x: Math.round(preferredPosition.x),
    y: Math.round(preferredPosition.y + (occupied.length + 1) * (Math.max(NODE_HEIGHT, COMPOSITION_HEIGHT) + 64)),
  };
}

function pathExists(edges, kind, startNodeId, goalNodeId) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (edge.kind !== kind) continue;
    const targets = outgoing.get(edge.sourceNodeId) ?? [];
    targets.push(edge.targetNodeId);
    outgoing.set(edge.sourceNodeId, targets);
  }
  const pending = [startNodeId];
  const seen = new Set();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === goalNodeId) return true;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    pending.push(...(outgoing.get(nodeId) ?? []));
  }
  return false;
}

export function connectionToGraphMutation(draft, connection) {
  const source = draft.nodes.find((node) => node.id === connection.source);
  const target = draft.nodes.find((node) => node.id === connection.target);
  if (!source || !target || source.id === target.id) return null;

  let kind = null;
  if (
    connection.sourceHandle === HANDLE_IDS.sequenceSource &&
    connection.targetHandle === HANDLE_IDS.sequenceTarget &&
    source.kind === "shot" &&
    target.kind === "shot"
  ) {
    kind = "sequence";
  }
  if (
    connection.targetHandle === HANDLE_IDS.dependencyTarget &&
    target.kind === "composition" &&
    ((source.kind === "shot" && connection.sourceHandle === HANDLE_IDS.sequenceSource) ||
      (source.kind === "composition" && connection.sourceHandle === HANDLE_IDS.dependencySource))
  ) {
    kind = "dependency";
  }
  if (!kind) return null;

  const duplicate = draft.edges.some((edge) => (
    edge.kind === kind &&
    edge.sourceNodeId === source.id &&
    edge.targetNodeId === target.id
  ));
  if (duplicate || pathExists(draft.edges, kind, target.id, source.id)) return null;

  return {
    kind,
    sourceNodeId: source.id,
    targetNodeId: target.id,
  };
}
