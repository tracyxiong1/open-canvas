import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  SlidersHorizontal,
  SpinnerGap,
  Stack,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  getNodeHeight,
  NODE_WIDTH,
  truncateIdentifier,
} from "./project-document.js";

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;
const PARAMETER_PANEL_HEIGHT = 258;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function graphBounds(draft, selectedNodeId) {
  const bounds = draft.nodes.reduce(
    (result, node) => {
      const height = getNodeHeight(node) + (node.id === selectedNodeId ? PARAMETER_PANEL_HEIGHT + 14 : 0);
      return {
        minX: Math.min(result.minX, node.position.x),
        minY: Math.min(result.minY, node.position.y),
        maxX: Math.max(result.maxX, node.position.x + NODE_WIDTH),
        maxY: Math.max(result.maxY, node.position.y + height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  if (!Number.isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return bounds;
}

function edgeGeometry(edge, nodesById) {
  const source = nodesById.get(edge.sourceNodeId);
  const target = nodesById.get(edge.targetNodeId);
  if (!source || !target) return null;

  if (edge.kind === "sequence") {
    const x1 = source.position.x + NODE_WIDTH;
    const y1 = source.position.y + getNodeHeight(source) / 2;
    const x2 = target.position.x;
    const y2 = target.position.y + getNodeHeight(target) / 2;
    const curve = Math.max(54, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
  }

  const x1 = source.position.x + NODE_WIDTH / 2;
  const y1 = source.position.y + getNodeHeight(source);
  const x2 = target.position.x + NODE_WIDTH / 2;
  const y2 = target.position.y;
  const curve = Math.max(76, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + curve}, ${x2} ${y2 - curve}, ${x2} ${y2}`;
}

function EdgeLayer({ draft, visible }) {
  const nodesById = useMemo(
    () => new Map(draft.nodes.map((node) => [node.id, node])),
    [draft.nodes],
  );

  if (!visible) return null;

  return (
    <svg className="edge-layer" width="1400" height="920" aria-label="节点连线">
      <defs>
        <marker id="sequence-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
        <marker id="dependency-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      {draft.edges.map((edge) => {
        const path = edgeGeometry(edge, nodesById);
        if (!path) return null;
        return (
          <path
            key={edge.id}
            className={`edge-path ${edge.kind}`}
            d={path}
            markerEnd={`url(#${edge.kind}-arrow)`}
            data-edge-kind={edge.kind}
          >
            <title>{edge.kind === "sequence" ? "镜头顺序" : "生成依赖"}</title>
          </path>
        );
      })}
    </svg>
  );
}

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
        className="open-preview-button"
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

function ParameterPanel({ node }) {
  const requirements = node.spec.requirements ?? {};
  const route = node.route;
  const fingerprint = truncateIdentifier(node.execution.inputFingerprint, 16, 8);
  const routeSource = {
    prompt_override: "提示词指定",
    ai_choice: "AI 选择",
    registry_default: "默认路由",
  }[route?.selectionSource];

  return (
    <section className="parameter-panel" onClick={(event) => event.stopPropagation()} aria-label={`${node.title} 参数`}>
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

      {node.kind === "shot" ? <p className="prompt-copy">{node.spec.prompt}</p> : (
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

export function CanvasNode({ node, selected, onSelect, onOpenPreview }) {
  const requirements = node.spec.requirements ?? {};
  const nodeHeight = getNodeHeight(node);

  return (
    <article
      className={`canvas-node ${selected ? "selected" : ""}`}
      style={{
        left: `${node.position.x}px`,
        top: `${node.position.y}px`,
        height: `${nodeHeight}px`,
      }}
      data-node-id={node.id}
      data-node-status={node.status}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
    >
      <button
        className="node-header"
        type="button"
        aria-pressed={selected}
        aria-label={`${node.title}，${node.statusMeta.label}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.id);
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
      </button>

      <MediaPreview node={node} onOpenPreview={onOpenPreview} />

      <footer className="node-footer">
        <span>{node.kind === "composition" ? <Stack aria-hidden="true" /> : <ImageSquare aria-hidden="true" />}</span>
        <span>{requirements.aspectRatio ?? "16:9"}</span>
        <span>{requirements.durationSeconds ? `${requirements.durationSeconds}s` : node.kind === "composition" ? "合成" : "自动"}</span>
        <span className="node-id">{truncateIdentifier(node.id, 9, 4)}</span>
      </footer>

      {selected ? (
        <>
          <span className="port input-port" aria-hidden="true" />
          <span className="port output-port" aria-hidden="true" />
          <ParameterPanel node={node} />
        </>
      ) : null}
    </article>
  );
}

function CanvasDock({ tool, onToolChange, showEdges, onToggleEdges, onFit }) {
  return (
    <div className="canvas-dock" role="toolbar" aria-label="画布工具">
      <button
        className={tool === "select" ? "active" : ""}
        type="button"
        onClick={() => onToolChange("select")}
        aria-pressed={tool === "select"}
        aria-label="选择节点"
        title="选择节点 (V)"
      >
        <Cursor weight="fill" aria-hidden="true" />
      </button>
      <button
        className={tool === "pan" ? "active" : ""}
        type="button"
        onClick={() => onToolChange("pan")}
        aria-pressed={tool === "pan"}
        aria-label="平移画布"
        title="平移画布 (H)"
      >
        <Hand weight="fill" aria-hidden="true" />
      </button>
      <span className="dock-divider" />
      <button
        className={showEdges ? "active" : ""}
        type="button"
        onClick={onToggleEdges}
        aria-pressed={showEdges}
        aria-label="显示连线"
        title="显示连线"
      >
        <GitBranch aria-hidden="true" />
      </button>
      <button type="button" onClick={onFit} aria-label="适合屏幕" title="适合屏幕 (0)">
        <CornersOut aria-hidden="true" />
      </button>
    </div>
  );
}

function ZoomDock({ zoom, onZoomIn, onZoomOut, onFit }) {
  return (
    <div className="zoom-dock" aria-label="缩放控制">
      <button type="button" onClick={onZoomOut} aria-label="缩小画布">
        <MagnifyingGlassMinus aria-hidden="true" />
      </button>
      <button className="zoom-value" type="button" onClick={onFit} aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击适合屏幕`}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" onClick={onZoomIn} aria-label="放大画布">
        <MagnifyingGlassPlus aria-hidden="true" />
      </button>
    </div>
  );
}

function EdgeLegend() {
  return (
    <div className="edge-legend" aria-label="连线图例">
      <span><i className="sequence-sample" />顺序</span>
      <span><i className="dependency-sample" />依赖</span>
    </div>
  );
}

export function CanvasViewport({ draft, selectedNodeId, onSelectNode, onOpenPreview }) {
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const layoutKeyRef = useRef(null);
  const [tool, setTool] = useState("select");
  const [showEdges, setShowEdges] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 600);
  const [view, setView] = useState({ x: 160, y: 148, scale: 0.86 });

  const selectedNode = draft.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const fitView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const width = rect.width || window.innerWidth || 1440;
    const height = rect.height || window.innerHeight || 900;
    const bounds = graphBounds(draft, selectedNodeId);
    const horizontalPadding = width < 600 ? 48 : 176;
    const verticalPadding = width < 600 ? 210 : 228;
    const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
    const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale = clamp(
      Math.min((width - horizontalPadding) / graphWidth, (height - verticalPadding) / graphHeight),
      MIN_ZOOM,
      width < 600 ? 0.72 : 1.05,
    );
    setView({
      x: (width - graphWidth * scale) / 2 - bounds.minX * scale,
      y: Math.max(86, (height - graphHeight * scale) / 2 - bounds.minY * scale),
      scale,
    });
  }, [draft, selectedNodeId]);

  useEffect(() => {
    const updateViewportMode = () => setIsMobileViewport(window.innerWidth < 600);
    window.addEventListener("resize", updateViewportMode);
    return () => window.removeEventListener("resize", updateViewportMode);
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const width = rect.width || window.innerWidth || 1440;
    const layoutKey = isMobileViewport
      ? `${draft.id}:mobile:${selectedNodeId ?? "none"}`
      : `${draft.id}:desktop`;
    if (layoutKeyRef.current === layoutKey) return;
    layoutKeyRef.current = layoutKey;
    const target = draft.nodes.find((node) => node.id === selectedNodeId) ?? draft.nodes[0];

    if (isMobileViewport && target) {
      const scale = 0.72;
      setView({ x: 46 - target.position.x * scale, y: 118 - target.position.y * scale, scale });
    } else {
      const bounds = graphBounds(draft, null);
      const graphWidth = bounds.maxX - bounds.minX;
      const scale = 0.86;
      setView({ x: (width - graphWidth * scale) / 2 - bounds.minX * scale, y: 148, scale });
    }
  }, [draft, isMobileViewport, selectedNodeId]);

  const zoomAt = useCallback((factor, point) => {
    setView((current) => {
      const nextScale = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM);
      const ratio = nextScale / current.scale;
      return {
        x: point.x - (point.x - current.x) * ratio,
        y: point.y - (point.y - current.y) * ratio,
        scale: nextScale,
      };
    });
  }, []);

  const zoomFromCenter = useCallback((factor) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    zoomAt(factor, {
      x: (rect?.width ?? window.innerWidth) / 2,
      y: (rect?.height ?? window.innerHeight) / 2,
    });
  }, [zoomAt]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === "v") setTool("select");
      if (event.key.toLowerCase() === "h") setTool("pan");
      if (event.key === "0") fitView();
      if (event.key === "+" || event.key === "=") zoomFromCenter(1.15);
      if (event.key === "-" || event.key === "_") zoomFromCenter(1 / 1.15);
      if (event.key === "Escape") onSelectNode(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fitView, onSelectNode, zoomFromCenter]);

  const handlePointerDown = (event) => {
    const canPan = event.button === 1 || tool === "pan" || event.pointerType === "touch";
    if (!canPan) {
      onSelectNode(null);
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    setDragging(true);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      x: drag.viewX + event.clientX - drag.x,
      y: drag.viewY + event.clientY - drag.y,
    }));
  };

  const endPan = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    const rect = viewportRef.current.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * 0.0015), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const gridStyle = {
    "--grid-size": `${24 * view.scale}px`,
    "--grid-x": `${view.x}px`,
    "--grid-y": `${view.y}px`,
  };

  return (
    <section
      ref={viewportRef}
      className={`canvas-viewport tool-${tool} ${dragging ? "dragging" : ""}`}
      style={gridStyle}
      data-testid="canvas-viewport"
      data-view={`${Math.round(view.x)},${Math.round(view.y)},${view.scale.toFixed(3)}`}
      aria-label="无限画布。拖动平移，滚轮缩放。"
      tabIndex="0"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onWheel={handleWheel}
    >
      <div
        className="canvas-world"
        style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
      >
        <EdgeLayer draft={draft} visible={showEdges} />
        {draft.nodes.map((node) => (
          <CanvasNode
            key={node.id}
            node={node}
            selected={node.id === selectedNodeId}
            onSelect={onSelectNode}
            onOpenPreview={onOpenPreview}
          />
        ))}
      </div>

      <EdgeLegend />
      <CanvasDock
        tool={tool}
        onToolChange={setTool}
        showEdges={showEdges}
        onToggleEdges={() => setShowEdges((value) => !value)}
        onFit={fitView}
      />
      <ZoomDock
        zoom={view.scale}
        onZoomIn={() => zoomFromCenter(1.15)}
        onZoomOut={() => zoomFromCenter(1 / 1.15)}
        onFit={fitView}
      />
    </section>
  );
}
