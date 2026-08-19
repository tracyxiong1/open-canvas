import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Aperture,
  ArrowLeft,
  ArrowUp,
  ArrowsOutSimple,
  BezierCurve,
  CaretRight,
  CheckCircle,
  Clock,
  CornersOut,
  Crop,
  Crosshair,
  Cube,
  Cursor,
  DownloadSimple,
  Eraser,
  FilmSlate,
  FileText,
  FolderSimple,
  GridFour,
  GlobeHemisphereWest,
  GitBranch,
  HighDefinition,
  ImageSquare,
  Keyboard,
  Magnet,
  MapTrifold,
  MagnifyingGlassPlus,
  Minus,
  Paperclip,
  PaintBrush,
  Pause,
  PencilSimple,
  Plus,
  Question,
  Scissors,
  Shapes,
  SpeakerHigh,
  Sparkle,
  SpinnerGap,
  Stack,
  Smiley,
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
const MAX_ZOOM = 8;
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
  if (kind === "text") return <TextAlignLeft weight="regular" aria-hidden="true" />;
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

function NodeComposer({ node, kind, graph, onUpdatePrompt }) {
  const canEditPrompt = node.kind === "shot" || isContextNode(node);
  const [prompt, setPrompt] = useState(canEditPrompt ? node.spec.prompt : "");
  const requirements = node.spec.requirements ?? {};
  const upstreamNode = graph?.edges?.map((edge) => edge.targetNodeId === node.id ? graph.nodes.find((item) => item.id === edge.sourceNodeId) : null)
    .find(Boolean);
  const upstreamPreview = upstreamNode?.outputAssets.find((asset) => asset.previewUrl)?.previewUrl ?? null;

  useEffect(() => {
    setPrompt(node.spec.kind === "shot" || isContextNode(node) ? node.spec.prompt : "");
  }, [node.id, node.specRevision, node.spec]);

  const submitPrompt = (event) => {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!canEditPrompt || !nextPrompt || nextPrompt === node.spec.prompt) return;
    onUpdatePrompt(node.id, nextPrompt);
  };

  if (kind === "text") {
    return (
      <section
        className="node-composer node-composer-text nodrag nowheel"
        onClick={(event) => event.stopPropagation()}
        aria-label={`${node.title} 参数`}
      >
        <form onSubmit={submitPrompt}>
          <div className="text-composer-reference" aria-hidden="true">
            <span className="text-composer-reference-thumb">
              {upstreamPreview ? <img src={upstreamPreview} alt="" draggable="false" /> : <ImageSquare weight="fill" />}
            </span>
            <span className="text-composer-reference-count">1</span>
          </div>
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
            <button className="text-composer-model" type="button" aria-label="选择理解模型">
              <Sparkle weight="fill" aria-hidden="true" /><span>视觉理解 3.1</span><CaretRight aria-hidden="true" />
            </button>
            <span className="text-composer-spacer" />
            <button className="text-composer-utility" type="button" aria-label="翻译文本"><TextT aria-hidden="true" /></button>
            <button className="text-composer-utility" type="button" aria-label="增强文本"><Sparkle weight="fill" aria-hidden="true" /></button>
            <button
              className="text-composer-submit"
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

  return (
    <section
      className="node-composer node-composer-media nodrag nowheel"
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
        <footer className="composer-tools composer-tools-media">
          <div className="composer-settings-group">
            <button type="button" className="composer-provider" aria-label="选择生成模型"><Sparkle weight="fill" aria-hidden="true" /><span>图像模型</span><CaretRight aria-hidden="true" /></button>
            <span className="composer-divider" />
            <button type="button" className="composer-settings" aria-label="调整图像规格"><span>{`${requirements.aspectRatio ?? "16:9"} · 标准画质 · ${requirements.width ? "2K" : "高清"} · 1张`}</span><CaretRight aria-hidden="true" /></button>
            <span className="composer-divider" />
            <button type="button" className="composer-utility composer-preset" aria-label="预设"><Shapes aria-hidden="true" /></button>
            <button type="button" className="composer-utility" aria-label="扩展图像参数"><Aperture aria-hidden="true" /></button>
          </div>
          <div className="composer-tools-end">
            <div className="composer-utilities">
              <button type="button" className="composer-utility" aria-label="翻译提示词"><TextT aria-hidden="true" /></button>
              <button type="button" className="composer-utility" aria-label="提示词调节"><Sparkle weight="fill" aria-hidden="true" /></button>
            </div>
            <div className="composer-submit-group">
              <span className={`composer-state ${node.statusMeta.tone}`} title={node.statusMeta.label}><StatusIcon status={node.status} /></span>
              <button
                className="composer-submit"
                type="submit"
                disabled={!canEditPrompt || !prompt.trim() || prompt.trim() === node.spec.prompt}
                aria-label="应用提示词"
              >
                <ArrowUp weight="bold" aria-hidden="true" />
              </button>
            </div>
          </div>
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
    >
        <span className={`canvas-handle-hit-area canvas-handle-hit-area-${position}`}>
          <span className="canvas-handle-visual" aria-hidden="true">
            <Plus weight="regular" />
          </span>
        </span>
    </Handle>
  );
}

function NodeQuickActions({ kind, node, className = "", style }) {
  const [openMenu, setOpenMenu] = useState(null);
  if (kind !== "image" && kind !== "video") return null;
  const actionMenus = {
    高清: {
      label: "图像快捷操作",
      variant: "compact",
      items: [
        { label: "高清", icon: HighDefinition },
        { label: "扩图", icon: CornersOut },
        { label: "重绘", icon: PencilSimple },
        { label: "擦除", icon: Eraser },
        { label: "抠图", icon: Scissors },
        { label: "裁剪", icon: Crop },
      ],
    },
    九宫格: {
      label: "分镜布局预设",
      variant: "grid",
      items: [
        { label: "多机位九宫格", icon: GridFour },
        { label: "剧情推演四宫格", icon: GridFour },
        { label: "角色脸部三视图", icon: Crosshair },
        { label: "角色设定图", icon: UserCircle },
        { label: "场景设定图", icon: Stack },
        { label: "产品设定图", icon: Cube },
        { label: "25宫格连贯分镜", icon: GridFour },
        { label: "电影级光影校正", icon: Aperture },
        { label: "角色三视图", icon: UsersThree },
        { label: "画面推演 - 3秒后", icon: FilmSlate },
        { label: "画面推演 - 5秒前", icon: FilmSlate },
      ],
    },
  };
  const portraitMenu = {
    label: "人像调节选项",
    variant: "portrait",
    items: [
      { label: "人像调节", icon: UserCircle },
      { label: "情绪调节", icon: Smiley },
    ],
  };
  const releasePointerFocus = (event) => {
    if (event.detail === 0) return;
    const button = event.currentTarget;
    window.requestAnimationFrame(() => button.blur());
  };
  const actions = kind === "image"
    ? [
      { label: "全景", icon: CornersOut, tooltip: "基于当前场景创建720°全景图" },
      { label: "多角度", icon: Crosshair, tooltip: "多角度" },
      { label: "打光", icon: Sparkle, tooltip: "打光" },
      { label: "九宫格", icon: GridFour, caret: true, tooltip: "九宫格布局" },
      { label: "高清", icon: HighDefinition, caret: true, tooltip: "清晰度设置" },
      { label: "宫格切分", icon: GridFour, caret: true, tooltip: "宫格切分" },
    ]
    : [
      { label: "运动", icon: Sparkle, tooltip: "运动控制" },
      { label: "多角度", icon: Crosshair, tooltip: "多角度" },
      { label: "打光", icon: Sparkle, tooltip: "打光" },
      { label: "九宫格", icon: GridFour, caret: true, tooltip: "九宫格布局" },
      { label: "高清", icon: HighDefinition, caret: true, tooltip: "清晰度设置" },
      { label: "宫格切分", icon: GridFour, caret: true, tooltip: "宫格切分" },
    ];

  const renderAction = ({ label, icon: Icon, caret, tooltip }) => {
    const menu = actionMenus[label];
    const items = menu?.items;
    const menuOpen = openMenu === label;
    const button = (
      <button
        className={`quick-action${menuOpen ? " active" : ""}`}
        type="button"
        aria-label={label}
        aria-expanded={menu ? menuOpen : undefined}
        aria-haspopup={menu ? "menu" : undefined}
        data-tooltip={menu ? undefined : tooltip ?? label}
        onClick={(event) => {
          event.stopPropagation();
          if (menu) setOpenMenu((current) => current === label ? null : label);
          releasePointerFocus(event);
        }}
      >
        <Icon weight="regular" aria-hidden="true" />
        <span>{label}</span>
        {caret ? <CaretRight className="quick-caret" weight="bold" aria-hidden="true" /> : null}
      </button>
    );

    if (!menu) return <span className="quick-action-menu-anchor" key={label}>{button}</span>;
    return (
      <span className="quick-action-menu-anchor" key={label}>
        {button}
        {menuOpen ? (
          <span className={`quick-action-submenu quick-action-submenu-${menu.variant}`} role="menu" aria-label={menu.label}>
            <span className="quick-action-submenu-inner">
              {items.map(({ label: item, icon: ItemIcon }, index) => (
                <button
                  key={item}
                  className={menu.variant === "compact" && index === 0 ? "active" : ""}
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenu(null);
                    releasePointerFocus(event);
                  }}
                >
                  <ItemIcon weight="regular" aria-hidden="true" />
                  <span>{item}</span>
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
    <div
      className={`node-quick-actions nodrag nowheel ${className}`}
      style={style}
      aria-label={`${node.title} 快捷配置`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="quick-action-menu-anchor">
        <button
          className={`quick-person-action${portraitMenuOpen ? " active" : ""}`}
          type="button"
          aria-label="人像质感调节"
          aria-expanded={portraitMenuOpen}
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation();
            setOpenMenu((current) => current === "portrait" ? null : "portrait");
            releasePointerFocus(event);
          }}
        >
          <UserCircle weight="regular" aria-hidden="true" />
          <span>人像质感调节</span>
          <em>NEW</em>
          <CaretRight className="quick-caret" weight="bold" aria-hidden="true" />
        </button>
        {portraitMenuOpen ? (
          <span className={`quick-action-submenu quick-action-submenu-${portraitMenu.variant}`} role="menu" aria-label={portraitMenu.label}>
            <span className="quick-action-submenu-inner">
              {portraitMenu.items.map(({ label, icon: ItemIcon }) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenu(null);
                    releasePointerFocus(event);
                  }}
                >
                  <ItemIcon weight="regular" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </span>
          </span>
        ) : null}
      </span>
      {renderAction(actions[0])}
      <div className="quick-action-group">
        {renderAction(actions[1])}
        {renderAction(actions[2])}
        <span className="quick-group-divider" aria-hidden="true" />
        {renderAction(actions[3])}
      </div>
      {renderAction(actions[4])}
      {renderAction(actions[5])}
      <span className="quick-actions-divider" />
      <button type="button" aria-label="画笔编辑" data-tooltip="画笔编辑"><PaintBrush aria-hidden="true" /></button>
      <button type="button" aria-label="定位主体" data-tooltip="定位主体"><Crosshair aria-hidden="true" /></button>
      <button type="button" aria-label="下载素材" data-tooltip="下载素材"><DownloadSimple aria-hidden="true" /></button>
      <button type="button" aria-label="打开素材预览" data-tooltip="打开素材预览"><ArrowsOutSimple aria-hidden="true" /></button>
    </div>
  );
}

function CanvasEdge({ id, sourceX, sourceY, targetX, targetY, className }) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const active = className?.includes("active");
  return (
    <>
      <BaseEdge id={id} path={edgePath} className={className} />
      {active ? <path className="canvas-edge-pulse" d={edgePath} aria-hidden="true" /> : null}
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
        </div>

        {selected ? <NodeComposer node={node} kind={kind} graph={graph} onUpdatePrompt={onUpdatePrompt} /> : null}
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
      <p className="add-menu-heading">添加节点</p>
      <div className="add-menu-list">
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "text" })}><TextAlignLeft aria-hidden="true" /><span>文本</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "shot", mediaKind: "image" })}><ImageSquare aria-hidden="true" /><span>图片</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "shot", mediaKind: "video" })}><VideoCamera aria-hidden="true" /><span>视频</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "smart-edit" })}><Scissors aria-hidden="true" /><span>智能剪辑</span><small>Beta</small></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "director" })}><Stack aria-hidden="true" /><span>导演台</span><small className="new">NEW</small></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "frame-analysis" })}><MagnifyingGlassPlus aria-hidden="true" /><span>逐帧拉片</span><Sparkle className="add-menu-model-spark" weight="fill" aria-hidden="true" /><small className="new add-menu-model-badge">SD 2.5</small></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "audio" })}><SpeakerHigh aria-hidden="true" /><span>音频</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "script" })}><FileText aria-hidden="true" /><span>脚本</span><CaretRight aria-hidden="true" /></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "asset-library" })}><FolderSimple aria-hidden="true" /><span>素材库</span><CaretRight aria-hidden="true" /></button>
      </div>
      <p className="add-menu-heading add-menu-resource-heading">添加资源</p>
      <div className="add-menu-list add-menu-resource-list">
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "asset-library" })}><UploadSimple aria-hidden="true" /><span>上传</span></button>
        <button type="button" role="menuitem" onClick={() => addAndClose({ kind: "composition", role: "asset-library" })}><Sparkle aria-hidden="true" /><span>从生成历史选择</span></button>
      </div>
    </div>
  );
}

const TOOLBOX_PRESETS = Object.freeze([
  { title: "【预设】深空开场", image: "/assets/shot-arrival.webp" },
  { title: "【预设】未来空间转场", image: "/assets/shot-crossing.webp" },
  { title: "【预设】能量降临", image: "/assets/shot-signal.webp" },
  { title: "【预设】蓝色轨道", image: "/assets/reference-blue-orbit-v2.png" },
  { title: "【预设】光束剪影", image: "/assets/shot-signal.webp" },
  { title: "【预设】星港漫游", image: "/assets/shot-arrival.webp" },
  { title: "【预设】城市回声", image: "/assets/shot-crossing.webp" },
  { title: "【预设】轨道讯号", image: "/assets/reference-blue-orbit-v2.png" },
  { title: "【预设】穿越序章", image: "/assets/shot-signal.webp" },
  { title: "【预设】镜头推进", image: "/assets/shot-crossing.webp" },
  { title: "【预设】叙事定格", image: "/assets/shot-arrival.webp" },
  { title: "【预设】环形聚焦", image: "/assets/reference-blue-orbit-v2.png" },
  { title: "【预设】光影转场", image: "/assets/shot-signal.webp" },
  { title: "【预设】空间切换", image: "/assets/shot-crossing.webp" },
  { title: "【预设】氛围开场", image: "/assets/shot-arrival.webp" },
  { title: "【预设】蓝调推进", image: "/assets/reference-blue-orbit-v2.png" },
  { title: "【预设】信号闪现", image: "/assets/shot-signal.webp" },
  { title: "【预设】镜头停驻", image: "/assets/shot-crossing.webp" },
  { title: "【预设】叙事转折", image: "/assets/shot-arrival.webp" },
  { title: "【预设】轨道漫游", image: "/assets/reference-blue-orbit-v2.png" },
  { title: "【预设】能量显现", image: "/assets/shot-signal.webp" },
  { title: "【预设】城市远景", image: "/assets/shot-arrival.webp" },
  { title: "【预设】空间穿越", image: "/assets/shot-crossing.webp" },
  { title: "【预设】光束定格", image: "/assets/shot-signal.webp" },
  { title: "【预设】蓝色收束", image: "/assets/reference-blue-orbit-v2.png" },
]);

const ROLE_PRESETS = Object.freeze([
  { title: "蓝调肖像", image: "/assets/character-portrait-v1.png" },
  { title: "工作室设定", image: "/assets/character-portrait-v1.png" },
  { title: "自然表情", image: "/assets/character-portrait-v1.png" },
  { title: "光线档案", image: "/assets/character-portrait-v1.png" },
]);

function CanvasOverlay({ onClose }) {
  return <button className="canvas-modal-backdrop" type="button" aria-label="关闭弹窗" onClick={onClose} />;
}

function ToolboxPanel({ onClose }) {
  const scrollRef = useRef(null);
  const [scrollMetrics, setScrollMetrics] = useState({ clientHeight: 0, scrollHeight: 0, scrollTop: 0 });

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
    <section className="dock-toolbox-panel" role="dialog" aria-labelledby="toolbox-title" data-canvas-control>
      <header>
        <h2 id="toolbox-title">我的工具箱</h2>
        <Question className="toolbox-info" weight="regular" aria-label="工具箱说明" />
        <span>电影创作常用分镜</span>
        <button type="button" onClick={onClose} aria-label="关闭工具箱"><X aria-hidden="true" /></button>
      </header>
      <div className="toolbox-grid" ref={scrollRef}>
        {TOOLBOX_PRESETS.map((preset) => (
          <button key={preset.title} type="button" aria-label={`使用预设 ${preset.title}`}>
            <img src={preset.image} alt="" />
            <span>{preset.title}</span>
          </button>
        ))}
      </div>
      {scrollable ? (
        <div className="toolbox-scroll-rail" aria-hidden="true">
          <span className="toolbox-scroll-track">
            <span className="toolbox-scroll-thumb" style={{ height: `${visibleRatio * 100}%`, transform: `translateY(${progress * (1 / visibleRatio - 1) * 100}%)` }} />
          </span>
        </div>
      ) : null}
    </section>
  );
}

function LibraryPopover({ onClose }) {
  return (
    <section className="dock-library-popover" role="dialog" aria-labelledby="library-title" data-canvas-control>
      <h2 id="library-title">素材库</h2>
      <button type="button" onClick={onClose}><span className="library-entry-icon"><Cube weight="regular" aria-hidden="true" /></span><span>风格库</span><small>NEW</small></button>
      <button type="button" onClick={onClose}><span className="library-entry-icon"><GlobeHemisphereWest weight="regular" aria-hidden="true" /></span><span>特效库</span><small>NEW</small></button>
    </section>
  );
}

function TutorialPopover({ onClose }) {
  return (
    <section className="dock-tutorial-popover" role="dialog" aria-label="帮助与教程" data-canvas-control>
      <button type="button" onClick={onClose}>使用教程</button>
      <button type="button" onClick={onClose}>联系支持</button>
      <button type="button" onClick={onClose}>产品反馈</button>
      <button type="button" onClick={onClose}>关注动态</button>
    </section>
  );
}

function ShortcutSheet({ onClose }) {
  const scrollRef = useRef(null);
  const [scrollMetrics, setScrollMetrics] = useState({ clientHeight: 0, scrollHeight: 0, scrollTop: 0 });
  const groups = [
    {
      title: "创作",
      rows: [
        { label: "成组", keys: ["Ctrl/Alt", "G"] },
        { label: "合并分镜组", keys: ["Ctrl", "Alt", "G"] },
        { label: "解组", keys: ["Ctrl/Alt", "Shift", "G"] },
        { label: "连线", keys: ["Ctrl", "L"] },
        { label: "复制节点和连线", keys: ["Ctrl", "D"] },
        { label: "生成", keys: ["Ctrl", "Enter"] },
        { label: "新建节点", keys: ["Tab"] },
        { label: "节点复制", keys: ["Alt"], suffix: "+拖动节点" },
        { label: "创建副本", keys: ["Ctrl", "Alt"], suffix: "+拖动" },
      ],
    },
    {
      title: "缩放",
      rows: [
        { label: "放大", keys: ["Ctrl", { icon: "plus", label: "+" }] },
        { label: "缩小", keys: ["Ctrl", { icon: "minus", label: "−" }] },
        { label: "适应画布", keys: ["Ctrl", "0"] },
        { label: "触控板", keys: ["⌘", "滚动"] },
        { label: "鼠标", keys: ["Ctrl", "滚轮"] },
      ],
    },
    {
      title: "移动画布",
      rows: [
        { label: "键盘", keys: ["Space", "拖动"] },
        { label: "触控板", keys: ["双指拖动"] },
        { label: "鼠标", keys: ["Ctrl", "拖动"] },
        { label: "移动", keys: ["V"] },
        { label: "抓手工具", keys: ["H"] },
        { label: "整理画布", keys: ["Alt", "Shift", "F"] },
      ],
    },
    { title: "其他", rows: [{ label: "撤销", keys: ["Ctrl", "Z"] }, { label: "重做", keys: ["Ctrl", "Shift", "Z"] }, { label: "删除", keys: ["Backspace"] }] },
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
                  {row.keys.flatMap((key, index) => [
                    index > 0 ? <span className="shortcut-key-separator" key={`${row.label}-separator-${index}`} aria-hidden="true">+</span> : null,
                    <kbd className={typeof key === "string" ? "" : "shortcut-icon-key"} key={`${row.label}-${typeof key === "string" ? key : key.label}`}>{renderKey(key)}</kbd>,
                  ])}
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

function RoleLibraryModal({ onClose }) {
  const primary = ROLE_PRESETS[0];
  const contactSheet = Array.from({ length: 9 });
  const angleTop = Array.from({ length: 6 });
  const angleBottom = Array.from({ length: 3 });
  return (
    <>
      <CanvasOverlay onClose={onClose} />
      <section className="role-library-modal" role="dialog" aria-modal="true" aria-labelledby="role-library-title" data-canvas-control>
        <header><h2 id="role-library-title">角色库</h2><button type="button" onClick={onClose} aria-label="关闭角色库"><X aria-hidden="true" /></button></header>
        <section className="role-library-feature">
          <h3>{primary.title} <span>角色创作参考</span></h3>
          <div className="role-feature-images">
            <img className="role-pose-full" src={primary.image} alt={`${primary.title} 全身设定`} />
            <img className="role-pose-close" src={primary.image} alt={`${primary.title} 近景设定`} />
            <div className="role-contact-sheet" aria-label={`${primary.title} 表情设定`}>
              {contactSheet.map((_, index) => <img key={index} src={primary.image} alt="" />)}
            </div>
            <div className="role-angle-sheet" aria-label={`${primary.title} 多视角设定`}>
              <div>{angleTop.map((_, index) => <img key={index} src={primary.image} alt="" />)}</div>
              <div>{angleBottom.map((_, index) => <img key={index} src={primary.image} alt="" />)}</div>
            </div>
          </div>
          <footer><p>可将角色外观、服装和场景气质作为画布中的统一参考。</p><button type="button" onClick={onClose}><Plus weight="bold" aria-hidden="true" />应用至画布</button></footer>
        </section>
        <footer className="role-library-carousel">
          <button type="button" aria-label="角色筛选">角色筛选 <CaretRight aria-hidden="true" /></button>
          <label className="role-recent-toggle"><input type="checkbox" aria-label="仅显示最近使用" /><span>最近使用</span></label>
          <div className="role-carousel-track">
            <button className="role-carousel-arrow role-carousel-prev" type="button" aria-label="上一组角色"><CaretRight aria-hidden="true" /></button>
            {ROLE_PRESETS.map((role) => <button key={role.title} type="button" onClick={onClose}><img src={role.image} alt={role.title} /><small>{role.title}</small></button>)}
            <button className="role-carousel-arrow role-carousel-next" type="button" aria-label="下一组角色"><CaretRight aria-hidden="true" /></button>
          </div>
        </footer>
      </section>
    </>
  );
}

function HistoryModal({ draft, onClose, onSelectNode }) {
  const entries = draft.nodes.flatMap((node) => node.outputAssets.filter((asset) => asset.previewUrl).map((asset) => ({ asset, node })));
  return (
    <>
      <CanvasOverlay onClose={onClose} />
      <section className="canvas-history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title" data-canvas-control>
        <header><h2 id="history-title">历史资产</h2><div><button type="button" aria-label="缩小历史缩略图">−</button><span>100%</span><button type="button" aria-label="放大历史缩略图">+</button></div><button type="button" onClick={onClose} aria-label="关闭历史资产"><X aria-hidden="true" /></button></header>
        <nav><button type="button" className="active">图片历史({entries.length})</button><button type="button">视频历史(0)</button><button type="button">音频历史(0)</button><span /><button type="button">时间降序</button><button type="button">批量操作</button></nav>
        <section className="history-content"><p>2026-08-20</p><div>{entries.map(({ asset, node }) => <button key={asset.id} type="button" onClick={() => { onSelectNode(node.id); onClose(); }}><img src={asset.previewUrl} alt={node.title} /></button>)}</div><span>{entries.length > 0 ? "没有更多了" : "暂无历史资产"}</span></section>
      </section>
    </>
  );
}

function CanvasDock({ tool, onToolChange, onAddNode, draft, onSelectNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState(null);
  const releasePointerFocus = (event) => {
    if (event.detail === 0) return;
    const button = event.currentTarget;
    window.requestAnimationFrame(() => button.blur());
  };
  const togglePanel = (panel, event) => {
    setMenuOpen(false);
    setOpenPanel((current) => current === panel ? null : panel);
    releasePointerFocus(event);
  };
  const closePanel = () => setOpenPanel(null);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setOpenPanel(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <>
      <CanvasAddMenu open={menuOpen} onClose={() => setMenuOpen(false)} onAddNode={onAddNode} />
      {openPanel === "toolbox" ? <ToolboxPanel onClose={closePanel} /> : null}
      {openPanel === "library" ? <LibraryPopover onClose={closePanel} /> : null}
      {openPanel === "shortcuts" ? <ShortcutSheet onClose={closePanel} /> : null}
      {openPanel === "tutorial" ? <TutorialPopover onClose={closePanel} /> : null}
      {openPanel === "roles" ? <RoleLibraryModal onClose={closePanel} /> : null}
      {openPanel === "history" ? <HistoryModal draft={draft} onClose={closePanel} onSelectNode={onSelectNode} /> : null}
      <div className="canvas-dock" role="toolbar" aria-label="画布工具" data-canvas-control>
        <button className={`dock-add ${menuOpen ? "active" : ""}`} type="button" onClick={(event) => { setOpenPanel(null); setMenuOpen((value) => !value); releasePointerFocus(event); }} aria-expanded={menuOpen} aria-label={menuOpen ? "关闭添加菜单" : "添加节点"} data-tooltip={menuOpen ? "关闭添加菜单" : "添加节点"}>{menuOpen ? <X weight="bold" aria-hidden="true" /> : <Plus weight="bold" aria-hidden="true" />}</button>
        <button className={tool === "pan" ? "active" : ""} type="button" onClick={(event) => { onToolChange(tool === "pan" ? "select" : "pan"); releasePointerFocus(event); }} aria-pressed={tool === "pan"} aria-label="移动" data-tooltip={tool === "pan" ? "切换到选择模式 (V)" : "移动画布 (H)"}><Cursor weight="regular" aria-hidden="true" /></button>
        <button className={openPanel === "toolbox" ? "active" : ""} type="button" onClick={(event) => togglePanel("toolbox", event)} aria-label="打开工具箱" data-tooltip="打开工具箱"><GitBranch weight="regular" aria-hidden="true" /></button>
        <button className={openPanel === "library" ? "active" : ""} type="button" onClick={(event) => togglePanel("library", event)} aria-label="素材库" data-tooltip="素材库"><Shapes weight="regular" aria-hidden="true" /></button>
        <button className={openPanel === "roles" ? "active" : ""} type="button" onClick={(event) => togglePanel("roles", event)} aria-label="角色库" data-tooltip="角色库"><UsersThree weight="regular" aria-hidden="true" /></button>
        <button className={openPanel === "history" ? "active" : ""} type="button" onClick={(event) => togglePanel("history", event)} aria-label="历史记录" data-tooltip="历史记录"><Clock weight="regular" aria-hidden="true" /></button>
        <span className="dock-divider" />
        <button className={openPanel === "shortcuts" ? "active" : ""} type="button" onClick={(event) => togglePanel("shortcuts", event)} aria-label="快捷键" data-tooltip="快捷键"><Keyboard weight="regular" aria-hidden="true" /></button>
        <button className={openPanel === "tutorial" ? "active" : ""} type="button" onClick={(event) => togglePanel("tutorial", event)} aria-label="教程" data-tooltip="教程"><Question weight="regular" aria-hidden="true" /></button>
      </div>
    </>
  );
}

function ZoomOptions({ open, zoom, onClose, onFit, onZoomIn, onZoomOut, onSetZoom }) {
  const [inputValue, setInputValue] = useState(() => String(Math.round(zoom * 100)));

  useEffect(() => {
    setInputValue(String(Math.round(zoom * 100)));
  }, [zoom]);

  const commitInputZoom = () => {
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setInputValue(String(Math.round(zoom * 100)));
      return;
    }
    onSetZoom(Math.min(800, Math.max(32, parsed)) / 100);
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
      <button className="zoom-menu-row" type="button" onClick={onZoomIn} aria-label="放大画布"><span>放大</span><span className="zoom-key-combo"><span>⌘</span><span>+</span></span></button>
      <button className="zoom-menu-row" type="button" onClick={onZoomOut} aria-label="缩小画布"><span>缩小</span><span className="zoom-key-combo"><span>⌘</span><span>−</span></span></button>
      <button className="zoom-menu-row" type="button" onClick={onFit} aria-label="适合屏幕"><span>适合屏幕</span><span className="zoom-key-combo"><span>⌘</span><span>0</span></span></button>
      <span className="zoom-menu-divider" aria-hidden="true" />
      {[0.5, 1, 8].map((value) => <button className="zoom-menu-row" key={value} type="button" onClick={() => onSetZoom(value)}>{`缩放至${Math.round(value * 100)}%`}</button>)}
    </div>
  );
}

function CanvasAssetManager({ open, draft, onClose, onSelectNode }) {
  if (!open) return null;

  return (
    <aside className="canvas-asset-manager" role="dialog" aria-modal="false" aria-labelledby="asset-manager-title" data-canvas-control>
      <h2 id="asset-manager-title" className="visually-hidden">资产管理</h2>
      <header className="asset-sidebar-header">
        <div className="asset-sidebar-workspace">
          <strong>工作区</strong>
          <span aria-hidden="true" />
          <button type="button" aria-label="切换画布">{draft.title}<CaretRight aria-hidden="true" /></button>
        </div>
        <nav aria-label="画布侧栏">
          <button className="active" type="button" onClick={onClose}>画布</button>
          <span>资产</span>
        </nav>
      </header>
      <section className="asset-sidebar-content">
        <header>
          <span>画布元素</span>
          <button type="button" aria-label="筛选资产">全部 <CaretRight aria-hidden="true" /></button>
          <button type="button" aria-label="搜索资产"><MagnifyingGlassPlus aria-hidden="true" /></button>
        </header>
        <div className="asset-manager-list">
          {draft.nodes.map((node) => {
            const asset = node.outputAssets.find((item) => item.previewUrl);
            const kind = getSurfaceKind(node);
            return (
          <button
            key={node.id}
            type="button"
            onClick={() => { onSelectNode(node.id); onClose(); }}
            aria-label={`聚焦 ${node.title}`}
          >
            <span className={`asset-entry-preview asset-entry-preview-${kind}`}>
              {asset?.previewUrl ? <img src={asset.previewUrl} alt="" /> : <NodeLabelIcon kind={kind} />}
            </span>
            <strong>{node.title}</strong>
          </button>
            );
          })}
        </div>
      </section>
      <footer className="asset-sidebar-footer">
        <button type="button" onClick={onClose} aria-label="收起资产管理"><ArrowLeft aria-hidden="true" /></button>
        <span>共 {draft.nodes.length} 节点</span>
      </footer>
    </aside>
  );
}

function CanvasAside({ draft, onSelectNode, assetManagerOpen, onAssetManagerChange, showEdges, onToggleEdges, snapToGrid, onToggleSnap, showMinimap, onToggleMinimap, zoom, onZoomIn, onZoomOut, onSetZoom, onFit, onArrange }) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const releasePointerFocus = (event) => {
    if (event.detail === 0) return;
    const button = event.currentTarget;
    window.requestAnimationFrame(() => button.blur());
  };

  return (
    <>
      {!assetManagerOpen ? (
        <>
          <div className="canvas-aside" data-canvas-control>
            <button className="asset-manage-button" type="button" onClick={(event) => { onAssetManagerChange(true); releasePointerFocus(event); }} aria-label="资产管理" title="资产管理"><Stack weight="regular" aria-hidden="true" /><span>资产管理</span></button>
            <button type="button" onClick={(event) => { onArrange(); releasePointerFocus(event); }} aria-label="整理画布，Alt+Shift+F" data-tooltip="整理画布Alt+Shift+F"><GridFour weight="regular" aria-hidden="true" /></button>
            <button className={showMinimap ? "active" : ""} type="button" onClick={(event) => { onToggleMinimap(); releasePointerFocus(event); }} aria-pressed={showMinimap} aria-label="切换小地图" data-tooltip="切换小地图"><MapTrifold weight="regular" aria-hidden="true" /></button>
            <button className={!showEdges ? "active" : ""} type="button" onClick={(event) => { onToggleEdges(); releasePointerFocus(event); }} aria-pressed={!showEdges} aria-label="隐藏节点连线" data-tooltip="隐藏节点连线"><BezierCurve weight="regular" aria-hidden="true" /></button>
            <button className={snapToGrid ? "active" : ""} type="button" onClick={(event) => { onToggleSnap(); releasePointerFocus(event); }} aria-pressed={snapToGrid} aria-label="网格吸附" data-tooltip="网格吸附"><Magnet weight="regular" aria-hidden="true" /></button>
            <button className="zoom-value" type="button" onClick={(event) => { setZoomOpen((value) => !value); releasePointerFocus(event); }} aria-expanded={zoomOpen} aria-label="缩放选项" data-tooltip="缩放选项">{Math.round(zoom * 100)}%</button>
          </div>
          <ZoomOptions open={zoomOpen} zoom={zoom} onClose={() => setZoomOpen(false)} onFit={onFit} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onSetZoom={onSetZoom} />
        </>
      ) : null}
      <CanvasAssetManager open={assetManagerOpen} draft={draft} onClose={() => onAssetManagerChange(false)} onSelectNode={onSelectNode} />
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

function CanvasViewportInner({ draft, selectedNodeId, onSelectNode, onOpenPreview, onMoveNode, onAddNode, onConnectNodes, onDeleteEdges, onUpdatePrompt, onArrange, onAssetManagerChange }) {
  const viewportRef = useRef(null);
  const fitMaxZoom = window.innerWidth <= 800 ? 0.37 : 0.64;
  const { fitView, getViewport, screenToFlowPosition, setViewport, zoomIn, zoomOut } = useReactFlow();
  const [tool, setTool] = useState("select");
  const [showEdges, setShowEdges] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_CANVAS_ZOOM);
  const [assetManagerOpen, setAssetManagerOpen] = useState(false);
  const [quickActionsPosition, setQuickActionsPosition] = useState(null);
  const initialViewport = useMemo(() => ({
    // Preserve the reference's fixed world origin at narrow widths. The
    // canvas does not auto-fit its authored layout when the window shrinks.
    x: 267,
    y: Math.round(Math.min(240, Math.max(96, window.innerHeight * 0.33))) + 1,
    zoom: DEFAULT_CANVAS_ZOOM,
  }), []);

  const focusNode = useCallback((nodeId) => onSelectNode(nodeId), [onSelectNode]);

  const nodeData = useMemo(() => ({ onOpenPreview, onFocusNode: focusNode, onUpdatePrompt, graph: draft }), [draft, focusNode, onOpenPreview, onUpdatePrompt]);
  const projectedNodes = useMemo(
    () => toFlowNodes(draft, selectedNodeId, nodeData, CANVAS_PRESENTATION_SCALE),
    [draft, nodeData, selectedNodeId],
  );
  const [nodes, setNodes, handleNodesChange] = useNodesState(projectedNodes);
  const edges = useMemo(() => showEdges ? toFlowEdges(draft, selectedNodeId) : [], [draft, selectedNodeId, showEdges]);
  const selectedNode = useMemo(() => draft.nodes.find((node) => node.id === selectedNodeId) ?? null, [draft.nodes, selectedNodeId]);
  const selectedNodeKind = selectedNode ? getSurfaceKind(selectedNode) : null;

  const syncQuickActionsPosition = useCallback(() => {
    const viewport = viewportRef.current;
    const node = viewport?.querySelector(".canvas-node.selected");
    if (!viewport || !node) {
      setQuickActionsPosition(null);
      return;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    setQuickActionsPosition({
      left: nodeRect.left - viewportRect.left + nodeRect.width / 2,
      top: nodeRect.top - viewportRect.top - 47,
    });
  }, []);

  useLayoutEffect(() => {
    if (!selectedNode || (selectedNodeKind !== "image" && selectedNodeKind !== "video")) {
      setQuickActionsPosition(null);
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

  useEffect(() => {
    setNodes(projectedNodes);
  }, [projectedNodes, setNodes]);

  useEffect(() => {
    onAssetManagerChange?.(assetManagerOpen);
  }, [assetManagerOpen, onAssetManagerChange]);

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
    <section ref={viewportRef} className={`canvas-viewport tool-${tool}${assetManagerOpen ? " asset-sidebar-open" : ""}`} data-testid="canvas-viewport" data-view={`0,0,${zoom.toFixed(3)}`} aria-label="无限画布。拖动节点编辑布局，滚轮缩放，空格拖动画布。">
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
        onMove={(_, viewport) => {
          setZoom(viewport.zoom);
          window.requestAnimationFrame(syncQuickActionsPosition);
        }}
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
        fitView={false}
        fitViewOptions={{ padding: FIT_VIEW_PADDING, minZoom: MIN_ZOOM, maxZoom: fitMaxZoom }}
        deleteKeyCode={["Backspace", "Delete"]}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        data-testid="react-flow-editor"
      >
        <Background variant={BackgroundVariant.Dots} gap={32} size={1} color="#474747" />
        {showMinimap ? <MiniMap className="canvas-mini-map" maskColor="rgb(20 20 20 / 66%)" pannable zoomable /> : null}
      </ReactFlow>

      {selectedNode && quickActionsPosition ? (
        <NodeQuickActions
          className="node-quick-actions-overlay"
          kind={selectedNodeKind}
          node={selectedNode}
          style={{ "--quick-actions-left": `${quickActionsPosition.left}px`, "--quick-actions-top": `${quickActionsPosition.top}px` }}
        />
      ) : null}

      {draft.nodes.length === 0 ? <EmptyCanvasGuide onAddNode={addAtViewportCenter} /> : null}
      <CanvasAside
        draft={draft}
        onSelectNode={onSelectNode}
        assetManagerOpen={assetManagerOpen}
        onAssetManagerChange={setAssetManagerOpen}
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
      <CanvasDock
        tool={tool}
        onToolChange={setTool}
        onAddNode={addAtViewportCenter}
        draft={draft}
        onSelectNode={onSelectNode}
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
