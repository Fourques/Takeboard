import { describe, expect, it, vi } from "vitest";
import {
  buildLtx23I2VPrompt,
  buildMiniMaxH3Prompt,
  buildMiniMaxH3ReferencePrompt,
  buildQwenImage2512Prompt,
  buildWan22FirstLastPrompt,
  buildWan22I2VPrompt,
  ComfyClient,
  convertUiWorkflowToPrompt,
  miniMaxH3FrameCount,
  miniMaxH3Resolution,
  qwenImage2512Resolution,
  wanFrameCount,
} from "../src/index.js";

describe("generic ComfyUI workflow conversion", () => {
  it("turns a regular canvas workflow into API Prompt without overwriting linked inputs", () => {
    const prompt = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: "LoadImage", inputs: [], widgets_values: ["source.png"] },
          {
            id: 2,
            type: "ImageScale",
            inputs: [
              { name: "image", link: 10 },
              { name: "width", link: null, widget: { name: "width" } },
            ],
            widgets_values: [768],
          },
        ],
        links: [[10, 1, 0, 2, 0, "IMAGE"]],
      },
      {
        LoadImage: { input: { required: { image: ["STRING"] } } },
        ImageScale: { input: { required: { image: ["IMAGE"], width: ["INT"] } } },
      },
    );
    expect(prompt["1"]?.inputs.image).toBe("source.png");
    expect(prompt["2"]?.inputs.image).toEqual(["1", 0]);
    expect(prompt["2"]?.inputs.width).toBe(768);
  });

  it("skips ComfyUI's serialized seed control when aligning numeric widgets", () => {
    const prompt = convertUiWorkflowToPrompt({
      nodes: [
        {
          id: 10,
          type: "KSampler",
          inputs: [
            { name: "seed", type: "INT", link: null, widget: { name: "seed" } },
            { name: "steps", type: "INT", link: null, widget: { name: "steps" } },
            { name: "cfg", type: "FLOAT", link: null, widget: { name: "cfg" } },
            {
              name: "sampler_name",
              type: "COMBO",
              link: null,
              widget: { name: "sampler_name" },
            },
            {
              name: "scheduler",
              type: "COMBO",
              link: null,
              widget: { name: "scheduler" },
            },
            { name: "denoise", type: "FLOAT", link: null, widget: { name: "denoise" } },
          ],
          widgets_values: [2512, "randomize", 50, 4, "euler", "simple", 0.65],
        },
      ],
      links: [],
    });

    expect(prompt["10"]?.inputs).toMatchObject({
      seed: 2512,
      steps: 50,
      cfg: 4,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 0.65,
    });
  });

  it("recursively expands multiple connected subgraphs", () => {
    const prompt = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: "sub-a", inputs: [] },
          { id: 2, type: "sub-b", inputs: [{ name: "value", link: 100 }] },
          { id: 3, type: "SaveImage", inputs: [{ name: "images", link: 101 }] },
        ],
        links: [
          [100, 1, 0, 2, 0, "STRING"],
          [101, 2, 0, 3, 0, "IMAGE"],
        ],
        definitions: {
          subgraphs: [
            {
              id: "sub-a",
              nodes: [{ id: 10, type: "TextNode", inputs: [], widgets_values: ["hello"] }],
              links: [{ id: 1, origin_id: 10, origin_slot: 0, target_id: -20, target_slot: 0 }],
              inputs: [],
              outputs: [{ linkIds: [1] }],
            },
            {
              id: "sub-b",
              nodes: [{ id: 20, type: "PassThrough", inputs: [{ name: "value", link: 2 }] }],
              links: [
                { id: 2, origin_id: -10, origin_slot: 0, target_id: 20, target_slot: 0 },
                { id: 3, origin_id: 20, origin_slot: 0, target_id: -20, target_slot: 0 },
              ],
              inputs: [{ linkIds: [2] }],
              outputs: [{ linkIds: [3] }],
            },
          ],
        },
      },
      { TextNode: { input: { required: { value: ["STRING"] } } } },
    );
    expect(prompt.node_sg_1_10?.inputs.value).toBe("hello");
    expect(prompt.node_sg_2_20?.inputs.value).toEqual(["node_sg_1_10", 0]);
    expect(prompt.node_3?.inputs.images).toEqual(["node_sg_2_20", 0]);
  });
});

describe("Qwen-Image-2512 recipe", () => {
  it("builds a full-quality text-to-image prompt", () => {
    const prompt = buildQwenImage2512Prompt({
      positivePrompt: "电影感雪山站台，真实摄影",
      width: 928,
      height: 1664,
      seed: 42,
      steps: 50,
      filenamePrefix: "takeboard/qwen/t2i",
    });
    expect(prompt.latent).toMatchObject({
      class_type: "EmptySD3LatentImage",
      inputs: { width: 928, height: 1664 },
    });
    expect(prompt.sample?.inputs).toMatchObject({ steps: 50, cfg: 4, denoise: 1 });
    expect(prompt.lora).toBeUndefined();
    expect(prompt.save?.class_type).toBe("SaveImage");
  });

  it("builds a fast image-to-image prompt with a bounded denoise value", () => {
    const prompt = buildQwenImage2512Prompt({
      image: "takeboard/reference.png",
      positivePrompt: "保持人物身份，改为雨夜场景",
      width: 928,
      height: 1664,
      seed: 7,
      steps: 4,
      denoise: 2,
      filenamePrefix: "takeboard/qwen/i2i",
    });
    expect(prompt.image?.inputs.image).toBe("takeboard/reference.png");
    expect(prompt.scaled).toMatchObject({
      class_type: "ImageScale",
      inputs: { width: 928, height: 1664, crop: "center" },
    });
    expect(prompt.latent?.class_type).toBe("VAEEncode");
    expect(prompt.latent?.inputs.pixels).toEqual(["scaled", 0]);
    expect(prompt.sample?.inputs).toMatchObject({ steps: 4, cfg: 1, denoise: 1 });
    expect(prompt.lora?.class_type).toBe("LoraLoaderModelOnly");
    expect(prompt.lora?.inputs.lora_name).toBe(
      "Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors",
    );
  });

  it("keeps requested Qwen sizes on a safe 32-pixel grid", () => {
    expect(qwenImage2512Resolution(928, 1664)).toEqual({ width: 928, height: 1664 });
    expect(qwenImage2512Resolution(200, 300)).toEqual({ width: 512, height: 512 });
  });
});

describe("Wan 2.2 I2V recipe", () => {
  it("builds the full-quality two-stage prompt by default", () => {
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
    expect(prompt.high_sample?.inputs).toMatchObject({ steps: 20, cfg: 3.5, end_at_step: 10 });
    expect(prompt.low_sample?.inputs).toMatchObject({ steps: 20, cfg: 3.5, start_at_step: 10 });
    expect(prompt.high_lora).toBeUndefined();
    expect(prompt.low_lora).toBeUndefined();
    expect(prompt.save?.inputs.video).toEqual(["video", 0]);
    expect(Object.values(prompt).map((node) => node.class_type)).toContain("SaveVideo");
  });

  it("keeps LightX2V isolated to the explicit preview profile", () => {
    const prompt = buildWan22I2VPrompt({
      image: "takeboard/start.png",
      positivePrompt: "A quick motion preview.",
      width: 480,
      height: 848,
      durationSeconds: 5,
      fps: 16,
      qualityProfile: "preview",
      steps: 20,
      seed: 42,
      filenamePrefix: "takeboard/test/preview",
    });
    expect(prompt.high_sample?.inputs).toMatchObject({ steps: 4, cfg: 1, end_at_step: 2 });
    expect(prompt.low_sample?.inputs).toMatchObject({ steps: 4, cfg: 1, start_at_step: 2 });
    expect(prompt.high_lora?.class_type).toBe("LoraLoaderModelOnly");
    expect(prompt.low_lora?.class_type).toBe("LoraLoaderModelOnly");
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
    expect(prompt.decoded_audio?.class_type).toBe("VAEDecodeAudio");
    expect(prompt.video?.inputs).toMatchObject({
      audio: ["decoded_audio", 0],
      fps: 24,
      bit_depth: 8,
    });
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
    expect(miniMaxH3FrameCount(1)).toBe(107);
    expect(miniMaxH3FrameCount(20)).toBe(362);
    expect(miniMaxH3Resolution(480, 848)).toEqual({ width: 480, height: 864 });
    expect(miniMaxH3Resolution(768, 1344)).toEqual({ width: 768, height: 1344 });
  });

  it("builds native Ref2VA with ordered image, video soundtrack, and audio inputs", () => {
    const prompt = buildMiniMaxH3ReferencePrompt({
      positivePrompt: "Use <Picture 1>, the motion from <Video 1>, and the voice from <Audio 2>.",
      referenceImages: ["portrait.png"],
      referenceVideos: ["motion.mp4"],
      referenceAudios: ["voice.wav"],
      referenceImageSize: "max",
      width: 1344,
      height: 768,
      durationSeconds: 5,
      seed: 9,
      steps: 20,
      filenamePrefix: "takeboard/minimax/r2v",
    });

    expect(prompt.model?.inputs.unet_name).toBe(
      "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    );
    expect(prompt.conditioning).toMatchObject({
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: {
        ref_image_size: "max",
        "ref_images.ref_image_0": ["reference_image_0", 0],
        "ref_videos.ref_video_0": ["reference_video_components_0", 0],
        "ref_video_audios.ref_video_audio_0": ["reference_video_components_0", 1],
        "ref_audios.ref_audio_0": ["reference_audio_0", 0],
      },
    });
    expect(prompt.reference_video_0).toMatchObject({
      class_type: "LoadVideo",
      inputs: { file: "motion.mp4" },
    });
    expect(prompt.reference_video_components_0?.class_type).toBe("GetVideoComponents");
    expect(prompt.reference_audio_0).toMatchObject({
      class_type: "LoadAudio",
      inputs: { audio: "voice.wav" },
    });
    expect(prompt.scheduler?.inputs).toMatchObject({ scheduler: "beta", steps: 20 });
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
