/* Generated from docs/schema/canvas-document-v1.schema.json. Do not edit. */

export type ProjectId = string;
export type Timestamp = string;
export type DraftId = string;
export type NodeId = string;
export type AssetId = string;
export type Execution = {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  status: "dirty" | "queued" | "running" | "succeeded" | "failed";
  inputFingerprint: Sha256;
  activeJobId?: JobId;
  outputAssetIds: AssetId[];
};
export type Sha256 = string;
export type JobId = string;
export type EdgeId = string;
export type Job = {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  [k: string]: unknown;
} & {
  id: JobId;
  nodeId: NodeId;
  attempt: number;
  inputFingerprint: Sha256;
  status: "queued" | "running" | "succeeded" | "failed";
  route: ResolvedRoute;
  providerJobId?: string;
  progress?: number;
  outputAssetIds: AssetId[];
  error?: JobError;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export interface CreatorCanvasDraftBasedProjectDocumentV1 {
  schemaVersion: 1;
  revision: number;
  project: Project;
  activeDraftId: DraftId;
  /**
   * @minItems 1
   */
  drafts: [Draft, ...Draft[]];
  assets: Asset[];
}
export interface Project {
  id: ProjectId;
  title: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export interface Draft {
  id: DraftId;
  title: string;
  revision: number;
  sourceDraftId?: DraftId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  nodes: Node[];
  edges: Edge[];
  jobs: Job[];
}
export interface Node {
  id: NodeId;
  title: string;
  position: Position;
  specRevision: number;
  spec: ShotSpec | CompositionSpec;
  execution: Execution;
}
export interface Position {
  x: number;
  y: number;
}
export interface ShotSpec {
  kind: "shot";
  prompt: string;
  mediaKind: "image" | "video";
  inputAssetIds: AssetId[];
  requirements?: OutputRequirements;
  routing?: RoutingHints;
}
export interface OutputRequirements {
  aspectRatio?: "16:9" | "9:16" | "1:1";
  width?: number;
  height?: number;
  durationSeconds?: number;
  audio?: "required" | "forbidden" | "either";
  mediaType?: string;
}
export interface RoutingHints {
  promptOverride?: RouteHint;
  aiChoice?: RouteHint;
}
export interface RouteHint {
  providerId?: string;
  modelId?: string;
}
export interface CompositionSpec {
  kind: "composition";
  mediaType: "video/mp4";
}
export interface Edge {
  id: EdgeId;
  kind: "dependency" | "sequence";
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
}
export interface ResolvedRoute {
  providerId: string;
  modelId: string;
  selectionSource: "prompt_override" | "ai_choice" | "registry_default";
}
export interface JobError {
  code: "provider_rejected" | "provider_unavailable" | "provider_protocol" | "missing_credential";
  retryable: boolean;
  message: string;
}
export interface Asset {
  id: AssetId;
  kind: "image" | "video";
  mediaType: string;
  byteLength: number;
  checksumSha256: Sha256;
  path: string;
  origin:
    | {
        kind: "job";
        draftId: DraftId;
        jobId: JobId;
      }
    | {
        kind: "import";
      };
  createdAt: Timestamp;
}
