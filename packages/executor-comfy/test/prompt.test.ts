import { describe, expect, it } from "vitest";
import { buildWan22I2VPrompt } from "../src/index.js";

describe("Wan 2.2 I2V recipe", () => {
  it("builds a compact two-stage four-step prompt", () => {
    const prompt = buildWan22I2VPrompt({
      image: "takeboard/start.png",
      positivePrompt: "A restrained push-in as the character turns toward camera.",
      width: 480,
      height: 848,
      durationSeconds: 5,
      fps: 16,
      seed: 42,
      filenamePrefix: "takeboard/test/shot-01",
    });

    expect(prompt.latent?.inputs).toMatchObject({ width: 480, height: 848, length: 81 });
    expect(prompt.high_sample?.inputs).toMatchObject({ steps: 4, end_at_step: 2 });
    expect(prompt.low_sample?.inputs).toMatchObject({ steps: 4, start_at_step: 2 });
    expect(prompt.save?.inputs.video).toEqual(["video", 0]);
    expect(Object.values(prompt).map((node) => node.class_type)).toContain("SaveVideo");
  });
});
