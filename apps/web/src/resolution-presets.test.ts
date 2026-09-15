import { resolveGenerationResolution } from "@takeboard/contracts";
import { describe, expect, it } from "vitest";
import { closestAspectRatio, resolutionPresets } from "./resolution-presets";

describe("generation aspect presets", () => {
  it.each(["exact", "multiple_32", "qwen_image_2512", "minimax_h3"] as const)(
    "keeps %s presets inside executable bounds",
    (policy) => {
      for (const preset of resolutionPresets(1344, 768, policy)) {
        expect(preset.width).toBeGreaterThanOrEqual(256);
        expect(preset.height).toBeGreaterThanOrEqual(256);
        expect(preset.width).toBeLessThanOrEqual(2048);
        expect(preset.height).toBeLessThanOrEqual(2048);
        expect(resolveGenerationResolution(policy, preset.width, preset.height).effective).toEqual({
          width: preset.width,
          height: preset.height,
        });
        expect(closestAspectRatio(preset.width, preset.height)).toBe(preset.label);
      }
    },
  );
  it("does not relabel arbitrary user dimensions as a standard aspect", () => {
    expect(closestAspectRatio(1000, 600)).toBe("custom");
    expect(closestAspectRatio(720, 1280)).toBe("9:16");
  });
});
