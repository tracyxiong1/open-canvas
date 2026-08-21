import { describe, expect, it } from "vitest";

import { buildScriptShotConnections, MAX_SCRIPT_SHOTS, splitScriptIntoShotPrompts } from "@open-canvas/core/browser";

describe("script shot planning", () => {
  it("keeps an explicit line-oriented shot list editable and ordered", () => {
    expect(splitScriptIntoShotPrompts("1. 雨夜的高架桥上，信使抵达。\n2. 她穿过空旷的车站。\n3. 远处的列车亮起。"))
      .toEqual(["雨夜的高架桥上，信使抵达。", "她穿过空旷的车站。", "远处的列车亮起。"]);
  });

  it("falls back to prose sentence boundaries and caps accidental bulk creation", () => {
    expect(splitScriptIntoShotPrompts("第一幕开始。角色进入站台！列车驶离？"))
      .toEqual(["第一幕开始。", "角色进入站台！", "列车驶离？"]);
    expect(splitScriptIntoShotPrompts(Array.from({ length: MAX_SCRIPT_SHOTS + 2 }, (_, index) => `镜头 ${index + 1}：画面 ${index + 1}`).join("\n")))
      .toHaveLength(MAX_SCRIPT_SHOTS);
  });

  it("keeps context dependencies separate from the expanded shot sequence", () => {
    expect(buildScriptShotConnections("script", ["shot-a", "shot-b", "shot-c", "shot-b"])).toEqual([
      { kind: "dependency", sourceNodeId: "script", targetNodeId: "shot-a" },
      { kind: "dependency", sourceNodeId: "script", targetNodeId: "shot-b" },
      { kind: "dependency", sourceNodeId: "script", targetNodeId: "shot-c" },
      { kind: "sequence", sourceNodeId: "shot-a", targetNodeId: "shot-b" },
      { kind: "sequence", sourceNodeId: "shot-b", targetNodeId: "shot-c" },
    ]);
  });
});
