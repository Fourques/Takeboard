export type ComfyPromptNode = {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title: string };
};

export type ComfyPrompt = Record<string, ComfyPromptNode>;

export type Wan22Input = {
  image: string;
  positivePrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  durationSeconds: number;
  fps?: number;
  seed: number;
  filenamePrefix: string;
};

const defaultNegative =
  "identity drift, face blur, melted face, character swap, extra limbs, fused hands, missing fingers, foot skating, floating, slow motion, pause, repeated motion, camera orbit, unmotivated zoom, camera shake, background morph, lighting change, plastic skin, flicker, text, logo, watermark";

export function wanFrameCount(durationSeconds: number, fps: number) {
  return Math.max(5, Math.round((durationSeconds * fps) / 4) * 4 + 1);
}

export function buildWan22I2VPrompt(input: Wan22Input): ComfyPrompt {
  const fps = input.fps ?? 16;
  const length = wanFrameCount(input.durationSeconds, fps);
  return {
    image: { class_type: "LoadImage", inputs: { image: input.image } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" } },
    clip: {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
        type: "wan",
        device: "default",
      },
    },
    positive: {
      class_type: "CLIPTextEncode",
      inputs: { text: input.positivePrompt, clip: ["clip", 0] },
    },
    negative: {
      class_type: "CLIPTextEncode",
      inputs: { text: input.negativePrompt ?? defaultNegative, clip: ["clip", 0] },
    },
    high_unet: {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
        weight_dtype: "default",
      },
    },
    low_unet: {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
        weight_dtype: "default",
      },
    },
    high_lora: {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
        strength_model: 1,
        model: ["high_unet", 0],
      },
    },
    low_lora: {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
        strength_model: 1,
        model: ["low_unet", 0],
      },
    },
    high_model: {
      class_type: "ModelSamplingSD3",
      inputs: { shift: 5, model: ["high_lora", 0] },
    },
    low_model: {
      class_type: "ModelSamplingSD3",
      inputs: { shift: 5, model: ["low_lora", 0] },
    },
    latent: {
      class_type: "WanImageToVideo",
      inputs: {
        width: input.width,
        height: input.height,
        length,
        batch_size: 1,
        positive: ["positive", 0],
        negative: ["negative", 0],
        vae: ["vae", 0],
        start_image: ["image", 0],
      },
    },
    high_sample: {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "enable",
        noise_seed: input.seed,
        steps: 4,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        start_at_step: 0,
        end_at_step: 2,
        return_with_leftover_noise: "enable",
        model: ["high_model", 0],
        positive: ["latent", 0],
        negative: ["latent", 1],
        latent_image: ["latent", 2],
      },
    },
    low_sample: {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "disable",
        noise_seed: 0,
        steps: 4,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        start_at_step: 2,
        end_at_step: 4,
        return_with_leftover_noise: "disable",
        model: ["low_model", 0],
        positive: ["latent", 0],
        negative: ["latent", 1],
        latent_image: ["high_sample", 0],
      },
    },
    decoded: {
      class_type: "VAEDecode",
      inputs: { samples: ["low_sample", 0], vae: ["vae", 0] },
    },
    video: {
      class_type: "CreateVideo",
      inputs: { fps, bit_depth: 8, images: ["decoded", 0] },
    },
    save: {
      class_type: "SaveVideo",
      inputs: {
        filename_prefix: input.filenamePrefix,
        format: "auto",
        codec: "auto",
        video: ["video", 0],
      },
    },
  };
}

export type Wan22FirstLastInput = Wan22Input & { lastImage: string };

export function buildWan22FirstLastPrompt(input: Wan22FirstLastInput): ComfyPrompt {
  const fps = input.fps ?? 16;
  const length = wanFrameCount(input.durationSeconds, fps);
  const base = buildWan22I2VPrompt(input);
  base.last_image = { class_type: "LoadImage", inputs: { image: input.lastImage } };
  base.latent = {
    class_type: "WanFirstLastFrameToVideo",
    inputs: {
      width: input.width,
      height: input.height,
      length,
      batch_size: 1,
      positive: ["positive", 0],
      negative: ["negative", 0],
      vae: ["vae", 0],
      start_image: ["image", 0],
      end_image: ["last_image", 0],
    },
  };
  return base;
}

export type ComfyOutputFile = { filename: string; subfolder: string; type: string };

export class ComfyClient {
  constructor(readonly baseUrl: string) {}

  async uploadImage(bytes: Uint8Array, filename: string, mimeType: string) {
    const body = new FormData();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    body.set("image", new Blob([copy.buffer], { type: mimeType }), filename);
    body.set("overwrite", "true");
    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ComfyUI image upload failed: ${response.status}`);
    const result = (await response.json()) as { name: string; subfolder: string; type: string };
    return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
  }

  async submit(prompt: ComfyPrompt) {
    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, client_id: `takeboard-${Date.now()}` }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json()) as {
      prompt_id?: string;
      error?: string;
      node_errors?: Record<string, unknown>;
    };
    if (!response.ok || !result.prompt_id) {
      throw new Error(`ComfyUI rejected prompt: ${JSON.stringify(result)}`);
    }
    return result.prompt_id;
  }

  async history(promptId: string) {
    const response = await fetch(`${this.baseUrl}/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ComfyUI history failed: ${response.status}`);
    const history = (await response.json()) as Record<
      string,
      {
        outputs?: Record<string, { videos?: ComfyOutputFile[]; images?: ComfyOutputFile[] }>;
        status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
      }
    >;
    return history[promptId] ?? null;
  }

  async download(file: ComfyOutputFile) {
    const query = new URLSearchParams({
      filename: file.filename,
      subfolder: file.subfolder,
      type: file.type,
    });
    const response = await fetch(`${this.baseUrl}/view?${query}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`ComfyUI output download failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
