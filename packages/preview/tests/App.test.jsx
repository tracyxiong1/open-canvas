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
  it("renders the active variation as a React Flow editor", async () => {
    render(<App />);

    expect(screen.getByText("Three-shot science-fiction short")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "草稿" })).toHaveValue(exampleDocument.activeDraftId);
    expect(screen.getByTestId("react-flow-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加节点" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出 JSON" })).toBeEnabled();

    const selectedNode = await screen.findByRole("button", { name: /Shot 2 — Crossing，待生成/ });
    expect(selectedNode).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Shot 2 — Crossing 参数" })).not.toBeInTheDocument();

    fireEvent.click(selectedNode);
    expect(selectedNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Shot 2 — Crossing 参数" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "At night, the courier walks through a moonlit glass transit corridor.",
    );
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("switches drafts and opens a generated asset preview", async () => {
    const user = userEvent.setup();
    render(<App />);

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
    render(<App />);

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
    render(<App />);

    const toolbar = screen.getByRole("toolbar", { name: "画布工具" });
    const edgeToggle = within(toolbar).getByRole("button", { name: "显示连线" });
    expect(edgeToggle).toHaveAttribute("aria-pressed", "true");
    await user.click(edgeToggle);
    expect(edgeToggle).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "切换到抓手工具" }));
    const selectTool = screen.getByRole("button", { name: "切换到选择工具" });
    expect(selectTool).toHaveAttribute("aria-pressed", "true");
    await user.click(selectTool);
    expect(screen.getByRole("button", { name: "切换到抓手工具" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    expect(screen.getByRole("menu", { name: "添加画布节点" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "视频" }));
    expect(await screen.findByRole("button", { name: /视频 4，待生成/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("未保存")).toBeInTheDocument();
  });

  it("offers the full creative-node palette and persists context nodes", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    const menu = screen.getByRole("menu", { name: "添加画布节点" });
    for (const label of ["文本", "图片", "视频", "编辑", "分镜", "镜头分析", "音频", "脚本", "素材", "上传", "从生成历史中选择"]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }

    await user.click(within(menu).getByRole("menuitem", { name: "音频" }));
    const audioNode = await screen.findByRole("button", { name: /音频 1，待生成/ });
    expect(audioNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "描述配乐、旁白、环境音或声音设计。",
    );
  });

  it("adds a persistent text node with an editable canvas prompt", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.click(screen.getByRole("menuitem", { name: /文本/ }));

    const textNode = await screen.findByRole("button", { name: /文本 \d+，待生成/ });
    expect(textNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "写下这段创作的主题、情绪或叙事目标。",
    );
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
      render(<App />);
      expect(await screen.findByRole("button", { name: /Shot 2 — Crossing，待生成/ })).toBeInTheDocument();
      expect(screen.getByRole("toolbar", { name: "画布工具" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "添加节点" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "导出 JSON" })).toBeEnabled();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
