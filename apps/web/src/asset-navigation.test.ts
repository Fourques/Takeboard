import type { Asset, ProjectSnapshot, Run } from "@takeboard/contracts";
import { describe, expect, it } from "vitest";
import { assetDisplayNames, locateAsset } from "./asset-navigation";
import { recordedPromptParts } from "./recorded-prompt";

describe("asset navigation and identity", () => {
  const context = {
    canvasItems: [{ id: "node", refType: "shot", refId: "shot" }],
    shots: [{ id: "shot", approvedTakeId: "approved" }],
    takes: [
      { id: "old", shotId: "shot", assetId: "older", status: "candidate" },
      { id: "approved", shotId: "shot", assetId: "video", status: "approved" },
      { id: "new", shotId: "shot", assetId: "newer", status: "candidate" },
    ],
    entities: [],
  } as unknown as ProjectSnapshot;
  it("finds the exact approved video and historical results without creating nodes", () => {
    expect(locateAsset(context, "video")).toEqual({
      itemId: "node",
      takeId: "approved",
      state: "canvas",
    });
    expect(locateAsset(context, "older")).toEqual({
      itemId: "node",
      takeId: "old",
      state: "result",
    });
    expect(locateAsset(context, "newer")?.state).toBe("result");
    expect(locateAsset(context, "unplaced")).toBeNull();
    expect(locateAsset({ ...context, canvasItems: [] }, "video")).toBeNull();
  });
  it("prefers an explicit asset node and follows the latest preview if none is approved", () => {
    expect(
      locateAsset(
        {
          ...context,
          canvasItems: [
            ...context.canvasItems,
            {
              ...context.canvasItems[0],
              id: "asset-node",
              refType: "asset",
              refId: "video",
            } as ProjectSnapshot["canvasItems"][number],
          ],
        },
        "video",
      )?.itemId,
    ).toBe("asset-node");
    expect(
      locateAsset(
        { ...context, shots: context.shots.map((shot) => ({ ...shot, approvedTakeId: null })) },
        "newer",
      )?.state,
    ).toBe("canvas");
  });
  it("disambiguates equal stems independent of sort order without changing filenames", () => {
    const assets = [
      { id: "b", originalName: "output.mp4", createdAt: "2026-09-15" },
      { id: "a", originalName: "output.mp4", createdAt: "2026-09-14" },
    ] as Asset[];
    expect(assetDisplayNames(assets).get("b")).toBe("output · 2");
    expect(assetDisplayNames([...assets].reverse())).toEqual(assetDisplayNames(assets));
    expect(assets.map((asset) => asset.originalName)).toEqual(["output.mp4", "output.mp4"]);
  });
  it("resolves historical @ mentions through recorded prompt tokens even after renaming", () => {
    const assets = [
      { id: "cat", originalName: "renamed.mp4" },
      { id: "person", originalName: "new.png" },
    ] as Asset[];
    const run = {
      parameters: { promptSource: "@人 抱着 @猫", prompt: "<Picture 1> 抱着 <Video 1>" },
      inputs: [
        { slot: "reference_image_0", refId: "person", refType: "asset" },
        { slot: "reference_video_0", refId: "cat", refType: "asset" },
      ],
    } as unknown as Run;
    expect(
      recordedPromptParts(run, assets)
        .filter((part) => part.assetId)
        .map((part) => part.assetId),
    ).toEqual(["person", "cat"]);
    expect(recordedPromptParts(run, []).some((part) => part.assetId)).toBe(false);
  });
  it("never guesses between ambiguous names", () => {
    const run = {
      parameters: { prompt: "@cat" },
      inputs: [{ refId: "a" }, { refId: "b" }],
    } as unknown as Run;
    const assets = [
      { id: "a", originalName: "cat.png" },
      { id: "b", originalName: "cat.jpg" },
    ] as Asset[];
    expect(recordedPromptParts(run, assets)).toEqual([{ text: "@cat", offset: 0 }]);
  });
});
