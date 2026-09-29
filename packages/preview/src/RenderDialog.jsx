import { useEffect, useRef, useState } from "react";
import { effectiveOutputAssetIds } from "@open-canvas/core/browser";

export function RenderDialog({ document, draftId, selectedNodeIds, onRender, onClose, busy }) {
  const draft = document.drafts.find((item) => item.id === draftId);
  const available = (kind) => draft.nodes.filter((node) => {
    const asset = document.assets.find((item) => item.id === effectiveOutputAssetIds(node)[0]);
    return asset?.kind === kind;
  });
  const videos = available("video"); const audio = available("audio");
  const [order, setOrder] = useState(selectedNodeIds.filter((id) => videos.some((node) => node.id === id)));
  const [audioNodeId, setAudioNodeId] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [originalVolume, setOriginalVolume] = useState(1);
  const [narrationVolume, setNarrationVolume] = useState(1);
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = window.document.activeElement;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  const move = (index, direction) => setOrder((items) => {
    const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next;
  });
  return <div className="canvas-modal-backdrop render-backdrop" onClick={() => { if (!busy) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="render-dialog" role="dialog" aria-modal="true" aria-label="导出成片" onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !busy) onClose();
        if (event.key === "Tab") {
          const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
          const first = controls[0]; const last = controls.at(-1);
          if (event.shiftKey && (window.document.activeElement === first || window.document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><h2>导出成片</h2><button type="button" aria-label="关闭成片导出" disabled={busy} onClick={onClose}>×</button></header>
      <p>选择视频并排列播放顺序。使用各节点当前选中的结果。</p>
      <fieldset disabled={busy}><legend>视频片段</legend>
        {videos.length ? videos.map((node) => <label className="render-choice" key={node.id}>
          <input type="checkbox" checked={order.includes(node.id)} onChange={(event) => setOrder((items) => event.target.checked ? [...items, node.id] : items.filter((id) => id !== node.id))} />{node.title}
        </label>) : <p>先生成或导入视频，再导出成片。</p>}
        <ol className="render-order">{order.map((id, index) => <li key={id}><span>{videos.find((node) => node.id === id)?.title}</span>
          <button type="button" aria-label={`上移片段 ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={`下移片段 ${index + 1}`} disabled={index === order.length - 1} onClick={() => move(index, 1)}>↓</button>
        </li>)}</ol>
      </fieldset>
      <fieldset disabled={busy}><legend>画面与声音</legend>
        <label>画面比例<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
        <label>旁白<select value={audioNodeId} onChange={(event) => setAudioNodeId(event.target.value)}><option value="">不添加旁白</option>{audio.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label>
        <label>原声响度<input type="range" min="0" max="2" step="0.1" value={originalVolume} onChange={(event) => setOriginalVolume(Number(event.target.value))} /><output>{Math.round(originalVolume * 100)}%</output></label>
        <label>旁白响度<input type="range" min="0" max="2" step="0.1" value={narrationVolume} onChange={(event) => setNarrationVolume(Number(event.target.value))} /><output>{Math.round(narrationVolume * 100)}%</output></label>
      </fieldset>
      <p>旁白从片头开始，超出画面长度的部分会裁去。输出为 MP4。</p>
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-action" type="button" disabled={busy || !order.length} onClick={() => onRender({ nodeIds: order, ...(audioNodeId ? { audioNodeId } : {}), aspectRatio, originalVolume, narrationVolume })}>{busy ? "正在导出…" : "导出 MP4"}</button></footer>
    </section>
  </div>;
}
