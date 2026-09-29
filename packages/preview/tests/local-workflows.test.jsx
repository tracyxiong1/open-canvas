import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { addNode, completeGeneration, createProject, startGeneration } from "@open-canvas/core";
import { App } from "../src/App.jsx";
import { RenderDialog } from "../src/RenderDialog.jsx";

function addMedia(document, kind, title, completed = true) {
  const draftId = document.activeDraftId;
  document = addNode(document, { draftId, title,
    spec: { kind: "shot", mediaKind: kind, prompt: title, inputAssetIds: [] },
    expectedProjectRevision: document.revision, expectedDraftRevision: document.drafts[0].revision });
  const nodeId = document.drafts[0].nodes.at(-1).id;
  if (completed) {
    const started = startGeneration(document, { draftId, nodeId,
      expectedProjectRevision: document.revision, expectedDraftRevision: document.drafts[0].revision });
    document = completeGeneration(started.document, { draftId, jobId: started.request.jobId, providerJobId: `fixture-${nodeId}`,
      artifact: { kind, mediaType: { image: "image/png", video: "video/mp4", audio: "audio/wav" }[kind], bytes: new Uint8Array([1, 2, title.length]) } });
  }
  return { document, nodeId };
}

it("export uses the user's clip order and chosen narration and waits for explicit submission", async () => {
  let document = createProject({ title: "Film" });
  const first = addMedia(document, "video", "第一幕"); document = first.document;
  const second = addMedia(document, "video", "第二幕"); document = second.document;
  const audio = addMedia(document, "audio", "旁白素材"); document = audio.document;
  const onRender = vi.fn(); const user = userEvent.setup();
  render(<RenderDialog document={document} draftId={document.activeDraftId} selectedNodeIds={[]} onRender={onRender} onClose={vi.fn()} busy={false} />);
  expect(screen.getByRole("button", { name: "导出 MP4" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "第一幕" }));
  await user.click(screen.getByRole("checkbox", { name: "第二幕" }));
  await user.click(screen.getByRole("button", { name: "上移片段 2" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "旁白" }), audio.nodeId);
  await user.selectOptions(screen.getByRole("combobox", { name: "画面比例" }), "9:16");
  expect(onRender).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "导出 MP4" }));
  expect(onRender).toHaveBeenCalledWith({ nodeIds: [second.nodeId, first.nodeId], audioNodeId: audio.nodeId, aspectRatio: "9:16", originalVolume: 1, narrationVolume: 1 });
});

it("Studio saves the inline prompt before explicitly generating through the local bridge", async () => {
  const added = addMedia(createProject({ title: "Local generation" }), "image", "晨光", false);
  let current = added.document;
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const method = init.method ?? "GET";
    if (method === "PUT") { current = JSON.parse(init.body).document; calls.push("save"); return { ok: true, json: async () => ({ revision: current.revision }) }; }
    if (method === "POST") {
      expect(new URL(url).pathname).toBe("/generate");
      const input = JSON.parse(init.body); expect(input.baseRevision).toBe(current.revision);
      expect(current.drafts[0].nodes[0].spec.prompt).toBe("更新后的清晨"); calls.push("generate");
      const started = startGeneration(current, { draftId: current.activeDraftId, nodeId: added.nodeId, expectedProjectRevision: current.revision, expectedDraftRevision: current.drafts[0].revision });
      current = completeGeneration(started.document, { draftId: current.activeDraftId, jobId: started.request.jobId, providerJobId: "fixture", artifact: { kind: "image", mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]) } });
      return { ok: true, json: async () => ({ document: current, result: { status: "succeeded" } }) };
    }
    return { ok: true, status: 200, json: async () => structuredClone(current) };
  }));
  try {
    const user = userEvent.setup();
    render(<App projectUrl="http://127.0.0.1:4444/project.json?token=fixture" />);
    fireEvent.click(await screen.findByRole("button", { name: /晨光，待生成/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "更新后的清晨" } });
    expect(calls).toEqual([]);
    await user.click(screen.getByRole("button", { name: "生成媒体" }));
    await screen.findByText("生成完成，结果已保存");
    expect(calls).toEqual(["save", "generate"]);
    expect(screen.getByRole("button", { name: /晨光，已完成/ })).toBeInTheDocument();
  } finally { vi.unstubAllGlobals(); }
});

it("Studio imports a local file into the project and attaches its returned node", async () => {
  const initial = createProject({ title: "Local import" });
  const imported = addMedia(initial, "image", "素材.png");
  const uploads = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    if (init.method === "POST") {
      uploads.push({ url: new URL(url), body: init.body });
      return { ok: true, json: async () => imported };
    }
    return { ok: true, status: 200, json: async () => initial };
  }));
  try {
    render(<App projectUrl="http://127.0.0.1:4444/project.json?token=fixture" />);
    await screen.findByText("Local import");
    const file = new File(["local"], "素材.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("导入媒体文件"), { target: { files: [file] } });
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].url.pathname).toBe("/media");
    expect(uploads[0].url.searchParams.get("revision")).toBe(String(initial.revision));
    expect(uploads[0].body).toBe(file);
    expect(await screen.findByRole("button", { name: /素材.png，已完成/ })).toHaveAttribute("aria-pressed", "true");
  } finally { vi.unstubAllGlobals(); }
});
