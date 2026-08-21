import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addNode,
  connectNodes,
  createGroup,
  deleteNode,
  disconnectEdge,
  expandScriptIntoShots,
  moveGroup,
  moveNodes,
  parseCanvasDocument,
  splitScriptIntoShotPrompts,
  updateNode,
} from "@open-canvas/core/browser";
import {
  CaretDown,
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  FilmSlate,
  FloppyDisk,
  GitBranch,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import referenceCanvasDemo from "./reference-canvas-demo.json";
import { CanvasViewport } from "./CanvasViewport.jsx";
import { createNodeClipboard, nextCopiedNodeTitle, pasteNodeClipboard } from "./canvas-clipboard.js";
import { resolveDemoAssetUrl } from "./demo-assets.js";
import { localAssetUrl, localProjectUrl, resolveBridgeAssetUrl } from "./local-project-bridge.js";
import { AssetPreview, isPlayableVideoPreview } from "./media-preview.jsx";
import { createPreviewModel, truncateIdentifier } from "./project-document.js";
import { findOpenNodePosition } from "./react-flow-model.js";

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
    label: "逐帧拉片",
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
  "asset-reference": {
    label: "素材引用",
    mediaType: "application/json",
    prompt: "描述要引用的本地图片、视频或音频，以及它在创作中的用途。",
  },
  character: {
    label: "角色设定",
    mediaType: "application/json",
    prompt: "描述角色的外观、服装、年龄、表情和跨镜头连续性约束。",
  },
  "scene-style": {
    label: "场景与风格",
    mediaType: "application/json",
    prompt: "描述场景、光线、色彩、材质和整体视觉风格。",
  },
});

function buildModel(document, draftId, resolveAssetUrl = resolveDemoAssetUrl) {
  return createPreviewModel(document, {
    draftId,
    resolveAssetUrl,
  });
}

function requestedDraftId(document, candidateId) {
  return candidateId && document.drafts.some((draft) => draft.id === candidateId)
    ? candidateId
    : document.activeDraftId;
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

function sameNodeIdSet(left, right) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((nodeId) => rightIds.has(nodeId));
}

function ProjectHeader({
  model,
  isDirty,
  onDraftChange,
  onProjectFile,
  onDownload,
  onSave,
  canSave = false,
  isSaving = false,
}) {
  const inputRef = useRef(null);
  const draft = model.activeDraft;
  const complete = draft.statusCounts.succeeded ?? 0;
  const active = (draft.statusCounts.queued ?? 0) + (draft.statusCounts.running ?? 0);
  const pending = (draft.statusCounts.dirty ?? 0) + (draft.statusCounts.failed ?? 0);

  return (
    <header className="topbar">
      <div className="project-identity">
        <span className="project-mark" aria-hidden="true"><FilmSlate weight="fill" /></span>
        <span className="project-kicker">工作区</span>
        <span className="project-divider" aria-hidden="true" />
        <span className="project-canvas-select" title={model.project.title}>
          <strong title={model.project.title}>
            <span className="project-name-compact">{model.project.title}</span>
          </strong>
          <CaretDown className="project-caret" aria-hidden="true" />
        </span>
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
        <button className="secondary-button" type="button" aria-label="打开" onClick={() => inputRef.current?.click()}>
          <FileArrowUp aria-hidden="true" /><span>打开</span>
        </button>
        <input ref={inputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={onProjectFile} aria-label="打开项目 JSON 文档" />
        <button className="secondary-button primary-action" type="button" aria-label="导出 JSON" onClick={onDownload}>
          <DownloadSimple aria-hidden="true" /><span>导出 JSON</span>
        </button>
        {onSave ? (
          <button className="secondary-button save-project-button" type="button" aria-label="保存本地项目" onClick={onSave} disabled={!canSave || isSaving}>
            <FloppyDisk aria-hidden="true" /><span>{isSaving ? "保存中" : "保存"}</span>
          </button>
        ) : null}
        <span className={`editor-badge ${isDirty ? "dirty" : ""}`} title={`Project revision ${model.revision}`}>
          {isDirty ? "未保存" : "已保存"}
        </span>
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

  const playableVideo = isPlayableVideoPreview(preview.asset);

  return (
    <dialog className="asset-dialog" open aria-labelledby="asset-dialog-title">
      <button className="dialog-backdrop" type="button" onClick={onClose} aria-label="点击背景关闭素材预览" />
      <section className="asset-dialog-panel">
        <header>
          <div><span>素材预览</span><h2 id="asset-dialog-title">{preview.node.title}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭素材预览"><X aria-hidden="true" /></button>
        </header>
        <div className="asset-stage">
          <AssetPreview asset={preview.asset} alt={`${preview.node.title} 的生成画面`} controls={playableVideo} />
          {!playableVideo ? <span className="preview-still-label">预览帧</span> : null}
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

export function App({ initialDocument = referenceCanvasDemo, projectUrl = null, assetUrl = null, initialDraftId = null }) {
  const [document, setDocument] = useState(() => parseCanvasDocument(initialDocument));
  const [draftId, setDraftId] = useState(() => requestedDraftId(initialDocument, initialDraftId));
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  const [nodeClipboard, setNodeClipboard] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [savedSnapshot, setSavedSnapshot] = useState(() => serializeProject(initialDocument));
  const [activeProjectUrl, setActiveProjectUrl] = useState(() => localProjectUrl(projectUrl));
  const [activeAssetUrl, setActiveAssetUrl] = useState(() => localAssetUrl(assetUrl));
  const [bridgeLoading, setBridgeLoading] = useState(() => Boolean(localProjectUrl(projectUrl)));
  const [isSaving, setIsSaving] = useState(false);
  const savedProjectRevisionRef = useRef(null);
  const documentRef = useRef(document);

  const resolveAssetUrl = useMemo(() => activeAssetUrl
    ? (asset) => resolveBridgeAssetUrl(asset, activeAssetUrl)
    : resolveDemoAssetUrl, [activeAssetUrl]);
  const model = useMemo(() => buildModel(document, draftId, resolveAssetUrl), [document, draftId, resolveAssetUrl]);
  const serializedDocument = useMemo(() => serializeProject(document), [document]);
  const isDirty = serializedDocument !== savedSnapshot;

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    if (!activeProjectUrl) {
      setBridgeLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setBridgeLoading(true);
    void fetch(activeProjectUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`无法读取本地项目（${response.status}）`);
        return parseCanvasDocument(await response.json());
      })
      .then((nextDocument) => {
        if (controller.signal.aborted) return;
        setDocument(nextDocument);
        setDraftId(requestedDraftId(nextDocument, initialDraftId));
        setSelectedNodeId(null);
        setSelectedNodeIds([]);
        setNodeClipboard(null);
        setUndoStack([]);
        setRedoStack([]);
        setSavedSnapshot(serializeProject(nextDocument));
        savedProjectRevisionRef.current = nextDocument.revision;
        setBridgeLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setActiveProjectUrl(null);
        setActiveAssetUrl(null);
        setBridgeLoading(false);
        setNotice({ tone: "danger", message: error instanceof Error ? error.message : "无法读取本地项目" });
      });
    return () => controller.abort();
  }, [activeProjectUrl, initialDraftId]);

  useEffect(() => {
    const availableNodeIds = new Set(model.activeDraft.nodes
      .filter((node) => node.spec?.role !== "group")
      .map((node) => node.id));
    setSelectedNodeIds((current) => {
      const next = current.filter((nodeId) => availableNodeIds.has(nodeId));
      return sameNodeIdSet(current, next) ? current : next;
    });
    setSelectedNodeId((current) => current && availableNodeIds.has(current) ? current : null);
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
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setNodeClipboard(null);
      setUndoStack([]);
      setRedoStack([]);
      setSavedSnapshot(serializeProject(nextDocument));
      savedProjectRevisionRef.current = null;
      setActiveProjectUrl(null);
      setActiveAssetUrl(null);
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
    if (!activeProjectUrl) setSavedSnapshot(serializedDocument);
    setNotice({ tone: "success", message: activeProjectUrl ? "项目 JSON 已导出；本地项目仍可继续保存" : "项目 JSON 已导出" });
  };

  const handleSaveProject = useCallback(async () => {
    if (!activeProjectUrl || isSaving || savedProjectRevisionRef.current === null || !isDirty) return;
    const snapshot = document;
    const snapshotText = serializeProject(snapshot);
    const baseRevision = savedProjectRevisionRef.current;
    setIsSaving(true);
    try {
      const response = await fetch(activeProjectUrl, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRevision, document: snapshot }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) {
          throw new Error("本地项目已被其他命令更新，请重新打开后再保存");
        }
        throw new Error(typeof payload?.error === "string" ? payload.error : "无法保存本地项目");
      }
      savedProjectRevisionRef.current = typeof payload?.revision === "number" ? payload.revision : snapshot.revision;
      if (documentRef.current.revision === snapshot.revision) {
        setSavedSnapshot(snapshotText);
        setNotice({ tone: "success", message: "已保存到本地项目" });
      } else {
        setNotice({ tone: "success", message: "已保存较早修改；仍有新的未保存编辑" });
      }
    } catch (error) {
      setNotice({ tone: "danger", message: error instanceof Error ? error.message : "无法保存本地项目" });
    } finally {
      setIsSaving(false);
    }
  }, [activeProjectUrl, document, isDirty, isSaving]);

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

  const handleMoveNodes = useCallback((updates) => {
    const draft = findCanonicalDraft(document, draftId);
    const uniqueUpdates = [...new Map(updates.map((item) => [item.nodeId, item])).values()];
    const changedUpdates = uniqueUpdates.filter(({ nodeId, position }) => {
      const node = draft.nodes.find((item) => item.id === nodeId);
      return node && (node.position.x !== position.x || node.position.y !== position.y);
    });
    if (changedUpdates.length === 0) return;
    runMutation(changedUpdates.length === 1 ? "节点位置已更新" : `已移动 ${changedUpdates.length} 个节点`, (current) => moveNodes(current, {
      draftId,
      updates: changedUpdates,
      expectedProjectRevision: current.revision,
      expectedDraftRevision: findCanonicalDraft(current, draftId).revision,
    }));
  }, [document, draftId, runMutation]);

  const handleMoveGroup = useCallback((groupNodeId, delta) => {
    if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.y) || (delta.x === 0 && delta.y === 0)) return;
    const draft = findCanonicalDraft(document, draftId);
    const group = draft.nodes.find((node) => node.id === groupNodeId);
    if (!group || group.spec.kind !== "composition" || group.spec.role !== "group") return;
    runMutation(`已移动${group.title}`, (current) => moveGroup(current, {
      draftId,
      groupNodeId,
      delta,
      expectedProjectRevision: current.revision,
      expectedDraftRevision: findCanonicalDraft(current, draftId).revision,
    }));
  }, [document, draftId, runMutation]);

  const handleSelectNodes = useCallback((nodeIds, primaryNodeId) => {
    const uniqueNodeIds = [...new Set(nodeIds)];
    const nextPrimaryNodeId = primaryNodeId === undefined
      ? uniqueNodeIds.at(-1) ?? null
      : primaryNodeId && uniqueNodeIds.includes(primaryNodeId) ? primaryNodeId : null;
    setSelectedNodeIds((current) => sameNodeIdSet(current, uniqueNodeIds) ? current : uniqueNodeIds);
    setSelectedNodeId((current) => current === nextPrimaryNodeId ? current : nextPrimaryNodeId);
  }, []);

  const handleCreateGroup = useCallback((memberNodeIds) => {
    const currentDraft = findCanonicalDraft(document, draftId);
    const members = [...new Set(memberNodeIds)].filter((nodeId) => {
      const node = currentDraft.nodes.find((candidate) => candidate.id === nodeId);
      return node && node.spec.role !== "group";
    });
    if (members.length < 2) {
      setNotice({ tone: "danger", message: "请先选择至少两个普通节点" });
      return;
    }
    runMutation(`已将 ${members.length} 个节点分组`, (currentDocument) => {
      const currentDraft = findCanonicalDraft(currentDocument, draftId);
      return createGroup(currentDocument, {
        draftId,
        memberNodeIds: members,
        expectedProjectRevision: currentDocument.revision,
        expectedDraftRevision: currentDraft.revision,
      });
    }, () => {
      // A group frame is a layout selection rather than a node editor. Keep
      // all members visibly selected, but deliberately leave the inline
      // parameter composer closed.
      handleSelectNodes(members, null);
    });
  }, [document, draftId, handleSelectNodes, runMutation]);

  const handleCopyNodes = useCallback((nodeIds) => {
    const draft = findCanonicalDraft(document, draftId);
    const clipboard = createNodeClipboard(draft, nodeIds);
    if (!clipboard) return;
    setNodeClipboard({ ...clipboard, sourceDraftId: draftId });
    setNotice({ tone: "success", message: `已复制 ${clipboard.nodes.length} 个节点` });
  }, [document, draftId]);

  const handlePasteNodes = useCallback(() => {
    if (!nodeClipboard?.nodes.length) return;
    if (nodeClipboard.sourceDraftId !== draftId) {
      setNotice({ tone: "danger", message: "节点组只能粘贴到复制它的草稿" });
      return;
    }
    const clipboard = nodeClipboard;
    let nextClipboard = clipboard;
    runMutation(`已粘贴 ${clipboard.nodes.length} 个节点`, (current) => {
      const pasted = pasteNodeClipboard(current, { draftId, clipboard });
      nextClipboard = pasted.clipboard;
      return pasted.document;
    }, () => {
      setNodeClipboard(nextClipboard);
    });
  }, [draftId, nodeClipboard, runMutation]);

  const handleAddNode = useCallback((descriptor, position) => {
    const kind = typeof descriptor === "string" ? descriptor : descriptor.kind;
    const mediaKind = typeof descriptor === "string" ? "video" : descriptor.mediaKind ?? "video";
    const legacyPresentation = typeof descriptor === "string" ? null : descriptor.presentation ?? null;
    const role = typeof descriptor === "string"
      ? null
      : descriptor.role ?? (legacyPresentation === "text" ? "text" : legacyPresentation === "edit" ? "smart-edit" : null);
    const contextPreset = role ? CONTEXT_NODE_PRESETS[role] : null;
    const isOutputComposition = kind === "composition" && !contextPreset;
    const draft = findCanonicalDraft(document, draftId);
    const count = draft.nodes.filter((node) => {
      if (node.spec.kind !== kind) return false;
      if (kind === "shot") return node.spec.mediaKind === mediaKind;
      return (node.spec.role ?? "composition") === (role ?? "composition");
    }).length + 1;
    const spec = kind === "composition" ? {
      kind: "composition",
      mediaType: contextPreset?.mediaType ?? "video/mp4",
      ...(contextPreset ? { role, prompt: contextPreset.prompt } : { role: "composition" }),
    } : {
      kind: "shot",
      prompt: "描述这个镜头的主体、动作、环境与镜头语言。",
      mediaKind,
      inputAssetIds: [],
      requirements: {
        aspectRatio: "16:9",
        ...(mediaKind === "image"
          ? { width: 1792, height: 1008, audio: "forbidden" }
          // Do not invent a fixed video duration for a new node. The default
          // configured video route advertises no exact duration guarantee;
          // users may add an explicit duration in the node's output settings.
          : { audio: "either" }),
        mediaType: mediaKind === "image" ? "image/png" : "video/mp4",
      },
    };
    const title = kind === "composition"
      ? `${contextPreset?.label ?? (isOutputComposition ? "合成输出" : "剪辑")} ${count}`
      : `${mediaKind === "image" ? "图片" : "视频"} ${count}`;
    const addMessage = kind === "composition"
      ? `已新增${contextPreset?.label ?? (isOutputComposition ? "合成输出" : "剪辑")}节点`
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
      handleSelectNodes(nextDraft.nodes.at(-1)?.id ? [nextDraft.nodes.at(-1).id] : [], nextDraft.nodes.at(-1)?.id ?? null);
    });
  }, [document, draftId, handleSelectNodes, runMutation]);

  const handleArrange = useCallback((positions) => {
    const draft = findCanonicalDraft(document, draftId);
    if (draft.nodes.length === 0 || !positions) return;
    const updates = draft.nodes
      .filter((node) => node.spec?.role !== "group")
      .map((node) => ({ nodeId: node.id, position: positions[node.id] ?? node.position }))
      .filter(({ nodeId, position }) => {
        const node = draft.nodes.find((item) => item.id === nodeId);
        return node && (node.position.x !== position.x || node.position.y !== position.y);
      });
    if (updates.length === 0) return;
    runMutation("已整理画布", (current) => moveNodes(current, {
      draftId,
      updates,
      expectedProjectRevision: current.revision,
      expectedDraftRevision: findCanonicalDraft(current, draftId).revision,
    }));
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

  const handleDeleteNodes = useCallback((nodeIds) => {
    const ids = [...new Set(nodeIds)];
    const draft = findCanonicalDraft(document, draftId);
    const existingIds = ids.filter((nodeId) => draft.nodes.some((node) => node.id === nodeId));
    if (existingIds.length === 0) return;
    const message = existingIds.length === 1
      ? "已删除节点，相关下游已标记为待生成"
      : `已删除 ${existingIds.length} 个节点，相关下游已标记为待生成`;
    runMutation(message, (current) => existingIds.reduce((next, nodeId) => {
      const currentDraft = findCanonicalDraft(next, draftId);
      if (!currentDraft.nodes.some((node) => node.id === nodeId)) return next;
      return deleteNode(next, {
        draftId,
        nodeId,
        expectedProjectRevision: next.revision,
        expectedDraftRevision: currentDraft.revision,
      });
    }, current), () => handleSelectNodes([], null));
  }, [document, draftId, handleSelectNodes, runMutation]);

  const handleDuplicateNode = useCallback((nodeId) => {
    runMutation("已复制节点", (current) => {
      const currentDraft = findCanonicalDraft(current, draftId);
      const source = currentDraft.nodes.find((node) => node.id === nodeId);
      if (!source) throw new Error("要复制的节点不存在");
      return addNode(current, {
        draftId,
        title: nextCopiedNodeTitle(currentDraft, source.title),
        spec: structuredClone(source.spec),
        position: findOpenNodePosition(
          currentDraft,
          { x: source.position.x + 48, y: source.position.y + 48 },
          source.spec,
        ),
        expectedProjectRevision: current.revision,
        expectedDraftRevision: currentDraft.revision,
      });
    }, (nextDocument) => {
      const nextDraft = findCanonicalDraft(nextDocument, draftId);
      handleSelectNodes(nextDraft.nodes.at(-1)?.id ? [nextDraft.nodes.at(-1).id] : [], nextDraft.nodes.at(-1)?.id ?? null);
    });
  }, [draftId, handleSelectNodes, runMutation]);

  const handleUpdatePrompt = useCallback((nodeId, prompt) => {
    runMutation("Prompt 已更新，相关节点已标记为待生成", (current) => updateNode(current, {
      draftId,
      nodeId,
      prompt,
      expectedProjectRevision: current.revision,
      expectedDraftRevision: findCanonicalDraft(current, draftId).revision,
    }));
  }, [draftId, runMutation]);

  const handleUpdateReferenceAssets = useCallback((nodeId, referenceAssetIds) => {
    const uniqueAssetIds = [...new Set(referenceAssetIds)];
    runMutation("已更新本地素材引用", (current) => {
      const draft = findCanonicalDraft(current, draftId);
      const node = draft.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.spec.kind !== "composition" || !node.spec.role || node.spec.role === "composition" || node.spec.role === "group") {
        throw new Error("本地素材只能关联到画布上下文节点");
      }
      const spec = { ...node.spec };
      if (uniqueAssetIds.length > 0) spec.referenceAssetIds = uniqueAssetIds;
      else delete spec.referenceAssetIds;
      return updateNode(current, {
        draftId,
        nodeId,
        spec,
        expectedProjectRevision: current.revision,
        expectedDraftRevision: draft.revision,
      });
    });
  }, [draftId, runMutation]);

  const handleUpdateInputAssets = useCallback((nodeId, inputAssetIds) => {
    const uniqueAssetIds = [...new Set(inputAssetIds)];
    runMutation("已更新本地参考素材，相关节点已标记为待生成", (current) => {
      const draft = findCanonicalDraft(current, draftId);
      const node = draft.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.spec.kind !== "shot") {
        throw new Error("本地参考素材只能关联到图像或视频镜头");
      }
      return updateNode(current, {
        draftId,
        nodeId,
        spec: { ...node.spec, inputAssetIds: uniqueAssetIds },
        expectedProjectRevision: current.revision,
        expectedDraftRevision: draft.revision,
      });
    });
  }, [draftId, runMutation]);

  const handleUpdateRequirements = useCallback((nodeId, requirements) => {
    runMutation("已更新输出设置，相关节点已标记为待生成", (current) => {
      const draft = findCanonicalDraft(current, draftId);
      const node = draft.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.spec.kind !== "shot") {
        throw new Error("输出设置只能应用到图像或视频镜头");
      }
      return updateNode(current, {
        draftId,
        nodeId,
        spec: { ...node.spec, requirements },
        expectedProjectRevision: current.revision,
        expectedDraftRevision: draft.revision,
      });
    });
  }, [draftId, runMutation]);

  const handleExpandScript = useCallback((nodeId, draftPrompt) => {
    const currentDraft = findCanonicalDraft(document, draftId);
    const currentScript = currentDraft.nodes.find((node) => node.id === nodeId);
    if (!currentScript || currentScript.spec.kind !== "composition" || currentScript.spec.role !== "script") {
      setNotice({ tone: "danger", message: "只能从故事脚本节点创建镜头" });
      return;
    }
    const scriptPrompt = typeof draftPrompt === "string" ? draftPrompt.trim() : currentScript.spec.prompt;
    const shotPrompts = splitScriptIntoShotPrompts(scriptPrompt);
    if (shotPrompts.length === 0) {
      setNotice({ tone: "danger", message: "请先写下可拆分的脚本内容" });
      return;
    }
    let createdNodeIds = [];
    runMutation(`已从脚本创建 ${shotPrompts.length} 个视频镜头`, (current) => {
      const currentDraft = findCanonicalDraft(current, draftId);
      const expanded = expandScriptIntoShots(current, {
        draftId,
        scriptNodeId: nodeId,
        prompt: scriptPrompt,
        expectedProjectRevision: current.revision,
        expectedDraftRevision: currentDraft.revision,
        positionForShot: ({ draft, scriptNode, index, shotCount }) => findOpenNodePosition(
          draft,
          {
            x: scriptNode.position.x + 300,
            y: scriptNode.position.y + (index - (shotCount - 1) / 2) * 156,
          },
          { kind: "shot", mediaKind: "video" },
        ),
      });
      createdNodeIds = expanded.shotNodeIds;
      return expanded.document;
    }, () => {
      if (createdNodeIds.length === 0) return;
      handleSelectNodes([createdNodeIds[0]], createdNodeIds[0]);
    });
  }, [document, draftId, handleSelectNodes, runMutation]);

  const handleCreateVariation = useCallback((sourceNodeId, operation) => {
    runMutation(`已创建「${operation.label}」编辑变体`, (current) => {
      const currentDraft = findCanonicalDraft(current, draftId);
      const source = currentDraft.nodes.find((node) => node.id === sourceNodeId);
      if (!source || source.spec.kind !== "shot") throw new Error("只能从图像或视频镜头创建编辑变体");
      const sourceAssetId = source.execution.outputAssetIds[0];
      if (!sourceAssetId || !current.assets.some((asset) => asset.id === sourceAssetId)) {
        throw new Error("请先生成该镜头，再创建编辑变体");
      }
      const titleBase = `${source.title} · ${operation.label}`;
      const titleCount = currentDraft.nodes.filter((node) => node.title.startsWith(titleBase)).length + 1;
      const title = titleCount === 1 ? titleBase : `${titleBase} ${titleCount}`;
      const added = addNode(current, {
        draftId,
        title,
        spec: {
          kind: "shot",
          prompt: `${source.spec.prompt}\n\n编辑目标：${operation.instruction}`,
          mediaKind: source.spec.mediaKind,
          inputAssetIds: [sourceAssetId],
          ...(source.spec.requirements ? { requirements: structuredClone(source.spec.requirements) } : {}),
          ...(source.spec.routing ? { routing: structuredClone(source.spec.routing) } : {}),
        },
        position: findOpenNodePosition(
          currentDraft,
          { x: source.position.x + 214, y: source.position.y + 214 },
          { kind: "shot", mediaKind: source.spec.mediaKind },
        ),
        expectedProjectRevision: current.revision,
        expectedDraftRevision: currentDraft.revision,
      });
      const addedDraft = findCanonicalDraft(added, draftId);
      const child = addedDraft.nodes.at(-1);
      if (!child) throw new Error("无法创建编辑变体");
      return connectNodes(added, {
        draftId,
        kind: "dependency",
        sourceNodeId: source.id,
        targetNodeId: child.id,
        expectedProjectRevision: added.revision,
        expectedDraftRevision: addedDraft.revision,
      });
    }, (nextDocument) => {
      const nextDraft = findCanonicalDraft(nextDocument, draftId);
      handleSelectNodes(nextDraft.nodes.at(-1)?.id ? [nextDraft.nodes.at(-1).id] : [], nextDraft.nodes.at(-1)?.id ?? null);
    });
  }, [draftId, handleSelectNodes, runMutation]);

  const handleOpenPreview = useCallback((node, asset) => {
    if (asset.previewUrl) setPreview({ node, asset });
  }, []);

  return (
    <main className="app-shell">
      <ProjectHeader
        model={model}
        isDirty={isDirty}
        onDraftChange={(nextDraftId) => { setDraftId(nextDraftId); handleSelectNodes([], null); setNodeClipboard(null); setNotice(null); }}
        onProjectFile={handleProjectFile}
        onDownload={handleDownload}
        onSave={activeProjectUrl ? handleSaveProject : undefined}
        canSave={!bridgeLoading && isDirty}
        isSaving={isSaving}
      />
      <CanvasViewport
        draft={model.activeDraft}
        assets={model.assets}
        selectedNodeId={selectedNodeId}
        selectedNodeIds={selectedNodeIds}
        onSelectNodes={handleSelectNodes}
        onOpenPreview={handleOpenPreview}
        onMoveNodes={handleMoveNodes}
        onMoveGroup={handleMoveGroup}
        onCreateGroup={handleCreateGroup}
        onCopyNodes={handleCopyNodes}
        onPasteNodes={handlePasteNodes}
        canPasteNodes={Boolean(nodeClipboard?.nodes.length && nodeClipboard.sourceDraftId === draftId)}
        onAddNode={handleAddNode}
        onConnectNodes={handleConnectNodes}
        onConnectionRejected={(message) => setNotice({ tone: "danger", message })}
        onDeleteEdges={handleDeleteEdges}
        onDeleteNodes={handleDeleteNodes}
        onDuplicateNode={handleDuplicateNode}
        onUpdatePrompt={handleUpdatePrompt}
        onUpdateReferenceAssets={handleUpdateReferenceAssets}
        onUpdateInputAssets={handleUpdateInputAssets}
        onUpdateRequirements={handleUpdateRequirements}
        onExpandScript={handleExpandScript}
        onCreateVariation={handleCreateVariation}
        onArrange={handleArrange}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
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
