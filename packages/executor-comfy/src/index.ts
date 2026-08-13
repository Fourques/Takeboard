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
  const safeWidth = Math.max(512, width);
  const safeHeight = Math.max(512, height);
  const scale = Math.min(
    1,
    1664 / Math.max(safeWidth, safeHeight),
    Math.sqrt(1_800_000 / (safeWidth * safeHeight)),
  );
  return {
    width: Math.max(512, Math.round((safeWidth * scale) / 32) * 32),
    height: Math.max(512, Math.round((safeHeight * scale) / 32) * 32),
  };
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

export function miniMaxH3FrameCount(durationSeconds: number, fps = 24) {
  const desired = Math.max(5, durationSeconds * fps);
  return Math.max(5, Math.ceil((desired - 5) / 17) * 17 + 5);
}

export function miniMaxH3Resolution(width: number, height: number) {
  const safeWidth = Math.max(256, width);
  const safeHeight = Math.max(256, height);
  const scale = Math.min(
    1,
    768 / Math.min(safeWidth, safeHeight),
    1344 / Math.max(safeWidth, safeHeight),
  );
  return {
    width: Math.max(256, Math.round((safeWidth * scale) / 32) * 32),
    height: Math.max(256, Math.round((safeHeight * scale) / 32) * 32),
  };
}

export function buildMiniMaxH3Prompt(input: MiniMaxH3Input): ComfyPrompt {
  const fps = input.fps ?? 24;
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
    video: {
      class_type: "CreateVideo",
      inputs: { images: ["decoded", 0], fps, bit_depth: 10 },
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

type UiWorkflowNode = {
  id: number | string;
  type: string;
  title?: string;
  mode?: number;
  inputs?: Array<{ name: string; link?: number | null; widget?: { name: string } }>;
  widgets_values?: unknown[] | Record<string, unknown> | null;
};

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

export function expandSingleSubgraphWorkflow(workflow: UiWorkflow): ComfyPrompt {
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
    let widgetIndex = 0;
    for (const input of node.inputs ?? []) {
      const widgetValue = input.widget ? values[widgetIndex++] : undefined;
      const link =
        input.link == null ? null : links.find((candidate) => candidate.id === input.link);
      const origin = link ? resolve(link) : null;
      if (origin) inputs[input.name] = origin;
      else if (input.widget && widgetValue !== undefined) inputs[input.name] = widgetValue;
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
  setByTitle("Width", "value", Math.round(input.width / 32) * 32);
  setByTitle("Height", "value", Math.round(input.height / 32) * 32);
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
