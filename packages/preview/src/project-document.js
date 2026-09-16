// The canvas uses a stable, medium-density world unit. Keeping these values
// independent of rendered zoom lets the same document work in desktop and
// compact studio viewports without changing canonical positions.
// Canvas coordinates describe the complete node, including its compact label
// row. Media nodes intentionally use a 16:9 surface while text nodes retain a
// square reading surface.
export const NODE_WIDTH = 311;
export const NODE_HEIGHT = 175;
export const COMPOSITION_HEIGHT = 175;
export const TEXT_NODE_WIDTH = 175;
export const TEXT_NODE_HEIGHT = 175;
export const PANORAMA_NODE_WIDTH = 350;

export const STATUS_META = Object.freeze({
  dirty: { label: "待生成", tone: "pending" },
  queued: { label: "排队中", tone: "queued" },
  running: { label: "生成中", tone: "running" },
  succeeded: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "danger" },
});

function assertRecord(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
}

function assertArray(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array.`);
  }
}

function resolveRoute(node, job) {
  if (job?.route) return { ...job.route };

  const hint = node.spec?.routing?.promptOverride ?? node.spec?.routing?.aiChoice;
  if (!hint) return null;

  return {
    providerId: hint.providerId ?? "自动选择",
    modelId: hint.modelId ?? "自动选择",
    selectionSource: node.spec.routing.promptOverride ? "prompt_override" : "ai_choice",
  };
}

function projectAssets(assetIds, assetsById, resolveAssetUrl, node) {
  return assetIds.map((assetId) => {
    const asset = assetsById.get(assetId);
    if (!asset) return { id: assetId, missing: true, previewUrl: null };
    return {
      ...asset,
      previewUrl: resolveAssetUrl?.(asset, node) ?? null,
    };
  });
}

function projectGenerationHistory(node, jobs, assetsById, resolveAssetUrl) {
  return jobs
    .filter((job) => (
      job.nodeId === node.id
      && job.status === "succeeded"
      && job.id !== node.execution.activeJobId
      && job.outputAssetIds.length > 0
    ))
    .sort((left, right) => (
      right.attempt - left.attempt
      || right.updatedAt.localeCompare(left.updatedAt)
      || right.id.localeCompare(left.id)
    ))
    .map((job) => ({
      jobId: job.id,
      attempt: job.attempt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      inputFingerprint: job.inputFingerprint,
      route: job.route ? { ...job.route } : null,
      outputAssets: projectAssets(job.outputAssetIds, assetsById, resolveAssetUrl, node),
    }));
}

function buildPreviewNode(node, jobs, jobsById, assetsById, resolveAssetUrl) {
  assertRecord(node, "node");
  assertRecord(node.spec, "node.spec");
  assertRecord(node.execution, "node.execution");

  const activeJob = node.execution.activeJobId
    ? jobsById.get(node.execution.activeJobId) ?? null
    : null;
  const outputAssets = projectAssets(node.execution.outputAssetIds, assetsById, resolveAssetUrl, node);

  return {
    id: node.id,
    title: node.title,
    position: { ...node.position },
    specRevision: node.specRevision,
    kind: node.spec.kind,
    spec: structuredClone(node.spec),
    execution: structuredClone(node.execution),
    status: node.execution.status,
    statusMeta: STATUS_META[node.execution.status] ?? {
      label: node.execution.status,
      tone: "neutral",
    },
    activeJob: activeJob ? structuredClone(activeJob) : null,
    route: resolveRoute(node, activeJob),
    outputAssets,
    selectedOutputAsset: node.execution.selectedOutputAssetId
      ? projectAssets([node.execution.selectedOutputAssetId], assetsById, resolveAssetUrl, node)[0] : null,
    generationHistory: projectGenerationHistory(node, jobs, assetsById, resolveAssetUrl),
  };
}

function buildDraft(draft, assetsById, resolveAssetUrl) {
  assertRecord(draft, "draft");
  assertArray(draft.nodes, "draft.nodes");
  assertArray(draft.edges, "draft.edges");
  assertArray(draft.jobs, "draft.jobs");

  const jobsById = new Map(draft.jobs.map((job) => [job.id, job]));
  const nodes = draft.nodes.map((node) =>
    buildPreviewNode(node, draft.jobs, jobsById, assetsById, resolveAssetUrl),
  );

  return {
    id: draft.id,
    title: draft.title,
    revision: draft.revision,
    sourceDraftId: draft.sourceDraftId ?? null,
    nodes,
    edges: structuredClone(draft.edges),
    jobs: structuredClone(draft.jobs),
    // Layout groups are durable canvas structure, not pending generation
    // work. Excluding them keeps the header's task totals honest while the
    // group frame itself remains in the shared project document.
    statusCounts: nodes.filter((node) => node.spec?.role !== "group").reduce((counts, node) => {
      counts[node.status] = (counts[node.status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

/**
 * Read-only adapter from the canonical canvas document into preview view models.
 * It intentionally contains no mutations, persistence, provider calls, or secrets.
 */
export function createPreviewModel(document, options = {}) {
  assertRecord(document, "project document");
  if (document.schemaVersion !== 1) {
    throw new Error(`Unsupported canvas schema version: ${String(document.schemaVersion)}`);
  }
  assertRecord(document.project, "project");
  assertArray(document.drafts, "drafts");
  assertArray(document.assets, "assets");
  if (document.drafts.length === 0) {
    throw new Error("The project document must contain at least one draft.");
  }

  const assetsById = new Map(document.assets.map((asset) => [asset.id, asset]));
  const drafts = document.drafts.map((draft) =>
    buildDraft(draft, assetsById, options.resolveAssetUrl),
  );
  const requestedDraftId = options.draftId ?? document.activeDraftId;
  const activeDraft = drafts.find((draft) => draft.id === requestedDraftId);

  if (!activeDraft) {
    throw new Error(`Draft not found: ${requestedDraftId}`);
  }

  return {
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    project: structuredClone(document.project),
    activeDraftId: activeDraft.id,
    activeDraft,
    drafts,
    assets: document.assets.map((asset) => ({
      ...structuredClone(asset),
      previewUrl: options.resolveAssetUrl?.(asset, null) ?? null,
    })),
  };
}

export function chooseInitialNode(draft) {
  return draft.nodes.find((node) => node.status !== "succeeded") ?? draft.nodes[0] ?? null;
}

export function getNodeSize(node) {
  const kind = typeof node === "string" ? node : node?.kind ?? node?.spec?.kind;
  const role = typeof node === "object" && node
    ? node.role ?? node.spec?.role ?? null
    : null;
  const mediaType = typeof node === "object" && node
    ? node.mediaType ?? node.spec?.mediaType ?? null
    : null;

  if (kind === "composition" && role === "text") {
    return {
      width: TEXT_NODE_WIDTH,
      height: TEXT_NODE_HEIGHT,
      frameHeight: 175,
      shape: "square",
    };
  }

  if (kind === "composition" && role === "composition" && mediaType?.startsWith("image/")) {
    const panorama = typeof node === "object" && node?.title?.includes("全景");
    const compactOperation = typeof node === "object" && node?.title === "高清";
    return {
      width: panorama ? PANORAMA_NODE_WIDTH : compactOperation ? TEXT_NODE_WIDTH : NODE_WIDTH,
      height: NODE_HEIGHT,
      frameHeight: 175,
      shape: panorama ? "panorama" : compactOperation ? "square" : "wide",
    };
  }

  return {
    width: NODE_WIDTH,
    height: kind === "composition" ? COMPOSITION_HEIGHT : NODE_HEIGHT,
    frameHeight: 175,
    shape: "wide",
  };
}

export function getNodeWidth(node) {
  return getNodeSize(node).width;
}

export function getNodeHeight(node) {
  return getNodeSize(node).height;
}

export function truncateIdentifier(value, head = 12, tail = 6) {
  if (!value || value.length <= head + tail + 1) return value ?? "";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
