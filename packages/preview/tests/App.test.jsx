import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  addNode,
  applyProviderSnapshot,
  createProject,
  failGeneration,
  startGeneration,
} from "@open-canvas/core";
import exampleDocument from "../../../docs/examples/canvas-v1-shot2-night.json";
import { App } from "../src/App.jsx";

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

    fireEvent.click(selectedNode);
    expect(selectedNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "图片节点 2 参数" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "人像质感调节" })).toBeInTheDocument();
    for (const label of ["参考", "标记", "风格", "聚焦"]) {
      const contextAction = screen.getByRole("button", { name: label });
      expect(contextAction).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(contextAction);
      expect(contextAction).toHaveAttribute("aria-pressed", "true");
    }
    for (const label of ["全景", "多角度", "打光", "九宫格", "高清", "宫格切分", "标注", "旋转", "下载", "预览"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "测试素材：抽象蓝色圆形。",
    );
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

    await user.click(screen.getByRole("button", { name: "资产管理" }));
    const assetManager = screen.getByRole("dialog", { name: "资产管理" });
    expect(assetManager).toBeInTheDocument();
    await user.click(within(assetManager).getByRole("button", { name: /聚焦 Shot 1 — Arrival/ }));
    expect(assetManager).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "画布" }));
    expect(screen.queryByRole("dialog", { name: "资产管理" })).not.toBeInTheDocument();

    const moveTool = within(toolbar).getByRole("button", { name: "移动" });
    await user.click(moveTool);
    expect(screen.getByRole("menu", { name: "移动工具" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /抓手工具/ }));
    expect(moveTool).toHaveAttribute("aria-pressed", "true");
    await user.click(moveTool);
    await user.click(screen.getByRole("menuitem", { name: /^移动/ }));
    expect(moveTool).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    expect(screen.getByRole("menu", { name: "添加画布节点" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "视频" }));
    expect(await screen.findByRole("button", { name: /视频 4，待生成/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("未保存")).toBeInTheDocument();
  });

  it("opens and dismisses the selected image node's contextual editing menu", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    fireEvent.click(await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ }));
    const quickActions = screen.getByLabelText(/快捷配置$/);
    await user.click(within(quickActions).getByRole("button", { name: "高清" }));

    const menu = screen.getByRole("menu", { name: "图像快捷操作" });
    expect(within(menu).getByRole("menuitem", { name: "扩图" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "扩图" }));
    expect(screen.queryByRole("menu", { name: "图像快捷操作" })).not.toBeInTheDocument();

    await user.click(within(quickActions).getByRole("button", { name: "九宫格" }));
    const gridMenu = screen.getByRole("menu", { name: "分镜布局预设" });
    expect(within(gridMenu).getByRole("menuitem", { name: "多机位九宫格" })).toBeInTheDocument();

    await user.click(within(quickActions).getByRole("button", { name: "人像质感调节" }));
    const portraitMenu = screen.getByRole("menu", { name: "人像调节选项" });
    expect(within(portraitMenu).getByRole("menuitem", { name: "情绪调节" })).toBeInTheDocument();
    expect(screen.getByText("聚焦")).toBeInTheDocument();
    expect(screen.getByText("General image V2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "调整图像规格" })).toHaveTextContent(/^16:9 · (?:2K|高清) · 1张/);
    expect(screen.getByLabelText("本次生成消耗 12 点")).toHaveTextContent("12");

    await user.click(within(quickActions).getByRole("button", { name: "人像质感调节" }));
    expect(screen.queryByRole("menu", { name: "人像调节选项" })).not.toBeInTheDocument();
    expect(screen.getByText("聚焦")).toBeInTheDocument();
    expect(screen.getByText("General image V2")).toBeInTheDocument();

    await user.click(within(quickActions).getByRole("button", { name: "宫格切分" }));
    const splitMenu = screen.getByRole("menu", { name: "宫格切分选项" });
    for (const label of ["4宫格 (2×2)", "9宫格 (3×3)", "16宫格 (4×4)", "25宫格 (5×5)", "自定义"]) {
      expect(within(splitMenu).getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    expect(within(splitMenu).getByRole("separator")).toBeInTheDocument();
    expect(screen.getByText("聚焦")).toBeInTheDocument();
    expect(screen.getByText("General image V2")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Shot 1 — Arrival 参数" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Shot 1 — Arrival，已完成/ }));
    expect(screen.getByText("聚焦")).toBeInTheDocument();
    expect(screen.getByText("General image V2")).toBeInTheDocument();
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

  it("offers the full creative-node palette and persists context nodes", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    const menu = screen.getByRole("menu", { name: "添加画布节点" });
    for (const label of ["文本", "图片", "视频", "智能剪辑", "导演台", "逐帧拉片", "音频", "脚本", "素材库", "上传", "从生成历史选择"]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }

    await user.click(within(menu).getByRole("menuitem", { name: "音频" }));
    const audioNode = await screen.findByRole("button", { name: /音频 1，待生成/ });
    expect(audioNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "描述配乐、旁白、环境音或声音设计。",
    );
  });

  it("opens and closes each dock surface as its own canvas state", async () => {
    const user = userEvent.setup();
    render(<App initialDocument={exampleDocument} />);
    const toolbar = screen.getByRole("toolbar", { name: "画布工具" });

    await user.click(within(toolbar).getByRole("button", { name: "打开工具箱" }));
    expect(screen.getByRole("dialog", { name: "我的工具箱" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭工具箱" }));

    await user.click(within(toolbar).getByRole("button", { name: "素材库" }));
    expect(screen.getByRole("dialog", { name: "素材库" })).toBeInTheDocument();
    await user.click(within(toolbar).getByRole("button", { name: "素材库" }));

    await user.click(within(toolbar).getByRole("button", { name: "角色库" }));
    expect(screen.getByRole("dialog", { name: "角色库" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭角色库" }));

    await user.click(within(toolbar).getByRole("button", { name: "历史记录" }));
    expect(screen.getByRole("dialog", { name: "历史资产" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭历史资产" }));

    await user.click(within(toolbar).getByRole("button", { name: "快捷键" }));
    expect(screen.getByRole("dialog", { name: "快捷键" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭快捷键" }));

    await user.click(within(toolbar).getByRole("button", { name: "教程" }));
    expect(screen.getByRole("dialog", { name: "帮助与教程" })).toBeInTheDocument();
    await user.click(within(toolbar).getByRole("button", { name: "教程" }));
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
    expect(screen.getByText("GVLM 3.1")).toBeInTheDocument();
    expect(screen.getByLabelText("本次生成消耗 6 点")).toHaveTextContent("6");
    expect(screen.getByRole("button", { name: "应用提示词" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "移除参考素材" })).toBeInTheDocument();

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
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
