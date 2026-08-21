import {
  getNodeHeight,
  getNodeSize,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./project-document.js";

export const HANDLE_IDS = Object.freeze({
  // A canvas card intentionally exposes a single visible port on each side.
  // Link semantics belong to the document, not to a second row of UI dots.
  input: "canvas-input",
  output: "canvas-output",
  // Retained only so older interaction recordings can still be interpreted.
  sequenceSource: "sequence-source",
  sequenceTarget: "sequence-target",
  dependencySource: "dependency-source",
  dependencyTarget: "dependency-target",
});

export const INVALID_CONNECTION_MESSAGE = "未创建连线：请从节点右侧输出端口拖到兼容节点的左侧输入端口。重复或循环依赖不可用。";

/**
 * React Flow reports `isValid === false` only when a connection was released
 * over an incompatible handle. Releasing over blank canvas yields `null` and
 * remains a harmless cancelled gesture, so it should not produce a toast.
 */
export function connectionRejectionMessage(connectionState) {
  return connectionState?.isValid === false ? INVALID_CONNECTION_MESSAGE : null;
}

// Canonical documents use compact, portable world coordinates. The studio
// projects those coordinates into a larger editing surface so cards and their
// controls remain legible at the default 50% canvas view.
export const CANVAS_PRESENTATION_SCALE = 2;

// The public canvas reference represents a group as a low-z-index frame that
// sits behind ordinary cards. Membership remains canonical project data; the
// frame's bounds are derived so it always follows individual member edits.
export const GROUP_FRAME_PADDING = Object.freeze({ top: 60, right: 30, bottom: 30, left: 30 });

export function isLayoutGroupNode(node) {
  return node?.kind === "composition" && node?.spec?.role === "group";
}

export function getLayoutGroupBounds(draft, group) {
  const nodesById = new Map((draft?.nodes ?? []).map((node) => [node.id, node]));
  const members = (group?.spec?.memberNodeIds ?? [])
    .map((memberNodeId) => nodesById.get(memberNodeId))
    .filter((node) => node && !isLayoutGroupNode(node));
  if (members.length === 0) {
    return {
      x: group?.position?.x ?? 0,
      y: group?.position?.y ?? 0,
      width: 0,
      height: 0,
      memberNodeIds: [],
    };
  }
  const left = Math.min(...members.map((node) => node.position.x)) - GROUP_FRAME_PADDING.left;
  const top = Math.min(...members.map((node) => node.position.y)) - GROUP_FRAME_PADDING.top;
  const right = Math.max(...members.map((node) => node.position.x + getNodeSize(node).width)) + GROUP_FRAME_PADDING.right;
  const bottom = Math.max(...members.map((node) => node.position.y + getNodeHeight(node))) + GROUP_FRAME_PADDING.bottom;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    memberNodeIds: members.map((node) => node.id),
  };
}

/**
 * Place the leftmost, uppermost authored node at a measured screen anchor.
 * The document remains in canonical world coordinates; the caller supplies
 * the Studio presentation scale and the target viewport zoom.
 */
export function buildAnchoredGraphViewport(draft, {
  screenAnchor,
  zoom,
  presentationScale = 1,
}) {
  const anchorNode = (draft?.nodes ?? []).filter((node) => !isLayoutGroupNode(node)).reduce((current, node) => {
    if (!current || node.position.x < current.position.x) return node;
    if (node.position.x === current.position.x && node.position.y < current.position.y) return node;
    return current;
  }, null);

  if (!anchorNode) return { ...screenAnchor, zoom };

  return {
    x: screenAnchor.x - anchorNode.position.x * presentationScale * zoom,
    y: screenAnchor.y - anchorNode.position.y * presentationScale * zoom,
    zoom,
  };
}

export function toFlowNodes(draft, selectedNodeId, data = {}, presentationScale = 1, selectedNodeIds = []) {
  const selectedNodeIdSet = new Set(
    selectedNodeIds.length > 0
      ? selectedNodeIds
      : selectedNodeId ? [selectedNodeId] : [],
  );
  const layoutGroups = draft.nodes.filter((node) => isLayoutGroupNode(node));
  const groupFlowNodes = layoutGroups.map((group) => {
    const bounds = getLayoutGroupBounds(draft, group);
    const groupSelected = bounds.memberNodeIds.length > 0 && bounds.memberNodeIds.every((memberNodeId) => selectedNodeIdSet.has(memberNodeId));
    return {
      id: group.id,
      type: "groupFrame",
      position: {
        x: bounds.x * presentationScale,
        y: bounds.y * presentationScale,
      },
      selected: false,
      selectable: false,
      connectable: false,
      deletable: false,
      draggable: true,
      zIndex: -1001,
      width: bounds.width * presentationScale,
      height: bounds.height * presentationScale,
      data: {
        ...data,
        isLayoutGroup: true,
        group,
        groupBounds: bounds,
        groupSelected,
        presentationScale,
      },
    };
  });
  const contentFlowNodes = draft.nodes.filter((node) => !isLayoutGroupNode(node)).map((node) => {
    const selected = selectedNodeIdSet.has(node.id);
    const primarySelected = node.id === selectedNodeId;
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
        primarySelected,
        node,
      },
    };
  });
  return [...groupFlowNodes, ...contentFlowNodes];
}

/**
 * React Flow reports every node moved as part of a selected group. Convert
 * those presentation-layer coordinates back to canonical document positions
 * before sending them through the shared command core.
 */
export function flowNodesToCanvasPositions(flowNodes, presentationScale = 1) {
  const unique = new Map();
  for (const node of flowNodes ?? []) {
    if (node?.data?.isLayoutGroup) continue;
    if (!node?.id || !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) continue;
    unique.set(node.id, {
      nodeId: node.id,
      position: {
        x: Math.round(node.position.x / presentationScale),
        y: Math.round(node.position.y / presentationScale),
      },
    });
  }
  return [...unique.values()];
}

/**
 * React Flow reports the nodes covered by a Shift marquee independently from
 * its regular click-selection callback. Keep that transient list defensively
 * normalized before it becomes the canvas's canonical selection. In
 * particular, a marquee containing exactly one node must still focus that
 * node; otherwise the controlled projection clears React Flow's local state
 * on the next render.
 */
export function flowNodesToSelectionIds(flowNodes) {
  return [...new Set((flowNodes ?? []).map((node) => node?.id).filter(Boolean))];
}

/**
 * A controlled graph ignores React Flow's one-card click reconciliation, but
 * it must accept the same one-card result when it originated from a Shift
 * marquee. Callers mark the gesture boundary with React Flow's dedicated
 * selection start/end events.
 */
export function shouldSyncFlowSelection(flowNodes, isMarqueeSelection = false) {
  return isMarqueeSelection || flowNodesToSelectionIds(flowNodes).length > 1;
}

export function toFlowEdges(draft, selectedNodeId = null, selectedEdgeIds = []) {
  const nodesById = new Map(draft.nodes.map((node) => [node.id, node]));
  const selectedEdgeIdSet = new Set(selectedEdgeIds);
  return draft.edges.map((edge) => {
    const targetExecutionStatus = nodesById.get(edge.targetNodeId)?.execution?.status;
    const connectedToSelection = selectedNodeId != null && (
      edge.sourceNodeId === selectedNodeId || edge.targetNodeId === selectedNodeId
    );
    const active = targetExecutionStatus === "queued" || targetExecutionStatus === "running";
    const selected = selectedEdgeIdSet.has(edge.id);
    return ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    sourceHandle: HANDLE_IDS.output,
    targetHandle: HANDLE_IDS.input,
    // The visual connection is a direct source-right to target-left relation;
    // semantic kinds remain intact for validation and document mutations.
    type: "canvasEdge",
    className: `canvas-edge ${edge.kind}${connectedToSelection ? " linked" : ""}${active ? " active" : ""}${selected ? " selected" : ""}`,
    markerEnd: undefined,
    deletable: true,
    selected,
    data: { kind: edge.kind, active, linked: connectedToSelection, selected },
    });
  });
}

/**
 * Resolve the visible order for an output composition from its dependency
 * inputs and the explicit sequence edges between those shots. This mirrors the
 * document contract without using array order as a hidden timeline.
 */
export function resolveCompositionShotOrder(draft, compositionNodeId) {
  const nodesById = new Map((draft?.nodes ?? []).map((node) => [node.id, node]));
  const inputIds = [...new Set((draft?.edges ?? [])
    .filter((edge) => edge.kind === "dependency" && edge.targetNodeId === compositionNodeId)
    .map((edge) => edge.sourceNodeId)
    .filter((nodeId) => nodesById.get(nodeId)?.spec?.kind === "shot"))];
  if (inputIds.length === 0) return { status: "empty", nodeIds: [] };
  if (inputIds.length === 1) return { status: "single", nodeIds: inputIds };

  const inputIdSet = new Set(inputIds);
  const nextById = new Map();
  const incomingCount = new Map(inputIds.map((nodeId) => [nodeId, 0]));
  let invalid = false;
  for (const edge of draft?.edges ?? []) {
    if (edge.kind !== "sequence" || !inputIdSet.has(edge.sourceNodeId) || !inputIdSet.has(edge.targetNodeId)) continue;
    if (nextById.has(edge.sourceNodeId)) invalid = true;
    nextById.set(edge.sourceNodeId, edge.targetNodeId);
    const nextIncoming = (incomingCount.get(edge.targetNodeId) ?? 0) + 1;
    incomingCount.set(edge.targetNodeId, nextIncoming);
    if (nextIncoming > 1) invalid = true;
  }
  if (invalid) return { status: "invalid", nodeIds: inputIds };

  const starts = inputIds.filter((nodeId) => (incomingCount.get(nodeId) ?? 0) === 0);
  if (starts.length !== 1) return { status: "incomplete", nodeIds: inputIds };
  const ordered = [];
  const seen = new Set();
  let current = starts[0];
  while (current !== undefined && !seen.has(current)) {
    ordered.push(current);
    seen.add(current);
    current = nextById.get(current);
  }
  return ordered.length === inputIds.length
    ? { status: "ordered", nodeIds: ordered }
    : { status: "incomplete", nodeIds: inputIds };
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
  const occupied = draft.nodes.filter((node) => !isLayoutGroupNode(node)).map((node) => ({
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
  const graphNodes = (draft?.nodes ?? []).filter((node) => !isLayoutGroupNode(node));
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
  if (isLayoutGroupNode(source) || isLayoutGroupNode(target)) return null;

  let kind = null;
  const usesUnifiedPorts = connection.sourceHandle === HANDLE_IDS.output && connection.targetHandle === HANDLE_IDS.input;
  if (usesUnifiedPorts) {
    // Shot-to-shot links represent a serial edit/generation sequence. Every
    // other compatible relation is a dependency: a context can condition a
    // shot, and a shot can feed a composition. Programmatic edit variations
    // may still create a shot-to-shot dependency; their document edge renders
    // through these same ports without exposing duplicate UI handles.
    kind = source.kind === "shot" && target.kind === "shot" ? "sequence" : "dependency";
  }
  if (
    !kind &&
    connection.sourceHandle === HANDLE_IDS.sequenceSource &&
    connection.targetHandle === HANDLE_IDS.sequenceTarget &&
    source.kind === "shot" &&
    target.kind === "shot"
  ) {
    kind = "sequence";
  }
  if (
    !kind &&
    connection.targetHandle === HANDLE_IDS.dependencyTarget &&
    (target.kind === "composition" || target.kind === "shot") &&
    (connection.sourceHandle === HANDLE_IDS.dependencySource ||
      // Keep previously exported project interactions usable while the new
      // explicit dependency port is adopted by the canvas.
      (source.kind === "shot" && connection.sourceHandle === HANDLE_IDS.sequenceSource))
  ) {
    kind = "dependency";
  }
  if (!kind) return null;

  if (kind === "dependency") {
    if (target.kind !== "composition" && target.kind !== "shot") return null;
    const sourceIsContext = source.kind === "composition" && (source.spec.role ?? "composition") !== "composition";
    const targetIsOutputComposition = target.kind === "composition" && (target.spec.role ?? "composition") === "composition";
    if (sourceIsContext && targetIsOutputComposition) return null;
  }

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
