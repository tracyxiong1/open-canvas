import type {
  Draft,
  Node,
} from "./canvas-document.generated.js";

/**
 * Keep a single expansion action from accidentally turning a long treatment
 * into an unmanageable graph. Callers may ask for fewer shots, but never more
 * than this project-local default.
 */
export const MAX_SCRIPT_SHOTS = 8;

function normalizedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SCRIPT_SHOTS) {
    throw new Error(`Script shot limit must be an integer from 1 to ${MAX_SCRIPT_SHOTS}`);
  }
  return limit;
}

function cleanSegment(value: string): string {
  return value
    .replace(/^\s*(?:#{1,6}\s*|(?:镜头|场景)\s*\d+\s*[：:.、-]?|\d+\s*[.)、：:-]|[-*•])\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * A line-oriented script is treated as an explicit shot list. A prose
 * paragraph falls back to sentence boundaries. The returned prompts remain
 * ordinary editable video-shot prompts instead of a hidden generated plan.
 */
export function splitScriptIntoShotPrompts(prompt: string, limit = MAX_SCRIPT_SHOTS): string[] {
  const maximum = normalizedLimit(limit);
  const text = prompt.trim();
  if (!text) return [];

  const lineSegments = text
    .split(/\r?\n/u)
    .map(cleanSegment)
    .filter(Boolean);
  const candidateSegments = lineSegments.length > 1
    ? lineSegments
    : text
      .split(/(?<=[。！？!?；;])\s*/u)
      .map(cleanSegment)
      .filter(Boolean);
  const uniqueSegments: string[] = [];
  const seen = new Set<string>();
  for (const segment of candidateSegments) {
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSegments.push(segment);
    if (uniqueSegments.length >= maximum) break;
  }
  return uniqueSegments.length > 0 ? uniqueSegments : [cleanSegment(text)].filter(Boolean);
}

export interface ScriptShotConnection {
  kind: "dependency" | "sequence";
  sourceNodeId: string;
  targetNodeId: string;
}

/**
 * A script is a reusable context source, while its expanded shots form a
 * serial generation/edit sequence. Keeping both relations explicit lets an
 * output composition resolve the order without depending on array order.
 */
export function buildScriptShotConnections(scriptNodeId: string, shotNodeIds: readonly string[]): ScriptShotConnection[] {
  if (!scriptNodeId) throw new Error("Script node ID is required");
  const ids = [...new Set(shotNodeIds)].filter(Boolean);
  return [
    ...ids.map((targetNodeId) => ({
      kind: "dependency" as const,
      sourceNodeId: scriptNodeId,
      targetNodeId,
    })),
    ...ids.slice(1).map((targetNodeId, index) => ({
      kind: "sequence" as const,
      sourceNodeId: ids[index]!,
      targetNodeId,
    })),
  ];
}

export interface ScriptShotPositionContext {
  draft: Draft;
  scriptNode: Node;
  index: number;
  shotCount: number;
}
