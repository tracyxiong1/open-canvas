import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  addNode,
  applyProviderSnapshot,
  completeGeneration,
  connectNodes,
  createProject,
  failGeneration,
  registerImportedAsset,
  startGeneration,
  updateNode,
} from "@open-canvas/core";
import exampleDocument from "../../../docs/examples/canvas-v1-shot2-night.json";
import { App } from "../src/App.jsx";

function createDocumentWithHistoricalShotOutput() {
  let document = createProject({ title: "节点历史" });
  const draftId = document.activeDraftId;
  document = addNode(document, {
    draftId,
    title: "历史镜头",
    spec: {
      kind: "shot",
      prompt: "第一版镜头。",
      mediaKind: "image",
      inputAssetIds: [],
      requirements: {
        mediaType: "image/png",
        aspectRatio: "1:1",
        width: 1,
        height: 1,
        audio: "forbidden",
      },
    },
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
  });
  const nodeId = document.drafts[0].nodes[0].id;
  let started = startGeneration(document, {
    draftId,
    nodeId,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
    now: "2026-08-20T08:00:00Z",
  });
  document = completeGeneration(started.document, {
    draftId,
    jobId: started.document.drafts[0].nodes[0].execution.activeJobId,
    providerJobId: "mock-history-first",
    artifact: { kind: "image", mediaType: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) },
    now: "2026-08-20T08:00:01Z",
  });
  document = updateNode(document, {
    draftId,
    nodeId,
    prompt: "第二版镜头。",
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
    now: "2026-08-20T08:00:02Z",
  });
  started = startGeneration(document, {
    draftId,
    nodeId,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
    now: "2026-08-20T08:00:03Z",
  });
  return completeGeneration(started.document, {
    draftId,
    jobId: started.document.drafts[0].nodes[0].execution.activeJobId,
    providerJobId: "mock-history-second",
    artifact: { kind: "image", mediaType: "image/png", bytes: new Uint8Array([5, 6, 7, 8]) },
    now: "2026-08-20T08:00:04Z",
  });
}

function createDocumentWithMultipleShotOutputs() {
  let document = createProject({ title: "多候选结果" });
  const draftId = document.activeDraftId;
  document = addNode(document, {
    draftId,
    title: "多候选镜头",
    spec: {
      kind: "shot",
      prompt: "一座安静的轨道城市。",
      mediaKind: "image",
      inputAssetIds: [],
      requirements: {
        mediaType: "image/png",
        aspectRatio: "1:1",
        count: 2,
        audio: "forbidden",
      },
    },
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
  });
  const nodeId = document.drafts[0].nodes[0].id;
  const started = startGeneration(document, {
    draftId,
    nodeId,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
    resolveRoute: () => ({ providerId: "openai", modelId: "gpt-image-2", selectionSource: "registry_default" }),
  });
  return completeGeneration(started.document, {
    draftId,
    jobId: started.request.jobId,
    providerJobId: "openai-image:preview-candidates",
    artifacts: [
      { kind: "image", mediaType: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) },
      { kind: "image", mediaType: "image/png", bytes: new Uint8Array([5, 6, 7, 8]) },
    ],
  });
}

function createDocumentWithCopyableContextGroup() {
  let document = createProject({ title: "节点组复制" });
  const draftId = document.activeDraftId;
  for (const [title, role, position] of [
    ["角色设定 A", "character", { x: 120, y: 160 }],
    ["场景风格 B", "scene-style", { x: 520, y: 160 }],
  ]) {
    const draft = document.drafts[0];
    document = addNode(document, {
      draftId,
      title,
      spec: {
        kind: "composition",
        mediaType: "application/json",
        role,
        prompt: `${title} 的创作约束。`,
      },
      position,
      expectedProjectRevision: document.revision,
      expectedDraftRevision: draft.revision,
    });
  }
  const [source, target] = document.drafts[0].nodes;
  return connectNodes(document, {
    draftId,
    kind: "dependency",
    sourceNodeId: source.id,
    targetNodeId: target.id,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
  });
}

function createDocumentWithExpandableScript() {
  let document = createProject({ title: "脚本展开" });
  const draftId = document.activeDraftId;
  return addNode(document, {
    draftId,
    title: "三镜头脚本",
    spec: {
      kind: "composition",
      mediaType: "text/plain",
      role: "script",
      prompt: "1. 雨夜的高架桥上，信使抵达。\n2. 她穿过空旷的车站。\n3. 远处的列车亮起。",
    },
    position: { x: 160, y: 160 },
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
  });
}

function createDocumentWithOrderedComposition() {
  let document = createProject({ title: "有序合成" });
  const draftId = document.activeDraftId;
  for (const [title, prompt] of [["镜头 A", "第一段。"], ["镜头 B", "第二段。"]]) {
    const draft = document.drafts[0];
    document = addNode(document, {
      draftId,
      title,
      spec: {
        kind: "shot",
        prompt,
        mediaKind: "video",
        inputAssetIds: [],
        requirements: { aspectRatio: "16:9", audio: "either", mediaType: "video/mp4" },
      },
      expectedProjectRevision: document.revision,
      expectedDraftRevision: draft.revision,
    });
  }
  const [first, second] = document.drafts[0].nodes;
  document = addNode(document, {
    draftId,
    title: "成片输出",
    spec: { kind: "composition", role: "composition", mediaType: "video/mp4" },
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
  });
  const output = document.drafts[0].nodes.at(-1);
  document = connectNodes(document, {
    draftId,
    kind: "sequence",
    sourceNodeId: first.id,
    targetNodeId: second.id,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
  });
  document = connectNodes(document, {
    draftId,
    kind: "dependency",
    sourceNodeId: first.id,
    targetNodeId: output.id,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
  });
  return connectNodes(document, {
    draftId,
    kind: "dependency",
    sourceNodeId: second.id,
    targetNodeId: output.id,
    expectedProjectRevision: document.revision,
    expectedDraftRevision: document.drafts[0].revision,
  });
}

function createDocumentWithMixedGenerationReferences({ retainVideoReference = false } = {}) {
  let document = createProject({ title: "生成参考素材" });
  const draftId = document.activeDraftId;
  const image = registerImportedAsset(document, {
    expectedProjectRevision: document.revision,
    kind: "image",
    mediaType: "image/png",
    byteLength: 16,
    checksumSha256: `sha256:${"d".repeat(64)}`,
  });
  document = image.document;
  const video = registerImportedAsset(document, {
    expectedProjectRevision: document.revision,
    kind: "video",
    mediaType: "video/mp4",
    byteLength: 32,
    checksumSha256: `sha256:${"e".repeat(64)}`,
  });
  document = addNode(video.document, {
    draftId,
    expectedProjectRevision: video.document.revision,
    expectedDraftRevision: video.document.drafts[0].revision,
    title: "参考镜头",
    spec: {
      kind: "shot",
      prompt: "以项目内图片作为参考生成镜头。",
      mediaKind: "image",
      inputAssetIds: retainVideoReference ? [video.asset.id] : [],
      requirements: {
        mediaType: "image/png",
        aspectRatio: "16:9",
        width: 1792,
        height: 1008,
        audio: "forbidden",
      },
    },
  });
  return { document, imageAssetId: image.asset.id, videoAssetId: video.asset.id };
}

describe("editable open canvas", () => {
  it("opens a source-aligned image-to-text creative canvas by default", async () => {
    render(<App />);

    expect(screen.getByText("创作画布")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "草稿" })).toHaveValue("draft_019c8f55-9001-7000-8000-000000000001");
    expect(screen.getByTestId("react-flow-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加节点" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出 JSON" })).toBeEnabled();

    const selectedNode = await screen.findByRole("button", { name: /图片节点 2，已完成/ });
    expect(selectedNode).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "图片节点 2 参数" })).not.toBeInTheDocument();

    const editor = screen.getByTestId("react-flow-editor");
    expect(editor.querySelectorAll(".react-flow__handle")).toHaveLength(
      editor.querySelectorAll(".canvas-node").length * 2,
    );
    expect(editor.querySelectorAll('[aria-label="连接输入"]')).toHaveLength(
      editor.querySelectorAll(".canvas-node").length,
    );
    expect(editor.querySelectorAll('[aria-label="连接输出"]')).toHaveLength(
      editor.querySelectorAll(".canvas-node").length,
    );
    expect(editor.querySelectorAll(".react-flow__node.nodrag")).toHaveLength(0);
    expect(editor.querySelectorAll(".react-flow__node.nopan")).toHaveLength(
      editor.querySelectorAll(".canvas-node").length,
    );

    fireEvent.click(selectedNode);
    expect(selectedNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "图片节点 2 参数" })).toBeInTheDocument();
    expect(screen.getByLabelText(/可生成编辑变体$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "人像质感调节" })).toBeInTheDocument();
    for (const label of ["全景", "多角度", "打光", "九宫格", "高清", "宫格切分", "编辑当前镜头", "创建编辑变体", "下载当前素材", "预览"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    for (const label of ["参考", "标记", "风格", "聚焦", "标注", "旋转", "下载"]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "测试素材：抽象蓝色圆形。",
    );
    expect(screen.getByRole("img", { name: "图片节点 2 当前素材" })).toHaveAttribute(
      "src",
      "/assets/reference-blue-orbit-v2.png",
    );
    expect(screen.getByText("本地演示")).toBeInTheDocument();
    expect(screen.getByText("2048 × 1152")).toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开参数面板" }));
    expect(screen.getByRole("dialog", { name: "图片节点 2 参数" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起参数面板" }));
    expect(screen.queryByRole("dialog", { name: "图片节点 2 参数" })).not.toBeInTheDocument();
  });

  it("switches drafts and opens a generated asset preview", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "草稿" }), exampleDocument.drafts[0].id);
    await waitFor(() => expect(screen.queryByText("2 待处理")).not.toBeInTheDocument());

    const openPreview = await screen.findByRole("button", { name: "打开 Shot 1 — Arrival 的素材预览" });
    await user.click(openPreview);

    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("heading", { name: "Shot 1 — Arrival" })).toBeInTheDocument();
    expect(within(dialog).getByAltText("Shot 1 — Arrival 的生成画面")).toHaveAttribute("src", "/assets/shot-arrival.webp");

    await user.click(screen.getByRole("button", { name: "关闭素材预览" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("edits a prompt through the shared command core and supports undo and redo", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "草稿" }), exampleDocument.drafts[0].id);
    fireEvent.click(await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ }));

    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    await user.clear(prompt);
    await user.type(prompt, "A courier arrives during a violet electrical storm.");
    await user.click(screen.getByRole("button", { name: "应用提示词" }));

    expect(await screen.findByRole("button", { name: /Shot 1 — Arrival，待生成/ })).toBeInTheDocument();
    expect(screen.getByText("未保存")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重做" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "重做" }));
    expect(await screen.findByRole("button", { name: /Shot 1 — Arrival，待生成/ })).toBeInTheDocument();
  });

  it("supports modifier multi-selection and deletes the selected node group together", async () => {
    render(<App />);

    const imageNode = await screen.findByRole("button", { name: /图片节点 2，已完成/ });
    const textNode = screen.getByRole("button", { name: /文本节点 1，待生成/ });
    fireEvent.click(imageNode);
    fireEvent.click(textNode, { ctrlKey: true });

    expect(imageNode).toHaveAttribute("aria-pressed", "true");
    expect(textNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("region", { name: "图片节点 2 参数" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "文本节点 1 参数" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /图片节点 2，已完成/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /文本节点 1，待生成/ })).not.toBeInTheDocument();
    expect(screen.getByText("已删除 2 个节点，相关下游已标记为待生成")).toBeInTheDocument();
  });

  it("creates a project-local layout group from selected nodes without opening a global library or node composer", async () => {
    render(<App />);

    const imageNode = await screen.findByRole("button", { name: /图片节点 2，已完成/ });
    const textNode = screen.getByRole("button", { name: /文本节点 1，待生成/ });
    fireEvent.click(imageNode);
    fireEvent.click(textNode, { ctrlKey: true });
    expect(screen.getByRole("button", { name: "将选中节点分组" })).toBeEnabled();

    fireEvent.keyDown(document, { key: "g", ctrlKey: true });
    await waitFor(() => expect(screen.getByText("已将 2 个节点分组")).toBeInTheDocument());
    const frame = document.querySelector(".canvas-layout-group");
    expect(frame).toHaveAttribute("data-group-id");
    expect(frame).toHaveAccessibleName("分组 2 个节点，2 个节点");
    expect(screen.queryByRole("region", { name: /参数/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /角色库|素材库|风格库/ })).not.toBeInTheDocument();
  });

  it("copies a selected node group locally and restores its internal edge as dirty nodes", async () => {
    render(<App initialDocument={createDocumentWithCopyableContextGroup()} />);

    const source = await screen.findByRole("button", { name: "角色设定 A，待生成" });
    const target = screen.getByRole("button", { name: "场景风格 B，待生成" });
    expect(source).toBeInTheDocument();
    expect(target).toBeInTheDocument();
    fireEvent.click(source);
    fireEvent.click(target, { ctrlKey: true });
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    expect(screen.getByText("已复制 2 个节点")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "v", ctrlKey: true });
    const copiedSource = await screen.findByRole("button", { name: "角色设定 A 副本，待生成" });
    const copiedTarget = screen.getByRole("button", { name: "场景风格 B 副本，待生成" });
    expect(copiedSource).toBeInTheDocument();
    expect(copiedTarget).toBeInTheDocument();
    expect(screen.getByText("已粘贴 2 个节点")).toBeInTheDocument();
  });

  it("expands a project-local script into linked editable video shots", async () => {
    render(<App initialDocument={createDocumentWithExpandableScript()} />);

    const script = await screen.findByRole("button", { name: "三镜头脚本，待生成" });
    fireEvent.click(script);
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: "1. 雨夜的高架桥上，信使抵达。\n2. 她在蓝色霓虹中穿过空旷车站。\n3. 远处的列车亮起。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "从脚本创建视频镜头" }));

    expect(await screen.findByRole("button", { name: "镜头 1，待生成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "镜头 2，待生成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "镜头 3，待生成" })).toBeInTheDocument();
    expect(screen.getByText("已从脚本创建 3 个视频镜头")).toBeInTheDocument();

    fireEvent.click(script);
    expect(screen.getByText("已连接 3 项")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("1. 雨夜的高架桥上，信使抵达。\n2. 她在蓝色霓虹中穿过空旷车站。\n3. 远处的列车亮起。");
    fireEvent.click(screen.getByRole("button", { name: "镜头 2，待生成" }));
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("她在蓝色霓虹中穿过空旷车站。");
  });

  it("keeps normal copy and paste available while a node prompt is being edited", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /文本节点 1，待生成/ }));
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.keyDown(prompt, { key: "c", ctrlKey: true });
    fireEvent.keyDown(prompt, { key: "v", ctrlKey: true });

    expect(screen.queryByText(/已复制 \d+ 个节点/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已粘贴 \d+ 个节点/)).not.toBeInTheDocument();
  });

  it("keeps a copied node group inside its source draft", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    fireEvent.click(await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ }));
    fireEvent.keyDown(document, { key: "c", ctrlKey: true });
    expect(screen.getByText("已复制 1 个节点")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "草稿" }), exampleDocument.drafts[1].id);
    await screen.findByRole("button", { name: /Shot 2 — Crossing，待生成/ });
    fireEvent.keyDown(document, { key: "v", ctrlKey: true });

    expect(screen.queryByRole("button", { name: /Shot 1 — Arrival 副本/ })).not.toBeInTheDocument();
  });

  it("loads and explicitly saves the CLI project's local document bridge", async () => {
    const user = userEvent.setup();
    const bridgeDocument = structuredClone(exampleDocument);
    bridgeDocument.project.title = "Bridge studio";
    bridgeDocument.revision = 12;
    const projectUrl = "http://127.0.0.1:45678/project.json?token=test-token";
    const assetUrl = "http://127.0.0.1:45678/asset?token=test-token";
    let savedPayload = null;
    const fetchMock = vi.fn(async (_url, init = {}) => {
      if ((init.method ?? "GET") === "PUT") {
        savedPayload = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ revision: savedPayload.document.revision }) };
      }
      return { ok: true, status: 200, json: async () => structuredClone(bridgeDocument) };
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      render(<App projectUrl={projectUrl} assetUrl={assetUrl} initialDraftId={bridgeDocument.drafts[0].id} />);
      expect(await screen.findByText("Bridge studio")).toBeInTheDocument();

      const source = await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ });
      fireEvent.click(source);
      const prompt = screen.getByRole("textbox", { name: "Prompt" });
      await user.clear(prompt);
      await user.type(prompt, "A local bridge saves this prompt.");
      await user.click(screen.getByRole("button", { name: "应用提示词" }));

      const save = screen.getByRole("button", { name: "保存本地项目" });
      expect(save).toBeEnabled();
      await user.click(save);
      await waitFor(() => expect(savedPayload).not.toBeNull());
      expect(savedPayload.baseRevision).toBe(bridgeDocument.revision);
      expect(savedPayload.document.drafts[0].nodes[0].spec.prompt).toBe("A local bridge saves this prompt.");
      expect(screen.getByText("已保存到本地项目")).toBeInTheDocument();
      expect(screen.getByText("已保存")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("deletes a selected node through the canvas keyboard and restores it with undo", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    const source = await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ });
    fireEvent.click(source);
    fireEvent.keyDown(document, { key: "Delete" });

    await waitFor(() => expect(screen.queryByRole("button", { name: /Shot 1 — Arrival，/ })).not.toBeInTheDocument());
    expect(screen.getByText("已删除节点，相关下游已标记为待生成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ })).toBeInTheDocument();
  });

  it("copies the focused node into a new dirty project-local node", async () => {
    render(<App initialDocument={exampleDocument} />);

    const source = await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ });
    fireEvent.click(source);
    fireEvent.keyDown(document, { key: "d", metaKey: true });

    const copy = await screen.findByRole("button", { name: /Shot 1 — Arrival 副本，待生成/ });
    expect(copy).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("已复制节点")).toBeInTheDocument();
    expect(screen.getByText("未保存")).toBeInTheDocument();
  });

  it("updates executable image and video output settings through the shared command core", async () => {
    const user = userEvent.setup();
    render(<App />);

    const sourceImage = await screen.findByRole("button", { name: /图片节点 2，已完成/ });
    fireEvent.click(sourceImage);
    await user.click(screen.getByRole("button", { name: "打开输出设置" }));
    const imageSettings = screen.getByRole("dialog", { name: "输出设置" });
    expect(within(imageSettings).getByRole("radio", { name: "16:9" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(imageSettings).getByRole("radio", { name: "2 张" }));
    expect(screen.getByRole("dialog", { name: "输出设置" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "输出设置" })).getByText("2048 × 1152 · 2 张候选")).toBeInTheDocument();
    await user.click(within(imageSettings).getByRole("radio", { name: "9:16" }));

    expect(screen.getByRole("dialog", { name: "输出设置" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /图片节点 2，待生成/ })).toBeInTheDocument();
    expect(screen.getAllByText(/1008 × 1792 · 2 张/).length).toBeGreaterThan(0);
    expect(screen.getByText("未保存")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getAllByText(/2048 × 1152 · 2 张/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(await screen.findByRole("button", { name: /图片节点 2，已完成/ })).toBeInTheDocument();
    expect(screen.getAllByText("2048 × 1152").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: "视频镜头" }));
    await user.click(screen.getByRole("button", { name: "打开输出设置" }));
    const videoSettings = screen.getByRole("dialog", { name: "输出设置" });
    expect(within(videoSettings).getByText("自动 · 随提供方")).toBeInTheDocument();
    expect(within(videoSettings).getByRole("radio", { name: "自动" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(videoSettings).getByRole("radio", { name: "10 秒" }));

    expect(await screen.findByText("16:9 · 10 秒")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "输出设置" })).getByText("10 秒 · 随提供方")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "输出设置" })).getByRole("radio", { name: "需要音频" }));

    expect(within(screen.getByRole("dialog", { name: "输出设置" })).getByText("10 秒 · 需要音频")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "输出设置" })).getByRole("radio", { name: "9:16" }));

    expect(await screen.findByText("9:16 · 10 秒")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "输出设置" })).getByRole("radio", { name: "自动" }));
    expect(await screen.findByText("9:16 · 自动时长")).toBeInTheDocument();
  });

  it("adds nodes and keeps canvas controls interactive", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    const toolbar = screen.getByRole("toolbar", { name: "画布工具" });
    const edgeToggle = screen.getByRole("button", { name: "隐藏节点连线" });
    expect(edgeToggle).toHaveAttribute("aria-pressed", "false");
    await user.click(edgeToggle);
    expect(edgeToggle).toHaveAttribute("aria-pressed", "true");

    const snapToggle = screen.getByRole("button", { name: "网格吸附" });
    expect(snapToggle).toHaveAttribute("aria-pressed", "false");
    await user.click(snapToggle);
    expect(snapToggle).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "缩放选项" }));
    expect(screen.getByRole("menu", { name: "缩放选项" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "适合屏幕" })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "资产管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "素材库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "角色库" })).not.toBeInTheDocument();

    const moveTool = within(toolbar).getByRole("button", { name: "移动" });
    const editor = screen.getByTestId("react-flow-editor");
    expect(screen.getByTestId("canvas-viewport")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("双指滑动可平移画布"),
    );
    expect(editor.querySelectorAll(".react-flow__node.nopan")).toHaveLength(
      editor.querySelectorAll(".canvas-node").length,
    );
    await user.click(moveTool);
    expect(screen.getByRole("menu", { name: "移动工具" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /抓手工具/ }));
    expect(moveTool).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(editor.querySelectorAll(".react-flow__node.nopan")).toHaveLength(0));
    await user.click(moveTool);
    await user.click(screen.getByRole("menuitem", { name: /^移动/ }));
    expect(moveTool).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(editor.querySelectorAll(".react-flow__node.nopan")).toHaveLength(
      editor.querySelectorAll(".canvas-node").length,
    ));

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    expect(screen.getByRole("menu", { name: "添加画布节点" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "视频镜头" }));
    expect(await screen.findByRole("button", { name: /视频 4，待生成/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("未保存")).toBeInTheDocument();
  });

  it("creates a real dependent edit variation from a selected image node", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    fireEvent.click(await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ }));
    const quickActions = screen.getByLabelText(/可生成编辑变体$/);
    await user.click(within(quickActions).getByRole("button", { name: "高清" }));

    const menu = screen.getByRole("menu", { name: "图像编辑操作" });
    expect(within(menu).getByRole("menuitem", { name: "扩图" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "扩图" }));
    expect(screen.queryByRole("menu", { name: "图像编辑操作" })).not.toBeInTheDocument();
    const variation = await screen.findByRole("button", { name: /Shot 1 — Arrival · 扩图，待生成/ });
    expect(variation).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Prompt" }).value).toContain("编辑目标：向画面边缘扩展环境");
    expect(screen.getByText("未保存")).toBeInTheDocument();
    expect(screen.queryByText("General image V2")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/本次生成消耗/)).not.toBeInTheDocument();
  });

  it("creates a project-local variation from the direct image toolbar action", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    fireEvent.click(await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ }));
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    await user.click(screen.getByRole("button", { name: "编辑当前镜头" }));
    expect(prompt).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "创建编辑变体" }));
    const variation = await screen.findByRole("button", { name: /Shot 1 — Arrival · 编辑变体，待生成/ });
    expect(variation).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Prompt" }).value).toContain("编辑目标：基于当前素材创建一个可继续编辑的镜头变体");
    expect(screen.getByText("未保存")).toBeInTheDocument();
  });

  it("previews canvas arrangement before the user keeps or restores it", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "整理画布，Alt+Shift+F" }));
    const firstDialog = screen.getByRole("dialog", { name: "整理画布确认" });
    expect(within(firstDialog).getByText("是否保留此次整理结果？")).toBeInTheDocument();
    await user.click(within(firstDialog).getByRole("button", { name: "还原" }));
    expect(screen.queryByRole("dialog", { name: "整理画布确认" })).not.toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "整理画布，Alt+Shift+F" }));
    const secondDialog = screen.getByRole("dialog", { name: "整理画布确认" });
    await user.click(within(secondDialog).getByRole("button", { name: "保留" }));
    expect(screen.queryByRole("dialog", { name: "整理画布确认" })).not.toBeInTheDocument();
    expect(screen.getByText("未保存")).toBeInTheDocument();
  });

  it("opens node creation and canvas arrangement through their documented keyboard shortcuts", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.keyDown(document, { key: "n" });
    const menu = await screen.findByRole("menu", { name: "添加画布节点" });
    expect(within(menu).getByRole("menuitem", { name: "文本提示" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "添加画布节点" })).not.toBeInTheDocument());

    fireEvent.keyDown(document, { key: "F", altKey: true, shiftKey: true });
    const arrangement = await screen.findByRole("dialog", { name: "整理画布确认" });
    expect(within(arrangement).getByText("是否保留此次整理结果？")).toBeInTheDocument();
    await user.click(within(arrangement).getByRole("button", { name: "还原" }));
  });

  it("offers the full creative-node palette and persists context nodes", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    const menu = screen.getByRole("menu", { name: "添加画布节点" });
    for (const label of ["文本提示", "故事脚本", "角色设定", "场景与风格", "图像镜头", "视频镜头", "合成输出", "剪辑", "分镜规划", "视频分析", "音频", "添加本地素材引用"]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }
    for (const label of ["素材库", "角色库", "风格库", "历史记录"]) {
      expect(within(menu).queryByRole("menuitem", { name: label })).not.toBeInTheDocument();
    }

    await user.click(within(menu).getByRole("menuitem", { name: "音频" }));
    const audioNode = await screen.findByRole("button", { name: /音频 1，待生成/ });
    expect(audioNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "描述配乐、旁白、环境音或声音设计。",
    );
    expect(screen.getByText(/(?:可连接到镜头|已连接 \d+ 项)/)).toBeInTheDocument();
    expect(screen.queryByText("图像模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/本次生成消耗/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: "角色设定" }));
    const characterNode = await screen.findByRole("button", { name: /角色设定 1，待生成/ });
    expect(characterNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "描述角色的外观、服装、年龄、表情和跨镜头连续性约束。",
    );
    expect(screen.getByText("为跨镜头一致性记录外观、服装和情绪。")).toBeInTheDocument();
  });

  it("adds a project-local composition output instead of a provider-shaped generation node", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: "合成输出" }));
    const output = await screen.findByRole("button", { name: /合成输出 \d+，待生成/ });
    expect(output).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: /合成输出 \d+ 参数/ })).toBeInTheDocument();
    expect(screen.getByText("等待连接镜头")).toBeInTheDocument();
    expect(screen.getByText("成片渲染将在剪辑工作区接入")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Prompt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开输出设置" })).not.toBeInTheDocument();
  });

  it("shows the explicit project-local sequence in an output composition", async () => {
    render(<App initialDocument={createDocumentWithOrderedComposition()} />);

    fireEvent.click(await screen.findByRole("button", { name: "成片输出，待生成" }));
    expect(screen.getByText("已接收 2 个上游节点")).toBeInTheDocument();
    expect(screen.getByText("顺序：镜头 A → 镜头 B")).toBeInTheDocument();
  });

  it("keeps the local dock focused on editing tools and help", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);
    const toolbar = screen.getByRole("toolbar", { name: "画布工具" });

    for (const label of ["打开工具箱", "素材库", "角色库", "历史记录", "教程"]) {
      expect(within(toolbar).queryByRole("button", { name: label })).not.toBeInTheDocument();
    }

    await user.click(within(toolbar).getByRole("button", { name: "快捷键与帮助" }));
    const shortcutSheet = screen.getByRole("dialog", { name: "快捷键" });
    expect(shortcutSheet).toHaveTextContent("空格");
    expect(shortcutSheet).toHaveTextContent("双指滑动");
    expect(shortcutSheet).toHaveTextContent("双指捏合");
    await user.click(screen.getByRole("button", { name: "关闭快捷键" }));
  });

  it("adds a persistent text node with an editable canvas prompt", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: /文本/ }));

    const textNode = await screen.findByRole("button", { name: /文本 \d+，待生成/ });
    expect(textNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "写下这段创作的主题、情绪或叙事目标。",
    );
  });

  it("gives the text context card clear project-local creation directions", async () => {
    render(<App />);

    for (const label of ["叙事文本", "镜头描述", "画面提示", "声音意图"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("starts an empty canvas with the node type named by each quick-start action", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={createProject({ title: "空白创作" })} />);

    await user.click(screen.getByRole("button", { name: "故事脚本" }));

    const scriptNode = await screen.findByRole("button", { name: "脚本 1，待生成" });
    expect(scriptNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "脚本 1 参数" })).toBeInTheDocument();
    expect(screen.getByText("故事脚本")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "写下场景、角色、旁白与镜头节奏。",
    );
  });

  it("associates an imported local asset from a context node instead of opening a global library", async () => {
    const user = userEvent.setup();
    const empty = createProject({ title: "Local asset context" });
    const imported = registerImportedAsset(empty, {
      expectedProjectRevision: empty.revision,
      kind: "image",
      mediaType: "image/png",
      byteLength: 16,
      checksumSha256: `sha256:${"c".repeat(64)}`,
    });
    const document = addNode(imported.document, {
      draftId: imported.document.activeDraftId,
      expectedProjectRevision: imported.document.revision,
      expectedDraftRevision: imported.document.drafts[0].revision,
      title: "主角参考",
      spec: {
        kind: "composition",
        mediaType: "application/json",
        role: "character",
        prompt: "主角保持相同的短发、蓝色外套与神情。",
      },
    });

    render(<App initialDocument={document} />);
    fireEvent.click(await screen.findByRole("button", { name: /主角参考，待生成/ }));
    await user.click(screen.getByRole("button", { name: "关联本地素材" }));
    const picker = screen.getByRole("listbox", { name: "选择已导入本地素材" });
    await user.click(within(picker).getByRole("option"));

    expect(screen.getByRole("button", { name: /移除 图片素材 asset_sha256/ })).toBeInTheDocument();
    expect(screen.queryByText("尚未关联本地素材")).not.toBeInTheDocument();
    expect(screen.getByText("未保存")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "素材库" })).not.toBeInTheDocument();
  });

  it("keeps script, edit, analysis, and audio source media inside their project-local context nodes", async () => {
    const user = userEvent.setup();
    render(<App />);

    for (const nodeLabel of ["故事脚本", "剪辑", "视频分析", "音频"]) {
      await user.click(screen.getByRole("button", { name: "添加节点" }));
      await user.click(screen.getByRole("menuitem", { name: nodeLabel }));
      await user.click(screen.getByRole("button", { name: "关联本地素材" }));

      const picker = screen.getByRole("listbox", { name: "选择已导入本地素材" });
      await user.click(within(picker).getAllByRole("option")[0]);
      expect(screen.getByRole("button", { name: /移除 图片素材 asset_sha256/ })).toBeInTheDocument();
    }

    expect(screen.getByText("已更新本地素材引用")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "素材库" })).not.toBeInTheDocument();
  });

  it("associates a project-local reference asset with an image shot", async () => {
    const user = userEvent.setup();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /图片节点 2，已完成/ }));
    await user.click(screen.getByRole("button", { name: "关联本地参考素材" }));
    const picker = screen.getByRole("dialog", { name: "选择本地参考素材" });
    const options = within(picker).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    await user.click(options[0]);

    expect(await screen.findByRole("button", { name: /图片节点 2，待生成/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "管理本地参考素材，已关联 1 个" })).toBeInTheDocument();
    expect(screen.getByText("已关联 1 个参考素材")).toBeInTheDocument();
    expect(screen.getByText("已更新本地参考素材，相关节点已标记为待生成")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "素材库" })).not.toBeInTheDocument();
  });

  it("shows only locally executable image references for generation while retaining an old incompatible reference for removal", async () => {
    const { document } = createDocumentWithMixedGenerationReferences({ retainVideoReference: true });
    render(<App initialDocument={document} />);

    fireEvent.click(await screen.findByRole("button", { name: "参考镜头，待生成" }));
    fireEvent.click(screen.getByRole("button", { name: "管理本地参考素材，已关联 1 个" }));
    const picker = screen.getByRole("dialog", { name: "选择本地参考素材" });
    const options = within(picker).getAllByRole("option");

    expect(picker).toHaveTextContent("PNG、JPEG 或 WebP 图片");
    expect(options).toHaveLength(2);
    expect(options.filter((option) => option.textContent?.includes("图片素材"))).toHaveLength(1);
    const legacyVideo = options.find((option) => option.textContent?.includes("视频素材"));
    expect(legacyVideo).toHaveTextContent("当前路由不支持");
    expect(legacyVideo).toHaveAttribute("aria-selected", "true");

    fireEvent.click(legacyVideo);
    expect(screen.getByRole("button", { name: "关联本地参考素材" })).toBeInTheDocument();
  });

  it("shows superseded output inside the node and safely reuses it as a project-local reference", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={createDocumentWithHistoricalShotOutput()} />);

    fireEvent.click(await screen.findByRole("button", { name: /历史镜头，已完成/ }));
    await user.click(screen.getByRole("button", { name: "查看 1 项历史结果" }));

    const history = screen.getByRole("dialog", { name: "历史镜头 历史结果" });
    expect(within(history).getByText("第 1 次生成")).toBeInTheDocument();
    expect(within(history).getByText("mock-image-v1")).toBeInTheDocument();
    await user.click(within(history).getByRole("button", { name: "将第 1 次生成结果用作参考素材" }));

    expect(screen.queryByRole("dialog", { name: "历史镜头 历史结果" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /历史镜头，待生成/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "管理本地参考素材，已关联 1 个" })).toBeInTheDocument();
    expect(screen.getByText("已更新本地参考素材，相关节点已标记为待生成")).toBeInTheDocument();
  });

  it("keeps multiple current image candidates project-local and opens the selected preview", async () => {
    const user = userEvent.setup();
    render(
      <App
        initialDocument={createDocumentWithMultipleShotOutputs()}
        assetUrl="http://127.0.0.1:40123/asset?token=preview-test"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "多候选镜头，已完成" }));
    await user.click(screen.getByRole("button", { name: "查看本次生成的 2 个结果" }));

    const candidates = screen.getByRole("dialog", { name: "多候选镜头 当前生成结果" });
    expect(within(candidates).getByRole("list", { name: "当前生成候选" })).toBeInTheDocument();
    expect(within(candidates).getByRole("button", { name: "预览第 1 个当前结果" })).toBeEnabled();
    await user.click(within(candidates).getByRole("button", { name: "预览第 2 个当前结果" }));

    expect(screen.queryByRole("dialog", { name: "多候选镜头 当前生成结果" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "多候选镜头" })).toBeInTheDocument();
  });

  it("matches the text-node composer anatomy and dismisses zoom on canvas interaction", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "缩放选项" }));
    expect(screen.getByRole("menu", { name: "缩放选项" })).toBeInTheDocument();

    const textNode = await screen.findByRole("button", { name: /文本节点 1，待生成/ });
    fireEvent.pointerDown(textNode);
    fireEvent.click(textNode);
    expect(screen.queryByRole("menu", { name: "缩放选项" })).not.toBeInTheDocument();

    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("测试镜头：城市天际线，夜景。");
    expect(screen.getByAltText("文本节点 1 的上游参考素材")).toBeInTheDocument();
    expect(screen.getByLabelText("1 个输入")).toHaveTextContent("1");
    expect(screen.getByText(/(?:可连接到镜头|已连接 \d+ 项)/)).toBeInTheDocument();
    expect(screen.queryByText("GVLM 3.1")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/本次生成消耗/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用提示词" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "移除参考素材" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开参数面板" }));
    expect(screen.getByRole("dialog", { name: "文本节点 1 参数" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收起参数面板" }));
    expect(screen.queryByRole("dialog", { name: "文本节点 1 参数" })).not.toBeInTheDocument();
  });

  it("renders queued, running, and failed states from validated job projections", async () => {
    let stateDocument = createProject({ title: "Job state gallery" });
    for (const title of ["运行镜头", "排队镜头", "失败镜头"]) {
      const draft = stateDocument.drafts[0];
      stateDocument = addNode(stateDocument, {
        draftId: draft.id,
        title,
        spec: { kind: "shot", prompt: title, mediaKind: "image", inputAssetIds: [] },
        position: { x: draft.nodes.length * 340, y: 0 },
        expectedProjectRevision: stateDocument.revision,
        expectedDraftRevision: draft.revision,
      });
    }

    const draftId = stateDocument.activeDraftId;
    const nodeIds = stateDocument.drafts[0].nodes.map((node) => node.id);
    let started = startGeneration(stateDocument, {
      draftId,
      nodeId: nodeIds[0],
      expectedProjectRevision: stateDocument.revision,
      expectedDraftRevision: stateDocument.drafts[0].revision,
    });
    stateDocument = applyProviderSnapshot(started.document, {
      draftId,
      jobId: started.document.drafts[0].nodes[0].execution.activeJobId,
      snapshot: { status: "running", providerJobId: "mock-running", progress: 0.42 },
    });
    started = startGeneration(stateDocument, {
      draftId,
      nodeId: nodeIds[1],
      expectedProjectRevision: stateDocument.revision,
      expectedDraftRevision: stateDocument.drafts[0].revision,
    });
    stateDocument = started.document;
    started = startGeneration(stateDocument, {
      draftId,
      nodeId: nodeIds[2],
      expectedProjectRevision: stateDocument.revision,
      expectedDraftRevision: stateDocument.drafts[0].revision,
    });
    const failedJobId = started.document.drafts[0].nodes[2].execution.activeJobId;
    stateDocument = failGeneration(started.document, {
      draftId,
      jobId: failedJobId,
      code: "provider_unavailable",
      message: "生成服务超时，可重试",
      retryable: true,
    });

    render(<App initialDocument={stateDocument} />);

    expect(await screen.findByLabelText("运行镜头 生成中")).toBeInTheDocument();
    expect(screen.getByLabelText("排队镜头 排队中")).toBeInTheDocument();
    expect(screen.getByLabelText("失败镜头 失败")).toBeInTheDocument();
    expect(screen.getByTestId("react-flow-editor").querySelector('[data-node-status="running"]')).not.toBeNull();
    expect(screen.getByTestId("react-flow-editor").querySelector('[data-node-status="failed"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "失败镜头，失败" }));
    fireEvent.click(screen.getByRole("button", { name: "查看失败原因" }));
    const failureDetails = screen.getByRole("dialog", { name: "失败详情" });
    expect(within(failureDetails).getByText("生成服务超时，可重试")).toBeInTheDocument();
    expect(within(failureDetails).getByText("provider_unavailable")).toBeInTheDocument();
    expect(within(failureDetails).getByText("检查本地配置后可在 Codex 或 CLI 中重试。")).toBeInTheDocument();
    fireEvent.click(within(failureDetails).getByRole("button", { name: "关闭失败详情" }));
    expect(screen.queryByRole("dialog", { name: "失败详情" })).not.toBeInTheDocument();
  });

  it("keeps the editor and primary tools available at a mobile viewport", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      render(<App initialDocument={exampleDocument} />);
      expect(await screen.findByRole("button", { name: /Shot 2 — Crossing，待生成/ })).toBeInTheDocument();
      expect(screen.getByRole("toolbar", { name: "画布工具" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "添加节点" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "导出 JSON" })).toBeEnabled();

      const selectedNode = await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ });
      fireEvent.click(selectedNode);
      expect(screen.getByRole("region", { name: "Shot 1 — Arrival 参数" })).toBeInTheDocument();
      expect(screen.getByLabelText("Shot 1 — Arrival 可生成编辑变体")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "创建编辑变体" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
