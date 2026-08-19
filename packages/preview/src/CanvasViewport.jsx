import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import {
  ArrowUp,
  CaretRight,
  CheckCircle,
  Clock,
  CornersOut,
  Cursor,
  FilmSlate,
  FileText,
  FolderSimple,
  GitBranch,
  Hand,
  ImageSquare,
  Keyboard,
  LinkSimple,
  List,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Paperclip,
  Pause,
  Plus,
  Question,
  Scissors,
  SpeakerHigh,
  Sparkle,
  SpinnerGap,
  Stack,
  TextAlignLeft,
  TextT,
  UploadSimple,
  VideoCamera,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { NODE_WIDTH } from "./project-document.js";
import {
  connectionToGraphMutation,
  findOpenNodePosition,
  HANDLE_IDS,
  toFlowEdges,
  toFlowNodes,
} from "./react-flow-model.js";

const MIN_ZOOM = 0.32;
const MAX_ZOOM = 1.8;
const FIT_VIEW_PADDING = { top: "106px", right: "14px", bottom: "132px", left: "14px" };

const CONTEXT_NODE_ROLES = new Set([
  "text",
  "smart-edit",
  "director",
  "frame-analysis",
  "audio",
  "script",
  "asset-library",
]);

const NODE_PRESENTATION = Object.freeze({
  text: { label: "文本", examples: ["撰写内容", "从文字生成视频", "从图片提取提示词", "从文字生成配乐"] },
  image: { label: "图片", examples: ["以图生成图片", "提升清晰度"] },
  video: { label: "视频", examples: ["延展视频", "用首尾帧生成", "用首帧生成"] },
  "smart-edit": { label: "编辑", examples: ["导入片段", "整理节奏", "添加转场"] },
  director: { label: "分镜", examples: ["拆解故事", "规划分镜", "组织镜头组"] },
  "frame-analysis": { label: "镜头分析", examples: ["上传参考", "分析镜头", "提取节奏"] },
  audio: { label: "音频", examples: ["生成配乐", "添加旁白", "设计环境音"] },
  script: { label: "脚本", examples: ["撰写大纲", "扩展场景", "拆解镜头"] },
  "asset-library": { label: "素材", examples: ["上传素材", "选择历史素材", "整理参考"] },
  composition: { label: "剪辑", examples: ["组合上游镜头", "调整叙事顺序", "继续编辑片段"] },
});

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

function nodePresentation(kind) {
  return NODE_PRESENTATION[kind] ?? NODE_PRESENTATION.composition;
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
        <p>{node.spec.prompt}</p>
      </div>
    );
  }
  if (asset && kind !== "text") {
    return (
      <button
        className="node-media node-media-asset nodrag"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenPreview(node, asset);
        }}
        aria-label={`打开 ${node.title} 的素材预览`}
      >
        <img src={asset.previewUrl} alt={`${node.title} 的生成画面`} draggable="false" />
        {kind === "video" ? <span className="node-play"><VideoCamera weight="fill" aria-hidden="true" /></span> : null}
      </button>
    );
  }

  return (
    <div className="node-media node-media-empty" aria-label={`${node.title} ${node.statusMeta.label}`}>
      <SurfaceIcon kind={kind} />
      <div className="node-empty-examples" aria-hidden="true">
        <span>尝试：</span>
        {nodePresentation(kind).examples.map((example) => <small key={example}>{example}</small>)}
      </div>
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
    <>
      <Handle
        id={id}
        className="canvas-handle"
        type={type}
        position={position}
        role="button"
        tabIndex={-1}
        aria-label={label}
      />
      <span className={`node-handle-glyph node-handle-glyph-${position}`} aria-hidden="true">
        <Plus weight="bold" />
      </span>
    </>
  );
}

function CanvasNode({ data, selected }) {
  const { cardHeight, node, onOpenPreview, onFocusNode, onUpdatePrompt } = data;
  const kind = getSurfaceKind(node);
  const isShot = node.kind === "shot";

  return (
    <article
      className={`canvas-node canvas-node-${kind} ${selected ? "selected" : ""}`}
      style={{ height: `${cardHeight}px` }}
      data-node-id={node.id}
      data-node-kind={kind}
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

      <div className="node-label" aria-hidden="true">
        <NodeLabelIcon kind={kind} />
        <span>{node.title}</span>
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

      {selected ? <NodeComposer node={node} kind={kind} onUpdatePrompt={onUpdatePrompt} /> : null}
    </article>
  );
}

const NODE_TYPES = { creatorNode: CanvasNode };

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

function CanvasDock({ tool, onToolChange, showEdges, onToggleEdges, onFit, onAddNode, onArrange }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <CanvasAddMenu open={menuOpen} onClose={() => setMenuOpen(false)} onAddNode={onAddNode} />
      <div className="canvas-dock" role="toolbar" aria-label="画布工具" data-canvas-control>
        <button className={`dock-add ${menuOpen ? "active" : ""}`} type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="添加节点" title="添加节点"><Plus weight="bold" aria-hidden="true" /></button>
        <button className={tool === "pan" ? "active" : ""} type="button" onClick={() => onToolChange(tool === "pan" ? "select" : "pan")} aria-pressed={tool === "pan"} aria-label={tool === "pan" ? "切换到选择工具" : "切换到抓手工具"} title={tool === "pan" ? "选择和移动节点 (V)" : "抓手工具 (H)"}>{tool === "pan" ? <Hand weight="fill" aria-hidden="true" /> : <Cursor weight="fill" aria-hidden="true" />}</button>
        <button className={showEdges ? "active" : ""} type="button" onClick={onToggleEdges} aria-pressed={showEdges} aria-label="显示连线" title="显示连线"><GitBranch aria-hidden="true" /></button>
        <button type="button" onClick={onArrange} aria-label="整理画布" title="整理画布"><Sparkle aria-hidden="true" /></button>
        <button type="button" onClick={onFit} aria-label="适合屏幕" title="适合屏幕 (0)"><LinkSimple aria-hidden="true" /></button>
        <button type="button" onClick={onFit} aria-label="重置画布视角" title="重置画布视角"><Clock aria-hidden="true" /></button>
        <span className="dock-divider" />
        <button type="button" aria-label="键盘快捷键" title="键盘快捷键"><Keyboard aria-hidden="true" /></button>
        <button type="button" aria-label="画布帮助" title="画布帮助"><Question aria-hidden="true" /></button>
      </div>
    </>
  );
}

function CanvasAside({ showEdges, onToggleEdges, onFit }) {
  return (
    <div className="canvas-aside" data-canvas-control>
      <button className="asset-manage-button" type="button" onClick={onFit} aria-label="资源管理" title="资源管理"><Stack aria-hidden="true" /><span>资源管理</span></button>
      <button className={showEdges ? "active" : ""} type="button" onClick={onToggleEdges} aria-pressed={showEdges} aria-label="显示连线" title="显示连线"><GitBranch aria-hidden="true" /></button>
      <button type="button" onClick={onFit} aria-label="画布概览" title="画布概览"><CornersOut aria-hidden="true" /></button>
      <button type="button" aria-label="画布提示" title="画布提示"><List aria-hidden="true" /></button>
    </div>
  );
}

function ZoomDock({ zoom, onZoomIn, onZoomOut, onFit }) {
  return (
    <div className="zoom-dock" role="group" aria-label="缩放控制" data-canvas-control>
      <button type="button" onClick={onZoomOut} aria-label="缩小画布"><MagnifyingGlassMinus aria-hidden="true" /></button>
      <button className="zoom-value" type="button" onClick={onFit} aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击适合屏幕`}>{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={onZoomIn} aria-label="放大画布"><MagnifyingGlassPlus aria-hidden="true" /></button>
    </div>
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
  const fitMaxZoom = window.innerWidth <= 800 ? 0.37 : 0.5;
  const { fitView, screenToFlowPosition, setCenter, zoomIn, zoomOut } = useReactFlow();
  const [tool, setTool] = useState("select");
  const [showEdges, setShowEdges] = useState(true);
  const [zoom, setZoom] = useState(1);

  const focusNode = useCallback((nodeId) => {
    const node = draft.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    onSelectNode(nodeId);
    const viewport = viewportRef.current?.getBoundingClientRect();
    if (!viewport || viewport.width === 0 || viewport.height === 0) return;
    void setCenter(
      node.position.x + NODE_WIDTH / 2,
      node.position.y + 175,
      { zoom: 1, duration: 240 },
    );
  }, [draft.nodes, onSelectNode, setCenter]);

  const nodeData = useMemo(() => ({ onOpenPreview, onFocusNode: focusNode, onUpdatePrompt }), [focusNode, onOpenPreview, onUpdatePrompt]);
  const projectedNodes = useMemo(() => toFlowNodes(draft, selectedNodeId, nodeData), [draft, nodeData, selectedNodeId]);
  const [nodes, setNodes, handleNodesChange] = useNodesState(projectedNodes);
  const edges = useMemo(() => showEdges ? toFlowEdges(draft) : [], [draft, showEdges]);

  useEffect(() => {
    setNodes(projectedNodes);
  }, [projectedNodes, setNodes]);

  const handleFit = useCallback(() => {
    void fitView({ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: fitMaxZoom, duration: 260 });
  }, [fitMaxZoom, fitView]);

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
    const preferredPosition = { x: Math.round(center.x - NODE_WIDTH / 2), y: Math.round(center.y - 188) };
    onAddNode(descriptor, findOpenNodePosition(draft, preferredPosition, descriptor.kind));
  }, [draft, onAddNode, screenToFlowPosition]);

  return (
    <section ref={viewportRef} className={`canvas-viewport tool-${tool}`} data-testid="canvas-viewport" data-view={`0,0,${zoom.toFixed(3)}`} aria-label="无限画布。拖动节点编辑布局，滚轮缩放，空格拖动画布。">
      <ReactFlow
        key={draft.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onNodeClick={(_, node) => focusNode(node.id)}
        onNodeDragStart={(_, node) => onSelectNode(node.id)}
        onNodeDragStop={(_, node) => onMoveNode(node.id, node.position)}
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
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        fitView={!isCompactViewport}
        fitViewOptions={{ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: fitMaxZoom }}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        data-testid="react-flow-editor"
      >
        <Background variant={BackgroundVariant.Dots} gap={44} size={1.5} color="#525252" />
      </ReactFlow>

      {draft.nodes.length === 0 ? <EmptyCanvasGuide onAddNode={addAtViewportCenter} /> : null}
      <CanvasAside showEdges={showEdges} onToggleEdges={() => setShowEdges((value) => !value)} onFit={handleFit} />
      <CanvasDock tool={tool} onToolChange={setTool} showEdges={showEdges} onToggleEdges={() => setShowEdges((value) => !value)} onFit={handleFit} onAddNode={addAtViewportCenter} onArrange={onArrange} />
      <ZoomDock zoom={zoom} onZoomIn={() => void zoomIn({ duration: 120 })} onZoomOut={() => void zoomOut({ duration: 120 })} onFit={handleFit} />
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
