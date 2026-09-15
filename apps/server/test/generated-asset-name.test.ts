import type { ProjectSnapshot, Run } from "@takeboard/contracts";
import { describe, expect, it } from "vitest";
import { generatedAssetName } from "../src/generated-asset-name.js";

describe("generated asset names", () => {
  const run = {
    id: "run2",
    shotId: "shot",
    parameters: { shotLabel: "雨中的猫" },
  } as unknown as Run;
  const snapshot = {
    shots: [{ id: "shot", label: "renamed later" }],
    runs: [{ id: "run1", shotId: "shot" }, run],
    assets: [],
  } as unknown as ProjectSnapshot;
  it("uses the submitted shot name and independent generation ordinal", () => {
    expect(generatedAssetName(snapshot, run, "result_00001.PNG", true)).toBe(
      "雨中的猫 · 图片 02.png",
    );
    expect(generatedAssetName(snapshot, run, "result_00001.mp4", false)).toBe(
      "雨中的猫 · 视频 02.mp4",
    );
  });
  it("avoids duplicate names without changing existing assets", () => {
    const existing = {
      ...snapshot,
      assets: [{ originalName: "雨中的猫 · 图片 02.png" }],
    } as ProjectSnapshot;
    expect(generatedAssetName(existing, run, "result.png", true)).toBe(
      "雨中的猫 · 图片 02 (2).png",
    );
    expect(existing.assets[0]?.originalName).toBe("雨中的猫 · 图片 02.png");
  });
  it("produces a filename safe for Mac and Windows", () => {
    expect(
      generatedAssetName(
        snapshot,
        { ...run, parameters: { shotLabel: "a/b:c\u0000" } },
        "x.mp4",
        false,
      ),
    ).toBe("a-b-c- · 视频 02.mp4");
  });
});
