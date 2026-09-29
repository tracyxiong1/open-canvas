import { basename, extname } from "node:path";
import {
  addNode, completeGeneration, loadProject, resetNodeGeneration, saveProjectAtomic, startGeneration,
  updateNode, writeAssetBytes, type CanvasDocument, type MediaKind,
} from "@open-canvas/core";

const mediaTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac",
};
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;

export interface MediaImportOptions {
  filename: string;
  draftId?: string;
  nodeId?: string;
  baseRevision?: number;
  x?: number;
  y?: number;
}

/** One canonical mutation: bytes, node and imported result become visible together. */
export async function importCanvasMedia(directory: string, bytes: Buffer, options: MediaImportOptions): Promise<{ document: CanvasDocument; nodeId: string }> {
  if (bytes.length === 0 || bytes.length > MAX_IMPORT_BYTES) throw new Error("Media must contain 1 byte to 256 MiB");
  const mediaType = mediaTypes[extname(options.filename).toLowerCase()];
  if (!mediaType) throw new Error("Unsupported media file; choose an image, video or audio file");
  const kind = mediaType.split("/")[0] as MediaKind;
  const before = await loadProject(directory);
  if (options.baseRevision !== undefined && before.revision !== options.baseRevision) throw new Error("project revision conflict; reload before importing");
  const draftId = options.draftId ?? before.activeDraftId;
  const draft = before.drafts.find((item) => item.id === draftId);
  if (!draft) throw new Error("Unknown draft");
  let document = before;
  let nodeId = options.nodeId;
  if (!nodeId) {
    document = addNode(document, { draftId, title: basename(options.filename),
      position: { x: options.x ?? draft.nodes.length * 48, y: options.y ?? draft.nodes.length * 48 },
      spec: { kind: "shot", mediaKind: kind, prompt: basename(options.filename), inputAssetIds: [], requirements: { mediaType } },
      expectedProjectRevision: document.revision, expectedDraftRevision: draft.revision });
    nodeId = document.drafts.find((item) => item.id === draftId)!.nodes.at(-1)!.id;
  } else {
    const node = draft.nodes.find((item) => item.id === nodeId);
    if (!node || node.spec.kind !== "shot" || node.spec.mediaKind !== kind) throw new Error("Choose a node with the same media type");
    if (node.execution.status === "running" || node.execution.status === "queued") throw new Error("Wait for this node's generation before importing");
    document = updateNode(document, { draftId, nodeId, spec: { ...node.spec,
      requirements: { ...node.spec.requirements, mediaType, ...(kind === "image" ? { count: 1 } : {}) } },
      expectedProjectRevision: document.revision, expectedDraftRevision: draft.revision });
    const updatedDraft = document.drafts.find((item) => item.id === draftId)!;
    if (updatedDraft.nodes.find((item) => item.id === nodeId)!.execution.status === "succeeded") {
      document = resetNodeGeneration(document, { draftId, nodeId, expectedProjectRevision: document.revision, expectedDraftRevision: updatedDraft.revision });
    }
  }
  const started = startGeneration(document, { draftId, nodeId, expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts.find((item) => item.id === draftId)!.revision,
    resolveRoute: () => ({ providerId: "local-import", modelId: "external-media-v1", selectionSource: "registry_default" }) });
  const completed = completeGeneration(started.document, { draftId, jobId: started.request.jobId,
    providerJobId: `local:${started.request.jobId}`, artifact: { kind, mediaType, bytes } });
  const outputId = completed.drafts.find((item) => item.id === draftId)!.nodes.find((item) => item.id === nodeId)!.execution.outputAssetIds[0];
  const asset = completed.assets.find((item) => item.id === outputId)!;
  await writeAssetBytes(directory, asset.path, bytes);
  await saveProjectAtomic(directory, completed, { expectedCurrentRevision: before.revision });
  return { document: completed, nodeId };
}
