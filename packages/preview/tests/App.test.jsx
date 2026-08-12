import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import exampleDocument from "../../../docs/examples/canvas-v1-shot2-night.json";
import { App } from "../src/App.jsx";

function parseView(viewport) {
  const [x, y, scale] = viewport.dataset.view.split(",").map(Number);
  return { x, y, scale };
}

describe("canvas preview", () => {
  it("renders the active variation and exposes read-only parameters", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText("Three-shot science-fiction short")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "草稿" })).toHaveValue(
      exampleDocument.activeDraftId,
    );

    await waitFor(() => expect(screen.getByLabelText(/Shot 2 — Crossing，待生成/)).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("region", { name: "Shot 2 — Crossing 参数" })).toBeInTheDocument();
    expect(screen.getByText(/moonlit glass transit corridor/i)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Shot 1 — Arrival，已完成/));
    expect(screen.getByRole("region", { name: "Shot 1 — Arrival 参数" })).toBeInTheDocument();
    expect(screen.getByText(/mock · mock-video-v1/i)).toBeInTheDocument();
  });

  it("switches drafts and opens a generated asset preview", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole("combobox", { name: "草稿" }), exampleDocument.drafts[0].id);
    await waitFor(() => expect(screen.queryByText("2 待处理")).not.toBeInTheDocument());

    const openPreview = await screen.findByRole("button", {
      name: "打开 Shot 1 — Arrival 的素材预览",
    });
    await user.click(openPreview);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shot 1 — Arrival" })).toBeInTheDocument();
    expect(within(dialog).getByAltText("Shot 1 — Arrival 的生成画面")).toHaveAttribute(
      "src",
      "/assets/shot-arrival.webp",
    );

    await user.click(screen.getByRole("button", { name: "关闭素材预览" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pans, zooms, fits, and toggles edge visibility", async () => {
    const user = userEvent.setup();
    render(<App />);
    const viewport = screen.getByTestId("canvas-viewport");

    const initial = parseView(viewport);
    await user.click(screen.getByRole("button", { name: "平移画布" }));
    fireEvent.pointerDown(viewport, { pointerId: 11, pointerType: "mouse", button: 0, clientX: 120, clientY: 180 });
    fireEvent.pointerMove(viewport, { pointerId: 11, pointerType: "mouse", clientX: 172, clientY: 216 });
    fireEvent.pointerUp(viewport, { pointerId: 11, pointerType: "mouse", clientX: 172, clientY: 216 });
    const panned = parseView(viewport);
    expect(panned.x).toBe(initial.x + 52);
    expect(panned.y).toBe(initial.y + 36);

    await user.click(screen.getByRole("button", { name: "放大画布" }));
    expect(parseView(viewport).scale).toBeGreaterThan(panned.scale);

    await user.click(screen.getByRole("button", { name: "适合屏幕" }));
    expect(parseView(viewport).scale).toBeGreaterThanOrEqual(0.35);

    expect(screen.getByLabelText("节点连线")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "显示连线" }));
    expect(screen.queryByLabelText("节点连线")).not.toBeInTheDocument();
  });

  it("renders queued, running, and failed states from current job projections", async () => {
    const runningDocument = structuredClone(exampleDocument);
    runningDocument.activeDraftId = runningDocument.drafts[0].id;
    const draft = runningDocument.drafts[0];
    const runningNode = draft.nodes[0];
    const runningJob = draft.jobs.find((item) => item.id === runningNode.execution.activeJobId);
    runningNode.execution.status = "running";
    runningNode.execution.outputAssetIds = [];
    runningJob.status = "running";
    runningJob.progress = 0.42;
    runningJob.outputAssetIds = [];

    const queuedNode = draft.nodes[1];
    const queuedJob = draft.jobs.find((item) => item.id === queuedNode.execution.activeJobId);
    queuedNode.execution.status = "queued";
    queuedNode.execution.outputAssetIds = [];
    queuedJob.status = "queued";
    queuedJob.progress = 0;
    queuedJob.outputAssetIds = [];

    const failedNode = draft.nodes[2];
    const failedJob = draft.jobs.find((item) => item.id === failedNode.execution.activeJobId);
    failedNode.execution.status = "failed";
    failedNode.execution.outputAssetIds = [];
    failedJob.status = "failed";
    failedJob.progress = 0.63;
    failedJob.outputAssetIds = [];
    failedJob.error = {
      code: "PROVIDER_TIMEOUT",
      message: "生成服务超时，可重试",
      retryable: true,
    };

    render(<App initialDocument={runningDocument} />);

    expect(await screen.findByText("正在生成 · 42%")).toBeInTheDocument();
    expect(screen.getByLabelText("生成进度 42%")).toBeInTheDocument();
    expect(screen.getByText("任务已进入生成队列")).toBeInTheDocument();
    expect(screen.getByText("生成服务超时，可重试")).toBeInTheDocument();
  });

  it("centers the selected pending node on first mobile render", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

    try {
      render(<App />);
      await waitFor(() => expect(screen.getByLabelText(/Shot 2 — Crossing，待生成/)).toHaveAttribute("aria-pressed", "true"));
      await waitFor(() => expect(screen.getByTestId("canvas-viewport")).toHaveAttribute("data-view", "-213,118,0.720"));
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
