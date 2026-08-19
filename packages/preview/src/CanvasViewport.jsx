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
  ArrowsClockwise,
  CheckCircle,
  Clock,
  CornersOut,
  Cursor,
  FilmSlate,
  GitBranch,
  Hand,
  ImageSquare,
  LinkSimple,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Paperclip,
  Pause,
  Plus,
  Sparkle,
  SpinnerGap,
  Stack,
  TextAlignLeft,
  TextT,
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

function StatusIcon({ status }) {
  if (status === "succeeded") return <CheckCircle weight="fill" aria-hidden="true" />;
  if (status === "running") return <SpinnerGap className="spin" aria-hidden="true" />;
  if (status === "queued") return <Clock weight="fill" aria-hidden="true" />;
  if (status === "failed") return <WarningCircle weight="fill" aria-hidden="true" />;
  return <Pause weight="fill" aria-hidden="true" />;
}

function getSurfaceKind(node) {
  if (node.kind === "composition") return node.spec.role === "text" ? "text" : "composition";
  return node.spec.mediaKind === "image" ? "image" : "video";
}

function SurfaceIcon({ kind }) {
  if (kind === "text") return <TextT weight="thin" aria-hidden="true" />;
  if (kind === "image") return <ImageSquare weight="thin" aria-hidden="true" />;
  if (kind === "composition") return <Stack weight="thin" aria-hidden="true" />;
  return <VideoCamera weight="thin" aria-hidden="true" />;
}

function NodeLabelIcon({ kind }) {
  if (kind === "text") return <TextT weight="bold" aria-hidden="true" />;
  if (kind === "image") return <ImageSquare weight="fill" aria-hidden="true" />;
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
      {node.status !== "dirty" ? (
        <span className={`node-status-dot ${node.statusMeta.tone}`} title={node.statusMeta.label}>
          <StatusIcon status={node.status} />
        </span>
      ) : null}
    </div>
  );
}

function NodeComposer({ node, kind, onUpdatePrompt }) {
  const canEditPrompt = node.kind === "shot" || (node.kind === "composition" && node.spec.role === "text");
  const [prompt, setPrompt] = useState(canEditPrompt ? node.spec.prompt : "");
  const requirements = node.spec.requirements ?? {};

  useEffect(() => {
    setPrompt(node.spec.kind === "shot" || node.spec.role === "text" ? node.spec.prompt : "");
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

function CanvasNode({ data, selected }) {
  const { cardHeight, node, onOpenPreview, onSelectNode, onUpdatePrompt } = data;
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
          <Handle id={HANDLE_IDS.sequenceTarget} className="canvas-handle sequence-handle" type="target" position={Position.Left} role="button" tabIndex={-1} aria-label="镜头顺序输入" />
          <Handle id={HANDLE_IDS.sequenceSource} className="canvas-handle sequence-handle" type="source" position={Position.Right} role="button" tabIndex={-1} aria-label="镜头顺序输出" />
          <Handle id={HANDLE_IDS.dependencySource} className="canvas-handle dependency-handle" type="source" position={Position.Bottom} role="button" tabIndex={-1} aria-label="生成依赖输出" />
        </>
      ) : (
        <Handle id={HANDLE_IDS.dependencyTarget} className="canvas-handle dependency-handle" type="target" position={Position.Left} role="button" tabIndex={-1} aria-label="组合输入" />
      )}

      <div className="node-label" aria-hidden="true">
        <NodeLabelIcon kind={kind} />
        <span>{node.title}</span>
        <small>{isShot ? (kind === "image" ? "图片" : "视频") : (kind === "text" ? "文本" : "剪辑")}</small>
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
            onSelectNode(node.id);
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

function CanvasAddMenu({ open, onClose, onAddNode, onArrange }) {
  if (!open) return null;
  return (
    <div className="canvas-add-menu" role="menu" aria-label="添加画布节点" data-canvas-control>
      <button className="add-menu-close" type="button" onClick={onClose} aria-label="关闭添加菜单"><X aria-hidden="true" /></button>
      <div className="add-menu-primary">
        <button type="button" role="menuitem" onClick={() => { onAddNode({ kind: "composition", presentation: "text" }); onClose(); }}>
          <TextT weight="fill" aria-hidden="true" /><span><strong>文本</strong><small>记录创作意图</small></span>
        </button>
        <button type="button" role="menuitem" onClick={() => { onAddNode({ kind: "shot", mediaKind: "image" }); onClose(); }}>
          <ImageSquare weight="fill" aria-hidden="true" /><span><strong>图片</strong><small>生成或引用画面</small></span>
        </button>
        <button type="button" role="menuitem" onClick={() => { onAddNode({ kind: "shot", mediaKind: "video" }); onClose(); }}>
          <VideoCamera weight="fill" aria-hidden="true" /><span><strong>视频</strong><small>创建动态镜头</small></span>
        </button>
      </div>
      <div className="add-menu-utility">
        <button type="button" role="menuitem" onClick={() => { onArrange(); onClose(); }}><ArrowsClockwise aria-hidden="true" />整理画布</button>
        <button type="button" role="menuitem" onClick={() => { onAddNode({ kind: "composition", presentation: "edit" }); onClose(); }}><Stack aria-hidden="true" />新增剪辑</button>
      </div>
    </div>
  );
}

function CanvasDock({ tool, onToolChange, showEdges, onToggleEdges, onFit, onAddNode, onArrange }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <CanvasAddMenu open={menuOpen} onClose={() => setMenuOpen(false)} onAddNode={onAddNode} onArrange={onArrange} />
      <div className="canvas-dock" role="toolbar" aria-label="画布工具" data-canvas-control>
        <button className={`dock-add ${menuOpen ? "active" : ""}`} type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="添加节点" title="添加节点"><Plus weight="bold" aria-hidden="true" /></button>
        <span className="dock-divider" />
        <button className={tool === "select" ? "active" : ""} type="button" onClick={() => onToolChange("select")} aria-pressed={tool === "select"} aria-label="选择和移动节点" title="选择和移动节点 (V)"><Cursor weight="fill" aria-hidden="true" /></button>
        <button className={tool === "pan" ? "active" : ""} type="button" onClick={() => onToolChange("pan")} aria-pressed={tool === "pan"} aria-label="平移画布" title="抓手工具 (H)"><Hand weight="fill" aria-hidden="true" /></button>
        <button type="button" onClick={onArrange} aria-label="整理画布" title="整理画布"><ArrowsClockwise aria-hidden="true" /></button>
        <button className={showEdges ? "active" : ""} type="button" onClick={onToggleEdges} aria-pressed={showEdges} aria-label="显示连线" title="显示连线"><LinkSimple aria-hidden="true" /></button>
        <span className="dock-divider" />
        <button type="button" onClick={onFit} aria-label="适合屏幕" title="适合屏幕 (0)"><CornersOut aria-hidden="true" /></button>
      </div>
    </>
  );
}

function CanvasAside({ showEdges, onToggleEdges, onFit }) {
  return (
    <div className="canvas-aside" data-canvas-control>
      <button type="button" onClick={onFit} aria-label="定位全部节点" title="定位全部节点"><CornersOut aria-hidden="true" /></button>
      <button className={showEdges ? "active" : ""} type="button" onClick={onToggleEdges} aria-pressed={showEdges} aria-label="显示连线" title="显示连线"><GitBranch aria-hidden="true" /></button>
      <button type="button" aria-label="画布提示" title="画布提示"><Sparkle aria-hidden="true" /></button>
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
        <button type="button" onClick={() => onAddNode({ kind: "composition", presentation: "text" })}><TextT weight="bold" aria-hidden="true" /><span>故事脚本</span></button>
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
  const { fitView, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow();
  const [tool, setTool] = useState("select");
  const [showEdges, setShowEdges] = useState(true);
  const [zoom, setZoom] = useState(1);

  const nodeData = useMemo(() => ({ onOpenPreview, onSelectNode, onUpdatePrompt }), [onOpenPreview, onSelectNode, onUpdatePrompt]);
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
        onNodeClick={(_, node) => onSelectNode(node.id)}
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
        onInit={(instance) => {
          if (!isCompactViewport || !selectedNodeId) return;
          window.requestAnimationFrame(() => {
            const selectedNode = instance.getNode(selectedNodeId);
            if (!selectedNode) return;
            void instance.fitView({ nodes: [selectedNode], padding: FIT_VIEW_PADDING, minZoom: 0.42, maxZoom: 0.62, duration: 0 });
          });
        }}
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
