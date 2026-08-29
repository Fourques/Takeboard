import { resolveGenerationResolution } from "@takeboard/contracts";
import { ComfyProgressTracker } from "./progress.js";

export type { ComfyExecutionProgress } from "./progress.js";

export type ComfyPromptNode = {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title: string };
};

export type ComfyPrompt = Record<string, ComfyPromptNode>;

export type QwenImage2512Input = {
  image?: string;
  positivePrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed: number;
  steps?: number;
  denoise?: number;
  filenamePrefix: string;
};

const qwenImageNegative =
  "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，AI感，构图混乱，文字模糊，扭曲，水印";

export function qwenImage2512Resolution(width: number, height: number) {
  return resolveGenerationResolution("qwen_image_2512", width, height).effective;
}

export function buildQwenImage2512Prompt(input: QwenImage2512Input): ComfyPrompt {
  const size = qwenImage2512Resolution(input.width, input.height);
  const steps = input.steps ?? 50;
  const turbo = steps <= 4;
  const prompt: ComfyPrompt = {
    unet: {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "qwen_image_2512_fp8_e4m3fn.safetensors",
        weight_dtype: "default",
      },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
        type: "qwen_image",
        device: "default",
      },
    },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_vae.safetensors" } },
    positive: {
      class_type: "CLIPTextEncode",
      inputs: { text: input.positivePrompt, clip: ["clip", 0] },
    },
    negative: {
      class_type: "CLIPTextEncode",
      inputs: { text: input.negativePrompt ?? qwenImageNegative, clip: ["clip", 0] },
    },
    sampling: {
      class_type: "ModelSamplingAuraFlow",
      inputs: { model: [turbo ? "lora" : "unet", 0], shift: 3.1 },
    },
    latent: input.image
      ? { class_type: "VAEEncode", inputs: { pixels: ["scaled", 0], vae: ["vae", 0] } }
      : {
          class_type: "EmptySD3LatentImage",
          inputs: { width: size.width, height: size.height, batch_size: 1 },
        },
    sample: {
      class_type: "KSampler",
      inputs: {
        model: ["sampling", 0],
        positive: ["positive", 0],
        negative: ["negative", 0],
        latent_image: ["latent", 0],
        seed: input.seed,
        steps,
        cfg: turbo ? 1 : 4,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: input.image ? Math.min(1, Math.max(0.05, input.denoise ?? 0.65)) : 1,
      },
    },
    decoded: {
      class_type: "VAEDecode",
      inputs: { samples: ["sample", 0], vae: ["vae", 0] },
    },
    save: {
      class_type: "SaveImage",
      inputs: { images: ["decoded", 0], filename_prefix: input.filenamePrefix },
    },
  };
  if (turbo) {
    prompt.lora = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["unet", 0],
        lora_name: "Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors",
        strength_model: 1,
      },
    };
  }
  if (input.image) {
    prompt.image = { class_type: "LoadImage", inputs: { image: input.image } };
    prompt.scaled = {
      class_type: "ImageScale",
      inputs: {
        image: ["image", 0],
        upscale_method: "lanczos",
        width: size.width,
        height: size.height,
        crop: "center",
      },
    };
  }
  return prompt;
}

export type Wan22Input = {
  image: string;
  positivePrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  durationSeconds: number;
  fps?: number;
  steps?: number;
  qualityProfile?: "preview" | "quality";
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
  const qualityProfile = input.qualityProfile ?? "quality";
  const quality = qualityProfile === "quality";
  const steps = quality ? Math.min(40, Math.max(8, Math.round(input.steps ?? 20))) : 4;
  const splitStep = Math.round(steps / 2);
  const cfg = quality ? 3.5 : 1;
  const prompt: ComfyPrompt = {
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
      inputs: { shift: 5, model: [quality ? "high_unet" : "high_lora", 0] },
    },
    low_model: {
      class_type: "ModelSamplingSD3",
      inputs: { shift: 5, model: [quality ? "low_unet" : "low_lora", 0] },
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
        steps,
        cfg,
        sampler_name: "euler",
        scheduler: "simple",
        start_at_step: 0,
        end_at_step: splitStep,
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
        steps,
        cfg,
        sampler_name: "euler",
        scheduler: "simple",
        start_at_step: splitStep,
        end_at_step: steps,
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
  if (quality) {
    delete prompt.high_lora;
    delete prompt.low_lora;
  }
  return prompt;
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

export type MiniMaxH3Input = {
  positivePrompt: string;
  firstImage?: string;
  lastImage?: string;
  width: number;
  height: number;
  durationSeconds: number;
  fps?: number;
  seed: number;
  steps?: number;
  filenamePrefix: string;
};

export type MiniMaxH3ReferenceInput = {
  positivePrompt: string;
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
  referenceImageSize?: "match" | "max";
  width: number;
  height: number;
  durationSeconds: number;
  fps?: number;
  seed: number;
  steps?: number;
  filenamePrefix: string;
};

export function miniMaxH3FrameCount(durationSeconds: number, _fps = 24) {
  const desired = Math.max(4, Math.min(15, durationSeconds)) * 24;
  return Math.max(5, Math.ceil((desired - 5) / 17) * 17 + 5);
}

export function miniMaxH3Resolution(width: number, height: number) {
  return resolveGenerationResolution("minimax_h3", width, height).effective;
}

export function buildMiniMaxH3Prompt(input: MiniMaxH3Input): ComfyPrompt {
  // H3-Base is trained and published at 24 fps; changing mux fps changes
  // playback speed rather than model quality, so keep the timeline invariant.
  const fps = 24;
  const steps = input.steps ?? 20;
  const size = miniMaxH3Resolution(input.width, input.height);
  const prompt: ComfyPrompt = {
    model: {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
        weight_dtype: "default",
      },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        type: "minimax",
        device: "default",
      },
    },
    vae: {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
    },
    audio_vae: {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" },
    },
    conditioning: {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["clip", 0],
        vae: ["vae", 0],
        prompt: input.positivePrompt,
        width: size.width,
        height: size.height,
        length: miniMaxH3FrameCount(input.durationSeconds, fps),
      },
    },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: input.seed } },
    guider: {
      class_type: "BasicGuider",
      inputs: { model: ["model", 0], conditioning: ["conditioning", 0] },
    },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    scheduler: {
      class_type: "BasicScheduler",
      inputs: { model: ["model", 0], scheduler: "simple", steps, denoise: 1 },
    },
    sampled: {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["noise", 0],
        guider: ["guider", 0],
        sampler: ["sampler", 0],
        sigmas: ["scheduler", 0],
        latent_image: ["conditioning", 1],
      },
    },
    decoded: {
      class_type: "VAEDecode",
      inputs: { samples: ["sampled", 0], vae: ["vae", 0] },
    },
    decoded_audio: {
      class_type: "VAEDecodeAudio",
      inputs: { samples: ["sampled", 0], vae: ["audio_vae", 0] },
    },
    video: {
      class_type: "CreateVideo",
      inputs: {
        images: ["decoded", 0],
        audio: ["decoded_audio", 0],
        fps,
        bit_depth: 8,
      },
    },
    save: {
      class_type: "SaveVideo",
      inputs: {
        video: ["video", 0],
        filename_prefix: input.filenamePrefix,
        format: "mp4",
        codec: "auto",
      },
    },
  };
  const conditioning = prompt.conditioning;
  if (!conditioning) throw new Error("MiniMax H3 conditioning node is missing");
  if (input.firstImage) {
    prompt.first_image = { class_type: "LoadImage", inputs: { image: input.firstImage } };
    conditioning.inputs.first_frame = ["first_image", 0];
  }
  if (input.lastImage) {
    prompt.last_image = { class_type: "LoadImage", inputs: { image: input.lastImage } };
    conditioning.inputs.last_frame = ["last_image", 0];
  }
  return prompt;
}

/**
 * Builds MiniMax H3's native Ref2VA graph. Reference videos are decoded into
 * both their frame stream and synchronized soundtrack so H3 can reason over
 * the complete source instead of silently discarding its audio track.
 */
export function buildMiniMaxH3ReferencePrompt(input: MiniMaxH3ReferenceInput): ComfyPrompt {
  const referenceImages = input.referenceImages?.slice(0, 9) ?? [];
  const referenceVideos = input.referenceVideos?.slice(0, 3) ?? [];
  const referenceAudios = input.referenceAudios?.slice(0, 3) ?? [];
  if (referenceImages.length + referenceVideos.length + referenceAudios.length === 0) {
    throw new Error("MiniMax H3 Ref2VA requires at least one reference asset");
  }
  if (referenceImages.length + referenceVideos.length + referenceAudios.length > 12) {
    throw new Error("MiniMax H3 Ref2VA accepts at most 12 reference assets");
  }

  const fps = 24;
  const steps = Math.min(100, Math.max(1, Math.round(input.steps ?? 20)));
  const size = miniMaxH3Resolution(input.width, input.height);
  const conditioningInputs: Record<string, unknown> = {
    clip: ["clip", 0],
    vae: ["vae", 0],
    audio_vae: ["audio_vae", 0],
    prompt: input.positivePrompt,
    width: size.width,
    height: size.height,
    length: miniMaxH3FrameCount(input.durationSeconds, fps),
    ref_image_size: input.referenceImageSize ?? "match",
  };
  const prompt: ComfyPrompt = {
    model: {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
        weight_dtype: "default",
      },
    },
    clip: {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        type: "minimax",
        device: "default",
      },
    },
    vae: {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
    },
    audio_vae: {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" },
    },
    conditioning: {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: conditioningInputs,
    },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: input.seed } },
    guider: {
      class_type: "BasicGuider",
      inputs: { model: ["model", 0], conditioning: ["conditioning", 0] },
    },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    scheduler: {
      class_type: "BasicScheduler",
      // Comfy's own H3 template recommends beta/normal for reference-heavy prompts.
      inputs: { model: ["model", 0], scheduler: "beta", steps, denoise: 1 },
    },
    sampled: {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["noise", 0],
        guider: ["guider", 0],
        sampler: ["sampler", 0],
        sigmas: ["scheduler", 0],
        latent_image: ["conditioning", 1],
      },
    },
    decoded: {
      class_type: "VAEDecode",
      inputs: { samples: ["sampled", 0], vae: ["vae", 0] },
    },
    decoded_audio: {
      class_type: "VAEDecodeAudio",
      inputs: { samples: ["sampled", 0], vae: ["audio_vae", 0] },
    },
    video: {
      class_type: "CreateVideo",
      inputs: { images: ["decoded", 0], audio: ["decoded_audio", 0], fps, bit_depth: 8 },
    },
    save: {
      class_type: "SaveVideo",
      inputs: {
        video: ["video", 0],
        filename_prefix: input.filenamePrefix,
        format: "mp4",
        codec: "auto",
      },
    },
  };

  referenceImages.forEach((image, index) => {
    const nodeId = `reference_image_${index}`;
    prompt[nodeId] = { class_type: "LoadImage", inputs: { image } };
    conditioningInputs[`ref_images.ref_image_${index}`] = [nodeId, 0];
  });
  referenceVideos.forEach((file, index) => {
    const loadNodeId = `reference_video_${index}`;
    const componentsNodeId = `reference_video_components_${index}`;
    prompt[loadNodeId] = { class_type: "LoadVideo", inputs: { file } };
    prompt[componentsNodeId] = {
      class_type: "GetVideoComponents",
      inputs: { video: [loadNodeId, 0] },
    };
    conditioningInputs[`ref_videos.ref_video_${index}`] = [componentsNodeId, 0];
    conditioningInputs[`ref_video_audios.ref_video_audio_${index}`] = [componentsNodeId, 1];
  });
  referenceAudios.forEach((audio, index) => {
    const nodeId = `reference_audio_${index}`;
    prompt[nodeId] = { class_type: "LoadAudio", inputs: { audio } };
    conditioningInputs[`ref_audios.ref_audio_${index}`] = [nodeId, 0];
  });
  return prompt;
}

type UiWorkflowNode = {
  id: number | string;
  type: string;
  title?: string;
  mode?: number;
  inputs?: Array<{
    name: string;
    type?: string | string[];
    link?: number | null;
    widget?: { name: string };
  }>;
  widgets_values?: unknown[] | Record<string, unknown> | null;
};

export type ComfyObjectInfo = Record<
  string,
  {
    input?: {
      required?: Record<string, unknown>;
      optional?: Record<string, unknown>;
      hidden?: Record<string, unknown>;
    };
    output?: string[];
  }
>;

type UiWorkflowLink = {
  id: number;
  origin_id: number | string;
  origin_slot: number;
  target_id: number | string;
  target_slot: number;
};

type UiSubgraph = {
  id: string;
  nodes: UiWorkflowNode[];
  links: UiWorkflowLink[];
  inputs: Array<{ linkIds?: number[] }>;
  outputs: Array<{ linkIds?: number[] }>;
};

export type UiWorkflow = {
  nodes: UiWorkflowNode[];
  links: Array<UiWorkflowLink | [number, number | string, number, number | string, number, string]>;
  definitions?: { subgraphs?: UiSubgraph[] };
};

function normalizedLinks(
  links: Array<UiWorkflowLink | [number, number | string, number, number | string, number, string]>,
) {
  return links.map((link) =>
    Array.isArray(link)
      ? {
          id: link[0],
          origin_id: link[1],
          origin_slot: link[2],
          target_id: link[3],
          target_slot: link[4],
        }
      : link,
  );
}

function widgetValues(node: UiWorkflowNode) {
  if (Array.isArray(node.widgets_values)) return node.widgets_values;
  return node.widgets_values ? Object.values(node.widgets_values) : [];
}

const widgetControlValues = new Set(["fixed", "increment", "decrement", "randomize"]);

function nextWidgetValue(values: unknown[], start: number, inputType?: string | string[]) {
  let index = start;
  const numeric = ["INT", "FLOAT", "NUMBER"].includes(String(inputType).toUpperCase());
  while (
    numeric &&
    typeof values[index] === "string" &&
    widgetControlValues.has(String(values[index]).toLowerCase())
  ) {
    index += 1;
  }
  return { value: values[index], nextIndex: index + 1 };
}

function isApiPrompt(value: unknown): value is ComfyPrompt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return (
    entries.length > 0 &&
    entries.every(
      (node) =>
        node &&
        typeof node === "object" &&
        typeof (node as ComfyPromptNode).class_type === "string" &&
        (node as ComfyPromptNode).inputs &&
        typeof (node as ComfyPromptNode).inputs === "object",
    )
  );
}

function schemaWidgetNames(definition: ComfyObjectInfo[string] | undefined) {
  const fields = {
    ...(definition?.input?.required ?? {}),
    ...(definition?.input?.optional ?? {}),
  };
  return Object.entries(fields).flatMap(([name, raw]) => {
    if (!Array.isArray(raw)) return [];
    const type = raw[0];
    const options = raw[1];
    const widget =
      Array.isArray(type) ||
      ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"].includes(String(type)) ||
      (options &&
        typeof options === "object" &&
        ("default" in options || "defaultInput" in options));
    return widget ? [name] : [];
  });
}

function expandSubgraphWorkflow(workflow: UiWorkflow, objectInfo: ComfyObjectInfo): ComfyPrompt {
  const definitions = new Map(
    (workflow.definitions?.subgraphs ?? []).map((definition) => [definition.id, definition]),
  );
  const prompt: ComfyPrompt = {};
  const active = new Set<string>();

  const walk = (
    graphNodes: UiWorkflowNode[],
    graphLinks: UiWorkflowLink[],
    prefix: string,
    externalInput: (slot: number) => [string, number] | null,
  ) => {
    const nodes = new Map(graphNodes.map((node) => [String(node.id), node]));
    const expandedOutputs = new Map<string, Array<[string, number] | null>>();

    const serialize = (node: UiWorkflowNode) => {
      if (
        node.mode === 2 ||
        node.mode === 4 ||
        ["Reroute", "Note", "MarkdownNote"].includes(node.type) ||
        definitions.has(node.type)
      ) {
        return;
      }
      const inputs: Record<string, unknown> = {};
      const values = widgetValues(node);
      const explicitWidgetNames = (node.inputs ?? []).flatMap((input) =>
        input.widget ? [input.widget.name || input.name] : [],
      );
      const widgetNames = explicitWidgetNames.length
        ? explicitWidgetNames
        : schemaWidgetNames(objectInfo[node.type]);
      let widgetIndex = 0;
      for (const input of node.inputs ?? []) {
        const widget = input.widget
          ? nextWidgetValue(values, widgetIndex, input.type)
          : { value: undefined, nextIndex: widgetIndex };
        const widgetValue = widget.value;
        if (input.widget) widgetIndex = widget.nextIndex;
        const link =
          input.link == null ? null : graphLinks.find((candidate) => candidate.id === input.link);
        const origin = link ? resolveOrigin(link) : null;
        if (origin) inputs[input.name] = origin;
        else if (input.widget && widgetValue !== undefined) {
          inputs[input.widget.name || input.name] = widgetValue;
        }
      }
      for (const name of widgetNames) {
        if (name in inputs || values[widgetIndex] === undefined) continue;
        inputs[name] = values[widgetIndex++];
      }
      prompt[`${prefix}${node.id}`] = {
        class_type: node.type,
        inputs,
        ...(node.title ? { _meta: { title: node.title } } : {}),
      };
    };

    const expandInstance = (instance: UiWorkflowNode) => {
      const key = `${prefix}${instance.id}`;
      const existing = expandedOutputs.get(key);
      if (existing) return existing;
      const definition = definitions.get(instance.type);
      if (!definition) return [];
      if (active.has(key)) throw new Error(`Workflow contains a recursive subgraph at ${key}`);
      active.add(key);
      const childPrefix = `${prefix}sg_${instance.id}_`;
      const child = walk(
        definition.nodes,
        normalizedLinks(definition.links),
        childPrefix,
        (slot) => {
          const linkId = instance.inputs?.[slot]?.link;
          const link = graphLinks.find((candidate) => candidate.id === linkId);
          return link ? resolveOrigin(link) : null;
        },
      );
      const outputs = definition.outputs.map((output) => {
        const link = normalizedLinks(definition.links).find(
          (candidate) =>
            (output.linkIds ?? []).includes(candidate.id) && candidate.target_id === -20,
        );
        return link ? child.resolveOrigin(link) : null;
      });
      expandedOutputs.set(key, outputs);
      active.delete(key);
      return outputs;
    };

    function resolveOrigin(link: UiWorkflowLink): [string, number] | null {
      if (link.origin_id === -10) return externalInput(link.origin_slot);
      const origin = nodes.get(String(link.origin_id));
      if (!origin || origin.mode === 2 || origin.mode === 4) return null;
      if (origin.type === "Reroute") {
        const upstreamId = origin.inputs?.[0]?.link;
        const upstream = graphLinks.find((candidate) => candidate.id === upstreamId);
        return upstream ? resolveOrigin(upstream) : null;
      }
      if (definitions.has(origin.type)) return expandInstance(origin)[link.origin_slot] ?? null;
      serialize(origin);
      return [`${prefix}${origin.id}`, link.origin_slot];
    }

    for (const node of graphNodes) {
      if (definitions.has(node.type)) expandInstance(node);
      else serialize(node);
    }
    return { resolveOrigin };
  };

  walk(workflow.nodes, normalizedLinks(workflow.links ?? []), "node_", () => null);
  return prompt;
}

/**
 * Converts a regular, non-subgraph ComfyUI canvas workflow into API Prompt
 * format. The conversion uses each node's explicit widget metadata first and
 * falls back to the active ComfyUI object schema for older workflow files.
 */
export function convertUiWorkflowToPrompt(
  workflow: UiWorkflow | ComfyPrompt,
  objectInfo: ComfyObjectInfo = {},
): ComfyPrompt {
  if (isApiPrompt(workflow)) return structuredClone(workflow);
  if (!Array.isArray(workflow.nodes)) throw new Error("Workflow has no canvas nodes");
  if ((workflow.definitions?.subgraphs?.length ?? 0) > 0) {
    return expandSubgraphWorkflow(workflow, objectInfo);
  }

  const links = normalizedLinks(workflow.links ?? []);
  const nodes = new Map(workflow.nodes.map((node) => [String(node.id), node]));
  const prompt: ComfyPrompt = {};
  const resolveOrigin = (link: UiWorkflowLink): [string, number] | null => {
    const origin = nodes.get(String(link.origin_id));
    if (origin?.type === "Reroute") {
      const upstreamId = origin.inputs?.[0]?.link;
      const upstream = links.find((candidate) => candidate.id === upstreamId);
      return upstream ? resolveOrigin(upstream) : null;
    }
    if (!origin || origin.mode === 2 || origin.mode === 4) return null;
    return [String(origin.id), link.origin_slot];
  };

  for (const node of workflow.nodes) {
    if (
      node.mode === 2 ||
      node.mode === 4 ||
      ["Reroute", "Note", "MarkdownNote"].includes(node.type)
    ) {
      continue;
    }
    const inputs: Record<string, unknown> = {};
    const values = widgetValues(node);
    const explicitWidgetNames = (node.inputs ?? []).flatMap((input) =>
      input.widget ? [input.widget.name || input.name] : [],
    );
    const widgetNames = explicitWidgetNames.length
      ? explicitWidgetNames
      : schemaWidgetNames(objectInfo[node.type]);
    let widgetIndex = 0;

    for (const input of node.inputs ?? []) {
      const widget = input.widget
        ? nextWidgetValue(values, widgetIndex, input.type)
        : { value: undefined, nextIndex: widgetIndex };
      const widgetValue = widget.value;
      if (input.widget) widgetIndex = widget.nextIndex;
      const link =
        input.link == null ? null : links.find((candidate) => candidate.id === input.link);
      const origin = link ? resolveOrigin(link) : null;
      if (origin) inputs[input.name] = origin;
      else if (input.widget && widgetValue !== undefined) {
        inputs[input.widget.name || input.name] = widgetValue;
      }
    }
    for (const name of widgetNames) {
      if (name in inputs || values[widgetIndex] === undefined) continue;
      inputs[name] = values[widgetIndex++];
    }
    prompt[String(node.id)] = {
      class_type: node.type,
      inputs,
      ...(node.title ? { _meta: { title: node.title } } : {}),
    };
  }
  return prompt;
}

export function expandSingleSubgraphWorkflow(
  workflow: UiWorkflow,
  objectInfo: ComfyObjectInfo = {},
): ComfyPrompt {
  const subgraph = workflow.definitions?.subgraphs?.[0];
  if (!subgraph) throw new Error("Workflow does not contain a subgraph definition");
  const outerSubgraphNode = workflow.nodes.find((node) => node.type === subgraph.id);
  if (!outerSubgraphNode) throw new Error("Workflow subgraph instance is missing");
  const outerLinks = normalizedLinks(workflow.links);
  const innerLinks = normalizedLinks(subgraph.links);
  const innerNodes = new Map(subgraph.nodes.map((node) => [String(node.id), node]));
  const prompt: ComfyPrompt = {};

  const externalInputOrigin = (slot: number): [string, number] | null => {
    const linkId = outerSubgraphNode.inputs?.[slot]?.link;
    const link = outerLinks.find((candidate) => candidate.id === linkId);
    return link ? [`outer_${link.origin_id}`, link.origin_slot] : null;
  };

  const resolveInnerOrigin = (link: UiWorkflowLink): [string, number] | null => {
    if (link.origin_id === -10) return externalInputOrigin(link.origin_slot);
    const origin = innerNodes.get(String(link.origin_id));
    if (origin?.type === "Reroute") {
      const rerouteInput = origin.inputs?.[0]?.link;
      const upstream = innerLinks.find((candidate) => candidate.id === rerouteInput);
      return upstream ? resolveInnerOrigin(upstream) : null;
    }
    return [`inner_${link.origin_id}`, link.origin_slot];
  };

  const outputOrigin = (slot: number) => {
    const linkIds = subgraph.outputs[slot]?.linkIds ?? [];
    const link = innerLinks.find(
      (candidate) => linkIds.includes(candidate.id) && candidate.target_id === -20,
    );
    return link ? resolveInnerOrigin(link) : null;
  };

  const serializeNode = (
    node: UiWorkflowNode,
    id: string,
    links: UiWorkflowLink[],
    resolve: (link: UiWorkflowLink) => [string, number] | null,
  ) => {
    if (
      node.mode === 4 ||
      node.mode === 2 ||
      ["Reroute", "Note", "MarkdownNote"].includes(node.type)
    ) {
      return;
    }
    const inputs: Record<string, unknown> = {};
    const values = widgetValues(node);
    const explicitWidgetNames = (node.inputs ?? []).flatMap((input) =>
      input.widget ? [input.widget.name || input.name] : [],
    );
    const widgetNames = explicitWidgetNames.length
      ? explicitWidgetNames
      : schemaWidgetNames(objectInfo[node.type]);
    let widgetIndex = 0;
    for (const input of node.inputs ?? []) {
      const widget = input.widget
        ? nextWidgetValue(values, widgetIndex, input.type)
        : { value: undefined, nextIndex: widgetIndex };
      const widgetValue = widget.value;
      if (input.widget) widgetIndex = widget.nextIndex;
      const link =
        input.link == null ? null : links.find((candidate) => candidate.id === input.link);
      const origin = link ? resolve(link) : null;
      if (origin) inputs[input.name] = origin;
      else if (input.widget && widgetValue !== undefined) inputs[input.name] = widgetValue;
    }
    for (const name of widgetNames) {
      if (name in inputs || values[widgetIndex] === undefined) continue;
      inputs[name] = values[widgetIndex++];
    }
    prompt[id] = {
      class_type: node.type,
      inputs,
      ...(node.title ? { _meta: { title: node.title } } : {}),
    };
  };

  for (const node of subgraph.nodes) {
    serializeNode(node, `inner_${node.id}`, innerLinks, resolveInnerOrigin);
  }
  for (const node of workflow.nodes) {
    if (node.id === outerSubgraphNode.id) continue;
    serializeNode(node, `outer_${node.id}`, outerLinks, (link) => {
      if (link.origin_id === outerSubgraphNode.id) return outputOrigin(link.origin_slot);
      return [`outer_${link.origin_id}`, link.origin_slot];
    });
  }
  return prompt;
}

export type Ltx23I2VInput = {
  image: string;
  positivePrompt: string;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  seed: number;
  filenamePrefix: string;
};

export function buildLtx23I2VPrompt(workflow: UiWorkflow, input: Ltx23I2VInput) {
  const prompt = expandSingleSubgraphWorkflow(workflow);
  const setByTitle = (title: string, field: string, value: unknown) => {
    const node = Object.values(prompt).find((candidate) => candidate._meta?.title === title);
    if (!node) throw new Error(`LTX Recipe node titled ${title} is missing`);
    node.inputs[field] = value;
  };
  setByTitle("Prompt", "value", input.positivePrompt);
  const size = resolveGenerationResolution("multiple_32", input.width, input.height).effective;
  setByTitle("Width", "value", size.width);
  setByTitle("Height", "value", size.height);
  setByTitle("Duration", "value", Math.round(input.durationSeconds));
  setByTitle("Frame Rate", "value", Math.round(input.fps));
  const load = Object.values(prompt).find((node) => node.class_type === "LoadImage");
  const noise = Object.values(prompt).find(
    (node) => node.class_type === "RandomNoise" && node.inputs.noise_seed !== 42,
  );
  const save = Object.values(prompt).find((node) => node.class_type === "SaveVideo");
  if (!load || !noise || !save) throw new Error("LTX Recipe input or output nodes are missing");
  load.inputs.image = input.image;
  noise.inputs.noise_seed = input.seed;
  save.inputs.filename_prefix = input.filenamePrefix;
  save.inputs.format ??= "auto";
  save.inputs.codec ??= "auto";
  return prompt;
}

export type ComfyOutputFile = { filename: string; subfolder: string; type: string };

export class ComfyClient {
  private readonly progressTracker: ComfyProgressTracker;

  constructor(
    private readonly baseUrl: string,
    options: { liveProgress?: boolean } = {},
  ) {
    this.progressTracker = new ComfyProgressTracker(baseUrl, options.liveProgress ?? true);
  }

  async uploadInput(bytes: Uint8Array, filename: string, mimeType: string) {
    const body = new FormData();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    // ComfyUI's /upload/image route is its generic input-file ingress despite
    // the historical field name. LoadImage, LoadVideo and LoadAudio all read
    // from the same protected input directory.
    body.set("image", new Blob([copy.buffer], { type: mimeType }), filename);
    body.set("overwrite", "true");
    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ComfyUI input upload failed: ${response.status}`);
    const result = (await response.json()) as { name: string; subfolder: string; type: string };
    return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
  }

  async uploadImage(bytes: Uint8Array, filename: string, mimeType: string) {
    return await this.uploadInput(bytes, filename, mimeType);
  }

  createClientId() {
    return `takeboard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  watchProgress(promptId: string, clientId: string) {
    this.progressTracker.watch(promptId, clientId);
  }

  progress(promptId: string) {
    return this.progressTracker.get(promptId);
  }

  forgetProgress(promptId: string) {
    this.progressTracker.forget(promptId);
  }

  async submit(prompt: ComfyPrompt, clientId = this.createClientId()) {
    this.progressTracker.connect(clientId, prompt);
    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, client_id: clientId }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json()) as {
      prompt_id?: string;
      number?: number;
      error?: string;
      node_errors?: Record<string, unknown>;
    };
    if (!response.ok || !result.prompt_id) {
      throw new Error(`ComfyUI rejected prompt: ${JSON.stringify(result)}`);
    }
    this.progressTracker.register(result.prompt_id, clientId, result.number);
    return result.prompt_id;
  }

  private async queueState(promptId: string) {
    const queueResponse = await fetch(`${this.baseUrl}/queue`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!queueResponse.ok) throw new Error("ComfyUI queue inspection failed before cancellation");
    const queue = (await queueResponse.json()) as {
      queue_running?: unknown[];
      queue_pending?: unknown[];
    };
    const containsPrompt = (entries: unknown[] | undefined) =>
      (entries ?? []).some(
        (entry) => Array.isArray(entry) && entry.some((value) => value === promptId),
      );
    return {
      running: containsPrompt(queue.queue_running),
      pending: containsPrompt(queue.queue_pending),
    };
  }

  async cancel(promptId: string) {
    const response = await fetch(
      `${this.baseUrl}/api/jobs/${encodeURIComponent(promptId)}/cancel`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status === 404) {
      const { running, pending } = await this.queueState(promptId);
      if (!running && !pending) {
        // The queue is authoritative for whether work can still consume compute.
        // History may already have been pruned, so its absence must not make a
        // completed task impossible to clean up or its project impossible to delete.
        return true;
      }
      const actions: Promise<Response>[] = [];
      if (running) {
        actions.push(
          fetch(`${this.baseUrl}/interrupt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt_id: promptId }),
            signal: AbortSignal.timeout(30_000),
          }),
        );
      }
      if (pending) {
        actions.push(
          fetch(`${this.baseUrl}/queue`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ delete: [promptId] }),
            signal: AbortSignal.timeout(30_000),
          }),
        );
      }
      const results = await Promise.all(actions);
      if (results.some((result) => !result.ok)) {
        throw new Error("ComfyUI targeted cancellation failed");
      }
      return true;
    }
    if (!response.ok) throw new Error(`ComfyUI job cancellation failed: ${response.status}`);
    const result = (await response.json()) as { cancelled?: boolean };
    if (result.cancelled) return true;
    const state = await this.queueState(promptId);
    return !state.running && !state.pending;
  }

  async deleteHistory(promptId: string) {
    const response = await fetch(`${this.baseUrl}/history`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ComfyUI history cleanup failed: ${response.status}`);
  }

  async freeResourcesIfIdle() {
    const queueResponse = await fetch(`${this.baseUrl}/queue`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!queueResponse.ok) return false;
    const queue = (await queueResponse.json()) as {
      queue_running?: unknown[];
      queue_pending?: unknown[];
    };
    if ((queue.queue_running?.length ?? 0) > 0 || (queue.queue_pending?.length ?? 0) > 0) {
      return false;
    }
    const response = await fetch(`${this.baseUrl}/free`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(30_000),
    });
    return response.ok;
  }

  async workflow(path: string) {
    const response = await fetch(
      `${this.baseUrl}/api/userdata/${encodeURIComponent(`workflows/${path}`)}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) throw new Error(`ComfyUI workflow failed: ${response.status}`);
    return (await response.json()) as UiWorkflow;
  }

  async missingNodeClasses(prompt: ComfyPrompt) {
    const response = await fetch(`${this.baseUrl}/object_info`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ComfyUI object info failed: ${response.status}`);
    const objectInfo = (await response.json()) as Record<string, unknown>;
    return [...new Set(Object.values(prompt).map((node) => node.class_type))].filter(
      (classType) => !(classType in objectInfo),
    );
  }

  async preflightPrompt(prompt: ComfyPrompt) {
    const response = await fetch(`${this.baseUrl}/object_info`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ComfyUI object info failed: ${response.status}`);
    const objectInfo = (await response.json()) as Record<
      string,
      { input?: { required?: Record<string, unknown> } }
    >;
    const errors: string[] = [];
    for (const [nodeId, node] of Object.entries(prompt)) {
      const definition = objectInfo[node.class_type];
      if (!definition) {
        errors.push(`${nodeId}: missing node class ${node.class_type}`);
        continue;
      }
      for (const field of Object.keys(definition.input?.required ?? {})) {
        const present =
          field in node.inputs ||
          Object.keys(node.inputs).some((inputField) => inputField.startsWith(`${field}.`));
        if (!present) errors.push(`${nodeId}: missing required input ${field}`);
      }
      for (const [field, value] of Object.entries(node.inputs)) {
        if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string") {
          if (!prompt[value[0]]) errors.push(`${nodeId}.${field}: missing origin node ${value[0]}`);
        }
      }
    }
    return errors;
  }

  async history(promptId: string) {
    const response = await fetch(`${this.baseUrl}/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ComfyUI history failed: ${response.status}`);
    const history = (await response.json()) as Record<
      string,
      {
        outputs?: Record<
          string,
          {
            videos?: ComfyOutputFile[];
            images?: ComfyOutputFile[];
            gifs?: ComfyOutputFile[];
          }
        >;
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
