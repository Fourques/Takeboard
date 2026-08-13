import { describe, expect, it, vi } from "vitest";
import {
  buildLtx23I2VPrompt,
  buildMiniMaxH3Prompt,
  buildWan22FirstLastPrompt,
  buildWan22I2VPrompt,
  ComfyClient,
  miniMaxH3FrameCount,
  miniMaxH3Resolution,
  wanFrameCount,
} from "../src/index.js";

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

  it("adds an end frame for first-last-frame generation", () => {
    const prompt = buildWan22FirstLastPrompt({
      image: "takeboard/start.png",
      lastImage: "takeboard/end.png",
      positivePrompt: "A continuous grounded action between the supplied frames.",
      width: 848,
      height: 480,
      durationSeconds: 4,
      fps: 16,
      seed: 7,
      filenamePrefix: "takeboard/test/flf2v",
    });

    expect(prompt.last_image?.inputs.image).toBe("takeboard/end.png");
    expect(prompt.latent?.class_type).toBe("WanFirstLastFrameToVideo");
    expect(prompt.latent?.inputs.end_image).toEqual(["last_image", 0]);
  });

  it("normalizes arbitrary duration and fps to Wan-compatible 4n+1 frames", () => {
    expect(wanFrameCount(3.3, 24)).toBe(81);
    expect(wanFrameCount(1, 10)).toBe(13);
  });
});

describe("MiniMax H3 recipe", () => {
  it("builds text-to-video without image nodes", () => {
    const prompt = buildMiniMaxH3Prompt({
      positivePrompt: "A quiet river at dawn with native ambient audio.",
      width: 480,
      height: 848,
      durationSeconds: 5,
      seed: 42,
      filenamePrefix: "takeboard/minimax/t2v",
    });
    expect(prompt.conditioning?.inputs).toMatchObject({ width: 480, height: 864, length: 124 });
    expect(prompt.first_image).toBeUndefined();
    expect(prompt.scheduler?.inputs.steps).toBe(20);
  });

  it("injects optional first and last images", () => {
    const prompt = buildMiniMaxH3Prompt({
      positivePrompt: "One continuous movement between both supplied frames.",
      firstImage: "start.png",
      lastImage: "end.png",
      width: 768,
      height: 1344,
      durationSeconds: 4.2,
      fps: 24,
      seed: 7,
      steps: 12,
      filenamePrefix: "takeboard/minimax/flf",
    });
    expect(prompt.conditioning?.inputs.first_frame).toEqual(["first_image", 0]);
    expect(prompt.conditioning?.inputs.last_frame).toEqual(["last_image", 0]);
    expect(prompt.scheduler?.inputs.steps).toBe(12);
  });

  it("normalizes MiniMax frame grid and resolution", () => {
    expect(miniMaxH3FrameCount(5)).toBe(124);
    expect(miniMaxH3Resolution(480, 848)).toEqual({ width: 480, height: 864 });
    expect(miniMaxH3Resolution(768, 1344)).toEqual({ width: 768, height: 1344 });
  });
});

describe("LTX 2.3 subgraph recipe", () => {
  it("expands a UI subgraph and binds project-facing inputs", () => {
    const workflow = {
      nodes: [
        { id: 1, type: "LoadImage", inputs: [], widgets_values: ["default.png"] },
        {
          id: 2,
          type: "ltx-subgraph",
          inputs: [{ name: "image", link: 100 }],
          widgets_values: [],
        },
        {
          id: 3,
          type: "SaveVideo",
          inputs: [{ name: "video", link: 101 }],
          widgets_values: ["default", "auto", "auto"],
        },
      ],
      links: [
        [100, 1, 0, 2, 0, "IMAGE"] as [number, number, number, number, number, string],
        [101, 2, 0, 3, 0, "VIDEO"] as [number, number, number, number, number, string],
      ],
      definitions: {
        subgraphs: [
          {
            id: "ltx-subgraph",
            inputs: [{ linkIds: [10] }],
            outputs: [{ linkIds: [16] }],
            nodes: [
              {
                id: 10,
                type: "PrimitiveStringMultiline",
                title: "Prompt",
                inputs: [{ name: "value", widget: { name: "value" } }],
                widgets_values: ["default prompt"],
              },
              {
                id: 11,
                type: "PrimitiveInt",
                title: "Width",
                inputs: [{ name: "value", widget: { name: "value" } }],
                widgets_values: [480],
              },
              {
                id: 12,
                type: "PrimitiveInt",
                title: "Height",
                inputs: [{ name: "value", widget: { name: "value" } }],
                widgets_values: [848],
              },
              {
                id: 13,
                type: "PrimitiveInt",
                title: "Duration",
                inputs: [{ name: "value", widget: { name: "value" } }],
                widgets_values: [5],
              },
              {
                id: 14,
                type: "PrimitiveInt",
                title: "Frame Rate",
                inputs: [{ name: "value", widget: { name: "value" } }],
                widgets_values: [25],
              },
              {
                id: 15,
                type: "RandomNoise",
                inputs: [{ name: "noise_seed", widget: { name: "noise_seed" } }],
                widgets_values: [999],
              },
              { id: 16, type: "CreateVideo", inputs: [{ name: "images", link: 10 }] },
            ],
            links: [
              { id: 10, origin_id: -10, origin_slot: 0, target_id: 16, target_slot: 0 },
              { id: 16, origin_id: 16, origin_slot: 0, target_id: -20, target_slot: 0 },
            ],
          },
        ],
      },
    };
    const prompt = buildLtx23I2VPrompt(workflow, {
      image: "takeboard/frame.png",
      positivePrompt: "A restrained push in.",
      width: 500,
      height: 850,
      durationSeconds: 4.6,
      fps: 24.6,
      seed: 7,
      filenamePrefix: "takeboard/ltx/test",
    });

    expect(prompt.outer_1?.inputs.image).toBe("takeboard/frame.png");
    expect(prompt.inner_10?.inputs.value).toBe("A restrained push in.");
    expect(prompt.inner_11?.inputs.value).toBe(512);
    expect(prompt.inner_12?.inputs.value).toBe(864);
    expect(prompt.inner_13?.inputs.value).toBe(5);
    expect(prompt.inner_14?.inputs.value).toBe(25);
    expect(prompt.inner_15?.inputs.noise_seed).toBe(7);
    expect(prompt.outer_3?.inputs).toMatchObject({
      filename_prefix: "takeboard/ltx/test",
      format: "auto",
      codec: "auto",
    });
  });

  it("accepts ComfyUI dynamic required inputs during preflight", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ComfyMathExpression: {
            input: { required: { expression: ["STRING", {}], values: ["COMFY_AUTOGROW_V3", {}] } },
          },
        }),
      ),
    );
    try {
      const errors = await new ComfyClient("http://comfy.test").preflightPrompt({
        math: {
          class_type: "ComfyMathExpression",
          inputs: { expression: "a / 2", "values.a": ["width", 0] },
        },
        width: { class_type: "ComfyMathExpression", inputs: { expression: "480", values: 0 } },
      });
      expect(errors).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
