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
