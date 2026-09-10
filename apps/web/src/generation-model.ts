import type { ExecutionPolicy, ProjectSnapshot } from "@takeboard/contracts";
import type { WorkflowSummary } from "./api";

export type GenerationSettings = {
  recipePath: string;
  prompt: string;
  negativePrompt: string;
  firstFrameAssetId: string | null;
  lastFrameAssetId: string | null;
  referenceAssetId: string | null;
  referenceImageSize: "match" | "max";
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  seed: number;
  steps: number;
  denoise: number;
  executionPolicy: ExecutionPolicy;
  budgetCap: number;
  budgetCurrency: string;
};

export type PromptMention = {
  assetId: string;
  alias: string;
  role: string;
  canonicalToken: string;
  thumbnailUrl: string | undefined;
};

export type ShotCanvasControls = {
  settings: GenerationSettings;
  workflows: WorkflowSummary[];
  workflowLocked: boolean;
  mentionAliases: string[];
  busy: boolean;
  progress: GenerationProgress | null;
  disabledReason: string | null;
  onWorkflowChange: (path: string) => void;
  onSettingsChange: (input: Partial<GenerationSettings>) => void;
  onGenerate: (input: Partial<GenerationSettings>) => void;
  onOpenDetails: () => void;
  onCommitTitle: (title: string) => void;
};

export const defaultGenerationSettings: GenerationSettings = {
  recipePath: "Kino/Kino_Wan22_I2V.json",
  prompt: "",
  negativePrompt: "",
  firstFrameAssetId: null,
  lastFrameAssetId: null,
  referenceAssetId: null,
  referenceImageSize: "match",
  width: 480,
  height: 848,
  durationSeconds: 5,
  fps: 16,
  seed: 26081301,
  steps: 20,
  denoise: 0.65,
  executionPolicy: "balanced",
  budgetCap: 10,
  budgetCurrency: "CNY",
};

const nativeWorkflowFallbacks: WorkflowSummary[] = [
  {
    id: "native-wan22-i2v",
    path: "Kino/Kino_Wan22_I2V.json",
    name: "Wan 2.2 I2V · 高质量",
    capability: "image_to_video",
    capabilityLabel: "图生视频",
    inputs: [
      "prompt",
      "negative_prompt",
      "first_frame",
      "resolution",
      "duration",
      "fps",
      "seed",
      "steps",
    ],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-wan22-flf2v",
    path: "Kino/Kino_Wan22_FLF2V.json",
    name: "Wan 2.2 首尾帧 · 高质量",
    capability: "first_last_video",
    capabilityLabel: "首尾帧视频",
    inputs: [
      "prompt",
      "negative_prompt",
      "first_frame",
      "last_frame",
      "resolution",
      "duration",
      "fps",
      "seed",
      "steps",
    ],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-wan22-i2v-preview",
    path: "Kino/Kino_Wan22_I2V_Preview.json",
    name: "Wan 2.2 I2V · 快速预演",
    capability: "image_to_video",
    capabilityLabel: "图生视频",
    inputs: ["prompt", "negative_prompt", "first_frame", "resolution", "duration", "fps", "seed"],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-wan22-flf2v-preview",
    path: "Kino/Kino_Wan22_FLF2V_Preview.json",
    name: "Wan 2.2 首尾帧 · 快速预演",
    capability: "first_last_video",
    capabilityLabel: "首尾帧视频",
    inputs: [
      "prompt",
      "negative_prompt",
      "first_frame",
      "last_frame",
      "resolution",
      "duration",
      "fps",
      "seed",
    ],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-minimax-h3-i2v",
    path: "Kino/Kino_MinimaxH3_I2V.json",
    name: "MiniMax H3 I2V · 原生音画",
    capability: "image_to_video",
    capabilityLabel: "图生视频",
    inputs: [
      "prompt",
      "first_frame",
      "last_frame",
      "resolution",
      "duration",
      "fps",
      "seed",
      "steps",
    ],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-minimax-h3-t2v",
    path: "Kino/Kino_MinimaxH3_T2V.json",
    name: "MiniMax H3 T2V · 原生音画",
    capability: "text_to_video",
    capabilityLabel: "文生视频",
    inputs: ["prompt", "resolution", "duration", "fps", "seed", "steps"],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-minimax-h3-r2v",
    path: "Kino/Kino_MinimaxH3_R2V.json",
    name: "MiniMax H3 Ref2VA · 多模态参考",
    capability: "reference_video",
    capabilityLabel: "参考生成视频",
    inputs: [
      "prompt",
      "reference_images",
      "reference_videos",
      "reference_audio",
      "resolution",
      "duration",
      "fps",
      "seed",
      "steps",
    ],
    mediaInputs: {
      first_frame: 0,
      last_frame: 0,
      reference: 9,
      reference_video: 3,
      reference_audio: 3,
    },
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-ltx23-i2v",
    path: "Kino/Kino_LTX23_I2V_Draft.json",
    name: "LTX23 I2V Draft",
    capability: "image_to_video",
    capabilityLabel: "图生视频",
    inputs: ["prompt", "first_frame", "resolution", "duration", "fps", "seed"],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-qwen-image-2512-t2i",
    path: "Kino/Kino_QwenImage2512_T2I.json",
    name: "Qwen Image 2512 T2I",
    capability: "text_to_image",
    capabilityLabel: "文生图",
    inputs: ["prompt", "negative_prompt", "resolution", "seed", "steps"],
    models: ["qwen_image_2512_fp8_e4m3fn.safetensors"],
    nodeCount: 10,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-qwen-image-2512-i2i",
    path: "Kino/Kino_QwenImage2512_I2I.json",
    name: "Qwen Image 2512 I2I",
    capability: "image_to_image",
    capabilityLabel: "图生图",
    inputs: ["prompt", "negative_prompt", "first_frame", "resolution", "seed", "steps", "denoise"],
    models: ["qwen_image_2512_fp8_e4m3fn.safetensors"],
    nodeCount: 11,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
];

export function shortId(value: string) {
  return value.slice(-6).toUpperCase();
}

export function runWorkflowPath(snapshot: ProjectSnapshot, shotId: string) {
  const value = [...snapshot.runs].reverse().find((run) => run.shotId === shotId)
    ?.parameters.recipePath;
  return typeof value === "string" ? value : null;
}

export function findWorkflow(path: string | null | undefined, workflows: WorkflowSummary[]) {
  if (!path) return null;
  return (
    workflows.find((workflow) => workflow.path === path) ??
    nativeWorkflowFallbacks.find((workflow) => workflow.path === path) ??
    null
  );
}

export type GenerationProgress = {
  phase: "preparing" | "queued" | "running" | "collecting";
  label: string;
  detail: string;
  percent: number | null;
  elapsedSeconds: number;
};

export type GenerationLaunchOptions = {
  candidateCount?: number;
  candidateBatchId?: string;
  candidateIndex?: number;
  retryOfRunId?: string;
  compiledPrompt?: string;
  firstFrameAssetId?: string | null;
  lastFrameAssetId?: string | null;
  referenceImageAssetIds?: string[];
  referenceVideoAssetIds?: string[];
  referenceAudioAssetIds?: string[];
};

export function realGenerationProgress(
  progress: {
    phase: "queued" | "running" | "collecting";
    label: string;
    detail: string;
    percent: number | null;
  } | null,
  startedAt: number,
): GenerationProgress {
  return {
    phase: progress?.phase ?? "running",
    label: progress?.label ?? "ComfyUI 正在执行工作流",
    detail: progress?.detail ?? "当前节点没有提供步进百分比",
    percent: progress?.percent ?? null,
    elapsedSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
  };
}
