import { describe, expect, it } from "vitest";
import {
  type ComfyObjectInfo,
  inspectPromptInputs,
  nativeRecipePrompt,
  nativeRecipes,
} from "../src/index.js";

// Independent required-field snapshot observed via /object_info on 2026-09-14.
// Checks structure, not GPU execution, tensor types or output quality.
const requiredFields: Record<string, string[]> = {
  BasicGuider: ["model", "conditioning"],
  BasicScheduler: ["model", "scheduler", "steps", "denoise"],
  CLIPLoader: ["clip_name", "type"],
  CLIPTextEncode: ["text", "clip"],
  CreateVideo: ["images", "fps"],
  EmptySD3LatentImage: ["width", "height", "batch_size"],
  GetVideoComponents: ["video"],
  ImageScale: ["image", "upscale_method", "width", "height", "crop"],
  KSampler: [
    "model",
    "seed",
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "positive",
    "negative",
    "latent_image",
    "denoise",
  ],
  KSamplerAdvanced: [
    "model",
    "add_noise",
    "noise_seed",
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "positive",
    "negative",
    "latent_image",
    "start_at_step",
    "end_at_step",
    "return_with_leftover_noise",
  ],
  KSamplerSelect: ["sampler_name"],
  LoadAudio: ["audio"],
  LoadImage: ["image"],
  LoadVideo: ["file"],
  LoraLoaderModelOnly: ["model", "lora_name", "strength_model"],
  MiniMaxH3ImageToVideo: ["clip", "vae", "prompt", "width", "height", "length"],
  MiniMaxH3ReferenceToVideo: [
    "clip",
    "vae",
    "audio_vae",
    "prompt",
    "width",
    "height",
    "length",
    "ref_image_size",
  ],
  ModelSamplingAuraFlow: ["model", "shift"],
  ModelSamplingSD3: ["model", "shift"],
  RandomNoise: ["noise_seed"],
  SamplerCustomAdvanced: ["noise", "guider", "sampler", "sigmas", "latent_image"],
  SaveImage: ["images", "filename_prefix"],
  SaveVideo: ["video", "filename_prefix", "format", "codec"],
  UNETLoader: ["unet_name", "weight_dtype"],
  VAEDecode: ["samples", "vae"],
  VAEDecodeAudio: ["samples", "vae"],
  VAEEncode: ["pixels", "vae"],
  VAELoader: ["vae_name"],
  WanFirstLastFrameToVideo: [
    "positive",
    "negative",
    "vae",
    "width",
    "height",
    "length",
    "batch_size",
  ],
  WanImageToVideo: ["positive", "negative", "vae", "width", "height", "length", "batch_size"],
};
const info: ComfyObjectInfo = Object.fromEntries(
  Object.entries(requiredFields).map(([type, fields]) => [
    type,
    { input: { required: Object.fromEntries(fields.map((field) => [field, ["*"]])) } },
  ]),
);

describe("maintained native catalog", () => {
  it.each(nativeRecipes)("$id matches independently recorded required inputs", (recipe) => {
    const prompt = nativeRecipePrompt(`Kino/TakeBoard/version/${recipe.filename}`);
    expect(prompt).not.toBeNull();
    if (!prompt) throw new Error("missing maintained prompt");
    expect(inspectPromptInputs(prompt, info)).toEqual([]);
    expect(Object.values(prompt).some((node) => /Save(Video|Image)/.test(node.class_type))).toBe(
      true,
    );
    expect(prompt).toEqual(nativeRecipePrompt(`Kino/${recipe.filename}`));
  });
  it("does not advertise unmaintained or imported graphs as bundled native templates", () => {
    expect(nativeRecipePrompt("Kino/Kino_LTX23_I2V_Draft.json")).toBeNull();
    expect(nativeRecipePrompt("TakeBoard/Kino_MinimaxH3_T2V.json")).toBeNull();
    expect(nativeRecipePrompt("Kino/My_Custom.json")).toBeNull();
  });
});
