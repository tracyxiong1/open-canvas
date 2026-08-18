import type {
  CreatorCanvasDraftBasedProjectDocumentV1 as CanvasDocument,
  Draft,
  Node,
} from "./canvas-document.generated.js";
import { computeNodeFingerprint } from "./validation.js";

export function dependencyClosureInTopologicalOrder(
  draft: Draft,
  sourceNodeIds: Iterable<string>,
  includeSources: boolean,
): Node[] {
  const nodes = new Map(draft.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(draft.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of draft.edges) {
    if (edge.kind === "dependency") outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const sources = new Set(sourceNodeIds);
  const closure = new Set(sources);
  const pending = [...sources];
  for (const sourceId of sources) {
    if (!nodes.has(sourceId)) throw new Error(`Unknown dependency source: ${sourceId}`);
  }
  while (pending.length > 0) {
    const sourceId = pending.shift()!;
    for (const targetId of outgoing.get(sourceId) ?? []) {
      if (closure.has(targetId)) continue;
      closure.add(targetId);
      pending.push(targetId);
    }
  }

  const selected = new Set([...closure].filter((nodeId) => includeSources || !sources.has(nodeId)));
  const indegree = new Map([...selected].map((nodeId) => [nodeId, 0]));
  for (const edge of draft.edges) {
    if (edge.kind === "dependency" && selected.has(edge.sourceNodeId) && selected.has(edge.targetNodeId)) {
      indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
    }
  }

  const ready = draft.nodes.filter((node) => selected.has(node.id) && indegree.get(node.id) === 0);
  const ordered: Node[] = [];
  while (ready.length > 0) {
    const node = ready.shift()!;
    ordered.push(node);
    for (const targetId of outgoing.get(node.id) ?? []) {
      if (!selected.has(targetId)) continue;
      const remaining = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, remaining);
      if (remaining === 0) ready.push(nodes.get(targetId)!);
    }
  }
  if (ordered.length !== selected.size) throw new Error("Dependency graph contains a cycle");
  return ordered;
}

export function invalidateDependencyClosure(
  document: CanvasDocument,
  draft: Draft,
  sourceNodeIds: Iterable<string>,
  includeSources: boolean,
): void {
  for (const node of dependencyClosureInTopologicalOrder(draft, sourceNodeIds, includeSources)) {
    node.execution = {
      status: "dirty",
      inputFingerprint: computeNodeFingerprint(document, draft, node),
      outputAssetIds: [],
    };
  }
}
