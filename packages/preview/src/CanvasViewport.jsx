import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  getBezierPath,
  Handle,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import {
  Article,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowUp,
  ArrowsInSimple,
  ArrowsOutSimple,
  Atom,
  CaretDown,
  CaretRight,
  CheckCircle,
  Clock,
  CornersOut,
  Crop,
  Crosshair,
  Cursor,
  DownloadSimple,
  Eraser,
  FilmSlate,
  FileText,
  FlowerLotus,
  FolderSimple,
  GridFour,
  GridNine,
  Hand,
  HashStraight,
  HighDefinition,
  ImageSquare,
  Info,
  LinkSimple,
  MapPinArea,
  MagnifyingGlassPlus,
  Minus,
  Mountains,
  Pause,
  PencilSimple,
  Play,
  Plus,
  Rectangle,
  Scissors,
  SpeakerHigh,
  Sparkle,
  SpinnerGap,
  Stack,
  Smiley,
  TextAlignLeft,
  TextT,
  UploadSimple,
  User,
  UserCircle,
  VideoCamera,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  IconBadgeHd,
  IconKeyboard as TablerKeyboard,
  IconLayoutDashboard,
  IconPanoramaHorizontal,
  IconRoute,
  IconSunset2,
} from "@tabler/icons-react";
import { getNodeSize } from "./project-document.js";
import {
  buildAnchoredGraphViewport,
  buildAutoLayoutPositions,
  composerHorizontalOffset,
  connectionRejectionMessage,
  connectionToGraphMutation,
  CANVAS_PRESENTATION_SCALE,
  findOpenNodePosition,
  flowNodesToCanvasPositions,
  flowNodesToSelectionIds,
  HANDLE_IDS,
  isLayoutGroupNode,
  resolveCompositionShotOrder,
  shouldSyncFlowProjection,
  shouldSyncFlowSelection,
  toFlowEdges,
  toFlowNodes,
} from "./react-flow-model.js";
import { AssetPreview, isPlayableVideoPreview } from "./media-preview.jsx";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const FIT_VIEW_PADDING = 0.12;
const DEFAULT_CANVAS_ZOOM = 0.5;
// The top bar is fixed above the canvas. Keep fitted cards below it so the
// first node's title and connection port remain reachable on compact screens.
const FIT_VIEW_BIAS = Object.freeze({ x: 10, y: 38 });
// A dense fan-out is framed like a working canvas, not a presentation slide.
// Reference capture shows that the authored source has a different, deliberate
// working origin on compact screens. The anchors stay in screen coordinates;
// canonical document positions remain unchanged.
const NARROW_VIEWPORT_BREAKPOINT = 800;
const DESKTOP_GRAPH_FRAMING = Object.freeze({
  zoom: 0.31,
  screenAnchor: Object.freeze({ x: 121, y: 368 }),
});
const NARROW_GRAPH_FRAMING = Object.freeze({
  zoom: 0.302744,
  screenAnchor: Object.freeze({ x: 48, y: 290 }),
});

const CONTEXT_NODE_ROLES = new Set([
  "text",
  "smart-edit",
  "director",
  "frame-analysis",
  "audio",
  "script",
  // Read-only compatibility for older project documents. The add menu and
  // local data contract create `asset-reference` instead.
  "asset-library",
  "asset-reference",
  "character",
  "scene-style",
]);

// Context nodes keep their input media in the same project-local asset store
// as shots. The visual picker is intentionally an inline node control rather
// than a separate material library: character and style need visual reference,
// while edit, analysis, and audio nodes need source media to describe their
// work precisely.
const LOCAL_REFERENCE_CONTEXT_ROLES = new Set([
  "script",
  "asset-reference",
  "character",
  "scene-style",
  "smart-edit",
  "frame-analysis",
  "audio",
]);

// These common presets are supported by both of the current image adapters.
// Existing documents keep their own explicit dimensions and remain executable.
const IMAGE_OUTPUT_PRESETS = Object.freeze({
  "16:9": Object.freeze({ width: 2048, height: 1152 }),
  "9:16": Object.freeze({ width: 1152, height: 2048 }),
  "1:1": Object.freeze({ width: 2048, height: 2048 }),
});
const IMAGE_ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "1:1"]);
const IMAGE_OUTPUT_COUNT_PRESETS = Object.freeze([1, 2, 4]);
const VIDEO_ASPECT_RATIOS = Object.freeze(["16:9", "9:16"]);
// The Studio stores these as ordinary output requirements. Provider routing is
// still the authority for whether a configured local route can satisfy a
// selected value, so the controls never imply a hidden online model choice.
const VIDEO_DURATION_PRESETS = Object.freeze([5, 10, 15]);
const VIDEO_AUDIO_OPTIONS = Object.freeze([
  { value: "either", label: "随提供方" },
  { value: "required", label: "需要音频" },
  { value: "forbidden", label: "无音频" },
]);
const LOCAL_GENERATION_REFERENCE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function supportsLocalGenerationReference(asset) {
  return asset?.kind === "image" && LOCAL_GENERATION_REFERENCE_MEDIA_TYPES.has(asset.mediaType);
}

function sameIdSet(left, right) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function StatusIcon({ status }) {
  if (status === "succeeded") return <CheckCircle weight="fill" aria-hidden="true" />;
  if (status === "running") return <SpinnerGap className="spin" aria-hidden="true" />;
  if (status === "queued") return <Clock weight="fill" aria-hidden="true" />;
  if (status === "failed") return <WarningCircle weight="fill" aria-hidden="true" />;
  return <Pause weight="fill" aria-hidden="true" />;
}

function getSurfaceKind(node) {
  if (node.kind === "composition") {
    if ((node.spec.role ?? "composition") === "composition") {
      return node.spec.mediaType?.startsWith("image/") ? "image" : "output";
    }
    return node.spec.role ?? "composition";
  }
  return node.spec.mediaKind;
}

function isContextNode(node) {
  return node.kind === "composition" && CONTEXT_NODE_ROLES.has(node.spec.role);
}

function SurfaceIcon({ kind }) {
  if (kind === "text") return <TextT weight="thin" aria-hidden="true" />;
  if (kind === "image") return <ImageSquare weight="thin" aria-hidden="true" />;
  if (kind === "smart-edit") return <Scissors weight="thin" aria-hidden="true" />;
  if (kind === "director") return <FilmSlate weight="thin" aria-hidden="true" />;
  if (kind === "frame-analysis") return <MagnifyingGlassPlus weight="thin" aria-hidden="true" />;
  if (kind === "audio") return <SpeakerHigh weight="thin" aria-hidden="true" />;
  if (kind === "script") return <FileText weight="thin" aria-hidden="true" />;
  if (kind === "asset-library" || kind === "asset-reference") return <FolderSimple weight="thin" aria-hidden="true" />;
  if (kind === "character") return <User weight="thin" aria-hidden="true" />;
  if (kind === "scene-style") return <FlowerLotus weight="thin" aria-hidden="true" />;
  if (kind === "output") return <Stack weight="thin" aria-hidden="true" />;
  if (kind === "composition") return <Stack weight="thin" aria-hidden="true" />;
  return <VideoCamera weight="thin" aria-hidden="true" />;
}

function NodeLabelIcon({ kind }) {
  if (kind === "text") return <Article weight="fill" aria-hidden="true" />;
  if (kind === "image") return <ImageSquare weight="fill" aria-hidden="true" />;
  if (kind === "smart-edit") return <Scissors weight="fill" aria-hidden="true" />;
  if (kind === "director") return <FilmSlate weight="fill" aria-hidden="true" />;
  if (kind === "frame-analysis") return <MagnifyingGlassPlus weight="bold" aria-hidden="true" />;
  if (kind === "audio") return <SpeakerHigh weight="fill" aria-hidden="true" />;
  if (kind === "script") return <FileText weight="fill" aria-hidden="true" />;
  if (kind === "asset-library" || kind === "asset-reference") return <FolderSimple weight="fill" aria-hidden="true" />;
  if (kind === "character") return <User weight="fill" aria-hidden="true" />;
  if (kind === "scene-style") return <FlowerLotus weight="fill" aria-hidden="true" />;
  if (kind === "output") return <Stack weight="fill" aria-hidden="true" />;
  if (kind === "composition") return <Stack weight="fill" aria-hidden="true" />;
  return <VideoCamera weight="fill" aria-hidden="true" />;
}

function NodeMedia({ node, kind, onFocusNode, onOpenPreview }) {
  const asset = node.selectedOutputAsset ?? node.outputAssets.find((item) => item.previewUrl);
  const operationNode = node.kind === "composition"
    && (node.spec.role ?? "composition") === "composition"
    && node.spec.mediaType?.startsWith("image/");
  const videoLikeOutput = kind === "video" || (kind === "output" && node.spec.mediaType?.startsWith("video/"));
  if (kind === "text") {
    const prompt = node.spec.prompt?.trim() || "尚未填写文本提示";
    return (
      <div className="node-media node-media-text" aria-label={`${node.title} ${node.statusMeta.label}`}>
        <span className="node-text-heading"><TextAlignLeft weight="regular" aria-hidden="true" />文本提示</span>
        <p className="node-text-prompt" title={prompt}>{prompt}</p>
      </div>
    );
  }
  if (asset && kind !== "text") {
    const playableVideo = (videoLikeOutput && isPlayableVideoPreview(asset)) || kind === "audio";
    const openVideoPreview = (event) => {
      event.stopPropagation();
      onFocusNode?.(node.id);
      onOpenPreview(node, asset);
    };
    return (
      <div className="node-media node-media-asset">
        {kind === "audio" ? <div className="node-audio-cover"><SpeakerHigh aria-hidden="true" /><span>{asset.origin?.kind === "job" && node.route?.providerId !== "local-import" ? node.route?.providerId === "mock" ? "本地测试音频（静音）" : "AI 合成声音" : "音频素材"}</span></div> : <AssetPreview asset={asset} alt={`${node.title} 的生成画面`} />}
        {node.selectedOutputAsset ? <span className="node-selected-result-label">已选结果</span> : null}
        {playableVideo ? (
          <button
            className="node-play node-play-button nodrag nopan nowheel"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openVideoPreview}
            aria-label={`播放 ${node.title}`}
          >
            <Play weight="fill" aria-hidden="true" />
          </button>
        ) : (
          <button
            className="node-preview-button nodrag nopan"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPreview(node, asset);
            }}
            aria-label={`打开 ${node.title} 的素材预览`}
          >
            <CornersOut aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  if (operationNode) {
    return (
      <div className="node-media node-media-operation" aria-label={`${node.title} ${node.statusMeta.label}`}>
        {node.title === "高清" ? <span>{node.spec.prompt}</span> : <Mountains weight="fill" aria-hidden="true" />}
      </div>
    );
  }

  return (
    <div className="node-media node-media-empty" aria-label={`${node.title} ${node.statusMeta.label}`}>
      <SurfaceIcon kind={kind} />
      {node.status !== "dirty" ? (
        <span className={`node-status-dot ${node.statusMeta.tone}`} title={node.statusMeta.label}>
          <StatusIcon status={node.status} />
        </span>
      ) : null}
    </div>
  );
}

function NodeComposer({ node, kind, graph, assets = [], onOpenPreview, onUpdatePrompt, onUpdateReferenceAssets, onUpdateInputAssets, onUpdateRequirements, onSelectOutput, onResetGeneration, onExpandScript }) {
  const canEditPrompt = node.kind === "shot" || isContextNode(node) || (node.spec.role === "composition" && Boolean(node.spec.prompt));
  const composerRef = useRef(null);
  const [prompt, setPrompt] = useState(canEditPrompt ? node.spec.prompt : "");
  const [expanded, setExpanded] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [inputAssetPickerOpen, setInputAssetPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resultPickerOpen, setResultPickerOpen] = useState(false);
  const [failureDetailsOpen, setFailureDetailsOpen] = useState(false);
  const [outputSettingsOpen, setOutputSettingsOpen] = useState(false);
  const [outputSettingsPosition, setOutputSettingsPosition] = useState(null);
  const requirements = node.spec.requirements ?? {};

  useEffect(() => {
    setPrompt(canEditPrompt ? node.spec.prompt : "");
  }, [canEditPrompt, node.id, node.specRevision, node.spec]);

  useEffect(() => {
    setExpanded(false);
    setAssetPickerOpen(false);
    setInputAssetPickerOpen(false);
    setHistoryOpen(false);
    setResultPickerOpen(false);
    setFailureDetailsOpen(false);
    setOutputSettingsOpen(false);
    setOutputSettingsPosition(null);
  }, [node.id]);

  useLayoutEffect(() => {
    if (!outputSettingsOpen) {
      setOutputSettingsPosition(null);
      return undefined;
    }
    let frame = 0;
    const syncPosition = () => {
      const viewport = document.querySelector(".canvas-viewport");
      const composer = composerRef.current;
      if (!viewport || !composer) return;
      const viewportRect = viewport.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();
      const quickActionsRect = viewport.querySelector(".node-quick-actions-overlay")?.getBoundingClientRect() ?? null;
      const panelWidth = 236;
      // Image candidates and video timing/audio add their own controls below
      // the shared aspect ratio. Reserve their actual panel height so the
      // popup does not cover a fixed toolbar or node quick actions.
      const panelHeight = kind === "video" ? 304 : 236;
      const margin = 8;
      const composerTop = composerRect.top - viewportRect.top;
      let top = composerTop - panelHeight - margin;
      if (quickActionsRect) {
        const quickTop = quickActionsRect.top - viewportRect.top;
        const quickBottom = quickActionsRect.bottom - viewportRect.top;
        const belowQuick = quickBottom + 2;
        top = belowQuick + panelHeight <= composerTop - margin
          ? belowQuick
          : quickTop - panelHeight - margin;
      }
      const lowerBound = Math.max(margin, viewportRect.height - panelHeight - margin);
      if (top < margin) top = Math.min(lowerBound, composerRect.bottom - viewportRect.top + margin);
      const maxLeft = Math.max(margin, viewportRect.width - panelWidth - margin);
      let left = Math.min(
        maxLeft,
        Math.max(margin, composerRect.right - viewportRect.left - panelWidth - margin),
      );
      // A lower-half video node can have its toolbar above the composer and a
      // header directly above that. In that case, move the setting panel to a
      // free side column instead of covering either fixed control layer.
      if (top < 64) {
        const leftOfComposer = composerRect.left - viewportRect.left - panelWidth - margin;
        if (leftOfComposer >= margin) {
          left = Math.round(leftOfComposer);
          top = Math.min(lowerBound, Math.max(margin, composerTop));
        } else {
          top = Math.min(lowerBound, composerRect.bottom - viewportRect.top + margin);
        }
      }
      const next = { left: Math.round(left), top: Math.round(Math.max(margin, top)) };
      setOutputSettingsPosition((current) => current?.left === next.left && current?.top === next.top ? current : next);
      frame = window.requestAnimationFrame(syncPosition);
    };
    syncPosition();
    return () => window.cancelAnimationFrame(frame);
  }, [kind, outputSettingsOpen]);

  const submitPrompt = (event) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!canEditPrompt || !nextPrompt) return;
    onUpdatePrompt(node.id, nextPrompt);
  };

  if (kind === "output") {
    const incomingNodes = (graph?.edges ?? [])
      .filter((edge) => edge.targetNodeId === node.id)
      .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.sourceNodeId))
      .filter(Boolean);
    const sequence = resolveCompositionShotOrder(graph, node.id);
    const nodesById = new Map((graph?.nodes ?? []).map((candidate) => [candidate.id, candidate]));
    const orderedInputs = sequence.nodeIds.map((nodeId) => nodesById.get(nodeId)).filter(Boolean);
    const readyInputs = incomingNodes.filter((candidate) => candidate.status === "succeeded").length;
    const orderLabel = sequence.status === "empty"
      ? null
      : sequence.status === "ordered" || sequence.status === "single"
        ? `顺序：${orderedInputs.map((candidate) => candidate.title).join(" → ")}`
        : "镜头顺序尚未完整连接";
    return (
      <section className="node-composer node-composer-output nodrag nopan nowheel" aria-label={`${node.title} 参数`}>
        <header className="output-composer-heading">
          <span className="output-composer-icon" aria-hidden="true"><Stack weight="fill" /></span>
          <span><strong>合成输出</strong><small>将上游镜头组织为一个可继续编辑的成片关系。</small></span>
        </header>
        <div className="output-composer-body">
          <strong>{incomingNodes.length === 0 ? "等待连接镜头" : `已接收 ${incomingNodes.length} 个上游节点`}</strong>
          <span>{incomingNodes.length === 0 ? "从镜头右侧端口连接到此节点，即可定义成片输入。" : `其中 ${readyInputs} 个已完成；顺序与依赖会保留在项目文档中。`}</span>
          {orderLabel ? <p>{orderLabel}</p> : null}
        </div>
        <footer className="output-composer-footer">
          <span><LinkSimple weight="regular" aria-hidden="true" />项目内合成关系</span>
          <span>成片渲染将在剪辑工作区接入</span>
        </footer>
      </section>
    );
  }

  if (kind === "text") {
    const incomingNodes = (graph?.edges ?? [])
      .filter((edge) => edge.targetNodeId === node.id)
      .map((edge) => graph.nodes.find((item) => item.id === edge.sourceNodeId))
      .filter(Boolean);
    const incomingPreviewAsset = incomingNodes
      .flatMap((item) => item.outputAssets ?? [])
      .find((asset) => asset.previewUrl) ?? null;
    const connectedCount = graph?.edges.filter((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id).length ?? 0;
    const textComposer = (
      <section
        className={`node-composer node-composer-text nodrag nopan nowheel${expanded ? " composer-expanded" : ""}`}
        onClick={(event) => event.stopPropagation()}
        aria-label={`${node.title} 参数`}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded ? "true" : undefined}
      >
        <form onSubmit={submitPrompt}>
          <button
            className="composer-expand-button"
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "收起参数面板" : "展开参数面板"}
            title={expanded ? "收起" : "展开"}
          >
            {expanded ? <ArrowsInSimple aria-hidden="true" /> : <ArrowsOutSimple aria-hidden="true" />}
          </button>
          {incomingPreviewAsset ? (
            <div className="text-composer-reference" aria-label={`已引用 ${incomingNodes.length} 个上游节点`}>
              <span className="text-composer-reference-thumb">
                <AssetPreview asset={incomingPreviewAsset} alt={`${node.title} 的上游参考素材`} />
              </span>
              <span className="text-composer-reference-count" aria-label={`${incomingNodes.length} 个输入`}>{incomingNodes.length}</span>
            </div>
          ) : null}
          <textarea
            className="text-composer-prompt"
            id={`prompt-${node.id}`}
            aria-label="Prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitPrompt(event);
            }}
            rows="2"
            placeholder="描述这段文字的叙事目标"
          />
          <footer className="text-composer-tools">
            <span className="context-composer-link"><LinkSimple weight="regular" aria-hidden="true" />{connectedCount ? `已连接 ${connectedCount} 项` : "可连接到镜头"}</span>
            <span className="text-composer-spacer" />
            <button
              className="text-composer-submit"
              type="submit"
              disabled={!canEditPrompt || !prompt.trim()}
              aria-label="应用提示词"
            >
              <ArrowUp weight="bold" aria-hidden="true" />
            </button>
          </footer>
        </form>
      </section>
    );
    if (!expanded) return textComposer;
    const portalRoot = typeof document === "undefined" ? null : document.querySelector(".canvas-viewport");
    if (!portalRoot) return textComposer;
    return createPortal(
      <>
        <button className="composer-expanded-backdrop" type="button" aria-label="点击空白处收起参数面板" onClick={() => setExpanded(false)} />
        {textComposer}
      </>,
      portalRoot,
    );
  }

  if (isContextNode(node)) {
    const contextMeta = {
      script: {
        title: "故事脚本",
        description: "定义场景、角色、旁白与镜头节奏。",
        placeholder: "写下这一段的故事、对白或节奏要求",
      },
      character: {
        title: "角色设定",
        description: "为跨镜头一致性记录外观、服装和情绪。",
        placeholder: "描述外观、服装、年龄、表情和连续性约束",
      },
      "scene-style": {
        title: "场景与风格",
        description: "统一场景、光线、色彩、材质和视觉气质。",
        placeholder: "描述环境、时间、光线、色彩与整体风格",
      },
      "asset-reference": {
        title: "素材引用",
        description: "记录本地素材及其在当前创作中的参考用途。",
        placeholder: "描述要引用的本地图片、视频或音频素材",
      },
      "asset-library": {
        title: "素材引用",
        description: "记录本地素材及其在当前创作中的参考用途。",
        placeholder: "描述要引用的本地图片、视频或音频素材",
      },
      "smart-edit": {
        title: "剪辑",
        description: "说明保留内容、节奏和需要调整的段落。",
        placeholder: "描述剪辑目标、保留内容与叙事节奏",
      },
      director: {
        title: "分镜规划",
        description: "把故事意图拆成可执行的镜头安排。",
        placeholder: "描述场景拆分、机位、动作和镜头调度",
      },
      "frame-analysis": {
        title: "视频分析",
        description: "提炼参考视频中的构图、动作和节奏信息。",
        placeholder: "记录参考视频的镜头、构图、动作与节奏",
      },
      audio: {
        title: "音频",
        description: "定义配乐、旁白、环境音和声音设计。",
        placeholder: "描述配乐、旁白、环境音或声音设计",
      },
    }[kind] ?? {
      title: "创作上下文",
      description: "为下游节点提供可编辑的创作约束。",
      placeholder: "描述这份创作上下文",
    };
    const connectedCount = graph?.edges.filter((edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id).length ?? 0;
    const supportsLocalReferences = LOCAL_REFERENCE_CONTEXT_ROLES.has(kind);
    const referenceAssetIds = node.spec.referenceAssetIds ?? [];
    const referencedAssets = referenceAssetIds.map((assetId) => assets.find((asset) => asset.id === assetId)).filter(Boolean);
    const toggleReferenceAsset = (assetId) => {
      if (!onUpdateReferenceAssets) return;
      const nextAssetIds = referenceAssetIds.includes(assetId)
        ? referenceAssetIds.filter((id) => id !== assetId)
        : [...referenceAssetIds, assetId];
      onUpdateReferenceAssets(node.id, nextAssetIds);
    };
    const assetLabel = (asset) => `${asset.kind === "video" ? "视频" : "图片"}素材 ${asset.id.slice(0, 12)}`;
    const contextComposer = (
      <section
        className={`node-composer node-composer-context nodrag nopan nowheel${supportsLocalReferences ? " has-local-references" : ""}${expanded ? " composer-expanded" : ""}`}
        onClick={(event) => event.stopPropagation()}
        aria-label={`${node.title} 参数`}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded ? "true" : undefined}
      >
        <form onSubmit={submitPrompt}>
          <button
            className="composer-expand-button"
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "收起参数面板" : "展开参数面板"}
            title={expanded ? "收起" : "展开"}
          >
            {expanded ? <ArrowsInSimple aria-hidden="true" /> : <ArrowsOutSimple aria-hidden="true" />}
          </button>
          <header className="context-composer-heading">
            <span className={`context-composer-icon context-composer-icon-${kind}`} aria-hidden="true"><NodeLabelIcon kind={kind} /></span>
            <span><strong>{contextMeta.title}</strong><small>{contextMeta.description}</small></span>
          </header>
          <textarea
            className="context-composer-prompt"
            id={`prompt-${node.id}`}
            aria-label="Prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitPrompt(event);
            }}
            rows="3"
            placeholder={contextMeta.placeholder}
          />
          {supportsLocalReferences ? (
            <section className="context-asset-references" aria-label="本地素材引用">
              <div className="context-asset-reference-header">
                <span>本地素材</span>
                <button
                  type="button"
                  onClick={() => setAssetPickerOpen((open) => !open)}
                  disabled={assets.length === 0}
                  aria-expanded={assetPickerOpen}
                  aria-label={assets.length === 0 ? "尚未导入本地素材" : "关联本地素材"}
                >
                  <Plus weight="bold" aria-hidden="true" />关联素材
                </button>
              </div>
              {referencedAssets.length > 0 ? (
                <div className="context-asset-chip-list">
                  {referencedAssets.map((asset) => (
                    <button key={asset.id} type="button" onClick={() => toggleReferenceAsset(asset.id)} aria-label={`移除 ${assetLabel(asset)}`}>
                      <span className={`context-asset-chip-icon context-asset-chip-icon-${asset.kind}`} aria-hidden="true">
                        {asset.kind === "video" ? <VideoCamera weight="fill" /> : <ImageSquare weight="fill" />}
                      </span>
                      <span>{assetLabel(asset)}</span><X aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="context-asset-empty">{assets.length === 0 ? "尚未导入本地素材" : "尚未关联本地素材"}</p>
              )}
              {assetPickerOpen ? (
                <div className="context-asset-picker" role="listbox" aria-label="选择已导入本地素材">
                  {assets.map((asset) => {
                    const selected = referenceAssetIds.includes(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => toggleReferenceAsset(asset.id)}
                      >
                        {asset.kind === "video" ? <VideoCamera weight="fill" aria-hidden="true" /> : <ImageSquare weight="fill" aria-hidden="true" />}
                        <span>{assetLabel(asset)}</span>
                        {selected ? <CheckCircle weight="fill" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}
          <footer className="context-composer-tools">
            <span className="context-composer-link"><LinkSimple weight="regular" aria-hidden="true" />{connectedCount ? `已连接 ${connectedCount} 项` : "可连接到镜头"}</span>
            {kind === "script" && onExpandScript ? (
              <button
                className="context-composer-split"
                type="button"
                onClick={() => onExpandScript(node.id, prompt)}
                aria-label="从脚本创建视频镜头"
                title="从脚本创建视频镜头"
              >
                <FilmSlate weight="regular" aria-hidden="true" />拆成镜头
              </button>
            ) : null}
            <span className="context-composer-spacer" />
            <button
              className="context-composer-submit"
              type="submit"
              disabled={!canEditPrompt || !prompt.trim()}
              aria-label="应用提示词"
            >
              <ArrowUp weight="bold" aria-hidden="true" />
            </button>
          </footer>
        </form>
      </section>
    );
    if (!expanded) return contextComposer;
    const portalRoot = typeof document === "undefined" ? null : document.querySelector(".canvas-viewport");
    if (!portalRoot) return contextComposer;
    return createPortal(
      <>
        <button className="composer-expanded-backdrop" type="button" aria-label="点击空白处收起参数面板" onClick={() => setExpanded(false)} />
        {contextComposer}
      </>,
      portalRoot,
    );
  }

  const outputSpec = kind === "audio" ? `${requirements.voice ?? "coral"} · ${requirements.speed ?? 1}× · ${requirements.mediaType === "audio/mpeg" ? "MP3" : (requirements.mediaType?.split("/")[1] ?? "wav").toUpperCase()}` : kind === "video"
    ? `${requirements.aspectRatio ?? "16:9"} · ${requirements.durationSeconds === undefined ? "自动时长" : `${requirements.durationSeconds} 秒`}`
    : [
        requirements.aspectRatio ?? "16:9",
        requirements.width && requirements.height ? `${requirements.width} × ${requirements.height}` : "默认尺寸",
        ...(requirements.count !== undefined && requirements.count > 1 ? [`${requirements.count} 张`] : []),
      ].join(" · ");
  const outputPreviewAsset = node.outputAssets?.find((asset) => asset.previewUrl) ?? null;
  const currentOutputAssets = node.outputAssets ?? [];
  const inputAssetIds = node.spec.kind === "shot" ? node.spec.inputAssetIds : [];
  const inputAssets = inputAssetIds.map((assetId) => assets.find((asset) => asset.id === assetId)).filter(Boolean);
  const supportedInputAssets = assets.filter(supportsLocalGenerationReference);
  // Preserve any pre-existing unsupported reference long enough for the user
  // to remove it. It stays visible as a compatibility warning instead of being
  // silently dropped from the document.
  const unsupportedSelectedInputAssets = inputAssets.filter((asset) => !supportsLocalGenerationReference(asset));
  const inputPickerAssets = [
    ...supportedInputAssets,
    ...unsupportedSelectedInputAssets.filter((asset) => !supportedInputAssets.some((candidate) => candidate.id === asset.id)),
  ];
  const canManageInputAssets = node.spec.kind === "shot" && kind !== "audio" && Boolean(onUpdateInputAssets);
  const failure = node.status === "failed" ? node.activeJob?.error ?? null : null;
  const generationHistory = node.generationHistory ?? [];
  const historyResults = generationHistory.flatMap((entry) => entry.outputAssets.map((asset, outputIndex) => ({
    ...entry,
    asset,
    outputIndex,
    outputCount: entry.outputAssets.length,
  })));
  const inputAssetLabel = (asset) => `${asset.kind === "video" ? "视频" : "图片"}素材 ${asset.id.slice(0, 12)}`;
  const toggleInputAsset = (asset) => {
    if (!canManageInputAssets) return;
    const selected = inputAssetIds.includes(asset.id);
    if (!selected && !supportsLocalGenerationReference(asset)) return;
    const nextAssetIds = selected
      ? inputAssetIds.filter((id) => id !== asset.id)
      : [...inputAssetIds, asset.id];
    onUpdateInputAssets(node.id, nextAssetIds);
  };
  const useHistoricalOutput = (asset) => {
    if (!canManageInputAssets || inputAssetIds.includes(asset.id) || !supportsLocalGenerationReference(asset)) return;
    onUpdateInputAssets(node.id, [...inputAssetIds, asset.id]);
    setHistoryOpen(false);
  };
  const routeLabel = node.route?.providerId === "mock"
    ? "本地演示"
    : node.route?.modelId ?? "自动路由";
  const canEditOutputSettings = node.spec.kind === "shot" && Boolean(onUpdateRequirements);
  const selectedAspectRatio = requirements.aspectRatio ?? "16:9";
  const selectedImageCount = requirements.count ?? 1;
  const selectedVideoDuration = requirements.durationSeconds ?? null;
  const selectedAudio = requirements.audio ?? "either";
  const supportedAspectRatios = kind === "image" ? IMAGE_ASPECT_RATIOS : VIDEO_ASPECT_RATIOS;
  const updateImageRequirements = (changes) => {
    if (!canEditOutputSettings || kind !== "image") return;
    const nextRequirements = {
      ...requirements,
      ...changes,
      mediaType: requirements.mediaType ?? "image/png",
      audio: "forbidden",
    };
    delete nextRequirements.durationSeconds;
    onUpdateRequirements(node.id, nextRequirements);
  };
  const updateVideoRequirements = (changes) => {
    if (!canEditOutputSettings || kind !== "video") return;
    const nextRequirements = {
      ...requirements,
      ...changes,
      mediaType: requirements.mediaType ?? "video/mp4",
    };
    delete nextRequirements.width;
    delete nextRequirements.height;
    delete nextRequirements.count;
    onUpdateRequirements(node.id, nextRequirements);
  };
  const setImageCount = (count) => {
    if (!canEditOutputSettings || kind !== "image" || !IMAGE_OUTPUT_COUNT_PRESETS.includes(count)) return;
    if (requirements.count === count || (count === 1 && requirements.count === undefined)) return;
    updateImageRequirements({ count });
  };
  const setVideoDuration = (durationSeconds) => {
    if (!canEditOutputSettings || kind !== "video") return;
    if (durationSeconds === null) {
      if (requirements.durationSeconds === undefined) return;
      const nextRequirements = {
        ...requirements,
        mediaType: requirements.mediaType ?? "video/mp4",
      };
      delete nextRequirements.durationSeconds;
      delete nextRequirements.width;
      delete nextRequirements.height;
      delete nextRequirements.count;
      onUpdateRequirements(node.id, nextRequirements);
      return;
    }
    if (requirements.durationSeconds === durationSeconds) return;
    updateVideoRequirements({ durationSeconds });
  };
  const setAspectRatio = (aspectRatio) => {
    if (!canEditOutputSettings || !supportedAspectRatios.includes(aspectRatio)) return;
    const nextRequirements = {
      ...requirements,
      aspectRatio,
      mediaType: requirements.mediaType ?? (kind === "image" ? "image/png" : "video/mp4"),
    };
    if (kind === "image") {
      const preset = IMAGE_OUTPUT_PRESETS[aspectRatio];
      nextRequirements.width = preset.width;
      nextRequirements.height = preset.height;
      nextRequirements.audio = "forbidden";
      delete nextRequirements.durationSeconds;
    } else {
      nextRequirements.audio = requirements.audio ?? "either";
      delete nextRequirements.width;
      delete nextRequirements.height;
      delete nextRequirements.count;
    }
    onUpdateRequirements(node.id, nextRequirements);
  };
  const canvasPortalRoot = typeof document === "undefined" ? null : document.querySelector(".canvas-viewport");
  const outputSettingsPanel = canEditOutputSettings && outputSettingsOpen ? (
    <section
      className="composer-output-settings nodrag nopan nowheel"
      role="dialog"
      aria-label="输出设置"
      style={outputSettingsPosition ?? undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <header>
        <span>输出设置</span>
        <button type="button" aria-label="关闭输出设置" onClick={() => setOutputSettingsOpen(false)}><X weight="bold" aria-hidden="true" /></button>
      </header>
      {kind !== "audio" && <div className="composer-output-setting-group" role="radiogroup" aria-label="画幅">
        <span>画幅</span>
        <div>
          {supportedAspectRatios.map((aspectRatio) => (
            <button
              key={aspectRatio}
              type="button"
              role="radio"
              aria-checked={selectedAspectRatio === aspectRatio}
              className={selectedAspectRatio === aspectRatio ? "active" : ""}
              onClick={() => setAspectRatio(aspectRatio)}
            >
              {aspectRatio}
            </button>
          ))}
        </div>
      </div>
      }
      {kind === "audio" ? (
        <div className="speech-settings">
          <label>音色<select aria-label="音色" value={requirements.voice ?? "coral"} onChange={(event) => onUpdateRequirements(node.id, { ...requirements, voice: event.target.value })}>
            {["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"].map((voice) => <option key={voice}>{voice}</option>)}
          </select></label>
          <label>语速<input aria-label="语速" type="number" min="0.25" max="4" step="0.25" value={requirements.speed ?? 1} onChange={(event) => { const speed = Number(event.target.value); if (speed >= 0.25 && speed <= 4) onUpdateRequirements(node.id, { ...requirements, speed }); }} /></label>
          <label>格式<select aria-label="音频格式" value={requirements.mediaType ?? "audio/wav"} onChange={(event) => onUpdateRequirements(node.id, { ...requirements, mediaType: event.target.value })}><option value="audio/wav">WAV</option><option value="audio/mpeg">MP3</option>{requirements.mediaType && !["audio/wav", "audio/mpeg"].includes(requirements.mediaType) ? <option value={requirements.mediaType}>当前导入格式</option> : null}</select></label>
          <small>文字转语音 · AI 合成声音。生成需从 Codex 或 CLI 执行。</small>
        </div>
      ) : kind === "image" ? (
        <>
          <div className="composer-output-setting-group composer-output-setting-group-count" role="radiogroup" aria-label="数量">
            <span>数量</span>
            <div>
              {IMAGE_OUTPUT_COUNT_PRESETS.map((count) => (
                <button
                  key={count}
                  type="button"
                  role="radio"
                  aria-checked={selectedImageCount === count}
                  className={selectedImageCount === count ? "active" : ""}
                  onClick={() => setImageCount(count)}
                >
                  {count} 张
                </button>
              ))}
            </div>
          </div>
          <div className="composer-output-summary">
            <span>当前约束</span>
            <strong>{`${requirements.width && requirements.height ? `${requirements.width} × ${requirements.height}` : "由本地路由自动选择"} · ${selectedImageCount} 张候选`}</strong>
            <small>多张候选会在一次图像请求中保留为当前节点结果。</small>
          </div>
        </>
      ) : (
        <>
          <div className="composer-output-setting-group composer-output-setting-group-duration" role="radiogroup" aria-label="时长">
            <span>时长</span>
            <div>
              <button
                type="button"
                role="radio"
                aria-checked={selectedVideoDuration === null}
                className={selectedVideoDuration === null ? "active" : ""}
                onClick={() => setVideoDuration(null)}
              >
                自动
              </button>
              {VIDEO_DURATION_PRESETS.map((durationSeconds) => (
                <button
                  key={durationSeconds}
                  type="button"
                  role="radio"
                  aria-checked={selectedVideoDuration === durationSeconds}
                  className={selectedVideoDuration === durationSeconds ? "active" : ""}
                  onClick={() => setVideoDuration(durationSeconds)}
                >
                  {durationSeconds} 秒
                </button>
              ))}
            </div>
          </div>
          <div className="composer-output-setting-group" role="radiogroup" aria-label="音频">
            <span>音频</span>
            <div>
              {VIDEO_AUDIO_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selectedAudio === value}
                  className={selectedAudio === value ? "active" : ""}
                  onClick={() => {
                    if (selectedAudio !== value) updateVideoRequirements({ audio: value });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="composer-output-summary">
            <span>当前约束</span>
            <strong>{`${selectedVideoDuration ?? "自动"}${selectedVideoDuration === null ? "" : " 秒"} · ${selectedAudio === "required" ? "需要音频" : selectedAudio === "forbidden" ? "无音频" : "随提供方"}`}</strong>
            <small>生成前会按已配置的本地路由校验兼容性。</small>
          </div>
        </>
      )}
    </section>
  ) : null;
  const outputSettings = outputSettingsPanel && canvasPortalRoot && outputSettingsPosition
    ? createPortal(outputSettingsPanel, canvasPortalRoot)
    : null;
  const inputAssetPicker = canManageInputAssets && inputAssetPickerOpen && canvasPortalRoot ? createPortal(
    <>
      <button
        className="media-reference-picker-backdrop"
        type="button"
        aria-label="关闭本地参考素材选择"
        onClick={() => setInputAssetPickerOpen(false)}
      />
      <section
        className="media-reference-picker nodrag nopan nowheel"
        role="dialog"
        aria-modal="true"
        aria-label="选择本地参考素材"
        onPointerDownCapture={(event) => event.stopPropagation()}
        onMouseDownCapture={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <span><FolderSimple weight="fill" aria-hidden="true" />本地参考素材</span>
          <button type="button" aria-label="关闭本地参考素材选择" onClick={() => setInputAssetPickerOpen(false)}><X weight="bold" aria-hidden="true" /></button>
        </header>
        <p>当前本地生成只接受 PNG、JPEG 或 WebP 图片作为参考素材；新增文件请使用 CLI 导入。</p>
        {inputPickerAssets.length === 0 ? <div className="media-reference-empty">尚未导入可用的本地图片素材</div> : (
          <div className="media-reference-list" role="listbox" aria-label="可关联的本地参考素材">
            {inputPickerAssets.map((asset) => {
              const selected = inputAssetIds.includes(asset.id);
              const supported = supportsLocalGenerationReference(asset);
              return (
                <button
                  key={asset.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={!supported ? "unsupported" : ""}
                  title={!supported ? "当前本地生成路由不支持该素材格式；可移除已有引用" : undefined}
                  onClick={() => toggleInputAsset(asset)}
                >
                  <span className={`media-reference-kind media-reference-kind-${asset.kind}`} aria-hidden="true">
                    {asset.kind === "video" ? <VideoCamera weight="fill" /> : <ImageSquare weight="fill" />}
                  </span>
                  <span>{inputAssetLabel(asset)}{!supported ? " · 当前路由不支持" : ""}</span>
                  {selected ? <CheckCircle weight="fill" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        )}
        {inputAssets.length > 0 ? <footer>已关联 {inputAssets.length} 个参考素材</footer> : null}
      </section>
    </>,
    canvasPortalRoot,
  ) : null;
  const historyPicker = node.spec.kind === "shot" && historyOpen && canvasPortalRoot ? createPortal(
    <>
      <button className="media-reference-picker-backdrop" type="button" aria-label="关闭节点历史结果" onClick={() => setHistoryOpen(false)} />
      <section className="media-reference-picker node-history-picker nodrag nopan nowheel" role="dialog" aria-modal="true"
        aria-label={`${node.title} 历史结果`} onPointerDown={(event) => event.stopPropagation()}>
        <header><span><Clock aria-hidden="true" />节点结果</span><button type="button" aria-label="关闭节点历史结果" onClick={() => setHistoryOpen(false)}><X /></button></header>
        <p>选择结果用于预览、导出和下游引用；原始生成记录及当前提示词保持不变。</p>
        <div className="node-history-list">
          {[
            ...currentOutputAssets.map((asset) => ({ asset, jobId: node.activeJob?.id, attempt: node.activeJob?.attempt, current: true })),
            ...historyResults,
          ].map((item) => (
            <div key={`${item.jobId}:${item.asset.id}`} className="node-result-choice">
              <span>{item.current ? "当前结果" : `第 ${item.attempt} 次生成`}</span><small>{item.route?.modelId ?? node.route?.modelId ?? "本地输出"}</small>
              <button type="button" disabled={!item.asset.previewUrl || item.asset.missing}
                onClick={() => onOpenPreview?.(node, item.asset)}>预览</button>
              <button type="button" disabled={item.asset.missing || node.status === "running" || node.status === "queued"}
                aria-label={`选择第 ${item.attempt} 次生成的结果`}
                aria-pressed={node.execution.selectedOutputAssetId === item.asset.id}
                onClick={() => { onSelectOutput?.(node.id, item.asset.id); setHistoryOpen(false); }}>设为选中结果</button>
              {canManageInputAssets && supportsLocalGenerationReference(item.asset) ? <button type="button"
                disabled={inputAssetIds.includes(item.asset.id)}
                aria-label={`将第 ${item.attempt} 次生成结果用作参考素材`}
                onClick={() => useHistoricalOutput(item.asset)}>作为参考</button> : null}
            </div>
          ))}
        </div>
        <footer>选择历史结果不会声称当前参数已经生成成功。</footer>
      </section>
    </>,
    canvasPortalRoot,
  ) : null;
  const resultPicker = currentOutputAssets.length > 1 && resultPickerOpen && canvasPortalRoot ? createPortal(
    <>
      <button
        className="media-reference-picker-backdrop"
        type="button"
        aria-label="关闭当前生成结果"
        onClick={() => setResultPickerOpen(false)}
      />
      <section
        className="media-reference-picker node-history-picker nodrag nopan nowheel"
        role="dialog"
        aria-modal="true"
        aria-label={`${node.title} 当前生成结果`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <span><ImageSquare weight="fill" aria-hidden="true" />当前结果</span>
          <button type="button" aria-label="关闭当前生成结果" onClick={() => setResultPickerOpen(false)}><X weight="bold" aria-hidden="true" /></button>
        </header>
        <p>本次生成保留了 {currentOutputAssets.length} 个项目内候选。选择一个即可打开预览，不会改写镜头参数。</p>
        <div className="node-history-list" role="list" aria-label="当前生成候选">
          {currentOutputAssets.map((asset, outputIndex) => (
            <button
              key={`${asset.id}:${outputIndex}`}
              type="button"
              disabled={asset.missing || !asset.previewUrl}
              aria-label={`预览第 ${outputIndex + 1} 个当前结果`}
              title={asset.missing || !asset.previewUrl ? "本地项目中找不到该生成结果" : `预览第 ${outputIndex + 1} 个当前结果`}
              onClick={() => {
                onOpenPreview?.(node, asset);
                setResultPickerOpen(false);
              }}
            >
              {asset.previewUrl ? (
                <AssetPreview asset={asset} alt="" />
              ) : (
                <span className={`node-history-kind node-history-kind-${asset.kind}`} aria-hidden="true">
                  {asset.kind === "video" ? <VideoCamera weight="fill" /> : <ImageSquare weight="fill" />}
                </span>
              )}
              <span className="node-history-copy">
                <strong>结果 {outputIndex + 1}</strong>
                <small>{node.route?.modelId ?? "本地输出"}</small>
              </span>
              <ArrowsOutSimple aria-hidden="true" />
            </button>
          ))}
        </div>
        <footer>候选结果保存在当前项目内，可作为后续镜头的本地参考素材。</footer>
      </section>
    </>,
    canvasPortalRoot,
  ) : null;
  const failureDetails = failure && failureDetailsOpen && canvasPortalRoot ? createPortal(
    <>
      <button
        className="media-reference-picker-backdrop"
        type="button"
        aria-label="关闭失败详情"
        onClick={() => setFailureDetailsOpen(false)}
      />
      <section className="media-reference-picker node-failure-picker nodrag nopan nowheel" role="dialog" aria-modal="true" aria-label="失败详情" onClick={(event) => event.stopPropagation()}>
        <header>
          <span><WarningCircle weight="fill" aria-hidden="true" />生成失败</span>
          <button type="button" aria-label="关闭失败详情" onClick={() => setFailureDetailsOpen(false)}><X weight="bold" aria-hidden="true" /></button>
        </header>
        <p className="node-failure-message">{failure.message || "生成服务未返回可用结果。"}</p>
        <dl className="node-failure-meta">
          <div><dt>错误类型</dt><dd>{failure.code ?? "provider_protocol"}</dd></div>
          <div><dt>下一步</dt><dd>{failure.retryable ? "检查本地配置后可在 Codex 或 CLI 中重试。" : "调整当前 Prompt 或输出要求后，再从 Codex 或 CLI 重新生成。"}</dd></div>
        </dl>
      </section>
    </>,
    canvasPortalRoot,
  ) : null;

  const mediaComposer = (
    <section
      ref={composerRef}
      className={`node-composer node-composer-media nodrag nopan nowheel${expanded ? " composer-expanded" : ""}`}
      onClick={(event) => event.stopPropagation()}
      aria-label={`${node.title} 参数`}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? "true" : undefined}
    >
      <form onSubmit={submitPrompt}>
        <button
          className="composer-expand-button"
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "收起参数面板" : "展开参数面板"}
          title={expanded ? "收起" : "展开"}
        >
          {expanded ? <ArrowsInSimple aria-hidden="true" /> : <ArrowsOutSimple aria-hidden="true" />}
        </button>
        <div className="composer-input-row">
          {outputPreviewAsset ? (
            <span className="composer-media-reference" aria-label="当前素材">
              <AssetPreview asset={outputPreviewAsset} alt={`${node.title} 当前素材`} />
            </span>
          ) : (
            <span className={`composer-type composer-type-${kind}`} aria-hidden="true"><NodeLabelIcon kind={kind} /></span>
          )}
          {canEditPrompt ? (
            <textarea
              id={`prompt-${node.id}`}
              aria-label="Prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitPrompt(event);
              }}
              rows="2"
              placeholder={kind === "audio" ? "输入需要朗读的文字" : "描述主体、动作与镜头语言"}
            />
          ) : (
            <p>将上游镜头组合为一个可继续编辑的片段。</p>
          )}
        </div>
        <footer className="composer-tools composer-tools-media">
          <div className="composer-settings-group">
            {node.status !== "queued" && node.status !== "running" && (node.status === "succeeded" || node.status === "failed") ? <button type="button" className="composer-readout" aria-label="准备重新生成" onClick={() => onResetGeneration?.(node.id)}><ArrowClockwise />重新生成</button> : null}
            <span className="composer-readout composer-route"><Sparkle weight="fill" aria-hidden="true" /><span>{routeLabel}</span></span>
            <span className="composer-divider" />
            {failure ? (
              <button
                className={`composer-readout composer-error-trigger${failureDetailsOpen ? " active" : ""}`}
                type="button"
                aria-label="查看失败原因"
                aria-expanded={failureDetailsOpen}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setInputAssetPickerOpen(false);
                  setHistoryOpen(false);
                  setResultPickerOpen(false);
                  setOutputSettingsOpen(false);
                  setFailureDetailsOpen((open) => !open);
                }}
              >
                <WarningCircle weight="fill" aria-hidden="true" /><span>失败原因</span>
              </button>
            ) : null}
            {failure ? <span className="composer-divider" /> : null}
            {canManageInputAssets ? (
              <button
                className={`composer-readout composer-input-assets-trigger${inputAssetPickerOpen ? " active" : ""}`}
                type="button"
                aria-label={inputAssetIds.length > 0 ? `管理本地参考素材，已关联 ${inputAssetIds.length} 个` : "关联本地参考素材"}
                aria-expanded={inputAssetPickerOpen}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setOutputSettingsOpen(false);
                  setHistoryOpen(false);
                  setResultPickerOpen(false);
                  setFailureDetailsOpen(false);
                  setInputAssetPickerOpen((open) => !open);
                }}
              >
                <FolderSimple weight="regular" aria-hidden="true" /><span>{inputAssetIds.length > 0 ? `${inputAssetIds.length} 个参考素材` : "参考素材"}</span>
              </button>
            ) : null}
            {node.spec.kind === "shot" && (historyResults.length > 0 || currentOutputAssets.length > 0) ? <span className="composer-divider" /> : null}
            {node.spec.kind === "shot" && (historyResults.length > 0 || currentOutputAssets.length > 0) ? (
              <button
                className={`composer-readout composer-history-trigger${historyOpen ? " active" : ""}`}
                type="button"
                aria-label={generationHistory.length > 0 ? `查看 ${generationHistory.length} 项历史结果` : "查看节点结果"}
                aria-expanded={historyOpen}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setInputAssetPickerOpen(false);
                  setFailureDetailsOpen(false);
                  setResultPickerOpen(false);
                  setOutputSettingsOpen(false);
                  setHistoryOpen((open) => !open);
                }}
                title={`查看 ${generationHistory.length} 项历史结果`}
              >
                <Clock weight="regular" aria-hidden="true" /><span>{generationHistory.length || "结果"}</span>
              </button>
            ) : null}
            {currentOutputAssets.length > 1 ? <span className="composer-divider" /> : null}
            {currentOutputAssets.length > 1 ? (
              <button
                className={`composer-readout composer-history-trigger${resultPickerOpen ? " active" : ""}`}
                type="button"
                aria-label={`查看本次生成的 ${currentOutputAssets.length} 个结果`}
                aria-expanded={resultPickerOpen}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setInputAssetPickerOpen(false);
                  setHistoryOpen(false);
                  setFailureDetailsOpen(false);
                  setOutputSettingsOpen(false);
                  setResultPickerOpen((open) => !open);
                }}
                title={`查看本次生成的 ${currentOutputAssets.length} 个结果`}
              >
                <ImageSquare weight="regular" aria-hidden="true" /><span>{currentOutputAssets.length}</span>
              </button>
            ) : null}
            {canManageInputAssets ? <span className="composer-divider" /> : null}
            {canEditOutputSettings ? (
              <button
                className={`composer-readout composer-output-spec composer-output-settings-trigger${outputSettingsOpen ? " active" : ""}`}
                type="button"
                aria-label="打开输出设置"
                aria-expanded={outputSettingsOpen}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setInputAssetPickerOpen(false);
                  setHistoryOpen(false);
                  setResultPickerOpen(false);
                  setFailureDetailsOpen(false);
                  setOutputSettingsOpen((open) => !open);
                }}
              >
                <Rectangle weight="regular" aria-hidden="true" /><span>{outputSpec}</span><CaretDown weight="bold" aria-hidden="true" />
              </button>
            ) : <span className="composer-readout composer-output-spec"><Rectangle weight="regular" aria-hidden="true" /><span>{outputSpec}</span></span>}
          </div>
          <button
            className="composer-submit"
            type="submit"
            disabled={!canEditPrompt || !prompt.trim()}
            aria-label="应用提示词"
          >
            <ArrowUp weight="bold" aria-hidden="true" />
          </button>
        </footer>
      </form>
    </section>
  );

  if (!expanded) return <>{mediaComposer}{outputSettings}{inputAssetPicker}{historyPicker}{resultPicker}{failureDetails}</>;
  if (!canvasPortalRoot) return <>{mediaComposer}{outputSettings}{inputAssetPicker}{historyPicker}{resultPicker}{failureDetails}</>;
  return <>
    {createPortal(
      <>
        <button className="composer-expanded-backdrop" type="button" aria-label="点击空白处收起参数面板" onClick={() => setExpanded(false)} />
        {mediaComposer}
      </>,
      canvasPortalRoot,
    )}
    {outputSettings}{inputAssetPicker}{historyPicker}{resultPicker}{failureDetails}
  </>;
}

function CanvasHandle({ id, type, position, label, className = "" }) {
  return (
    <Handle
      id={id}
      className={`canvas-handle ${className}`}
      type={type}
      position={position}
      role="button"
      tabIndex={-1}
      aria-label={label}
    >
      <span className={`canvas-handle-hit-area canvas-handle-hit-area-${position}`}>
        <span className="canvas-handle-visual" aria-hidden="true"><Plus weight="bold" /></span>
      </span>
    </Handle>
  );
}

function NodeQuickActions({ kind, node, className = "", style, openMenu = null, onOpenMenuChange, onCreateVariation, onOpenPreview }) {
  if (kind !== "image" && kind !== "video") return null;
  const sourceAsset = node.selectedOutputAsset ?? node.outputAssets?.find((asset) => asset.previewUrl) ?? null;
  const hasOutput = Boolean(node.selectedOutputAsset) || node.execution?.outputAssetIds?.length > 0;
  const releasePointerFocus = (event) => {
    if (event.detail === 0) return;
    const button = event.currentTarget;
    window.requestAnimationFrame(() => button.blur());
  };
  const menus = {
    高清: {
      label: "图像编辑操作",
      variant: "compact",
      items: [
        { label: "高清", icon: HighDefinition, instruction: "提高画面清晰度，并保持原始构图和主体。" },
        { label: "扩图", icon: CornersOut, instruction: "向画面边缘扩展环境，同时保持主体与透视连续。" },
        { label: "重绘", icon: PencilSimple, instruction: "根据新的编辑意图重绘画面，同时保留关键主体。" },
        { label: "擦除", icon: Eraser, instruction: "移除指定干扰元素，并自然补全背景。" },
        { label: "抠图", icon: Scissors, instruction: "提取主体并生成干净的可编辑主体版本。" },
        { label: "裁剪", icon: Crop, instruction: "重新裁剪构图，保留叙事主体和视觉重心。" },
      ],
    },
    九宫格: {
      label: "分镜变体操作",
      variant: "grid",
      items: [
        { label: "多机位九宫格", icon: GridFour, instruction: "基于当前素材生成多机位九宫格分镜。" },
        { label: "剧情推演四宫格", icon: GridFour, instruction: "基于当前画面推演连续的四格剧情。" },
        { label: "角色脸部三视图", icon: Crosshair, instruction: "生成角色脸部的正面、侧面与三分之二视图。" },
        { label: "角色设定图", icon: UserCircle, instruction: "生成用于一致性参考的角色设定图。" },
        { label: "场景设定图", icon: Stack, instruction: "生成当前世界观的场景设定图。" },
        { label: "25宫格连贯分镜", icon: GridFour, instruction: "生成二十五格连续分镜，保持动作与光线连贯。" },
      ],
    },
    宫格切分: {
      label: "宫格切分操作",
      variant: "split",
      items: [
        { label: "4宫格 (2×2)", instruction: "将当前画面拆解为 2×2 连贯分镜。" },
        { label: "9宫格 (3×3)", instruction: "将当前画面拆解为 3×3 连贯分镜。" },
        { label: "16宫格 (4×4)", instruction: "将当前画面拆解为 4×4 连贯分镜。" },
        { label: "25宫格 (5×5)", instruction: "将当前画面拆解为 5×5 连贯分镜。" },
      ],
    },
    portrait: {
      label: "人像编辑操作",
      variant: "portrait",
      items: [
        { label: "人像调节", icon: User, instruction: "优化人物皮肤、发丝和服装质感，同时保持身份一致。" },
        { label: "情绪调节", icon: Smiley, instruction: "调整人物表情与情绪，同时保持角色身份和构图。" },
      ],
    },
  };
  const directActions = kind === "image"
    ? [
      { label: "全景", icon: IconPanoramaHorizontal, instruction: "扩展为更宽阔的全景镜头，保持原始场景结构。" },
      { label: "多角度", icon: Atom, instruction: "基于同一主体生成一个新的镜头角度。" },
      { label: "打光", icon: IconSunset2, instruction: "调整光线方向、强度和氛围，同时保持主体不变。" },
    ]
    : [
      { label: "运动", icon: Sparkle, instruction: "保持当前画面内容，重新设计镜头运动和节奏。" },
      { label: "多角度", icon: Atom, instruction: "基于同一主体生成一个新的运动镜头角度。" },
      { label: "打光", icon: IconSunset2, instruction: "调整视频的光线、曝光和氛围，同时保持动作连续。" },
    ];
  const runOperation = (operation, event) => {
    event.stopPropagation();
    if (!hasOutput) return;
    onCreateVariation?.(node.id, operation);
    onOpenMenuChange?.(null);
    releasePointerFocus(event);
  };
  const focusPrompt = (event) => {
    event.stopPropagation();
    document.getElementById(`prompt-${node.id}`)?.focus();
    releasePointerFocus(event);
  };
  const downloadOutput = (event) => {
    event.stopPropagation();
    if (!sourceAsset?.previewUrl) return;
    const link = document.createElement("a");
    link.href = sourceAsset.previewUrl;
    link.download = node.title || "open-canvas-output";
    document.body.appendChild(link);
    link.click();
    link.remove();
    releasePointerFocus(event);
  };
  const renderAction = (action) => {
    const menu = menus[action.label];
    const isOpen = openMenu === action.label;
    const Icon = action.icon;
    return (
      <span className="quick-action-menu-anchor" key={action.label}>
        <button
          className={`quick-action${isOpen ? " active" : ""}`}
          type="button"
          aria-label={action.label}
          aria-expanded={menu ? isOpen : undefined}
          aria-haspopup={menu ? "menu" : undefined}
          disabled={!hasOutput}
          onClick={(event) => {
            event.stopPropagation();
            if (menu) onOpenMenuChange?.(isOpen ? null : action.label);
            else runOperation(action, event);
            releasePointerFocus(event);
          }}
        >
          <Icon weight="regular" aria-hidden="true" />
          <span>{action.label}</span>
          {menu ? <CaretRight className="quick-caret" weight="bold" aria-hidden="true" /> : null}
        </button>
        {menu && isOpen ? (
          <span className={`quick-action-submenu quick-action-submenu-${menu.variant}`} role="presentation">
            <span className="quick-action-submenu-inner" role="menu" aria-label={menu.label}>
              {menu.items.map(({ label, icon: ItemIcon, instruction }) => (
                <button key={label} type="button" role="menuitem" disabled={!hasOutput} onClick={(event) => runOperation({ label, instruction }, event)}>
                  {ItemIcon ? <ItemIcon weight="regular" aria-hidden="true" /> : null}
                  <span>{label}</span>
                </button>
              ))}
            </span>
          </span>
        ) : null}
      </span>
    );
  };
  const portraitMenuOpen = openMenu === "portrait";

  return (
    <div className={`node-quick-actions nodrag nopan nowheel ${className}`} style={style} aria-label={`${node.title} 可生成编辑变体`} onPointerDown={(event) => event.stopPropagation()}>
      {kind === "image" ? (
        <span className="quick-action-menu-anchor">
          <button className={`quick-person-action${portraitMenuOpen ? " active" : ""}`} type="button" aria-label="人像质感调节" aria-expanded={portraitMenuOpen} aria-haspopup="menu" disabled={!hasOutput} onClick={(event) => { event.stopPropagation(); onOpenMenuChange?.(portraitMenuOpen ? null : "portrait"); releasePointerFocus(event); }}>
            <User weight="regular" aria-hidden="true" /><span>人像质感</span><CaretRight className="quick-caret" weight="bold" aria-hidden="true" />
          </button>
          {portraitMenuOpen ? (
            <span className="quick-action-submenu quick-action-submenu-portrait" role="presentation">
              <span className="quick-action-submenu-inner" role="menu" aria-label={menus.portrait.label}>
                {menus.portrait.items.map(({ label, icon: ItemIcon, instruction }) => <button key={label} type="button" role="menuitem" disabled={!hasOutput} onClick={(event) => runOperation({ label, instruction }, event)}><ItemIcon weight="regular" aria-hidden="true" /><span>{label}</span></button>)}
              </span>
            </span>
          ) : null}
        </span>
      ) : null}
      {directActions.map(renderAction)}
      {renderAction({ label: "九宫格", icon: GridNine })}
      {renderAction({ label: "高清", icon: IconBadgeHd })}
      {renderAction({ label: "宫格切分", icon: HashStraight })}
      <span className="quick-actions-divider" />
      <button type="button" aria-label="编辑当前镜头" disabled={!hasOutput} onClick={focusPrompt}><PencilSimple aria-hidden="true" /></button>
      <button type="button" aria-label="创建编辑变体" disabled={!hasOutput} onClick={(event) => runOperation({ label: "编辑变体", instruction: "基于当前素材创建一个可继续编辑的镜头变体。" }, event)}><Sparkle aria-hidden="true" /></button>
      <button type="button" aria-label="下载当前素材" disabled={!sourceAsset} onClick={downloadOutput}><DownloadSimple aria-hidden="true" /></button>
      <button type="button" aria-label="预览" disabled={!sourceAsset} onClick={(event) => { event.stopPropagation(); if (sourceAsset) onOpenPreview?.(node, sourceAsset); releasePointerFocus(event); }}><ArrowsOutSimple aria-hidden="true" /></button>
    </div>
  );
}

function CanvasEdge({ id, sourceX, sourceY, targetX, targetY, className, data }) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Right,
    targetX,
    targetY,
    targetPosition: Position.Left,
  });
  const active = Boolean(data?.active);
  return (
    <>
      <BaseEdge id={id} path={edgePath} className={className} />
      {active ? [0, 1, 2].map((index) => (
        <path key={index} className="canvas-edge-flow" data-flow-index={index} d={edgePath} pathLength="100" aria-hidden="true" />
      )) : null}
    </>
  );
}

function CanvasNode({ data, selected }) {
  const {
    nodeSize,
    flowNodeSize = nodeSize,
    presentationScale = 1,
    node,
    graph,
    onOpenPreview,
    onFocusNode,
    onUpdatePrompt,
    onUpdateReferenceAssets,
    onUpdateInputAssets,
    onUpdateRequirements,
    onSelectOutput,
    onResetGeneration,
    onExpandScript,
    assets,
    viewportZoom = DEFAULT_CANVAS_ZOOM,
    composerPosition = Position.Bottom,
    composerAlign = "center",
    primarySelected = selected,
  } = data;
  const kind = getSurfaceKind(node);
  const requirements = node.spec.requirements ?? {};
  const operationNode = node.kind === "composition"
    && (node.spec.role ?? "composition") === "composition"
    && node.spec.mediaType?.startsWith("image/");
  const resolutionLabel = kind === "image" && requirements.width && requirements.height
    ? `${requirements.width} × ${requirements.height}`
    : requirements.aspectRatio ?? "16:9";

  return (
    <article
      className={`canvas-node canvas-node-${kind} ${selected ? "selected" : ""}${primarySelected ? " primary-selected" : ""}`}
      style={{
        "--node-width": `${nodeSize.width}px`,
        "--node-frame-height": `${nodeSize.frameHeight}px`,
        "--node-height": `${nodeSize.height}px`,
        "--node-display-scale": presentationScale,
        width: `${flowNodeSize.width}px`,
        height: `${flowNodeSize.height}px`,
      }}
      data-node-id={node.id}
      data-node-kind={kind}
      data-node-shape={nodeSize.shape}
      data-node-status={node.status}
    >
      <CanvasHandle id={HANDLE_IDS.input} type="target" position={Position.Left} label="连接输入" />
      <CanvasHandle id={HANDLE_IDS.output} type="source" position={Position.Right} label="连接输出" />

      <div className="canvas-node-content">
        <div className="node-label" aria-hidden="true">
          <NodeLabelIcon kind={kind} />
          <span>{node.title}</span>
          {kind === "text" ? <span className="node-label-info" title="输入已更新"><Info weight="regular" aria-hidden="true" /></span> : null}
          {(kind === "image" || kind === "video") && !operationNode ? <small>{resolutionLabel}</small> : null}
        </div>

        <div
          className="node-frame"
          role="button"
          tabIndex="0"
          aria-pressed={selected}
          aria-label={`${node.title}，${node.statusMeta.label}`}
          onPointerDown={(event) => {
            if (!event.pointerType) return;
            const frame = event.currentTarget;
            window.requestAnimationFrame(() => frame.blur());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onFocusNode(node.id);
            }
          }}
        >
          <NodeMedia node={node} kind={kind} onFocusNode={onFocusNode} onOpenPreview={onOpenPreview} />
        </div>

        {primarySelected ? (
          <NodeToolbar
            className={`node-composer-toolbar node-composer-toolbar-${composerAlign}`}
            isVisible
            position={composerPosition}
            offset={16 * viewportZoom}
            align={composerAlign}
          >
            <NodeComposer
              node={node}
              kind={kind}
              graph={graph}
              assets={assets}
              onOpenPreview={onOpenPreview}
              onUpdatePrompt={onUpdatePrompt}
              onUpdateReferenceAssets={onUpdateReferenceAssets}
              onUpdateInputAssets={onUpdateInputAssets}
              onUpdateRequirements={onUpdateRequirements}
              onSelectOutput={onSelectOutput}
              onResetGeneration={onResetGeneration}
              onExpandScript={onExpandScript}
            />
          </NodeToolbar>
        ) : null}
      </div>
    </article>
  );
}

function CanvasGroupFrame({ data }) {
  const group = data.group;
  const memberCount = data.groupBounds?.memberNodeIds?.length ?? 0;
  const title = group?.title || `分组 ${memberCount} 个节点`;
  return (
    <section
      className={`canvas-layout-group ${data.groupSelected ? "selected" : ""}`}
      style={{ "--group-display-scale": data.presentationScale ?? 1 }}
      aria-label={`${title}，${memberCount} 个节点`}
      data-group-id={group?.id}
    >
      <span className="canvas-layout-group-label"><Stack weight="regular" aria-hidden="true" />{title}</span>
    </section>
  );
}

const NODE_TYPES = { creatorNode: CanvasNode, groupFrame: CanvasGroupFrame };
const EDGE_TYPES = { canvasEdge: CanvasEdge };

function CanvasAddMenu({ open, onClose, onAddNode }) {
  const firstItemRef = useRef(null);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  if (!open) return null;
  const addAndClose = (descriptor) => {
    onAddNode(descriptor);
    onClose();
  };
  return (
    <div className="canvas-add-menu" role="menu" aria-label="添加画布节点" data-canvas-control>
      <p className="add-menu-heading">基础节点</p>
      <div className="add-menu-list">
        <button ref={firstItemRef} type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "text" })}><TextAlignLeft aria-hidden="true" /><span>文本提示</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "shot", mediaKind: "image" })}><ImageSquare aria-hidden="true" /><span>图像镜头</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "shot", mediaKind: "video" })}><VideoCamera aria-hidden="true" /><span>视频镜头</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "shot", mediaKind: "audio" })}><SpeakerHigh aria-hidden="true" /><span>音频</span></button>
      </div>

    </div>
  );
}

function ShortcutSheet({ onClose }) {
  const scrollRef = useRef(null);
  const [scrollMetrics, setScrollMetrics] = useState({ clientHeight: 0, scrollHeight: 0, scrollTop: 0 });
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const primaryKey = isMac ? "⌘" : "Ctrl";
  const shiftKey = isMac ? "⇧" : "Shift";
  const groups = [
    {
      title: "画布",
      rows: [
        { label: "选择工具", keys: ["V"] },
        { label: "抓手工具", keys: ["H"] },
        { label: "添加节点", keys: ["N"] },
        { label: "整理画布", keys: ["Alt", "Shift", "F"] },
        { label: "移动画布", keys: ["空白处 / 空格", "拖动 / 双指滑动"] },
        { label: "拖动节点", keys: ["节点", "拖动"] },
        { label: "框选多个节点", keys: [shiftKey, "空白处", "拖动"] },
        { label: "追加节点选择", keys: [primaryKey, "点击节点"] },
        { label: "建立连接", keys: ["端口", "拖到端口"] },
      ],
    },
    {
      title: "缩放",
      rows: [
        { label: "放大", keys: [{ icon: "plus", label: "+" }] },
        { label: "缩小", keys: [{ icon: "minus", label: "−" }] },
        { label: "适应画布", keys: ["0"] },
        { label: "缩放手势", keys: [primaryKey, "滚轮 / 双指捏合"] },
      ],
    },
    {
      title: "编辑",
      rows: [
        { label: "撤销", keys: [primaryKey, "Z"] },
        { label: "重做", keys: [primaryKey, shiftKey, "Z"] },
        { label: "复制选中节点", keys: [primaryKey, "C"] },
        { label: "粘贴节点组", keys: [primaryKey, "V"] },
        { label: "将选中节点分组", keys: [primaryKey, "G"] },
        { label: "快速复制主选节点", keys: [primaryKey, "D"] },
        { label: "删除选中节点或连线", keys: ["Delete"] },
      ],
    },
  ];

  const renderKey = (key) => {
    if (typeof key === "string") return key;
    if (key.icon === "plus") return <Plus weight="regular" aria-label={key.label} />;
    return <Minus weight="regular" aria-label={key.label} />;
  };

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const sync = () => setScrollMetrics({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    });
    sync();
    element.addEventListener("scroll", sync, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", sync);
      observer?.disconnect();
    };
  }, []);

  const scrollable = scrollMetrics.scrollHeight > scrollMetrics.clientHeight + 1;
  const visibleRatio = scrollable ? scrollMetrics.clientHeight / scrollMetrics.scrollHeight : 1;
  const progress = scrollable ? scrollMetrics.scrollTop / (scrollMetrics.scrollHeight - scrollMetrics.clientHeight) : 0;

  return (
    <section className="dock-shortcut-sheet" role="dialog" aria-label="快捷键" data-canvas-control>
      <button className="shortcut-close" type="button" onClick={onClose} aria-label="关闭快捷键"><X aria-hidden="true" /></button>
      <div className="shortcut-columns" ref={scrollRef}>
        {groups.map((group) => (
          <section key={group.title}>
            <h2>{group.title}</h2>
            {group.rows.map((row) => (
              <div key={`${group.title}-${row.label}`}>
                <span>{row.label}</span>
                <span className="shortcut-keyset">
                  {row.keys.map((key) => (
                    <kbd className={typeof key === "string" ? "" : "shortcut-icon-key"} key={`${row.label}-${typeof key === "string" ? key : key.label}`}>{renderKey(key)}</kbd>
                  ))}
                  {row.suffix ? <span className="shortcut-key-suffix">{row.suffix}</span> : null}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
      {scrollable ? (
        <div className="shortcut-scroll-rail" aria-hidden="true">
          <span className="shortcut-scroll-track">
            <span className="shortcut-scroll-thumb" style={{ height: `${visibleRatio * 100}%`, transform: `translateY(${progress * (1 / visibleRatio - 1) * 100}%)` }} />
          </span>
          <CaretRight className="shortcut-scroll-end" weight="fill" />
        </div>
      ) : null}
    </section>
  );
}

function CanvasDock({
  tool,
  onToolChange,
  onAddNode,
  addMenuOpen,
  onAddMenuOpenChange,
  onArrange,
  canCreateGroup,
  onCreateGroup,
  showEdges,
  onToggleEdges,
  snapToGrid,
  onToggleSnap,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}) {
  const [openPanel, setOpenPanel] = useState(null);
  const releasePointerFocus = (event) => {
    if (event.detail === 0) return;
    const button = event.currentTarget;
    window.requestAnimationFrame(() => button.blur());
  };
  const togglePanel = (panel, event) => {
    onAddMenuOpenChange(false);
    setOpenPanel((current) => current === panel ? null : panel);
    releasePointerFocus(event);
  };
  const closePanel = () => setOpenPanel(null);
  const chooseTool = (nextTool, event) => {
    onToolChange(nextTool);
    setOpenPanel(null);
    releasePointerFocus(event);
  };

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      onAddMenuOpenChange(false);
      setOpenPanel(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onAddMenuOpenChange]);

  return (
    <>
      <CanvasAddMenu open={addMenuOpen} onClose={() => onAddMenuOpenChange(false)} onAddNode={onAddNode} />
      {openPanel === "shortcuts" ? <ShortcutSheet onClose={closePanel} /> : null}
      <div className="canvas-dock" role="toolbar" aria-label="画布工具" data-canvas-control>
        <button className={`dock-add ${addMenuOpen ? "active" : ""}`} type="button" onClick={(event) => { setOpenPanel(null); onAddMenuOpenChange(!addMenuOpen); releasePointerFocus(event); }} aria-expanded={addMenuOpen} aria-label={addMenuOpen ? "关闭添加菜单" : "添加节点"} data-tooltip={addMenuOpen ? "关闭添加菜单" : "添加节点 (N)"}>{addMenuOpen ? <X weight="bold" aria-hidden="true" /> : <Plus weight="bold" aria-hidden="true" />}</button>
        <span className="dock-tool-anchor">
          <button
            className={openPanel === "move" ? "active" : ""}
            type="button"
            onClick={(event) => togglePanel("move", event)}
            aria-expanded={openPanel === "move"}
            aria-haspopup="menu"
            aria-pressed={tool === "pan"}
            aria-label="移动"
            data-tooltip={openPanel === "move" ? undefined : "移动工具"}
          >
            {tool === "pan" ? <Hand weight="regular" aria-hidden="true" /> : <Cursor weight="regular" aria-hidden="true" />}
          </button>
          {openPanel === "move" ? (
            <span className="dock-tool-menu" role="menu" aria-label="移动工具">
              <button className={tool === "select" ? "active" : ""} type="button" role="menuitem" onClick={(event) => chooseTool("select", event)}><Cursor weight="regular" aria-hidden="true" /><span>移动</span><kbd>V</kbd></button>
              <button className={tool === "pan" ? "active" : ""} type="button" role="menuitem" onClick={(event) => chooseTool("pan", event)}><Hand weight="regular" aria-hidden="true" /><span>抓手工具</span><kbd>H</kbd></button>
            </span>
          ) : null}
        </span>
        <span className="dock-divider" />
        <button type="button" onClick={(event) => { onArrange(); releasePointerFocus(event); }} aria-label="自动整理画布" data-tooltip="整理画布"><IconLayoutDashboard aria-hidden="true" /></button>
        <button type="button" onClick={(event) => { onCreateGroup?.(); releasePointerFocus(event); }} disabled={!canCreateGroup} aria-label="将选中节点分组" data-tooltip="将选中节点分组 (⌘G)"><Rectangle aria-hidden="true" /></button>
        <button className={!showEdges ? "active" : ""} type="button" onClick={(event) => { onToggleEdges(); releasePointerFocus(event); }} aria-pressed={!showEdges} aria-label="切换节点连线" data-tooltip={showEdges ? "隐藏节点连线" : "显示节点连线"}><IconRoute aria-hidden="true" /></button>
        <button className={snapToGrid ? "active" : ""} type="button" onClick={(event) => { onToggleSnap(); releasePointerFocus(event); }} aria-pressed={snapToGrid} aria-label="切换网格吸附" data-tooltip="网格吸附"><LinkSimple weight="regular" aria-hidden="true" /></button>
        <span className="dock-divider" />
        <button type="button" onClick={(event) => { onUndo(); releasePointerFocus(event); }} disabled={!canUndo} aria-label="撤销" data-tooltip="撤销 (⌘Z)"><ArrowCounterClockwise aria-hidden="true" /></button>
        <button type="button" onClick={(event) => { onRedo(); releasePointerFocus(event); }} disabled={!canRedo} aria-label="重做" data-tooltip="重做 (⇧⌘Z)"><ArrowClockwise aria-hidden="true" /></button>
        <span className="dock-divider" />
        <button className={openPanel === "shortcuts" ? "active" : ""} type="button" onClick={(event) => togglePanel("shortcuts", event)} aria-label="快捷键与帮助" data-tooltip="快捷键与帮助"><TablerKeyboard aria-hidden="true" /></button>
      </div>
    </>
  );
}

function ZoomOptions({ open, zoom, onClose, onFit, onZoomIn, onZoomOut, onSetZoom }) {
  const [inputValue, setInputValue] = useState(() => String(Math.round(zoom * 100)));
  const runPointerAction = (event, action) => {
    const button = event.currentTarget;
    action();
    if (event.detail !== 0) window.requestAnimationFrame(() => button.blur());
  };

  useEffect(() => {
    setInputValue(String(Math.round(zoom * 100)));
  }, [zoom]);

  const commitInputZoom = () => {
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setInputValue(String(Math.round(zoom * 100)));
      return;
    }
    onSetZoom(Math.min(800, Math.max(10, parsed)) / 100);
  };

  if (!open) return null;
  return (
    <div className="canvas-zoom-options" role="menu" aria-label="缩放选项" data-canvas-control>
      <div className="zoom-input-block">
        <label className="zoom-input-wrap">
          <input
            type="text"
            inputMode="numeric"
            aria-label="缩放百分比"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value.replace(/[^0-9]/g, ""))}
            onBlur={commitInputZoom}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
                commitInputZoom();
              }
              if (event.key === "Escape") onClose();
            }}
          />
          <span>%</span>
        </label>
      </div>
      <button className="zoom-menu-row" type="button" onClick={(event) => runPointerAction(event, onZoomIn)} aria-label="放大画布"><span>放大</span><span className="zoom-key-combo"><span>⌘</span><span>+</span></span></button>
      <button className="zoom-menu-row" type="button" onClick={(event) => runPointerAction(event, onZoomOut)} aria-label="缩小画布"><span>缩小</span><span className="zoom-key-combo"><span>⌘</span><span>−</span></span></button>
      <button className="zoom-menu-row" type="button" onClick={(event) => runPointerAction(event, onFit)} aria-label="适合屏幕"><span>适合屏幕</span><span className="zoom-key-combo"><span>⌘</span><span>0</span></span></button>
      <span className="zoom-menu-divider" aria-hidden="true" />
      {[0.5, 1, 8].map((value) => <button className="zoom-menu-row" key={value} type="button" onClick={(event) => runPointerAction(event, () => onSetZoom(value))}>{`缩放至${Math.round(value * 100)}%`}</button>)}
    </div>
  );
}

function CanvasAside({ showEdges, onToggleEdges, snapToGrid, onToggleSnap, showMinimap, onToggleMinimap, zoom, onZoomIn, onZoomOut, onSetZoom, onFit, onArrange }) {
  const [zoomOpen, setZoomOpen] = useState(false);
  useEffect(() => {
    if (!zoomOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".canvas-zoom-options, .zoom-value")) setZoomOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setZoomOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [zoomOpen]);
  const releasePointerFocus = (event) => {
    if (event.detail === 0) return;
    const button = event.currentTarget;
    window.requestAnimationFrame(() => button.blur());
  };

  return (
    <>
      <div className="canvas-aside" data-canvas-control>
        <button type="button" onClick={(event) => { onArrange(); releasePointerFocus(event); }} aria-label="整理画布，Alt+Shift+F" data-tooltip="整理画布Alt+Shift+F"><IconLayoutDashboard aria-hidden="true" /></button>
        <button className={showMinimap ? "active" : ""} type="button" onClick={(event) => { onToggleMinimap(); releasePointerFocus(event); }} aria-pressed={showMinimap} aria-label="切换小地图" data-tooltip="切换小地图"><MapPinArea weight="regular" aria-hidden="true" /></button>
        <button className={!showEdges ? "active" : ""} type="button" onClick={(event) => { onToggleEdges(); releasePointerFocus(event); }} aria-pressed={!showEdges} aria-label="隐藏节点连线" data-tooltip="隐藏节点连线"><IconRoute aria-hidden="true" /></button>
        <button className={snapToGrid ? "active" : ""} type="button" onClick={(event) => { onToggleSnap(); releasePointerFocus(event); }} aria-pressed={snapToGrid} aria-label="网格吸附" data-tooltip="网格吸附"><LinkSimple weight="regular" aria-hidden="true" /></button>
        <button className="zoom-value" type="button" onClick={(event) => { setZoomOpen((value) => !value); releasePointerFocus(event); }} aria-expanded={zoomOpen} aria-label="缩放选项" data-tooltip="缩放选项">{Math.round(zoom * 100)}%</button>
      </div>
      <ZoomOptions open={zoomOpen} zoom={zoom} onClose={() => setZoomOpen(false)} onFit={onFit} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onSetZoom={onSetZoom} />
    </>
  );
}

function EmptyCanvasGuide({ onAddNode }) {
  return (
    <section className="empty-canvas-guide" data-canvas-control aria-label="从模板开始创作">
      <p>从一个节点开始你的创作</p>
      <div>
        <button type="button" onClick={() => onAddNode({ kind: "composition", role: "text" })}><TextT weight="bold" aria-hidden="true" /><span>文本提示</span></button>
        <button type="button" onClick={() => onAddNode({ kind: "shot", mediaKind: "image" })}><ImageSquare weight="fill" aria-hidden="true" /><span>图像镜头</span></button>
        <button type="button" onClick={() => onAddNode({ kind: "shot", mediaKind: "video" })}><FilmSlate weight="fill" aria-hidden="true" /><span>视频镜头</span></button>
        <button type="button" onClick={() => onAddNode({ kind: "shot", mediaKind: "audio" })}><SpeakerHigh aria-hidden="true" /><span>音频</span></button>
      </div>
    </section>
  );
}

function useNarrowCanvasViewport() {
  const getValue = () => typeof window !== "undefined" && window.innerWidth <= NARROW_VIEWPORT_BREAKPOINT;
  const [isNarrowViewport, setIsNarrowViewport] = useState(getValue);

  useEffect(() => {
    const syncViewportCategory = () => setIsNarrowViewport(getValue());
    window.addEventListener("resize", syncViewportCategory);
    return () => window.removeEventListener("resize", syncViewportCategory);
  }, []);

  return isNarrowViewport;
}

function CanvasViewportInner({ draft, assets = [], selectedNodeId, selectedNodeIds = [], onSelectNodes, onOpenPreview, onMoveNodes, onMoveGroup, onCreateGroup, onCopyNodes, onPasteNodes, canPasteNodes = false, onAddNode, onConnectNodes, onConnectionRejected, onDeleteEdges, onDeleteNodes, onDuplicateNode, onUpdatePrompt, onUpdateReferenceAssets, onUpdateInputAssets, onUpdateRequirements, onSelectOutput, onResetGeneration, onExpandScript, onCreateVariation, onArrange, canUndo, canRedo, onUndo, onRedo }) {
  const viewportRef = useRef(null);
  const isNarrowViewport = useNarrowCanvasViewport();
  const authoredGraphSpan = useMemo(() => {
    if (draft.nodes.length === 0) return 0;
    const bounds = draft.nodes.filter((node) => !isLayoutGroupNode(node)).reduce((current, node) => {
      const size = getNodeSize(node);
      return {
        left: Math.min(current.left, node.position.x),
        right: Math.max(current.right, node.position.x + size.width),
      };
    }, { left: Infinity, right: -Infinity });
    return bounds.right - bounds.left;
  }, [draft.nodes]);
  const usesWideGraphFraming = draft.nodes.length >= 6 && authoredGraphSpan >= 900;
  const graphFraming = isNarrowViewport ? NARROW_GRAPH_FRAMING : DESKTOP_GRAPH_FRAMING;
  // Compact documents remain readable at 50%; a broad fan-out uses the
  // measured working view so the graph reads as an editable system.
  const fitMaxZoom = usesWideGraphFraming
    ? graphFraming.zoom
    : isNarrowViewport ? 0.37 : DEFAULT_CANVAS_ZOOM;
  const wideGraphViewport = useMemo(() => {
    return buildAnchoredGraphViewport(draft, {
      ...graphFraming,
      presentationScale: CANVAS_PRESENTATION_SCALE,
    });
  }, [draft, graphFraming]);
  const { fitView, getViewport, screenToFlowPosition, setViewport, zoomIn, zoomOut } = useReactFlow();
  const [tool, setTool] = useState("select");
  const [showEdges, setShowEdges] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_CANVAS_ZOOM);
  const [arrangementPreview, setArrangementPreview] = useState(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState([]);
  const [quickActionsPosition, setQuickActionsPosition] = useState(null);
  const [quickActionMenu, setQuickActionMenu] = useState(null);
  const [composerPosition, setComposerPosition] = useState(Position.Bottom);
  const [isNodeDragActive, setIsNodeDragActive] = useState(false);
  // Keep the editor anchored to its node, clamping only at viewport edges
  // so all four node types remain editable on compact screens.
  const composerAlign = "center";
  const initialFitDraftRef = useRef(null);
  const previousNarrowViewportRef = useRef(isNarrowViewport);
  const composerPositionRef = useRef(composerPosition);
  const marqueeSelectionActiveRef = useRef(false);
  const groupDragRef = useRef(null);
  const nodeDragActiveRef = useRef(false);
  const initialViewport = useMemo(() => ({
    // Preserve the reference's fixed world origin at narrow widths. The
    // canvas does not auto-fit its authored layout when the window shrinks.
    x: 267,
    y: Math.round(Math.min(240, Math.max(96, window.innerHeight * 0.33))) + 1,
    zoom: DEFAULT_CANVAS_ZOOM,
  }), []);

  const selectCanvasNodes = useCallback((nodeIds, primaryNodeId) => {
    const availableNodeIds = new Set(draft.nodes
      .filter((node) => !isLayoutGroupNode(node))
      .map((node) => node.id));
    const nextNodeIds = [...new Set(nodeIds)].filter((nodeId) => availableNodeIds.has(nodeId));
    const nextPrimaryNodeId = primaryNodeId === undefined
      ? nextNodeIds.at(-1) ?? null
      : primaryNodeId && nextNodeIds.includes(primaryNodeId) ? primaryNodeId : null;
    onSelectNodes?.(nextNodeIds, nextPrimaryNodeId);
  }, [draft.nodes, onSelectNodes]);
  const selectCanvasEdges = useCallback((edgeIds) => {
    const availableEdgeIds = new Set(draft.edges.map((edge) => edge.id));
    const nextEdgeIds = [...new Set(edgeIds)].filter((edgeId) => availableEdgeIds.has(edgeId));
    setSelectedEdgeIds((current) => sameIdSet(current, nextEdgeIds) ? current : nextEdgeIds);
  }, [draft.edges]);
  const focusNode = useCallback((nodeId) => {
    selectCanvasNodes([nodeId], nodeId);
  }, [selectCanvasNodes]);
  const selectedNode = useMemo(() => draft.nodes.find((node) => node.id === selectedNodeId) ?? null, [draft.nodes, selectedNodeId]);
  const groupedMemberIds = useMemo(() => new Set(
    draft.nodes
      .filter((node) => isLayoutGroupNode(node))
      .flatMap((node) => node.spec.memberNodeIds ?? []),
  ), [draft.nodes]);
  const canCreateGroup = selectedNodeIds.length >= 2
    && selectedNodeIds.every((nodeId) => !groupedMemberIds.has(nodeId));
  const selectedNodeKind = selectedNode ? getSurfaceKind(selectedNode) : null;
  const syncComposerPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const composer = viewport?.querySelector(".node-composer:not(.composer-expanded)");
    if (!composer) return;
    const bounds = viewport.getBoundingClientRect();
    const rect = composer.getBoundingClientRect();
    const previousOffset = Number(composer.dataset.viewportOffset ?? 0);
    const offset = composerHorizontalOffset(rect.left - previousOffset, rect.width, bounds.left, bounds.width);
    composer.dataset.viewportOffset = String(offset);
    composer.style.translate = `${offset}px 0`;
  }, []);
  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(syncComposerPosition);
    window.addEventListener("resize", syncComposerPosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncComposerPosition);
    };
  }, [selectedNode, isNarrowViewport, syncComposerPosition]);
  const nodeData = useMemo(() => ({ assets, onOpenPreview, onFocusNode: focusNode, onUpdatePrompt, onUpdateReferenceAssets, onUpdateInputAssets, onUpdateRequirements, onSelectOutput, onResetGeneration, onExpandScript, graph: draft, viewportZoom: zoom, composerPosition, composerAlign }), [assets, composerAlign, composerPosition, draft, focusNode, onExpandScript, onOpenPreview, onUpdatePrompt, onUpdateReferenceAssets, onUpdateInputAssets, onUpdateRequirements, onSelectOutput, onResetGeneration, zoom]);
  const projectedNodes = useMemo(
    () => toFlowNodes(draft, selectedNodeId, nodeData, CANVAS_PRESENTATION_SCALE, selectedNodeIds),
    [draft, nodeData, selectedNodeId, selectedNodeIds],
  );
  const [nodes, setNodes, applyNodesChange] = useNodesState(projectedNodes);
  // Selection belongs to the canonical canvas state. Letting React Flow's
  // local select-change reducer race the projected `selected` flags produces
  // an update loop for a modifier-selected group, so only let it own transient
  // layout changes such as a drag-in-progress.
  const handleNodesChange = useCallback((changes) => {
    const layoutChanges = changes.filter((change) => change.type !== "select");
    if (layoutChanges.length > 0) applyNodesChange(layoutChanges);
  }, [applyNodesChange]);
  const beginNodeDrag = useCallback(() => {
    // The ref closes the small gap before React commits the state update. This
    // matters because selecting a card at drag start can immediately produce
    // a fresh canonical projection.
    nodeDragActiveRef.current = true;
    setIsNodeDragActive(true);
  }, []);
  const finishNodeDrag = useCallback(() => {
    nodeDragActiveRef.current = false;
    setIsNodeDragActive(false);
  }, []);
  const edges = useMemo(
    () => showEdges ? toFlowEdges(draft, selectedNodeId, selectedEdgeIds) : [],
    [draft, selectedEdgeIds, selectedNodeId, showEdges],
  );

  useEffect(() => {
    const available = new Set(draft.edges.map((edge) => edge.id));
    setSelectedEdgeIds((current) => {
      const next = current.filter((edgeId) => available.has(edgeId));
      return next.length === current.length ? current : next;
    });
  }, [draft.edges]);

  const fitCanvas = useCallback(async (duration = 260) => {
    if (usesWideGraphFraming) {
      await setViewport(wideGraphViewport, { duration });
      return;
    }
    await fitView({ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: fitMaxZoom, duration });
    const fittedViewport = getViewport();
    await setViewport({
      ...fittedViewport,
      x: fittedViewport.x + FIT_VIEW_BIAS.x,
      y: fittedViewport.y + FIT_VIEW_BIAS.y,
    }, { duration: 0 });
  }, [fitMaxZoom, fitView, getViewport, setViewport, usesWideGraphFraming, wideGraphViewport]);

  const fitArrangedCanvas = useCallback(async () => {
    await fitView({ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: fitMaxZoom, duration: 260 });
    const fittedViewport = getViewport();
    await setViewport({
      ...fittedViewport,
      // The arrangement preview is pinned to the canvas safe area instead of
      // centered. This leaves room for the confirmation card and mirrors the
      // authored left/top inset used by the reference interaction.
      x: 48,
      y: 48,
    }, { duration: 0 });
  }, [fitMaxZoom, fitView, getViewport, setViewport]);

  const syncQuickActionsPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const node = viewport?.querySelector(".canvas-node.selected");
    if (!viewport || !node) {
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const composerAboveOffset = composerPosition === Position.Top ? 191 : 0;
    const nextPosition = {
      left: nodeRect.left - viewportRect.left + nodeRect.width / 2,
      top: nodeRect.top - viewportRect.top - (59 + zoom * 24 + composerAboveOffset),
    };
    setQuickActionsPosition((current) => (
      Object.is(current?.left, nextPosition.left) && Object.is(current?.top, nextPosition.top)
        ? current
        : nextPosition
    ));
  }, [composerPosition, zoom]);

  useLayoutEffect(() => {
    if (!selectedNode || (selectedNodeKind !== "image" && selectedNodeKind !== "video")) {
      return undefined;
    }
    syncQuickActionsPosition();
    const frame = window.requestAnimationFrame(syncQuickActionsPosition);
    window.addEventListener("resize", syncQuickActionsPosition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncQuickActionsPosition);
    };
  }, [nodes, selectedNode, selectedNodeKind, syncQuickActionsPosition, zoom]);

  useLayoutEffect(() => {
    if (!selectedNode) {
      if (composerPositionRef.current !== Position.Bottom) {
        composerPositionRef.current = Position.Bottom;
        setComposerPosition(Position.Bottom);
      }
      return;
    }
    const viewport = viewportRef.current;
    const node = viewport?.querySelector(".canvas-node.selected");
    if (!viewport || !node) return;
    const viewportRect = viewport.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const composerHeight = LOCAL_REFERENCE_CONTEXT_ROLES.has(selectedNodeKind)
      ? 312
      : selectedNodeKind === "text"
        ? 202
        : isContextNode(selectedNode)
          ? 224
          : 191;
    const safeOffset = 16;
    const nextPosition = viewportRect.bottom - nodeRect.bottom < composerHeight + safeOffset && nodeRect.top - viewportRect.top > composerHeight + safeOffset
      ? Position.Top
      : Position.Bottom;
    if (composerPositionRef.current !== nextPosition) {
      composerPositionRef.current = nextPosition;
      setComposerPosition(nextPosition);
    }
  }, [nodes, selectedNode, selectedNodeKind, zoom]);

  useEffect(() => {
    if (!shouldSyncFlowProjection({
      hasArrangementPreview: Boolean(arrangementPreview),
      isNodeDragActive: nodeDragActiveRef.current || isNodeDragActive,
    })) return;
    setNodes(projectedNodes);
  }, [arrangementPreview, isNodeDragActive, projectedNodes, setNodes]);

  useEffect(() => {
    if (draft.nodes.length === 0 || initialFitDraftRef.current === draft.id) return undefined;
    // Custom card content can keep React Flow's nodes-initialized signal false
    // even after the cards are visibly mounted. Wait for two paint frames and
    // fit from the rendered bounds instead, so the initial viewport includes
    // every upstream context node instead of leaving only its edge visible.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        initialFitDraftRef.current = draft.id;
        void fitCanvas(0);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [draft.id, draft.nodes.length, fitCanvas]);

  useEffect(() => {
    const wasNarrow = previousNarrowViewportRef.current;
    previousNarrowViewportRef.current = isNarrowViewport;
    if (!usesWideGraphFraming || wasNarrow === isNarrowViewport) return;
    void setViewport(wideGraphViewport, { duration: 0 });
  }, [isNarrowViewport, setViewport, usesWideGraphFraming, wideGraphViewport]);

  useEffect(() => {
    setQuickActionMenu(null);
  }, [selectedNodeId]);

  const handleFit = useCallback(() => {
    void fitCanvas(260);
  }, [fitCanvas]);

  const handleArrangePreview = useCallback(() => {
    if (draft.nodes.length === 0 || arrangementPreview) return;
    const positions = buildAutoLayoutPositions(draft);
    const originalViewport = getViewport();
    setAddMenuOpen(false);
    setArrangementPreview({ originalViewport, positions });
    setNodes((currentNodes) => currentNodes.map((node) => ({
      ...node,
      position: {
        x: positions[node.id].x * CANVAS_PRESENTATION_SCALE,
        y: positions[node.id].y * CANVAS_PRESENTATION_SCALE,
      },
    })));
    window.requestAnimationFrame(() => {
      void fitArrangedCanvas();
    });
  }, [arrangementPreview, draft, fitArrangedCanvas, getViewport, setNodes]);

  const handleRevertArrangement = useCallback(() => {
    if (!arrangementPreview) return;
    const { originalViewport } = arrangementPreview;
    setArrangementPreview(null);
    setNodes(projectedNodes);
    void setViewport(originalViewport, { duration: 260 });
  }, [arrangementPreview, projectedNodes, setNodes, setViewport]);

  const handleKeepArrangement = useCallback(() => {
    if (!arrangementPreview) return;
    onArrange(arrangementPreview.positions);
    setArrangementPreview(null);
  }, [arrangementPreview, onArrange]);

  const handleSetZoom = useCallback((nextZoom) => {
    const current = getViewport();
    void setViewport({ ...current, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)) }, { duration: 120 });
  }, [getViewport, setViewport]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const editingText = target instanceof HTMLInputElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable);
      if (editingText) return;
      const protectedLayer = target instanceof Element
        && target.closest('[role="dialog"], [role="menu"], [role="listbox"]');
      if (protectedLayer) return;
      if (event.key === "Escape" && arrangementPreview) {
        event.preventDefault();
        handleRevertArrangement();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "g") {
        if (!canCreateGroup || arrangementPreview) return;
        event.preventDefault();
        onCreateGroup?.(selectedNodeIds);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "d") {
        if (!selectedNodeId || arrangementPreview) return;
        event.preventDefault();
        onDuplicateNode(selectedNodeId);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c") {
        if (selectedNodeIds.length === 0 || arrangementPreview) return;
        event.preventDefault();
        onCopyNodes?.(selectedNodeIds);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "v") {
        if (!canPasteNodes || arrangementPreview) return;
        event.preventDefault();
        onPasteNodes?.();
        return;
      }
      if (event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        handleArrangePreview();
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (!arrangementPreview) setAddMenuOpen(true);
        return;
      }
      if (event.key.toLowerCase() === "v") setTool("select");
      if (event.key.toLowerCase() === "h") setTool("pan");
      if (event.key === "0") handleFit();
      if (event.key === "+" || event.key === "=") void zoomIn({ duration: 120 });
      if (event.key === "-" || event.key === "_") void zoomOut({ duration: 120 });
      if (event.key === "Escape") selectCanvasNodes([], null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [arrangementPreview, canCreateGroup, canPasteNodes, handleArrangePreview, handleFit, handleRevertArrangement, onCopyNodes, onCreateGroup, onDuplicateNode, onPasteNodes, selectCanvasNodes, selectedNodeId, selectedNodeIds, zoomIn, zoomOut]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target;
      const editingText = target instanceof HTMLInputElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable);
      const protectedLayer = target instanceof Element
        && target.closest('[role="dialog"], [role="menu"], [role="listbox"]');
      if (editingText || protectedLayer) {
        event.stopPropagation();
        return;
      }
      if (arrangementPreview) return;
      // Capture the shortcut before React Flow's internal selection model so
      // deletion follows the canvas's focused node or selected edge, including
      // custom node/edge surfaces whose click target is not React Flow's
      // default wrapper.
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (selectedNodeIds.length > 0) {
        onDeleteNodes(selectedNodeIds);
        selectCanvasNodes([], null);
      }
      else {
        onDeleteEdges(selectedEdgeIds);
        selectCanvasEdges([]);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [arrangementPreview, onDeleteEdges, onDeleteNodes, selectCanvasEdges, selectCanvasNodes, selectedEdgeIds, selectedNodeIds]);

  const handleFlowSelectionChange = useCallback(({ nodes: flowNodes, edges: flowEdges }) => {
    const nextNodeIds = flowNodesToSelectionIds(flowNodes);
    const nextEdgeIds = flowEdges.map((edge) => edge.id);
    // Single-node and edge selection are handled by the explicit click
    // callbacks below. React Flow can emit a controlled selection-change
    // notification while reconciling that click, so only consume an actual
    // group selection here (the Shift marquee path).
    if (shouldSyncFlowSelection(flowNodes, marqueeSelectionActiveRef.current)) {
      const matchesLayoutGroup = draft.nodes.some((node) => (
        isLayoutGroupNode(node)
        && (node.spec.memberNodeIds?.length ?? 0) === nextNodeIds.length
        && node.spec.memberNodeIds?.every((memberNodeId) => nextNodeIds.includes(memberNodeId))
      ));
      const primaryNodeId = matchesLayoutGroup
        ? null
        : nextNodeIds.includes(selectedNodeId) ? selectedNodeId : nextNodeIds.at(-1);
      selectCanvasNodes(nextNodeIds, primaryNodeId);
      // A group selection is a node operation; its internal edges stay
      // visible but are not independently selected. Feeding React Flow's
      // auto-selected internal edge back as controlled edge state creates a
      // select/setEdges feedback loop.
      if (nextEdgeIds.length > 0) selectCanvasEdges([]);
    }
  }, [draft.nodes, selectCanvasEdges, selectCanvasNodes, selectedNodeId]);

  const handleSelectionStart = useCallback(() => {
    marqueeSelectionActiveRef.current = true;
  }, []);

  const handleSelectionEnd = useCallback(() => {
    // Selection changes can be delivered through React effects immediately
    // after pointer-up. Let that final one-card marquee reach the canonical
    // state before treating later ordinary clicks as separate selections.
    window.requestAnimationFrame(() => {
      marqueeSelectionActiveRef.current = false;
    });
  }, []);

  const addAtViewportCenter = useCallback((descriptor) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const center = screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2,
    });
    const size = getNodeSize(descriptor);
    const preferredPosition = {
      x: Math.round(center.x / CANVAS_PRESENTATION_SCALE - size.width / 2),
      y: Math.round(center.y / CANVAS_PRESENTATION_SCALE - size.height / 2),
    };
    onAddNode(descriptor, findOpenNodePosition(draft, preferredPosition, descriptor));
  }, [draft, onAddNode, screenToFlowPosition]);

  return (
    <section ref={viewportRef} className={`canvas-viewport tool-${tool}`} data-testid="canvas-viewport" data-view={`0,0,${zoom.toFixed(3)}`} aria-label="无限画布。拖动节点编辑布局；拖动空白处、空格拖动或双指滑动可平移画布；按住 Command 或 Control 滚轮，或使用双指捏合可缩放；按住 Shift 可框选节点。">
      <ReactFlow
        key={draft.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onNodeClick={(event, node) => {
          selectCanvasEdges([]);
          if (node.data?.isLayoutGroup) {
            selectCanvasNodes(node.data.groupBounds?.memberNodeIds ?? [], null);
            return;
          }
          const extendsSelection = event.metaKey || event.ctrlKey || event.shiftKey;
          if (!extendsSelection) {
            focusNode(node.id);
            return;
          }
          const nextNodeIds = selectedNodeIds.includes(node.id)
            ? selectedNodeIds.filter((nodeId) => nodeId !== node.id)
            : [...selectedNodeIds, node.id];
          const nextPrimaryNodeId = nextNodeIds.includes(node.id)
            ? node.id
            : selectedNodeId === node.id ? nextNodeIds.at(-1) ?? null : selectedNodeId;
          selectCanvasNodes(nextNodeIds, nextPrimaryNodeId);
        }}
        onNodeDragStart={(_, node) => {
          beginNodeDrag();
          if (node.data?.isLayoutGroup) {
            const memberNodeIds = node.data.groupBounds?.memberNodeIds ?? [];
            groupDragRef.current = {
              groupNodeId: node.id,
              startPosition: { ...node.position },
              memberPositions: new Map(nodes
                .filter((candidate) => memberNodeIds.includes(candidate.id))
                .map((candidate) => [candidate.id, { ...candidate.position }])),
            };
            selectCanvasNodes(memberNodeIds, null);
            selectCanvasEdges([]);
            setQuickActionMenu(null);
            return;
          }
          if (!selectedNodeIds.includes(node.id)) focusNode(node.id);
          selectCanvasEdges([]);
          setQuickActionMenu(null);
        }}
        onNodeDrag={(_, node) => {
          const drag = groupDragRef.current;
          if (!drag || drag.groupNodeId !== node.id) return;
          const delta = {
            x: node.position.x - drag.startPosition.x,
            y: node.position.y - drag.startPosition.y,
          };
          setNodes((currentNodes) => currentNodes.map((candidate) => {
            const startPosition = drag.memberPositions.get(candidate.id);
            if (!startPosition) return candidate;
            return {
              ...candidate,
              position: {
                x: startPosition.x + delta.x,
                y: startPosition.y + delta.y,
              },
            };
          }));
        }}
        onNodeDragStop={(_, node, movedNodes) => {
          finishNodeDrag();
          const drag = groupDragRef.current;
          if (drag?.groupNodeId === node.id) {
            groupDragRef.current = null;
            const delta = {
              x: Math.round((node.position.x - drag.startPosition.x) / CANVAS_PRESENTATION_SCALE),
              y: Math.round((node.position.y - drag.startPosition.y) / CANVAS_PRESENTATION_SCALE),
            };
            if (delta.x === 0 && delta.y === 0) {
              return;
            }
            onMoveGroup?.(node.id, delta);
            return;
          }
          const positions = flowNodesToCanvasPositions(
            movedNodes?.length ? movedNodes : [node],
            CANVAS_PRESENTATION_SCALE,
          );
          if (positions.length > 0) onMoveNodes(positions);
        }}
        onPaneClick={() => {
          selectCanvasNodes([], null);
          selectCanvasEdges([]);
        }}
        onEdgeClick={(event, edge) => {
          event.stopPropagation();
          selectCanvasNodes([], null);
          selectCanvasEdges([edge.id]);
        }}
        onSelectionChange={handleFlowSelectionChange}
        onSelectionStart={handleSelectionStart}
        onSelectionEnd={handleSelectionEnd}
        onConnect={(connection) => {
          const mutation = connectionToGraphMutation(draft, connection);
          if (mutation) onConnectNodes(mutation);
        }}
        onConnectEnd={(_, connectionState) => {
          const message = connectionRejectionMessage(connectionState);
          if (message) onConnectionRejected?.(message);
        }}
        isValidConnection={(connection) => Boolean(connectionToGraphMutation(draft, connection))}
        onEdgesDelete={(deletedEdges) => {
          const edgeIds = deletedEdges.map((edge) => edge.id);
          onDeleteEdges(edgeIds);
          setSelectedEdgeIds((current) => current.filter((edgeId) => !edgeIds.includes(edgeId)));
        }}
        onNodesDelete={(deletedNodes) => onDeleteNodes(deletedNodes.map((node) => node.id))}
        onMove={(_, viewport) => {
          setZoom(viewport.zoom);
          window.requestAnimationFrame(syncQuickActionsPosition);
          window.requestAnimationFrame(syncComposerPosition);
        }}
        nodesDraggable={tool === "select"}
        edgesReconnectable={false}
        noPanClassName="nopan"
        // Keep the canvas navigable in both tools: blank-space drags pan,
        // while node drags are still handled by the node layer in select mode.
        panOnDrag
        panOnScroll
        panActivationKeyCode="Space"
        zoomActivationKeyCode={["Meta", "Control"]}
        selectionOnDrag={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={["Meta", "Control"]}
        snapToGrid={snapToGrid}
        snapGrid={[20, 20]}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        // Start a wide authored graph at its measured working anchor instead
        // of briefly rendering the compact 50% viewport before the initial
        // fit effect takes over.
        defaultViewport={usesWideGraphFraming ? wideGraphViewport : initialViewport}
        fitView={false}
        fitViewOptions={{ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: fitMaxZoom }}
        deleteKeyCode={null}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        data-testid="react-flow-editor"
      >
        <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="#474747" />
        {showMinimap ? <MiniMap className="canvas-mini-map" maskColor="rgb(20 20 20 / 66%)" pannable zoomable /> : null}
      </ReactFlow>

      {selectedNode && (selectedNodeKind === "image" || selectedNodeKind === "video") && quickActionsPosition ? (
        <NodeQuickActions
          className="node-quick-actions-overlay"
          kind={selectedNodeKind}
          node={selectedNode}
          openMenu={quickActionMenu}
          onOpenMenuChange={setQuickActionMenu}
          onCreateVariation={onCreateVariation}
          onOpenPreview={onOpenPreview}
          style={{ "--quick-actions-left": `${quickActionsPosition.left}px`, "--quick-actions-top": `${quickActionsPosition.top}px` }}
        />
      ) : null}

      {draft.nodes.length === 0 ? <EmptyCanvasGuide onAddNode={addAtViewportCenter} /> : null}
      <CanvasAside
        showEdges={showEdges}
        onToggleEdges={() => setShowEdges((value) => !value)}
        snapToGrid={snapToGrid}
        onToggleSnap={() => setSnapToGrid((value) => !value)}
        showMinimap={showMinimap}
        onToggleMinimap={() => setShowMinimap((value) => !value)}
        zoom={zoom}
        onZoomIn={() => void zoomIn({ duration: 120 })}
        onZoomOut={() => void zoomOut({ duration: 120 })}
        onSetZoom={handleSetZoom}
        onFit={handleFit}
        onArrange={handleArrangePreview}
      />
      {arrangementPreview ? (
        <section className="arrange-confirmation" role="dialog" aria-label="整理画布确认" data-canvas-control>
          <p>是否保留此次整理结果？</p>
          <div>
            <button type="button" onClick={handleRevertArrangement} autoFocus>还原</button>
            <button className="primary" type="button" onClick={handleKeepArrangement}>保留</button>
          </div>
        </section>
      ) : null}
      <CanvasDock
        tool={tool}
        onToolChange={setTool}
        onAddNode={addAtViewportCenter}
        addMenuOpen={addMenuOpen}
        onAddMenuOpenChange={setAddMenuOpen}
        onArrange={handleArrangePreview}
        canCreateGroup={canCreateGroup}
        onCreateGroup={() => onCreateGroup?.(selectedNodeIds)}
        showEdges={showEdges}
        onToggleEdges={() => setShowEdges((value) => !value)}
        snapToGrid={snapToGrid}
        onToggleSnap={() => setSnapToGrid((value) => !value)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
      />
    </section>
  );
}

export function CanvasViewport(props) {
  return (
    <ReactFlowProvider>
      <CanvasViewportInner {...props} />
    </ReactFlowProvider>
  );
}
