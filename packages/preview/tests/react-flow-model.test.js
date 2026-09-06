import { describe, expect, it } from "vitest";
import exampleDocument from "../../../docs/examples/canvas-v1-shot2-night.json";
import {
  COMPOSITION_HEIGHT,
  createPreviewModel,
  getNodeSize,
  NODE_HEIGHT,
  NODE_WIDTH,
  PANORAMA_NODE_WIDTH,
  TEXT_NODE_HEIGHT,
  TEXT_NODE_WIDTH,
} from "../src/project-document.js";
import {
  buildAnchoredGraphViewport,
  buildAutoLayoutPositions,
  composerHorizontalOffset,
  connectionRejectionMessage,
  connectionToGraphMutation,
  findOpenNodePosition,
  flowNodesToCanvasPositions,
  flowNodesToSelectionIds,
  getLayoutGroupBounds,
  HANDLE_IDS,
  isLayoutGroupNode,
  resolveCompositionShotOrder,
  shouldSyncFlowProjection,
  shouldSyncFlowSelection,
  toFlowEdges,
  toFlowNodes,
} from "../src/react-flow-model.js";

function activeDraft() {
  return createPreviewModel(exampleDocument).activeDraft;
}

describe("React Flow projection", () => {
  it("keeps inline controls inside desktop and compact viewports without moving nodes", () => {
    expect(composerHorizontalOffset(300, 660, 0, 1280)).toBe(0);
    expect(composerHorizontalOffset(900, 660, 0, 1280)).toBe(-292);
    expect(composerHorizontalOffset(-80, 366, 0, 390)).toBe(92);
    expect(composerHorizontalOffset(700, 366, 0, 390)).toBe(-688);
  });
  it("anchors a wide graph at the compact reference origin without changing document coordinates", () => {
    const viewport = buildAnchoredGraphViewport({
      nodes: [
        { id: "source", position: { x: 145, y: 0 } },
        { id: "later", position: { x: 476, y: 122 } },
      ],
    }, {
      screenAnchor: { x: 48, y: 290 },
      zoom: 0.302744,
      presentationScale: 2,
    });

    expect(viewport).toEqual({ x: -39.79576, y: 290, zoom: 0.302744 });
  });

  it("projects canonical nodes without changing their ids or positions", () => {
    const draft = activeDraft();
    const selectedId = draft.nodes[1].id;
    const nodes = toFlowNodes(draft, selectedId);

    expect(nodes).toHaveLength(draft.nodes.length);
    expect(nodes[1]).toMatchObject({
      id: selectedId,
      type: "creatorNode",
      position: draft.nodes[1].position,
      selected: true,
      deletable: false,
    });
    expect(nodes[1].data.node.id).toBe(selectedId);
  });

  it("keeps every selected node visible while designating one primary node for the inline composer", () => {
    const draft = activeDraft();
    const [first, second] = draft.nodes;
    const nodes = toFlowNodes(draft, second.id, {}, 2, [first.id, second.id]);

    expect(nodes.find((node) => node.id === first.id)).toMatchObject({
      selected: true,
      data: { primarySelected: false },
    });
    expect(nodes.find((node) => node.id === second.id)).toMatchObject({
      selected: true,
      data: { primarySelected: true },
    });
  });

  it("defers a canonical node projection until a local drag has finished", () => {
    expect(shouldSyncFlowProjection()).toBe(true);
    expect(shouldSyncFlowProjection({ isNodeDragActive: true })).toBe(false);
    expect(shouldSyncFlowProjection({ hasArrangementPreview: true })).toBe(false);
    expect(shouldSyncFlowProjection({ hasArrangementPreview: true, isNodeDragActive: true })).toBe(false);
  });

  it("projects a durable layout group behind its members with derived bounds", () => {
    const first = {
      id: "first",
      kind: "shot",
      title: "镜头 A",
      position: { x: 100, y: 100 },
      spec: { kind: "shot", mediaKind: "image" },
    };
    const second = {
      id: "second",
      kind: "composition",
      title: "文本 B",
      position: { x: 500, y: 240 },
      spec: { kind: "composition", role: "text", mediaType: "text/plain" },
    };
    const group = {
      id: "group",
      kind: "composition",
      title: "第一幕",
      position: { x: 100, y: 100 },
      spec: { kind: "composition", role: "group", mediaType: "application/json", memberNodeIds: [first.id, second.id] },
    };
    const draft = { nodes: [first, second, group], edges: [] };

    expect(isLayoutGroupNode(group)).toBe(true);
    expect(getLayoutGroupBounds(draft, group)).toEqual({
      x: 70,
      y: 40,
      width: 635,
      height: 405,
      memberNodeIds: [first.id, second.id],
    });
    const nodes = toFlowNodes(draft, null, {}, 2, [first.id, second.id]);
    const frame = nodes[0];
    expect(frame).toMatchObject({
      id: group.id,
      type: "groupFrame",
      position: { x: 140, y: 80 },
      width: 1270,
      height: 810,
      selected: false,
      selectable: false,
      connectable: false,
      data: { isLayoutGroup: true, groupSelected: true },
    });
    expect(nodes.find((node) => node.id === first.id)).toMatchObject({ type: "creatorNode", selected: true });
    expect(flowNodesToCanvasPositions([frame, nodes.find((node) => node.id === first.id)], 2)).toEqual([
      { nodeId: first.id, position: first.position },
    ]);
    expect(buildAutoLayoutPositions(draft)).toEqual({
      first: { x: 0, y: 0 },
      second: { x: 0, y: 228 },
    });
  });

  it("converts a React Flow group drag back to canonical document coordinates", () => {
    expect(flowNodesToCanvasPositions([
      { id: "first", position: { x: 201, y: 399 } },
      { id: "second", position: { x: 520, y: 0 } },
      { id: "first", position: { x: 204, y: 402 } },
      { id: "ignored", position: { x: Number.NaN, y: 0 } },
    ], 2)).toEqual([
      { nodeId: "first", position: { x: 102, y: 201 } },
      { nodeId: "second", position: { x: 260, y: 0 } },
    ]);
  });

  it("keeps a one-node marquee selection instead of relying on React Flow local state", () => {
    const oneSelected = [
      { id: "shot-a" },
      { id: "" },
      null,
    ];
    expect(flowNodesToSelectionIds([
      ...oneSelected,
      { id: "shot-a" },
      { id: "shot-b" },
    ])).toEqual(["shot-a", "shot-b"]);
    expect(shouldSyncFlowSelection(oneSelected, false)).toBe(false);
    expect(shouldSyncFlowSelection(oneSelected, true)).toBe(true);
  });

  it("maps sequence and dependency semantics through shared canvas ports", () => {
    const edges = toFlowEdges(activeDraft());
    const sequence = edges.find((edge) => edge.data.kind === "sequence");
    const dependency = edges.find((edge) => edge.data.kind === "dependency");

    expect(sequence).toMatchObject({
      sourceHandle: HANDLE_IDS.output,
      targetHandle: HANDLE_IDS.input,
      type: "canvasEdge",
    });
    expect(dependency).toMatchObject({
      sourceHandle: HANDLE_IDS.output,
      targetHandle: HANDLE_IDS.input,
      type: "canvasEdge",
    });
  });

  it("derives a composition's visible order from explicit sequence edges", () => {
    const draft = {
      nodes: [
        { id: "shot-a", spec: { kind: "shot" } },
        { id: "shot-b", spec: { kind: "shot" } },
        { id: "shot-c", spec: { kind: "shot" } },
        { id: "output", spec: { kind: "composition", role: "composition" } },
      ],
      edges: [
        { kind: "dependency", sourceNodeId: "shot-a", targetNodeId: "output" },
        { kind: "dependency", sourceNodeId: "shot-b", targetNodeId: "output" },
        { kind: "dependency", sourceNodeId: "shot-c", targetNodeId: "output" },
        { kind: "sequence", sourceNodeId: "shot-a", targetNodeId: "shot-b" },
        { kind: "sequence", sourceNodeId: "shot-b", targetNodeId: "shot-c" },
      ],
    };

    expect(resolveCompositionShotOrder(draft, "output")).toEqual({
      status: "ordered",
      nodeIds: ["shot-a", "shot-b", "shot-c"],
    });
    expect(resolveCompositionShotOrder({ ...draft, edges: draft.edges.filter((edge) => edge.kind !== "sequence") }, "output"))
      .toEqual({ status: "incomplete", nodeIds: ["shot-a", "shot-b", "shot-c"] });
  });

  it("keeps selection-linked edges static and animates canonical execution flow", () => {
    const draft = activeDraft();
    const edge = draft.edges[0];
    const selectedEdges = toFlowEdges(draft, edge.sourceNodeId);
    const selectionLinkedEdge = selectedEdges.find((item) => item.id === edge.id);
    expect(selectionLinkedEdge.className).toContain("linked");
    expect(selectionLinkedEdge.className).not.toContain("active");
    expect(selectionLinkedEdge.data).toMatchObject({ linked: true, active: false });

    const unrelatedNode = draft.nodes.find((node) => node.id !== edge.sourceNodeId && node.id !== edge.targetNodeId);
    expect(toFlowEdges(draft, unrelatedNode.id).find((item) => item.id === edge.id).className).not.toContain("linked");

    const runningDraft = {
      ...draft,
      nodes: draft.nodes.map((node) => node.id === edge.targetNodeId
        ? { ...node, execution: { ...node.execution, status: "running" } }
        : node),
    };
    const runningEdge = toFlowEdges(runningDraft).find((item) => item.id === edge.id);
    expect(runningEdge.className).toContain("active");
    expect(runningEdge.data.active).toBe(true);
  });

  it("projects an explicitly selected edge for visible selection and keyboard deletion", () => {
    const draft = activeDraft();
    const edge = draft.edges[0];
    const selected = toFlowEdges(draft, null, [edge.id]).find((item) => item.id === edge.id);

    expect(selected).toMatchObject({ selected: true, data: { selected: true } });
    expect(selected.className).toContain("selected");
  });

  it("uses wide media cards and square text cards without changing graph semantics", () => {
    expect(getNodeSize({ kind: "shot", spec: { mediaKind: "image" } })).toMatchObject({
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      shape: "wide",
    });
    expect(getNodeSize({ kind: "composition", spec: { role: "text" } })).toMatchObject({
      width: TEXT_NODE_WIDTH,
      height: TEXT_NODE_HEIGHT,
      shape: "square",
    });
    expect(getNodeSize({ title: "高清", kind: "composition", spec: { role: "composition", mediaType: "image/png" } })).toMatchObject({
      width: TEXT_NODE_WIDTH,
      height: NODE_HEIGHT,
      shape: "square",
    });
    expect(getNodeSize({ title: "720°全景图", kind: "composition", spec: { role: "composition", mediaType: "image/png" } })).toMatchObject({
      width: PANORAMA_NODE_WIDTH,
      height: NODE_HEIGHT,
      shape: "panorama",
    });
    expect(getNodeSize({ title: "角色脸部三视图", kind: "composition", spec: { role: "composition", mediaType: "image/png" } })).toMatchObject({
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      shape: "wide",
    });
  });

  it("keeps a selected node's React Flow hitbox equal to its visible card", () => {
    const draft = activeDraft();
    const selectedNodeId = draft.nodes[0].id;
    const selected = toFlowNodes(draft, selectedNodeId).find((node) => node.id === selectedNodeId);

    expect(selected).toMatchObject({
      selected: true,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  it("accepts only valid, non-duplicate, acyclic handle connections", () => {
    const draft = activeDraft();
    const shots = draft.nodes.filter((node) => node.kind === "shot");
    const composition = draft.nodes.find((node) => node.kind === "composition");
    const withoutFirstDependency = {
      ...draft,
      edges: draft.edges.filter((edge) => !(
        edge.kind === "dependency" && edge.sourceNodeId === shots[0].id
      )),
    };

    expect(connectionToGraphMutation(withoutFirstDependency, {
      source: shots[0].id,
      sourceHandle: HANDLE_IDS.output,
      target: composition.id,
      targetHandle: HANDLE_IDS.input,
    })).toEqual({
      kind: "dependency",
      sourceNodeId: shots[0].id,
      targetNodeId: composition.id,
    });

    expect(connectionToGraphMutation(draft, {
      source: shots[0].id,
      sourceHandle: HANDLE_IDS.output,
      target: composition.id,
      targetHandle: HANDLE_IDS.input,
    })).toBeNull();

    expect(connectionToGraphMutation(draft, {
      source: shots[2].id,
      sourceHandle: HANDLE_IDS.output,
      target: shots[0].id,
      targetHandle: HANDLE_IDS.input,
    })).toBeNull();

    expect(connectionToGraphMutation(draft, {
      source: shots[0].id,
      sourceHandle: HANDLE_IDS.sequenceSource,
      target: composition.id,
      targetHandle: HANDLE_IDS.sequenceTarget,
    })).toBeNull();

    const context = {
      id: "context_character",
      kind: "composition",
      spec: { role: "character", prompt: "Keep the protagonist consistent." },
    };
    const withContext = { ...draft, nodes: [context, ...draft.nodes] };
    expect(connectionToGraphMutation(withContext, {
      source: context.id,
      sourceHandle: HANDLE_IDS.output,
      target: shots[0].id,
      targetHandle: HANDLE_IDS.input,
    })).toEqual({
      kind: "dependency",
      sourceNodeId: context.id,
      targetNodeId: shots[0].id,
    });

    const outputComposition = {
      id: "output_composition",
      kind: "composition",
      spec: { role: "composition", mediaType: "video/mp4" },
    };
    expect(connectionToGraphMutation({
      ...withContext,
      nodes: [...withContext.nodes, outputComposition],
    }, {
      source: context.id,
      sourceHandle: HANDLE_IDS.output,
      target: outputComposition.id,
      targetHandle: HANDLE_IDS.input,
    })).toBeNull();

    const group = {
      id: "layout_group",
      kind: "composition",
      spec: { role: "group", mediaType: "application/json", memberNodeIds: [shots[0].id, shots[1].id] },
    };
    expect(connectionToGraphMutation({ ...draft, nodes: [...draft.nodes, group] }, {
      source: group.id,
      sourceHandle: HANDLE_IDS.output,
      target: shots[0].id,
      targetHandle: HANDLE_IDS.input,
    })).toBeNull();
  });

  it("reports only real incompatible-handle drops, not cancelled connection gestures", () => {
    expect(connectionRejectionMessage({ isValid: false })).toContain("未创建连线");
    expect(connectionRejectionMessage({ isValid: true })).toBeNull();
    expect(connectionRejectionMessage({ isValid: null })).toBeNull();
  });

  it("places a new node in the nearest collision-free slot", () => {
    const draft = activeDraft();
    const position = findOpenNodePosition(draft, { x: 360, y: 100 }, "shot");

    expect(position).not.toEqual({ x: 360, y: 100 });
    for (const node of draft.nodes) {
      const separated = (
        position.x + NODE_WIDTH + 36 <= node.position.x ||
        node.position.x + NODE_WIDTH + 36 <= position.x ||
        position.y + NODE_HEIGHT + 36 <= node.position.y ||
        node.position.y + (node.kind === "composition" ? COMPOSITION_HEIGHT : NODE_HEIGHT) + 36 <= position.y
      );
      expect(separated).toBe(true);
    }
  });

  it("builds a left-to-right arrange preview with reference-sized gaps", () => {
    const draft = {
      nodes: [
        { id: "source", kind: "shot", spec: { mediaKind: "image" } },
        { id: "text", kind: "composition", spec: { role: "text" } },
        { id: "image-a", kind: "composition", spec: { role: "composition", mediaType: "image/png" }, title: "高清" },
        { id: "image-b", kind: "composition", spec: { role: "composition", mediaType: "image/png" }, title: "高清" },
      ],
      edges: [
        { sourceNodeId: "source", targetNodeId: "text" },
        { sourceNodeId: "source", targetNodeId: "image-a" },
        { sourceNodeId: "source", targetNodeId: "image-b" },
      ],
    };

    expect(buildAutoLayoutPositions(draft)).toEqual({
      source: { x: 0, y: 72 },
      text: { x: 414, y: 0 },
      "image-a": { x: 414, y: 228 },
      "image-b": { x: 414, y: 450 },
    });
  });
});
