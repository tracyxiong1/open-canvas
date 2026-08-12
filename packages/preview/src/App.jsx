import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle,
  FileArrowUp,
  FilmSlate,
  GitBranch,
  Info,
  Play,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import exampleDocument from "../../../docs/examples/canvas-v1-shot2-night.json";
import { CanvasViewport } from "./CanvasViewport.jsx";
import { resolveDemoAssetUrl } from "./demo-assets.js";
import { chooseInitialNode, createPreviewModel, truncateIdentifier } from "./project-document.js";

function buildModel(document, draftId) {
  return createPreviewModel(document, {
    draftId,
    resolveAssetUrl: resolveDemoAssetUrl,
  });
}

function ProjectHeader({ model, onDraftChange, onProjectFile }) {
  const inputRef = useRef(null);
  const draft = model.activeDraft;
  const complete = draft.statusCounts.succeeded ?? 0;
  const active = (draft.statusCounts.queued ?? 0) + (draft.statusCounts.running ?? 0);
  const pending = (draft.statusCounts.dirty ?? 0) + (draft.statusCounts.failed ?? 0);

  return (
    <header className="topbar">
      <div className="project-identity">
        <div className="project-mark" aria-hidden="true">
          <FilmSlate weight="fill" />
        </div>
        <div className="project-copy">
          <span className="project-kicker">项目预览</span>
          <strong title={model.project.title}>{model.project.title}</strong>
        </div>
      </div>

      <div className="draft-control">
        <GitBranch aria-hidden="true" />
        <label htmlFor="draft-select">草稿</label>
        <select
          id="draft-select"
          value={draft.id}
          onChange={(event) => onDraftChange(event.target.value)}
        >
          {model.drafts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        {draft.sourceDraftId ? (
          <span className="variation-chip" title={`源草稿 ${draft.sourceDraftId}`}>
            变体
          </span>
        ) : null}
      </div>

      <div className="header-actions">
        <div className="status-summary" aria-label="草稿生成状态汇总">
          <span className="summary-item success">
            <CheckCircle weight="fill" aria-hidden="true" />
            {complete} 完成
          </span>
          {active ? <span className="summary-item active">{active} 进行中</span> : null}
          {pending ? <span className="summary-item pending">{pending} 待处理</span> : null}
        </div>
        <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>
          <FileArrowUp aria-hidden="true" />
          <span>打开项目</span>
        </button>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={onProjectFile}
          aria-label="打开项目 JSON 文档"
        />
        <span className="readonly-badge" title={`Project revision ${model.revision}`}>
          Schema v{model.schemaVersion} · 只读
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

  return (
    <dialog className="asset-dialog" open aria-labelledby="asset-dialog-title">
      <button className="dialog-backdrop" type="button" onClick={onClose} aria-label="点击背景关闭素材预览" />
      <section className="asset-dialog-panel">
        <header>
          <div>
            <span>素材预览</span>
            <h2 id="asset-dialog-title">{preview.node.title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭素材预览">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="asset-stage">
          <img src={preview.asset.previewUrl} alt={`${preview.node.title} 的生成画面`} />
          <button className="play-control" type="button" aria-label="播放预览" disabled>
            <Play weight="fill" aria-hidden="true" />
          </button>
          <span className="preview-still-label">预览帧</span>
        </div>
        <footer>
          <div>
            <span>类型</span>
            <strong>{preview.asset.mediaType}</strong>
          </div>
          <div>
            <span>素材 ID</span>
            <strong>{truncateIdentifier(preview.asset.id)}</strong>
          </div>
          <div>
            <span>大小</span>
            <strong>{Math.max(1, Math.round(preview.asset.byteLength / 1024))} KB</strong>
          </div>
        </footer>
      </section>
    </dialog>
  );
}

export function App({ initialDocument = exampleDocument }) {
  const [document, setDocument] = useState(initialDocument);
  const [draftId, setDraftId] = useState(initialDocument.activeDraftId);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState(null);

  const model = useMemo(() => buildModel(document, draftId), [document, draftId]);

  useEffect(() => {
    const initialNode = chooseInitialNode(model.activeDraft);
    setSelectedNodeId(initialNode?.id ?? null);
    setPreview(null);
  }, [model.activeDraft.id]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const handleProjectFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const nextDocument = JSON.parse(await file.text());
      const nextModel = buildModel(nextDocument, nextDocument.activeDraftId);
      setDocument(nextDocument);
      setDraftId(nextModel.activeDraftId);
      setNotice({ tone: "success", message: `已打开 ${nextModel.project.title}` });
    } catch (error) {
      setNotice({ tone: "danger", message: error instanceof Error ? error.message : "无法读取项目文档" });
    }
  };

  const handleDraftChange = (nextDraftId) => {
    setDraftId(nextDraftId);
    setNotice(null);
  };

  const handleOpenPreview = (node, asset) => {
    if (!asset.previewUrl) return;
    setPreview({ node, asset });
  };

  return (
    <main className="app-shell">
      <ProjectHeader model={model} onDraftChange={handleDraftChange} onProjectFile={handleProjectFile} />
      <CanvasViewport
        draft={model.activeDraft}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onOpenPreview={handleOpenPreview}
      />

      <div className="canvas-note" aria-label="预览说明">
        <Info weight="fill" aria-hidden="true" />
        <span>CLI 写入项目文档，当前画布仅用于查看。</span>
      </div>

      {notice ? (
        <div className={`toast ${notice.tone}`} role="status">
          {notice.tone === "danger" ? (
            <WarningCircle weight="fill" aria-hidden="true" />
          ) : (
            <CheckCircle weight="fill" aria-hidden="true" />
          )}
          {notice.message}
        </div>
      ) : null}

      <AssetDialog preview={preview} onClose={() => setPreview(null)} />
    </main>
  );
}
