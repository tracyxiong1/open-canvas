import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addNode,
  connectNodes,
  disconnectEdge,
  parseCanvasDocument,
  updateNode,
} from "@open-canvas/core/browser";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretDown,
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  FilmSlate,
  GitBranch,
  Lightning,
  Play,
  ShareNetwork,
  SquaresFour,
  Sparkle,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import referenceCanvasDemo from "./reference-canvas-demo.json";
import { CanvasViewport } from "./CanvasViewport.jsx";
import { resolveDemoAssetUrl } from "./demo-assets.js";
import { createPreviewModel, truncateIdentifier } from "./project-document.js";

const HISTORY_LIMIT = 50;

const CONTEXT_NODE_PRESETS = Object.freeze({
  text: {
    label: "文本",
    mediaType: "text/plain",
    prompt: "写下这段创作的主题、情绪或叙事目标。",
  },
  "smart-edit": {
    label: "编辑",
    mediaType: "video/mp4",
    prompt: "描述想保留的素材、叙事节奏与剪辑目标。",
  },
  director: {
    label: "分镜",
    mediaType: "application/json",
    prompt: "定义故事节奏、场景拆分与镜头调度。",
  },
  "frame-analysis": {
    label: "镜头分析",
    mediaType: "application/json",
    prompt: "分析参考视频的镜头、构图、动作与节奏。",
  },
  audio: {
    label: "音频",
    mediaType: "audio/mpeg",
    prompt: "描述配乐、旁白、环境音或声音设计。",
  },
  script: {
    label: "脚本",
    mediaType: "text/plain",
    prompt: "写下场景、角色、旁白与镜头节奏。",
  },
  "asset-library": {
    label: "素材",
    mediaType: "application/json",
    prompt: "整理要引用的图片、视频、音频与参考素材。",
  },
});

function buildModel(document, draftId) {
  return createPreviewModel(document, {
    draftId,
    resolveAssetUrl: resolveDemoAssetUrl,
  });
}

function findCanonicalDraft(document, draftId) {
  const draft = document.drafts.find((item) => item.id === draftId);
  if (!draft) throw new Error(`Draft not found: ${draftId}`);
  return draft;
}

function projectFileName(title) {
  const safeTitle = title.trim().replace(/[^\p{Letter}\p{Number}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${safeTitle || "open-canvas"}.json`;
}

function serializeProject(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function ProjectHeader({
  model,
  isDirty,
  canUndo,
  canRedo,
  onDraftChange,
  onProjectFile,
  onDownload,
  onUndo,
  onRedo,
}) {
  const inputRef = useRef(null);
  const draft = model.activeDraft;
  const complete = draft.statusCounts.succeeded ?? 0;
  const active = (draft.statusCounts.queued ?? 0) + (draft.statusCounts.running ?? 0);
  const pending = (draft.statusCounts.dirty ?? 0) + (draft.statusCounts.failed ?? 0);

  return (
    <header className="topbar">
      <div className="project-identity">
        <button className="project-mark" type="button" aria-label="打开工作区"><FilmSlate weight="fill" aria-hidden="true" /></button>
        <span className="project-kicker">工作区</span>
        <span className="project-divider" aria-hidden="true" />
        <button className="project-canvas-select" type="button" aria-label={`切换画布，当前 ${model.project.title}`}>
          <strong title={model.project.title}>
            <span className="project-name-full">{model.project.title}</span>
            <span className="project-name-compact">画布 1</span>
          </strong>
          <CaretDown className="project-caret" aria-hidden="true" />
        </button>
      </div>

      <div className="project-top-tools" aria-label="画布视图工具">
        <button type="button" aria-label="查看画布关系" title="查看画布关系"><GitBranch aria-hidden="true" /></button>
        <button type="button" aria-label="切换画布视图" title="切换画布视图"><SquaresFour aria-hidden="true" /></button>
      </div>

      <div className="draft-control">
        <GitBranch aria-hidden="true" />
        <label htmlFor="draft-select">草稿</label>
        <select id="draft-select" value={draft.id} aria-label="草稿" onChange={(event) => onDraftChange(event.target.value)}>
          {model.drafts.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        {draft.sourceDraftId ? <span className="variation-chip" title={`源草稿 ${draft.sourceDraftId}`}>变体</span> : null}
      </div>

      <div className="header-actions">
        <div className="status-summary" role="status" aria-label="草稿生成状态汇总">
          <span className="summary-item success"><CheckCircle weight="fill" aria-hidden="true" />{complete} 完成</span>
          {active ? <span className="summary-item active">{active} 进行中</span> : null}
          {pending ? <span className="summary-item pending">{pending} 待处理</span> : null}
        </div>
        <div className="history-controls" role="group" aria-label="编辑历史">
          <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="撤销" title="撤销 (⌘Z)"><ArrowCounterClockwise aria-hidden="true" /></button>
          <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="重做" title="重做 (⇧⌘Z)"><ArrowClockwise aria-hidden="true" /></button>
        </div>
        <button className="secondary-button" type="button" aria-label="打开" onClick={() => inputRef.current?.click()}>
          <FileArrowUp aria-hidden="true" /><span>打开</span>
        </button>
        <input ref={inputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={onProjectFile} aria-label="打开项目 JSON 文档" />
        <button className="secondary-button primary-action" type="button" aria-label="导出 JSON" onClick={onDownload}>
          <DownloadSimple aria-hidden="true" /><span>导出 JSON</span>
        </button>
        <span className={`editor-badge ${isDirty ? "dirty" : ""}`} title={`Project revision ${model.revision}`}>
          {isDirty ? "未保存" : "已保存"}
        </span>
      </div>

      <div className="source-style-actions" aria-label="创作辅助工具">
        <button type="button" className="header-icon-action" aria-label="分享画布" title="分享画布"><ShareNetwork aria-hidden="true" /></button>
        <button type="button" className="header-icon-action header-library-action" aria-label="创作工具" title="创作工具"><SquaresFour weight="fill" aria-hidden="true" /></button>
        <button type="button" className="header-upgrade-action" aria-label="升级创作套餐" title="升级创作套餐"><Sparkle weight="fill" aria-hidden="true" /><span>升级创作</span><small>限时</small></button>
        <button type="button" className="header-credit-action" aria-label="创作额度"><Lightning weight="fill" aria-hidden="true" /><span>20</span></button>
        <button type="button" className="header-avatar-action" aria-label="账户"><UserCircle weight="fill" aria-hidden="true" /></button>
        <button type="button" className="header-agent-action" aria-label="打开创作 AI"><Sparkle weight="fill" aria-hidden="true" /><span>Agent</span></button>
      </div>
    </header>
  );
}

function AssetDialog({ preview, onClose }) {
  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview, onClose]);

  if (!preview) return null;

  return (
    <dialog className="asset-dialog" open aria-labelledby="asset-dialog-title">
      <button className="dialog-backdrop" type="button" onClick={onClose} aria-label="点击背景关闭素材预览" />
      <section className="asset-dialog-panel">
        <header>
          <div><span>素材预览</span><h2 id="asset-dialog-title">{preview.node.title}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭素材预览"><X aria-hidden="true" /></button>
        </header>
        <div className="asset-stage">
          <img src={preview.asset.previewUrl} alt={`${preview.node.title} 的生成画面`} />
          <button className="play-control" type="button" aria-label="播放预览" disabled><Play weight="fill" aria-hidden="true" /></button>
          <span className="preview-still-label">预览帧</span>
        </div>
        <footer>
          <div><span>类型</span><strong>{preview.asset.mediaType}</strong></div>
          <div><span>素材 ID</span><strong>{truncateIdentifier(preview.asset.id)}</strong></div>
          <div><span>大小</span><strong>{Math.max(1, Math.round(preview.asset.byteLength / 1024))} KB</strong></div>
        </footer>
      </section>
    </dialog>
  );
}

export function App({ initialDocument = referenceCanvasDemo }) {
  const [document, setDocument] = useState(() => parseCanvasDocument(initialDocument));
  const [draftId, setDraftId] = useState(initialDocument.activeDraftId);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [savedSnapshot, setSavedSnapshot] = useState(() => serializeProject(initialDocument));

  const model = useMemo(() => buildModel(document, draftId), [document, draftId]);
  const serializedDocument = useMemo(() => serializeProject(document), [document]);
  const isDirty = serializedDocument !== savedSnapshot;

  useEffect(() => {
    setSelectedNodeId((current) => {
      if (current && model.activeDraft.nodes.some((node) => node.id === current)) return current;
      return null;
    });
    setPreview(null);
  }, [model.activeDraft.id, model.activeDraft.nodes]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const commitDocument = useCallback((nextDocument, message) => {
    setUndoStack((items) => [...items.slice(-(HISTORY_LIMIT - 1)), document]);
    setRedoStack([]);
    setDocument(nextDocument);
    setNotice({ tone: "success", message });
  }, [document]);

  const runMutation = useCallback((message, mutate, afterCommit) => {
    try {
      const nextDocument = mutate(document);
      commitDocument(nextDocument, message);
      afterCommit?.(nextDocument);
    } catch (error) {
      setNotice({ tone: "danger", message: error instanceof Error ? error.message : "无法完成编辑" });
    }
  }, [commitDocument, document]);

  const handleProjectFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const nextDocument = parseCanvasDocument(JSON.parse(await file.text()));
      const nextModel = buildModel(nextDocument, nextDocument.activeDraftId);
      setDocument(nextDocument);
      setDraftId(nextModel.activeDraftId);
      setUndoStack([]);
      setRedoStack([]);
      setSavedSnapshot(serializeProject(nextDocument));
      setNotice({ tone: "success", message: `已打开 ${nextModel.project.title}` });
    } catch (error) {
      setNotice({ tone: "danger", message: error instanceof Error ? error.message : "无法读取项目文档" });
    }
  };

  const handleDownload = () => {
    const blob = new Blob([serializedDocument], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = projectFileName(model.project.title);
    link.click();
    URL.revokeObjectURL(url);
    setSavedSnapshot(serializedDocument);
    setNotice({ tone: "success", message: "项目 JSON 已导出" });
  };

  const handleUndo = useCallback(() => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setUndoStack((items) => items.slice(0, -1));
    setRedoStack((items) => [document, ...items].slice(0, HISTORY_LIMIT));
    setDocument(previous);
    setNotice({ tone: "success", message: "已撤销" });
  }, [document, undoStack]);

  const handleRedo = useCallback(() => {
    const next = redoStack[0];
    if (!next) return;
    setRedoStack((items) => items.slice(1));
    setUndoStack((items) => [...items.slice(-(HISTORY_LIMIT - 1)), document]);
    setDocument(next);
    setNotice({ tone: "success", message: "已重做" });
  }, [document, redoStack]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo]);

  const handleMoveNode = useCallback((nodeId, position) => {
    const draft = findCanonicalDraft(document, draftId);
    const node = draft.nodes.find((item) => item.id === nodeId);
    if (!node || (node.position.x === position.x && node.position.y === position.y)) return;
    runMutation("节点位置已更新", (current) => updateNode(current, {
      draftId,
      nodeId,
      position,
      expectedProjectRevision: current.revision,
      expectedDraftRevision: findCanonicalDraft(current, draftId).revision,
    }));
  }, [document, draftId, runMutation]);

  const handleAddNode = useCallback((descriptor, position) => {
    const kind = typeof descriptor === "string" ? descriptor : descriptor.kind;
    const mediaKind = typeof descriptor === "string" ? "video" : descriptor.mediaKind ?? "video";
    const legacyPresentation = typeof descriptor === "string" ? null : descriptor.presentation ?? null;
    const role = typeof descriptor === "string"
      ? null
      : descriptor.role ?? (legacyPresentation === "text" ? "text" : legacyPresentation === "edit" ? "smart-edit" : null);
    const contextPreset = role ? CONTEXT_NODE_PRESETS[role] : null;
    const draft = findCanonicalDraft(document, draftId);
    const count = draft.nodes.filter((node) => {
      if (node.spec.kind !== kind) return false;
      if (kind === "shot") return node.spec.mediaKind === mediaKind;
      return (node.spec.role ?? "composition") === (role ?? "composition");
    }).length + 1;
    const spec = kind === "composition" ? {
      kind: "composition",
      mediaType: contextPreset?.mediaType ?? "video/mp4",
      ...(contextPreset ? { role, prompt: contextPreset.prompt } : {}),
    } : {
      kind: "shot",
      prompt: "描述这个镜头的主体、动作、环境与镜头语言。",
      mediaKind,
      inputAssetIds: [],
      requirements: {
        aspectRatio: "16:9",
        durationSeconds: 5,
        audio: "either",
        mediaType: mediaKind === "image" ? "image/png" : "video/mp4",
      },
    };
    const title = kind === "composition"
      ? `${contextPreset?.label ?? "剪辑"} ${count}`
      : `${mediaKind === "image" ? "图片" : "视频"} ${count}`;
    const addMessage = kind === "composition"
      ? `已新增${contextPreset?.label ?? "剪辑"}节点`
      : `已新增${mediaKind === "image" ? "图片" : "视频"}节点`;
    runMutation(addMessage, (current) => addNode(current, {
      draftId,
      title,
      spec,
      position,
      expectedProjectRevision: current.revision,
      expectedDraftRevision: findCanonicalDraft(current, draftId).revision,
    }), (nextDocument) => {
      const nextDraft = findCanonicalDraft(nextDocument, draftId);
      setSelectedNodeId(nextDraft.nodes.at(-1)?.id ?? null);
    });
  }, [document, draftId, runMutation]);

  const handleArrange = useCallback(() => {
    const draft = findCanonicalDraft(document, draftId);
    if (draft.nodes.length === 0) return;
    const columns = Math.min(3, Math.max(1, draft.nodes.length));
    const columnGap = 430;
    const rowGap = 520;
    runMutation("已整理画布", (current) => draft.nodes.reduce((next, node, index) => {
      const currentDraft = findCanonicalDraft(next, draftId);
      return updateNode(next, {
        draftId,
        nodeId: node.id,
        position: {
          x: (index % columns) * columnGap,
          y: Math.floor(index / columns) * rowGap,
        },
        expectedProjectRevision: next.revision,
        expectedDraftRevision: currentDraft.revision,
      });
    }, current));
  }, [document, draftId, runMutation]);

  const handleConnectNodes = useCallback((connection) => {
    runMutation(connection.kind === "sequence" ? "已建立镜头顺序" : "已建立生成依赖", (current) => connectNodes(current, {
      draftId,
      ...connection,
      expectedProjectRevision: current.revision,
      expectedDraftRevision: findCanonicalDraft(current, draftId).revision,
    }));
  }, [draftId, runMutation]);

  const handleDeleteEdges = useCallback((edgeIds) => {
    if (edgeIds.length === 0) return;
    runMutation("已删除连线", (current) => edgeIds.reduce((next, edgeId) => disconnectEdge(next, {
      draftId,
      edgeId,
      expectedProjectRevision: next.revision,
      expectedDraftRevision: findCanonicalDraft(next, draftId).revision,
    }), current));
  }, [draftId, runMutation]);

  const handleUpdatePrompt = useCallback((nodeId, prompt) => {
    runMutation("Prompt 已更新，相关节点已标记为待生成", (current) => updateNode(current, {
      draftId,
      nodeId,
      prompt,
      expectedProjectRevision: current.revision,
      expectedDraftRevision: findCanonicalDraft(current, draftId).revision,
    }));
  }, [draftId, runMutation]);

  const handleOpenPreview = useCallback((node, asset) => {
    if (asset.previewUrl) setPreview({ node, asset });
  }, []);

  return (
    <main className="app-shell">
      <ProjectHeader
        model={model}
        isDirty={isDirty}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onDraftChange={(nextDraftId) => { setDraftId(nextDraftId); setNotice(null); }}
        onProjectFile={handleProjectFile}
        onDownload={handleDownload}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
      <CanvasViewport
        draft={model.activeDraft}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onOpenPreview={handleOpenPreview}
        onMoveNode={handleMoveNode}
        onAddNode={handleAddNode}
        onConnectNodes={handleConnectNodes}
        onDeleteEdges={handleDeleteEdges}
        onUpdatePrompt={handleUpdatePrompt}
        onArrange={handleArrange}
      />

      {notice ? (
        <div className={`toast ${notice.tone}`} role="status">
          {notice.tone === "danger" ? <WarningCircle weight="fill" aria-hidden="true" /> : <CheckCircle weight="fill" aria-hidden="true" />}
          {notice.message}
        </div>
      ) : null}

      <AssetDialog preview={preview} onClose={() => setPreview(null)} />
    </main>
  );
}
