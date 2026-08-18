import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  addNode,
  applyProviderSnapshot,
  createProject,
  failGeneration,
  startGeneration,
} from "@creator-canvas/core";
import exampleDocument from "../../../docs/examples/canvas-v1-shot2-night.json";
import { App } from "../src/App.jsx";

describe("editable creator canvas", () => {
  it("renders the active variation as a React Flow editor", async () => {
    render(<App />);

    expect(screen.getByText("Three-shot science-fiction short")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "草稿" })).toHaveValue(exampleDocument.activeDraftId);
    expect(screen.getByTestId("react-flow-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增镜头" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出 JSON" })).toBeEnabled();

    const selectedNode = await screen.findByRole("button", { name: /Shot 2 — Crossing，待生成/ });
    expect(selectedNode).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Shot 2 — Crossing 参数" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue(
      "At night, the courier walks through a moonlit glass transit corridor.",
    );
    expect(screen.getByText("Schema v1 · 可编辑")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "应用更改" }));

    expect(await screen.findByRole("button", { name: /Shot 1 — Arrival，待生成/ })).toBeInTheDocument();
    expect(screen.getByText("有本地更改")).toBeInTheDocument();
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

    const edgeToggle = screen.getByRole("button", { name: "显示连线" });
    expect(edgeToggle).toHaveAttribute("aria-pressed", "true");
    await user.click(edgeToggle);
    expect(edgeToggle).toHaveAttribute("aria-pressed", "false");

    const panButton = screen.getByRole("button", { name: "平移画布" });
    const selectButton = screen.getByRole("button", { name: "选择和移动节点" });
    await user.click(panButton);
    expect(panButton).toHaveAttribute("aria-pressed", "true");
    await user.click(selectButton);
    expect(selectButton).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "新增镜头" }));
    expect(await screen.findByRole("button", { name: /镜头 4，待生成/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("有本地更改")).toBeInTheDocument();
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

    expect(await screen.findByText("正在生成 · 42%")).toBeInTheDocument();
    expect(screen.getByLabelText("生成进度 42%")).toBeInTheDocument();
    expect(screen.getByText("任务已进入生成队列")).toBeInTheDocument();
    expect(screen.getByText("生成服务超时，可重试")).toBeInTheDocument();
  });

  it("keeps the editor and primary tools available at a mobile viewport", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      render(<App />);
      expect(await screen.findByRole("button", { name: /Shot 2 — Crossing，待生成/ })).toBeInTheDocument();
      expect(screen.getByRole("toolbar", { name: "画布工具" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "新增镜头" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "导出 JSON" })).toBeEnabled();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
