import type { Asset, Run, Take } from "@takeboard/contracts";
import { expect, it } from "vitest";
import { defaultGenerationSettings } from "./generation-model";
import { comparableResults, recordedSettings } from "./result-reuse";

it("restores recorded controls without mutating inputs, submitting or accepting invalid numbers", () => {
  const run = {
    parameters: {
      promptSource: "@portrait 在海边",
      prompt: "<Picture 1> 在海边",
      seed: 42,
      width: 832,
      height: Number.NaN,
      referenceVideoAudio: false,
    },
    inputs: [],
  } as unknown as Run;
  const settings = recordedSettings(run, {
    ...defaultGenerationSettings,
    firstFrameAssetId: "current-input",
  });
  expect(settings).toMatchObject({
    prompt: "@portrait 在海边",
    seed: 42,
    width: 832,
    height: defaultGenerationSettings.height,
    firstFrameAssetId: "current-input",
    referenceVideoAudio: false,
  });
  expect(run.inputs).toEqual([]);
});
it("compares only available outputs of the same media kind, regardless of adoption status", () => {
  const takes = [
    { id: "a", assetId: "image", status: "approved" },
    { id: "b", assetId: "other", status: "rejected" },
    { id: "c", assetId: "video", status: "candidate" },
    { id: "d", assetId: "other", status: "media_missing" },
  ] as Take[];
  const assets = [
    { id: "image", mediaType: "image" },
    { id: "other", mediaType: "image" },
    { id: "video", mediaType: "video" },
  ] as Asset[];
  expect(comparableResults(takes, assets, "a").map(({ id }) => id)).toEqual(["b"]);
  expect(comparableResults(takes, assets, "unknown")).toEqual([]);
});
