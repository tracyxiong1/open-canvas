import { describe, expect, it } from "vitest";
import exampleDocument from "../../../docs/examples/canvas-v1-shot2-night.json";
import { resolveDemoAssetUrl } from "../src/demo-assets.js";
import { createPreviewModel, STATUS_META } from "../src/project-document.js";

describe("project document preview adapter", () => {
  it("projects the active draft without mutating canonical document data", () => {
    const before = JSON.stringify(exampleDocument);
    const model = createPreviewModel(exampleDocument, { resolveAssetUrl: resolveDemoAssetUrl });

    expect(model.activeDraft.title).toBe("Night variation");
    expect(model.activeDraft.nodes.map((node) => node.status)).toEqual([
      "succeeded",
      "dirty",
      "succeeded",
      "dirty",
    ]);
    expect(model.activeDraft.nodes[0].outputAssets[0].previewUrl).toBe(
      "/assets/shot-arrival.webp",
    );
    expect(model.activeDraft.statusCounts).toMatchObject({ succeeded: 2, dirty: 2 });
    expect(JSON.stringify(exampleDocument)).toBe(before);
  });

  it("can select another draft through the adapter boundary", () => {
    const mainDraftId = exampleDocument.drafts[0].id;
    const model = createPreviewModel(exampleDocument, {
      draftId: mainDraftId,
      resolveAssetUrl: resolveDemoAssetUrl,
    });

    expect(model.activeDraft.title).toBe("Main draft");
    expect(model.activeDraft.nodes.every((node) => node.status === "succeeded")).toBe(true);
    expect(model.activeDraft.nodes.every((node) => node.outputAssets.length === 1)).toBe(true);
  });

  it("projects superseded successful jobs as node-local history without repeating the current output", () => {
    const document = structuredClone(exampleDocument);
    const draft = document.drafts.find((item) => item.id === document.activeDraftId);
    const currentNode = draft.nodes[0];
    const currentJob = draft.jobs.find((job) => job.id === currentNode.execution.activeJobId);
    draft.jobs.push({
      ...structuredClone(currentJob),
      id: "job_preview_history",
      attempt: currentJob.attempt + 1,
      createdAt: "2026-08-11T08:01:00Z",
      updatedAt: "2026-08-11T08:01:02Z",
    });

    const model = createPreviewModel(document, { resolveAssetUrl: resolveDemoAssetUrl });
    const node = model.activeDraft.nodes[0];

    expect(node.outputAssets).toHaveLength(1);
    expect(node.generationHistory).toHaveLength(1);
    expect(node.generationHistory[0]).toMatchObject({
      jobId: "job_preview_history",
      attempt: 2,
      outputAssets: [{ id: currentNode.execution.outputAssetIds[0], previewUrl: "/assets/shot-arrival.webp" }],
    });
  });

  it("keeps every canonical generation state in the preview vocabulary", () => {
    expect(Object.keys(STATUS_META)).toEqual([
      "dirty",
      "queued",
      "running",
      "succeeded",
      "failed",
    ]);
    expect(STATUS_META.running.label).toBe("生成中");
    expect(STATUS_META.failed.tone).toBe("danger");
  });

  it("rejects unsupported versions instead of guessing", () => {
    expect(() => createPreviewModel({ ...exampleDocument, schemaVersion: 2 })).toThrow(
      "Unsupported canvas schema version: 2",
    );
  });
});
