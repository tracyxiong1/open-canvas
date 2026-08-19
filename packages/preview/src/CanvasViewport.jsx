import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  getStraightPath,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import {
  ArrowUp,
  ArrowsOutSimple,
  BezierCurve,
  CaretRight,
  CheckCircle,
  Clock,
  CornersOut,
  Crosshair,
  Cursor,
  DownloadSimple,
  FilmSlate,
  FileText,
  FolderSimple,
  GridFour,
  GitBranch,
  HighDefinition,
  ImageSquare,
  Keyboard,
  Magnet,
  MapTrifold,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Paperclip,
  PaintBrush,
  Pause,
  Plus,
  Question,
  Scissors,
  Shapes,
  SpeakerHigh,
  Sparkle,
  SpinnerGap,
  Stack,
  TextAlignLeft,
  TextT,
  UploadSimple,
  UserCircle,
  UsersThree,
  VideoCamera,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { getNodeSize } from "./project-document.js";
import {
  connectionToGraphMutation,
  CANVAS_PRESENTATION_SCALE,
  findOpenNodePosition,
  HANDLE_IDS,
  toFlowEdges,
  toFlowNodes,
} from "./react-flow-model.js";

const MIN_ZOOM = 0.32;
const MAX_ZOOM = 1.8;
const FIT_VIEW_PADDING = { top: "106px", right: "14px", bottom: "132px", left: "14px" };
const DEFAULT_CANVAS_ZOOM = 0.5;

const CONTEXT_NODE_ROLES = new Set([
  "text",
  "smart-edit",
  "director",
  "frame-analysis",
  "audio",
  "script",
  "asset-library",
]);

function StatusIcon({ status }) {
  if (status === "succeeded") return <CheckCircle weight="fill" aria-hidden="true" />;
  if (status === "running") return <SpinnerGap className="spin" aria-hidden="true" />;
  if (status === "queued") return <Clock weight="fill" aria-hidden="true" />;
  if (status === "failed") return <WarningCircle weight="fill" aria-hidden="true" />;
  return <Pause weight="fill" aria-hidden="true" />;
}

function getSurfaceKind(node) {
  if (node.kind === "composition") return node.spec.role ?? "composition";
  return node.spec.mediaKind === "image" ? "image" : "video";
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
  if (kind === "asset-library") return <FolderSimple weight="thin" aria-hidden="true" />;
  if (kind === "composition") return <Stack weight="thin" aria-hidden="true" />;
  return <VideoCamera weight="thin" aria-hidden="true" />;
}

function NodeLabelIcon({ kind }) {
  if (kind === "text") return <TextT weight="bold" aria-hidden="true" />;
  if (kind === "image") return <ImageSquare weight="fill" aria-hidden="true" />;
  if (kind === "smart-edit") return <Scissors weight="fill" aria-hidden="true" />;
  if (kind === "director") return <FilmSlate weight="fill" aria-hidden="true" />;
  if (kind === "frame-analysis") return <MagnifyingGlassPlus weight="bold" aria-hidden="true" />;
  if (kind === "audio") return <SpeakerHigh weight="fill" aria-hidden="true" />;
  if (kind === "script") return <FileText weight="fill" aria-hidden="true" />;
  if (kind === "asset-library") return <FolderSimple weight="fill" aria-hidden="true" />;
  if (kind === "composition") return <Stack weight="fill" aria-hidden="true" />;
  return <VideoCamera weight="fill" aria-hidden="true" />;
}

function NodeMedia({ node, kind, onOpenPreview }) {
  const asset = node.outputAssets.find((item) => item.previewUrl);
  if (kind === "text") {
    return (
      <div className="node-media node-media-text" aria-label={`${node.title} ${node.statusMeta.label}`}>
        <TextAlignLeft weight="thin" aria-hidden="true" />
      </div>
    );
  }
  if (asset && kind !== "text") {
    return (
      <div className="node-media node-media-asset">
        <img src={asset.previewUrl} alt={`${node.title} 的生成画面`} draggable="false" />
        {kind === "video" ? <span className="node-play"><VideoCamera weight="fill" aria-hidden="true" /></span> : null}
        <button
          className="node-preview-button nodrag"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenPreview(node, asset);
          }}
          aria-label={`打开 ${node.title} 的素材预览`}
        >
          <CornersOut aria-hidden="true" />
        </button>
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

function NodeComposer({ node, kind, onUpdatePrompt }) {
  const canEditPrompt = node.kind === "shot" || isContextNode(node);
  const [prompt, setPrompt] = useState(canEditPrompt ? node.spec.prompt : "");
  const requirements = node.spec.requirements ?? {};

  useEffect(() => {
    setPrompt(node.spec.kind === "shot" || isContextNode(node) ? node.spec.prompt : "");
  }, [node.id, node.specRevision, node.spec]);

  const submitPrompt = (event) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!canEditPrompt || !nextPrompt || nextPrompt === node.spec.prompt) return;
    onUpdatePrompt(node.id, nextPrompt);
  };

  return (
    <section
      className="node-composer nodrag nowheel"
      onClick={(event) => event.stopPropagation()}
      aria-label={`${node.title} 参数`}
    >
      <form onSubmit={submitPrompt}>
        <div className="composer-context-row" aria-hidden="true">
          <span><Plus weight="bold" />参考</span>
          <span><Paperclip />标记</span>
          <span><Sparkle weight="fill" />风格</span>
        </div>
        <div className="composer-input-row">
          <span className={`composer-type composer-type-${kind}`} aria-hidden="true"><NodeLabelIcon kind={kind} /></span>
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
              placeholder="描述主体、动作与镜头语言"
            />
          ) : (
            <p>将上游镜头组合为一个可继续编辑的片段。</p>
          )}
        </div>
        <footer className="composer-tools">
          <button type="button" title="引用素材" aria-label="引用素材"><Paperclip aria-hidden="true" /></button>
          <span className="composer-divider" />
          <button type="button" className="composer-chip">{requirements.aspectRatio ?? "自适应"}</button>
          <button type="button" className="composer-chip">{requirements.durationSeconds ? `${requirements.durationSeconds} 秒` : "组合"}</button>
          <span className="composer-spacer" />
          <span className={`composer-state ${node.statusMeta.tone}`} title={node.statusMeta.label}><StatusIcon status={node.status} /></span>
          <button
            className="composer-submit"
            type="submit"
            disabled={!canEditPrompt || !prompt.trim() || prompt.trim() === node.spec.prompt}
            aria-label="应用提示词"
          >
            <ArrowUp weight="bold" aria-hidden="true" />
          </button>
        </footer>
      </form>
    </section>
  );
}

function CanvasHandle({ id, type, position, label }) {
  return (
    <Handle
      id={id}
      className="canvas-handle"
      type={type}
      position={position}
      role="button"
      tabIndex={-1}
      aria-label={label}
    />
  );
}

function NodeQuickActions({ kind, node }) {
  if (kind !== "image" && kind !== "video") return null;
  const actions = kind === "image"
    ? [
      { label: "全景", icon: CornersOut },
      { label: "多角度", icon: Crosshair },
      { label: "打光", icon: Sparkle },
      { label: "九宫格", icon: GridFour, caret: true },
      { label: "高清", icon: HighDefinition, caret: true },
      { label: "宫格切分", icon: GridFour, caret: true },
    ]
    : [
      { label: "运动", icon: Sparkle },
      { label: "多角度", icon: Crosshair },
      { label: "打光", icon: Sparkle },
      { label: "九宫格", icon: GridFour, caret: true },
      { label: "高清", icon: HighDefinition, caret: true },
      { label: "宫格切分", icon: GridFour, caret: true },
    ];

  return (
    <div className="node-quick-actions nodrag nowheel" aria-label={`${node.title} 快捷配置`}>
      <button className="quick-person-action" type="button" aria-label="人像质感调节" title="人像质感调节">
        <UserCircle weight="regular" aria-hidden="true" />
        <span>人像质感调节</span>
        <em>NEW</em>
        <CaretRight className="quick-caret" weight="bold" aria-hidden="true" />
      </button>
      {actions.map(({ label, icon: Icon, caret }) => (
        <button className="quick-action" key={label} type="button" aria-label={label} title={label}>
          <Icon weight="regular" aria-hidden="true" />
          <span>{label}</span>
          {caret ? <CaretRight className="quick-caret" weight="bold" aria-hidden="true" /> : null}
        </button>
      ))}
      <span className="quick-actions-divider" />
      <button type="button" aria-label="画笔编辑" title="画笔编辑"><PaintBrush aria-hidden="true" /></button>
      <button type="button" aria-label="定位主体" title="定位主体"><Crosshair aria-hidden="true" /></button>
      <button type="button" aria-label="下载素材" title="下载素材"><DownloadSimple aria-hidden="true" /></button>
      <button type="button" aria-label="打开素材预览" title="打开素材预览"><ArrowsOutSimple aria-hidden="true" /></button>
    </div>
  );
}

function CanvasEdge({ id, sourceX, sourceY, targetX, targetY, className }) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const deltaX = targetX - sourceX;
  const deltaY = targetY - sourceY;
  const length = Math.hypot(deltaX, deltaY);
  const indicatorLength = Math.min(34, length);
  const indicatorX = length ? sourceX + (deltaX / length) * indicatorLength : sourceX;
  const indicatorY = length ? sourceY + (deltaY / length) * indicatorLength : sourceY;
  const indicatorPath = `M ${sourceX},${sourceY} L ${indicatorX},${indicatorY}`;
  return (
    <>
      <BaseEdge id={id} path={edgePath} className={className} />
      <path className="canvas-edge-pulse" d={indicatorPath} aria-hidden="true" />
    </>
  );
}

function CanvasNode({ data, selected }) {
  const {
    nodeSize,
    flowNodeSize = nodeSize,
    presentationScale = 1,
    node,
    onOpenPreview,
    onFocusNode,
    onUpdatePrompt,
  } = data;
  const kind = getSurfaceKind(node);
  const isShot = node.kind === "shot";
  const requirements = node.spec.requirements ?? {};
  const resolutionLabel = kind === "image" && requirements.width && requirements.height
    ? `${requirements.width} × ${requirements.height}`
    : requirements.aspectRatio ?? "16:9";

  return (
    <article
      className={`canvas-node canvas-node-${kind} ${selected ? "selected" : ""}`}
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
      {isShot ? (
        <>
          <CanvasHandle id={HANDLE_IDS.sequenceTarget} type="target" position={Position.Left} label="镜头顺序输入" />
          <CanvasHandle id={HANDLE_IDS.sequenceSource} type="source" position={Position.Right} label="镜头顺序输出" />
        </>
      ) : (
        <>
          <CanvasHandle id={HANDLE_IDS.dependencyTarget} type="target" position={Position.Left} label="上下文输入" />
          <CanvasHandle id={HANDLE_IDS.dependencySource} type="source" position={Position.Right} label="上下文输出" />
        </>
      )}

      <div className="canvas-node-content">
        <div className="node-label" aria-hidden="true">
          <NodeLabelIcon kind={kind} />
          <span>{node.title}</span>
          {kind === "image" || kind === "video" ? <small>{resolutionLabel}</small> : null}
        </div>

        <div
          className="node-frame"
          role="button"
          tabIndex="0"
          aria-pressed={selected}
          aria-label={`${node.title}，${node.statusMeta.label}`}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onFocusNode(node.id);
            }
          }}
        >
          <NodeMedia node={node} kind={kind} onOpenPreview={onOpenPreview} />
          <span className="node-corner-status" title={node.statusMeta.label}>
            {node.status === "succeeded" ? <CheckCircle weight="fill" aria-hidden="true" /> : null}
          </span>
        </div>

        {selected ? <NodeQuickActions kind={kind} node={node} /> : null}
        {selected ? <NodeComposer node={node} kind={kind} onUpdatePrompt={onUpdatePrompt} /> : null}
      </div>
    </article>
  );
}

const NODE_TYPES = { creatorNode: CanvasNode };
const EDGE_TYPES = { canvasEdge: CanvasEdge };

function CanvasAddMenu({ open, onClose, onAddNode }) {
  if (!open) return null;
  const addAndClose = (descriptor) => {
    onAddNode(descriptor);
    onClose();
  };
  return (
    <div className="canvas-add-menu" role="menu" aria-label="添加画布节点" data-canvas-control>
      <button className="add-menu-close" type="button" onClick={onClose} aria-label="关闭添加菜单"><X aria-hidden="true" /></button>
      <p className="add-menu-heading">添加节点</p>
      <div className="add-menu-list">
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "text" })}><TextT aria-hidden="true" /><span>文本</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "shot", mediaKind: "image" })}><ImageSquare aria-hidden="true" /><span>图片</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "shot", mediaKind: "video" })}><VideoCamera aria-hidden="true" /><span>视频</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "smart-edit" })}><Scissors aria-hidden="true" /><span>编辑</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "director" })}><FilmSlate aria-hidden="true" /><span>分镜</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "frame-analysis" })}><MagnifyingGlassPlus aria-hidden="true" /><span>镜头分析</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "audio" })}><SpeakerHigh aria-hidden="true" /><span>音频</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "script" })}><FileText aria-hidden="true" /><span>脚本</span><CaretRight aria-hidden="true" /></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "asset-library" })}><FolderSimple aria-hidden="true" /><span>素材</span><CaretRight aria-hidden="true" /></button>
      </div>
      <p className="add-menu-heading add-menu-resource-heading">添加资源</p>
      <div className="add-menu-list add-menu-resource-list">
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "asset-library" })}><UploadSimple aria-hidden="true" /><span>上传</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "asset-library" })}><Clock aria-hidden="true" /><span>从生成历史中选择</span></button>
      </div>
    </div>
  );
}

function CanvasDock({ tool, onToolChange, onAddNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <CanvasAddMenu open={menuOpen} onClose={() => setMenuOpen(false)} onAddNode={onAddNode} />
      <div className="canvas-dock" role="toolbar" aria-label="画布工具" data-canvas-control>
        <button className={`dock-add ${menuOpen ? "active" : ""}`} type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="添加节点" title="添加节点"><Plus weight="bold" aria-hidden="true" /></button>
        <button className={tool === "pan" ? "active" : ""} type="button" onClick={() => onToolChange(tool === "pan" ? "select" : "pan")} aria-pressed={tool === "pan"} aria-label="移动" title={tool === "pan" ? "切换到选择模式 (V)" : "移动画布 (H)"}><Cursor weight="regular" aria-hidden="true" /></button>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="打开工具箱" title="打开工具箱"><GitBranch weight="regular" aria-hidden="true" /></button>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="素材库" title="素材库"><Shapes weight="regular" aria-hidden="true" /></button>
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="角色库" title="角色库"><UsersThree weight="regular" aria-hidden="true" /></button>
        <button type="button" aria-label="历史记录" title="历史记录"><Clock weight="regular" aria-hidden="true" /></button>
        <span className="dock-divider" />
        <button type="button" aria-label="快捷键" title="快捷键"><Keyboard weight="regular" aria-hidden="true" /></button>
        <button type="button" aria-label="教程" title="教程"><Question weight="regular" aria-hidden="true" /></button>
      </div>
    </>
  );
}

function ZoomOptions({ open, zoom, onClose, onFit, onZoomIn, onZoomOut, onSetZoom }) {
  if (!open) return null;
  return (
    <div className="canvas-zoom-options" role="menu" aria-label="缩放选项" data-canvas-control>
      <div>
        <button type="button" onClick={onZoomOut} aria-label="缩小画布"><MagnifyingGlassMinus aria-hidden="true" /></button>
        <strong>{Math.round(zoom * 100)}%</strong>
        <button type="button" onClick={onZoomIn} aria-label="放大画布"><MagnifyingGlassPlus aria-hidden="true" /></button>
      </div>
      <div className="zoom-presets">
        {[0.5, 0.75, 1].map((value) => <button key={value} type="button" onClick={() => { onSetZoom(value); onClose(); }}>{Math.round(value * 100)}%</button>)}
        <button type="button" onClick={() => { onFit(); onClose(); }}>适合画布</button>
      </div>
    </div>
  );
}

function CanvasAssetManager({ open, draft, onClose, onSelectNode }) {
  if (!open) return null;
  const entries = draft.nodes.flatMap((node) => node.outputAssets
    .filter((asset) => asset.previewUrl)
    .map((asset) => ({ asset, node })));

  return (
    <aside className="canvas-asset-manager" role="dialog" aria-modal="false" aria-labelledby="asset-manager-title" data-canvas-control>
      <header>
        <div><span>当前画布</span><h2 id="asset-manager-title">资产管理</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭资产管理"><X aria-hidden="true" /></button>
      </header>
      <div className="asset-manager-list">
        {entries.length > 0 ? entries.map(({ asset, node }) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => { onSelectNode(node.id); onClose(); }}
            aria-label={`聚焦 ${node.title}`}
          >
            <img src={asset.previewUrl} alt="" />
            <span><strong>{node.title}</strong><small>{node.spec.mediaKind === "image" ? "图片" : "视频"}</small></span>
          </button>
        )) : <p>还没有可管理的生成资产。</p>}
      </div>
    </aside>
  );
}

function CanvasAside({ draft, onSelectNode, showEdges, onToggleEdges, snapToGrid, onToggleSnap, showMinimap, onToggleMinimap, zoom, onZoomIn, onZoomOut, onSetZoom, onFit, onArrange }) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const [assetManagerOpen, setAssetManagerOpen] = useState(false);

  return (
    <>
      <div className="canvas-aside" data-canvas-control>
        <button className="asset-manage-button" type="button" onClick={() => setAssetManagerOpen(true)} aria-label="资产管理" title="资产管理"><Stack weight="regular" aria-hidden="true" /><span>资产管理</span></button>
        <button type="button" onClick={onArrange} aria-label="整理画布，Alt+Shift+F" title="整理画布 (Alt+Shift+F)"><GridFour weight="regular" aria-hidden="true" /></button>
        <button className={showMinimap ? "active" : ""} type="button" onClick={onToggleMinimap} aria-pressed={showMinimap} aria-label="切换小地图" title="切换小地图"><MapTrifold weight="regular" aria-hidden="true" /></button>
        <button className={!showEdges ? "active" : ""} type="button" onClick={onToggleEdges} aria-pressed={!showEdges} aria-label="隐藏节点连线" title="隐藏节点连线"><BezierCurve weight="regular" aria-hidden="true" /></button>
        <button className={snapToGrid ? "active" : ""} type="button" onClick={onToggleSnap} aria-pressed={snapToGrid} aria-label="网格吸附" title="网格吸附"><Magnet weight="regular" aria-hidden="true" /></button>
        <button className="zoom-value" type="button" onClick={() => setZoomOpen((value) => !value)} aria-expanded={zoomOpen} aria-label="缩放选项" title="缩放选项">{Math.round(zoom * 100)}%</button>
      </div>
      <ZoomOptions open={zoomOpen} zoom={zoom} onClose={() => setZoomOpen(false)} onFit={onFit} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onSetZoom={onSetZoom} />
      <CanvasAssetManager open={assetManagerOpen} draft={draft} onClose={() => setAssetManagerOpen(false)} onSelectNode={onSelectNode} />
    </>
  );
}

function EmptyCanvasGuide({ onAddNode }) {
  return (
    <section className="empty-canvas-guide" data-canvas-control aria-label="从模板开始创作">
      <p>从一个节点开始你的创作</p>
      <div>
        <button type="button" onClick={() => onAddNode({ kind: "composition", role: "text" })}><TextT weight="bold" aria-hidden="true" /><span>故事脚本</span></button>
        <button type="button" onClick={() => onAddNode({ kind: "shot", mediaKind: "image" })}><ImageSquare weight="fill" aria-hidden="true" /><span>角色设定</span></button>
        <button type="button" onClick={() => onAddNode({ kind: "shot", mediaKind: "video" })}><FilmSlate weight="fill" aria-hidden="true" /><span>视频镜头</span></button>
      </div>
    </section>
  );
}

function CanvasViewportInner({ draft, selectedNodeId, onSelectNode, onOpenPreview, onMoveNode, onAddNode, onConnectNodes, onDeleteEdges, onUpdatePrompt, onArrange }) {
  const viewportRef = useRef(null);
  const isCompactViewport = window.innerWidth <= 700;
  const fitMaxZoom = window.innerWidth <= 800 ? 0.37 : 0.64;
  const { fitView, getViewport, screenToFlowPosition, setViewport, zoomIn, zoomOut } = useReactFlow();
  const [tool, setTool] = useState("select");
  const [showEdges, setShowEdges] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_CANVAS_ZOOM);
  const initialViewport = useMemo(() => ({
    x: Math.round(Math.min(412, Math.max(24, window.innerWidth * 0.32))),
    y: Math.round(Math.min(240, Math.max(96, window.innerHeight * 0.33))),
    zoom: DEFAULT_CANVAS_ZOOM,
  }), []);

  const focusNode = useCallback((nodeId) => onSelectNode(nodeId), [onSelectNode]);

  const nodeData = useMemo(() => ({ onOpenPreview, onFocusNode: focusNode, onUpdatePrompt }), [focusNode, onOpenPreview, onUpdatePrompt]);
  const projectedNodes = useMemo(
    () => toFlowNodes(draft, selectedNodeId, nodeData, CANVAS_PRESENTATION_SCALE),
    [draft, nodeData, selectedNodeId],
  );
  const [nodes, setNodes, handleNodesChange] = useNodesState(projectedNodes);
  const edges = useMemo(() => showEdges ? toFlowEdges(draft) : [], [draft, showEdges]);

  useEffect(() => {
    setNodes(projectedNodes);
  }, [projectedNodes, setNodes]);

  const handleFit = useCallback(() => {
    void fitView({ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: fitMaxZoom, duration: 260 });
  }, [fitMaxZoom, fitView]);

  const handleSetZoom = useCallback((nextZoom) => {
    const current = getViewport();
    void setViewport({ ...current, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)) }, { duration: 120 });
  }, [getViewport, setViewport]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === "v") setTool("select");
      if (event.key.toLowerCase() === "h") setTool("pan");
      if (event.key === "0") handleFit();
      if (event.key === "+" || event.key === "=") void zoomIn({ duration: 120 });
      if (event.key === "-" || event.key === "_") void zoomOut({ duration: 120 });
      if (event.key === "Escape") onSelectNode(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleFit, onSelectNode, zoomIn, zoomOut]);

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
    <section ref={viewportRef} className={`canvas-viewport tool-${tool}`} data-testid="canvas-viewport" data-view={`0,0,${zoom.toFixed(3)}`} aria-label="无限画布。拖动节点编辑布局，滚轮缩放，空格拖动画布。">
      <ReactFlow
        key={draft.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onNodeClick={(_, node) => focusNode(node.id)}
        onNodeDragStart={(_, node) => onSelectNode(node.id)}
        onNodeDragStop={(_, node) => onMoveNode(node.id, {
          x: Math.round(node.position.x / CANVAS_PRESENTATION_SCALE),
          y: Math.round(node.position.y / CANVAS_PRESENTATION_SCALE),
        })}
        onPaneClick={() => onSelectNode(null)}
        onConnect={(connection) => {
          const mutation = connectionToGraphMutation(draft, connection);
          if (mutation) onConnectNodes(mutation);
        }}
        isValidConnection={(connection) => Boolean(connectionToGraphMutation(draft, connection))}
        onEdgesDelete={(deletedEdges) => onDeleteEdges(deletedEdges.map((edge) => edge.id))}
        onMove={(_, viewport) => setZoom(viewport.zoom)}
        nodesDraggable={tool === "select"}
        edgesReconnectable={false}
        panOnDrag={tool === "pan" ? true : [1, 2]}
        selectionOnDrag={tool === "select"}
        snapToGrid={snapToGrid}
        snapGrid={[20, 20]}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        defaultViewport={initialViewport}
        fitView={isCompactViewport}
        fitViewOptions={{ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: fitMaxZoom }}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        data-testid="react-flow-editor"
      >
        <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="#3c3c3c" />
        {showMinimap ? <MiniMap className="canvas-mini-map" maskColor="rgb(20 20 20 / 66%)" pannable zoomable /> : null}
      </ReactFlow>

      {draft.nodes.length === 0 ? <EmptyCanvasGuide onAddNode={addAtViewportCenter} /> : null}
      <CanvasAside
        draft={draft}
        onSelectNode={onSelectNode}
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
        onArrange={onArrange}
      />
      <CanvasDock tool={tool} onToolChange={setTool} onAddNode={addAtViewportCenter} />
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
