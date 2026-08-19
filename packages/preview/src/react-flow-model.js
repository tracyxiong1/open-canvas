import {
  getNodeHeight,
  getNodeSize,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./project-document.js";

export const HANDLE_IDS = Object.freeze({
  sequenceSource: "sequence-source",
  sequenceTarget: "sequence-target",
  dependencySource: "dependency-source",
  dependencyTarget: "dependency-target",
});

// Canonical documents use compact, portable world coordinates. The studio
// projects those coordinates into a larger editing surface so cards and their
// controls remain legible at the default 50% canvas view.
export const CANVAS_PRESENTATION_SCALE = 2;

export function toFlowNodes(draft, selectedNodeId, data = {}, presentationScale = 1) {
  return draft.nodes.map((node) => {
    const selected = node.id === selectedNodeId;
    const nodeSize = getNodeSize(node);
    const flowNodeSize = {
      ...nodeSize,
      width: nodeSize.width * presentationScale,
      height: nodeSize.height * presentationScale,
    };
    return {
      id: node.id,
      type: "creatorNode",
      position: {
        x: node.position.x * presentationScale,
        y: node.position.y * presentationScale,
      },
      selected,
      deletable: false,
      // The selected node's configuration surfaces intentionally overflow its
      // visual card. Keeping the React Flow hitbox equal to the card prevents
      // that overlay from swallowing clicks and drags on neighboring nodes.
      width: flowNodeSize.width,
      height: flowNodeSize.height,
      data: {
        ...data,
        nodeSize,
        flowNodeSize,
        presentationScale,
        node,
      },
    };
  });
}

export function toFlowEdges(draft, selectedNodeId = null) {
  const nodesById = new Map(draft.nodes.map((node) => [node.id, node]));
  return draft.edges.map((edge) => {
    const targetStatus = nodesById.get(edge.targetNodeId)?.status;
    const connectedToSelection = selectedNodeId != null && (
      edge.sourceNodeId === selectedNodeId || edge.targetNodeId === selectedNodeId
    );
    const active = connectedToSelection || targetStatus === "queued" || targetStatus === "running";
    return ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: edge.kind === "sequence"
      ? HANDLE_IDS.sequenceSource
      : nodesById.get(edge.sourceNodeId)?.kind === "shot"
        ? HANDLE_IDS.sequenceSource
        : HANDLE_IDS.dependencySource,
    targetHandle: edge.kind === "sequence" ? HANDLE_IDS.sequenceTarget : HANDLE_IDS.dependencyTarget,
    // The visual connection is a direct source-right to target-left relation;
    // semantic kinds remain intact for validation and document mutations.
    type: "canvasEdge",
    className: `canvas-edge ${edge.kind}${active ? " active" : ""}`,
    markerEnd: undefined,
    deletable: true,
    data: { kind: edge.kind, active },
    });
  });
}

function overlaps(left, right, gap = 36) {
  return (
    left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y
  );
}

export function findOpenNodePosition(draft, preferredPosition, descriptor) {
  const { width, height } = getNodeSize(descriptor);
  const occupied = draft.nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    width: getNodeSize(node).width,
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
      y: Math.round(preferredPosition.y + offset.y * (NODE_HEIGHT + 64)),
    };
    const candidateRect = { ...candidate, width, height };
    if (!occupied.some((rect) => overlaps(candidateRect, rect))) return candidate;
  }
  return {
    x: Math.round(preferredPosition.x),
    y: Math.round(preferredPosition.y + (occupied.length + 1) * (NODE_HEIGHT + 64)),
  };
}

/**
 * Build the same kind of left-to-right dependency layout used by the studio's
 * “整理画布” preview. Positions stay in canonical document coordinates; the
 * React Flow projection applies the presentation scale afterwards.
 */
export function buildAutoLayoutPositions(draft) {
  const graphNodes = draft?.nodes ?? [];
  if (graphNodes.length === 0) return {};

  const nodeIds = new Set(graphNodes.map((node) => node.id));
  const incoming = new Map(graphNodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graphNodes.map((node) => [node.id, []]));

  for (const edge of draft.edges ?? []) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) continue;
    outgoing.get(edge.sourceNodeId).push(edge.targetNodeId);
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1);
  }

  const rank = new Map(graphNodes.map((node) => [node.id, 0]));
  const queue = graphNodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const visited = new Set();

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const sourceId = queue[cursor];
    visited.add(sourceId);
    for (const targetId of outgoing.get(sourceId) ?? []) {
      rank.set(targetId, Math.max(rank.get(targetId) ?? 0, (rank.get(sourceId) ?? 0) + 1));
      incoming.set(targetId, (incoming.get(targetId) ?? 1) - 1);
      if (incoming.get(targetId) === 0) queue.push(targetId);
    }
  }

  // Cycles are rejected by the command core, but imported documents may still
  // contain one. Keep those nodes visible instead of dropping them.
  for (const node of graphNodes) {
    if (!visited.has(node.id)) rank.set(node.id, 0);
  }

  const columns = new Map();
  for (const node of graphNodes) {
    const nodeRank = rank.get(node.id) ?? 0;
    const column = columns.get(nodeRank) ?? [];
    column.push(node);
    columns.set(nodeRank, column);
  }

  const orderedRanks = [...columns.keys()].sort((left, right) => left - right);
  const columnGap = 103;
  const positions = {};
  const largestColumnSize = Math.max(...[...columns.values()].map((column) => column.length));
  let x = 0;

  for (const nodeRank of orderedRanks) {
    const column = columns.get(nodeRank);
    const columnWidth = Math.max(...column.map((node) => getNodeSize(node).width));
    // The reference keeps a single source node tucked between the first two
    // downstream cards instead of centering it against a very tall fan-out.
    let y = nodeRank === 0 && column.length === 1 && largestColumnSize > 1 ? 72 : 0;

    column.forEach((node, index) => {
      positions[node.id] = { x, y };
      // The captured layout alternates 53/47 world-unit gutters. With the
      // 2× presentation scale this produces the visible 456/444 px rhythm.
      y += getNodeHeight(node) + (index % 2 === 0 ? 53 : 47);
    });
    x += columnWidth + columnGap;
  }

  return positions;
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
