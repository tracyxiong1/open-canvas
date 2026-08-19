import { describe, expect, it } from "vitest";
import exampleDocument from "../../../docs/examples/canvas-v1-shot2-night.json";
import {
  COMPOSITION_HEIGHT,
  createPreviewModel,
  getNodeSize,
  NODE_HEIGHT,
  NODE_WIDTH,
  TEXT_NODE_HEIGHT,
  TEXT_NODE_WIDTH,
} from "../src/project-document.js";
import {
  connectionToGraphMutation,
  findOpenNodePosition,
  HANDLE_IDS,
  toFlowEdges,
  toFlowNodes,
} from "../src/react-flow-model.js";

function activeDraft() {
  return createPreviewModel(exampleDocument).activeDraft;
}

describe("React Flow projection", () => {
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

  it("maps sequence and dependency semantics to distinct handles", () => {
    const edges = toFlowEdges(activeDraft());
    const sequence = edges.find((edge) => edge.data.kind === "sequence");
    const dependency = edges.find((edge) => edge.data.kind === "dependency");

    expect(sequence).toMatchObject({
      sourceHandle: HANDLE_IDS.sequenceSource,
      targetHandle: HANDLE_IDS.sequenceTarget,
      type: "canvasEdge",
    });
    expect(dependency).toMatchObject({
      sourceHandle: HANDLE_IDS.sequenceSource,
      targetHandle: HANDLE_IDS.dependencyTarget,
      type: "canvasEdge",
    });
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
      sourceHandle: HANDLE_IDS.sequenceSource,
      target: composition.id,
      targetHandle: HANDLE_IDS.dependencyTarget,
    })).toEqual({
      kind: "dependency",
      sourceNodeId: shots[0].id,
      targetNodeId: composition.id,
    });

    expect(connectionToGraphMutation(draft, {
      source: shots[0].id,
      sourceHandle: HANDLE_IDS.sequenceSource,
      target: composition.id,
      targetHandle: HANDLE_IDS.dependencyTarget,
    })).toBeNull();

    expect(connectionToGraphMutation(draft, {
      source: shots[2].id,
      sourceHandle: HANDLE_IDS.sequenceSource,
      target: shots[0].id,
      targetHandle: HANDLE_IDS.sequenceTarget,
    })).toBeNull();

    expect(connectionToGraphMutation(draft, {
      source: shots[0].id,
      sourceHandle: HANDLE_IDS.sequenceSource,
      target: composition.id,
      targetHandle: HANDLE_IDS.sequenceTarget,
    })).toBeNull();
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
});
