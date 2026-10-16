const target = (nodeId, input, transform) => [
  { nodeId, input, ...(transform ? { transform } : {}) },
];
const node = (class_type, inputs, title) => ({ class_type, inputs, _meta: { title } });

export const starterWorkflows = [
  {
    path: "TakeBoard/AutoDL_SDXL.json",
    name: "SDXL · 图片",
    capability: "text_to_image",
    outputMediaType: "image",
    prompt: {
      1: node(
        "CheckpointLoaderSimple",
        { ckpt_name: "sd_xl_base_1.0.safetensors" },
        "SDXL Base 1.0",
      ),
      2: node(
        "CLIPTextEncode",
        {
          text: "A ceramic teapot on a wooden table, morning window light, still life photography",
          clip: ["1", 1],
        },
        "Positive Prompt",
      ),
      3: node(
        "CLIPTextEncode",
        { text: "blurry, low quality, watermark, text", clip: ["1", 1] },
        "Negative Prompt",
      ),
      4: node("EmptyLatentImage", { width: 1024, height: 1024, batch_size: 1 }, "Image Size"),
      5: node(
        "KSampler",
        {
          model: ["1", 0],
          positive: ["2", 0],
          negative: ["3", 0],
          latent_image: ["4", 0],
          seed: 20261013,
          steps: 25,
          cfg: 7,
          sampler_name: "dpmpp_2m",
          scheduler: "karras",
          denoise: 1,
        },
        "Generate Image",
      ),
      6: node("VAEDecode", { samples: ["5", 0], vae: ["1", 2] }, "Decode Image"),
      7: node("SaveImage", { images: ["6", 0], filename_prefix: "TakeBoard/SDXL" }, "Save Image"),
    },
    parameters: {
      prompt: target("2", "text"),
      negative_prompt: target("3", "text"),
      width: target("4", "width"),
      height: target("4", "height"),
      seed: target("5", "seed"),
      steps: target("5", "steps"),
    },
    media: {},
    acceptance: { width: 1024, height: 1024, steps: 25, seed: 20261013 },
  },
  {
    path: "TakeBoard/AutoDL_Wan21_T2V.json",
    name: "Wan 2.1 · 视频",
    capability: "text_to_video",
    outputMediaType: "video",
    prompt: {
      1: node(
        "UNETLoader",
        { unet_name: "wan2.1_t2v_1.3B_fp16.safetensors", weight_dtype: "default" },
        "Wan 2.1 T2V 1.3B",
      ),
      2: node(
        "CLIPLoader",
        { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan", device: "default" },
        "UMT5 Encoder",
      ),
      3: node("VAELoader", { vae_name: "wan_2.1_vae.safetensors" }, "Wan VAE"),
      4: node(
        "CLIPTextEncode",
        {
          text: "A small red sailboat glides slowly across a calm alpine lake. Pine trees and distant mountains, soft morning light, gentle ripples, steady cinematic camera.",
          clip: ["2", 0],
        },
        "Positive Prompt",
      ),
      5: node(
        "CLIPTextEncode",
        {
          text: "blurry, low quality, distorted, watermark, subtitles, frozen frame",
          clip: ["2", 0],
        },
        "Negative Prompt",
      ),
      6: node("ModelSamplingSD3", { model: ["1", 0], shift: 8 }, "Wan Sampling"),
      7: node(
        "EmptyHunyuanLatentVideo",
        { width: 832, height: 480, length: 81, batch_size: 1 },
        "Video Size",
      ),
      8: node(
        "KSampler",
        {
          model: ["6", 0],
          positive: ["4", 0],
          negative: ["5", 0],
          latent_image: ["7", 0],
          seed: 20261013,
          steps: 25,
          cfg: 6,
          sampler_name: "uni_pc",
          scheduler: "simple",
          denoise: 1,
        },
        "Generate Video",
      ),
      9: node("VAEDecode", { samples: ["8", 0], vae: ["3", 0] }, "Decode Video"),
      10: node("CreateVideo", { images: ["9", 0], fps: 16 }, "Video Frames"),
      11: node(
        "SaveVideo",
        { video: ["10", 0], filename_prefix: "TakeBoard/Wan21", format: "mp4", codec: "auto" },
        "Save Video",
      ),
    },
    parameters: {
      prompt: target("4", "text"),
      negative_prompt: target("5", "text"),
      width: target("7", "width"),
      height: target("7", "height"),
      duration: target("7", "length", "seconds_to_frames_plus_one"),
      fps: target("10", "fps"),
      seed: target("8", "seed"),
      steps: target("8", "steps"),
    },
    media: {},
    acceptance: { width: 832, height: 480, durationSeconds: 5, fps: 16, steps: 25, seed: 20261013 },
  },
];
