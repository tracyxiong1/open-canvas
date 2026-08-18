import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import {
  ArrowsOut,
  CheckCircle,
  Clock,
  CornersOut,
  Cursor,
  FilmSlate,
  GitBranch,
  Hand,
  ImageSquare,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Pause,
  Plus,
  SlidersHorizontal,
  SpinnerGap,
  Stack,
  WarningCircle,
} from "@phosphor-icons/react";
import { NODE_WIDTH, truncateIdentifier } from "./project-document.js";
import {
  connectionToGraphMutation,
  findOpenNodePosition,
  HANDLE_IDS,
  toFlowEdges,
  toFlowNodes,
} from "./react-flow-model.js";

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;
const FIT_VIEW_PADDING = { top: "104px", right: "64px", bottom: "96px", left: "64px" };

function StatusIcon({ status }) {
  if (status === "succeeded") return <CheckCircle weight="fill" aria-hidden="true" />;
  if (status === "running") return <SpinnerGap className="spin" aria-hidden="true" />;
  if (status === "queued") return <Clock weight="fill" aria-hidden="true" />;
  if (status === "failed") return <WarningCircle weight="fill" aria-hidden="true" />;
  return <Pause weight="fill" aria-hidden="true" />;
}

function GenerationPlaceholder({ node }) {
  const progress = Math.round((node.activeJob?.progress ?? 0) * 100);
  const copy = {
    dirty: "参数已更改，等待下一次生成",
    queued: "任务已进入生成队列",
    running: `正在生成 · ${progress}%`,
    succeeded: "输出素材尚未挂载到此预览",
    failed: node.activeJob?.error?.message ?? "本次生成未完成",
  }[node.status];

  return (
    <div className={`generation-placeholder ${node.status}`}>
      <StatusIcon status={node.status} />
      <span>{copy}</span>
      {node.status === "running" ? (
        <div className="progress-track" aria-label={`生成进度 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function MediaPreview({ node, onOpenPreview }) {
  const asset = node.outputAssets.find((item) => item.previewUrl);
  if (!asset) return <GenerationPlaceholder node={node} />;

  return (
    <div className="media-preview">
      <img src={asset.previewUrl} alt={`${node.title} 的生成画面`} draggable="false" />
      <span className="preview-kind">{node.kind === "composition" ? "合成预览" : "视频预览帧"}</span>
      <button
        className="open-preview-button nodrag"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenPreview(node, asset);
        }}
        aria-label={`打开 ${node.title} 的素材预览`}
      >
        <ArrowsOut aria-hidden="true" />
      </button>
    </div>
  );
}

function ParameterPanel({ node, onUpdatePrompt }) {
  const [prompt, setPrompt] = useState(node.spec.kind === "shot" ? node.spec.prompt : "");
  const requirements = node.spec.requirements ?? {};
  const route = node.route;
  const fingerprint = truncateIdentifier(node.execution.inputFingerprint, 16, 8);
  const routeSource = {
    prompt_override: "提示词指定",
    ai_choice: "AI 选择",
    registry_default: "默认路由",
  }[route?.selectionSource];

  useEffect(() => {
    setPrompt(node.spec.kind === "shot" ? node.spec.prompt : "");
  }, [node.id, node.specRevision, node.spec]);

  const submitPrompt = (event) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (node.spec.kind !== "shot" || !nextPrompt || nextPrompt === node.spec.prompt) return;
    onUpdatePrompt(node.id, nextPrompt);
  };

  return (
    <section
      className="parameter-panel nodrag nowheel"
      onClick={(event) => event.stopPropagation()}
      aria-label={`${node.title} 参数`}
    >
      <header>
        <span className="parameter-heading">
          <SlidersHorizontal aria-hidden="true" />
          参数
        </span>
        <span className={`status-pill ${node.statusMeta.tone}`}>
          <StatusIcon status={node.status} />
          {node.statusMeta.label}
        </span>
      </header>

      {node.kind === "shot" ? (
        <form className="prompt-editor" onSubmit={submitPrompt}>
          <label htmlFor={`prompt-${node.id}`}>Prompt</label>
          <textarea
            id={`prompt-${node.id}`}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitPrompt(event);
            }}
            rows="3"
          />
          <button
            type="submit"
            disabled={!prompt.trim() || prompt.trim() === node.spec.prompt}
          >
            应用更改
          </button>
        </form>
      ) : (
        <p className="prompt-copy">按镜头顺序合成所有有效依赖输出。</p>
      )}

      <dl className="parameter-grid">
        <div>
          <dt>类型</dt>
          <dd>{node.kind === "shot" ? (node.spec.mediaKind === "video" ? "视频镜头" : "图片镜头") : "最终合成"}</dd>
        </div>
        <div>
          <dt>画幅</dt>
          <dd>{requirements.aspectRatio ?? "继承输入"}</dd>
        </div>
        <div>
          <dt>时长</dt>
          <dd>{requirements.durationSeconds ? `${requirements.durationSeconds}s` : "按输入"}</dd>
        </div>
        <div>
          <dt>版本</dt>
          <dd>r{node.specRevision}</dd>
        </div>
      </dl>

      <div className="parameter-footer">
        <div>
          <span>路由</span>
          <strong>{route ? `${route.providerId} · ${route.modelId}` : "本地合成"}</strong>
          {routeSource ? <small>{routeSource}</small> : null}
        </div>
        <div>
          <span>指纹</span>
          <strong>{fingerprint}</strong>
        </div>
      </div>
    </section>
  );
}

function CanvasNode({ data, selected }) {
  const { cardHeight, node, onOpenPreview, onSelectNode, onUpdatePrompt } = data;
  const requirements = node.spec.requirements ?? {};

  return (
    <article
      className={`canvas-node ${selected ? "selected" : ""}`}
      style={{ height: `${cardHeight}px` }}
      data-node-id={node.id}
      data-node-status={node.status}
    >
      {node.kind === "shot" ? (
        <>
          <Handle id={HANDLE_IDS.sequenceTarget} className="canvas-handle sequence-handle" type="target" position={Position.Left} role="button" tabIndex={-1} aria-label="镜头顺序输入" />
          <Handle id={HANDLE_IDS.sequenceSource} className="canvas-handle sequence-handle" type="source" position={Position.Right} role="button" tabIndex={-1} aria-label="镜头顺序输出" />
          <Handle id={HANDLE_IDS.dependencySource} className="canvas-handle dependency-handle" type="source" position={Position.Bottom} role="button" tabIndex={-1} aria-label="生成依赖输出" />
        </>
      ) : (
        <Handle id={HANDLE_IDS.dependencyTarget} className="canvas-handle dependency-handle" type="target" position={Position.Top} role="button" tabIndex={-1} aria-label="生成依赖输入" />
      )}

      <div
        className="node-header"
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
        <span className="node-kind-icon" aria-hidden="true">
          {node.kind === "composition" ? <Stack weight="fill" /> : <FilmSlate weight="fill" />}
        </span>
        <strong title={node.title}>{node.title}</strong>
        <span className={`node-status ${node.statusMeta.tone}`} title={node.statusMeta.label}>
          <StatusIcon status={node.status} />
          <span>{node.statusMeta.label}</span>
        </span>
      </div>

      <MediaPreview node={node} onOpenPreview={onOpenPreview} />

      <footer className="node-footer">
        <span>{node.kind === "composition" ? <Stack aria-hidden="true" /> : <ImageSquare aria-hidden="true" />}</span>
        <span>{requirements.aspectRatio ?? "16:9"}</span>
        <span>{requirements.durationSeconds ? `${requirements.durationSeconds}s` : node.kind === "composition" ? "合成" : "自动"}</span>
        <span className="node-id">{truncateIdentifier(node.id, 9, 4)}</span>
      </footer>

      {selected ? <ParameterPanel node={node} onUpdatePrompt={onUpdatePrompt} /> : null}
    </article>
  );
}

const NODE_TYPES = { creatorNode: CanvasNode };

function CanvasDock({ tool, onToolChange, showEdges, onToggleEdges, onFit, onAddNode }) {
  return (
    <div className="canvas-dock" role="toolbar" aria-label="画布工具" data-canvas-control>
      <button className={tool === "select" ? "active" : ""} type="button" onClick={() => onToolChange("select")} aria-pressed={tool === "select"} aria-label="选择和移动节点" title="选择和移动节点 (V)">
        <Cursor weight="fill" aria-hidden="true" />
      </button>
      <button className={tool === "pan" ? "active" : ""} type="button" onClick={() => onToolChange("pan")} aria-pressed={tool === "pan"} aria-label="平移画布" title="平移画布 (H)">
        <Hand weight="fill" aria-hidden="true" />
      </button>
      <span className="dock-divider" />
      <button type="button" onClick={() => onAddNode("shot")} aria-label="新增镜头" title="新增镜头"><Plus aria-hidden="true" /></button>
      <button type="button" onClick={() => onAddNode("composition")} aria-label="新增合成" title="新增合成"><Stack aria-hidden="true" /></button>
      <span className="dock-divider" />
      <button className={showEdges ? "active" : ""} type="button" onClick={onToggleEdges} aria-pressed={showEdges} aria-label="显示连线" title="显示连线">
        <GitBranch aria-hidden="true" />
      </button>
      <button type="button" onClick={onFit} aria-label="适合屏幕" title="适合屏幕 (0)"><CornersOut aria-hidden="true" /></button>
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

function EdgeLegend() {
  return (
    <div className="edge-legend" role="group" aria-label="连线图例" data-canvas-control>
      <span><i className="sequence-sample" />顺序</span>
      <span><i className="dependency-sample" />依赖</span>
    </div>
  );
}

function CanvasViewportInner({ draft, selectedNodeId, onSelectNode, onOpenPreview, onMoveNode, onAddNode, onConnectNodes, onDeleteEdges, onUpdatePrompt }) {
  const viewportRef = useRef(null);
  const previousNodeCountRef = useRef(draft.nodes.length);
  const isCompactViewport = window.innerWidth <= 700;
  const { fitView, getNode, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow();
  const [tool, setTool] = useState("select");
  const [showEdges, setShowEdges] = useState(true);
  const [zoom, setZoom] = useState(1);

  const nodeData = useMemo(() => ({ onOpenPreview, onSelectNode, onUpdatePrompt }), [onOpenPreview, onSelectNode, onUpdatePrompt]);
  const projectedNodes = useMemo(() => toFlowNodes(draft, selectedNodeId, nodeData), [draft, nodeData, selectedNodeId]);
  const [nodes, setNodes, handleNodesChange] = useNodesState(projectedNodes);
  const edges = useMemo(() => showEdges ? toFlowEdges(draft, MarkerType.ArrowClosed) : [], [draft, showEdges]);

  useEffect(() => {
    setNodes(projectedNodes);
  }, [projectedNodes, setNodes]);

  const handleFit = useCallback(() => {
    void fitView({ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: 1.05, duration: 260 });
  }, [fitView]);

  useEffect(() => {
    const previousCount = previousNodeCountRef.current;
    previousNodeCountRef.current = draft.nodes.length;
    if (draft.nodes.length <= previousCount) return undefined;
    const addedNodeId = draft.nodes.at(-1)?.id;
    const frame = window.requestAnimationFrame(() => {
      const addedNode = addedNodeId ? getNode(addedNodeId) : null;
      if (!addedNode) return;
      void fitView({
        nodes: [addedNode],
        padding: FIT_VIEW_PADDING,
        minZoom: 0.55,
        maxZoom: 0.9,
        duration: 260,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft.nodes, fitView, getNode]);

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

  const handleAddNode = (kind) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const center = screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2,
    });
    const preferredPosition = {
      x: Math.round(center.x - NODE_WIDTH / 2),
      y: Math.round(center.y - (kind === "composition" ? 96 : 107)),
    };
    onAddNode(kind, findOpenNodePosition(draft, preferredPosition, kind));
  };

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
        fitViewOptions={{ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: 1.05 }}
        onInit={(instance) => {
          if (!isCompactViewport || !selectedNodeId) return;
          window.requestAnimationFrame(() => {
            const selectedNode = instance.getNode(selectedNodeId);
            if (!selectedNode) return;
            void instance.fitView({
              nodes: [selectedNode],
              padding: FIT_VIEW_PADDING,
              minZoom: 0.55,
              maxZoom: 0.72,
              duration: 0,
            });
          });
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        data-testid="react-flow-editor"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.15} color="var(--grid-dot)" />
      </ReactFlow>

      <EdgeLegend />
      <CanvasDock tool={tool} onToolChange={setTool} showEdges={showEdges} onToggleEdges={() => setShowEdges((value) => !value)} onFit={handleFit} onAddNode={handleAddNode} />
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
