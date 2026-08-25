import type { AspectRatio } from "@takeboard/contracts";
import type { WorkflowSummary } from "./api";

export type WorkflowInputSlot = {
  id: "first_frame" | "last_frame" | "reference" | "reference_video";
  label: string;
  required: boolean;
  hint: string;
  maxCount: number;
  mediaType: "image" | "video";
};

export type ModelDefaults = {
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  steps: number;
  denoise: number;
};

export type ModelProfile = {
  family: "wan22" | "minimax_h3" | "ltx23" | "qwen_image" | "custom";
  title: string;
  description: string;
  outputLabel: "图片" | "视频";
  defaults: ModelDefaults;
  slots: WorkflowInputSlot[];
};

const portraitRatios = new Set<AspectRatio>(["9:16", "4:5"]);

function orientedSize(landscapeWidth: number, landscapeHeight: number, ratio: AspectRatio) {
  return portraitRatios.has(ratio)
    ? { width: landscapeHeight, height: landscapeWidth }
    : { width: landscapeWidth, height: landscapeHeight };
}

export function workflowInputSlots(workflow: WorkflowSummary | null): WorkflowInputSlot[] {
  if (!workflow) return [];
  const slots: WorkflowInputSlot[] = [];
  if (workflow.inputs.includes("first_frame")) {
    slots.push({
      id: "first_frame",
      label: workflow.capability === "image_to_image" ? "源图" : "首帧",
      required: ["image_to_image", "image_to_video", "first_last_video"].includes(
        workflow.capability,
      ),
      hint: workflow.capability === "image_to_image" ? "保留并编辑这张图" : "视频从这里开始",
      maxCount: workflow.mediaInputs?.first_frame ?? 1,
      mediaType: "image",
    });
  }
  if (workflow.inputs.includes("last_frame")) {
    slots.push({
      id: "last_frame",
      label: "尾帧",
      required: workflow.capability === "first_last_video",
      hint: "约束视频结束画面",
      maxCount: workflow.mediaInputs?.last_frame ?? 1,
      mediaType: "image",
    });
  }
  if (workflow.inputs.includes("reference_images")) {
    slots.push({
      id: "reference",
      label: "参考",
      required: false,
      hint: "角色、场景或风格参考",
      maxCount: workflow.mediaInputs?.reference ?? 9,
      mediaType: "image",
    });
  }
  if (workflow.inputs.includes("reference_videos")) {
    slots.push({
      id: "reference_video",
      label: "参考视频",
      required: false,
      hint: "动作、运镜或节奏参考",
      maxCount: workflow.mediaInputs?.reference_video ?? 3,
      mediaType: "video",
    });
  }
  return slots;
}

export function modelProfile(
  workflow: WorkflowSummary | null,
  aspectRatio: AspectRatio,
): ModelProfile {
  const haystack = `${workflow?.path ?? ""} ${workflow?.name ?? ""}`.toLowerCase();
  const slots = workflowInputSlots(workflow);
  if (haystack.includes("qwen")) {
    const size = orientedSize(1664, 928, aspectRatio);
    return {
      family: "qwen_image",
      title: "Qwen Image 工作参数",
      description: "参数随这个镜头保存；工作流定义由当前 JSON 决定。",
      outputLabel: "图片",
      defaults: { ...size, durationSeconds: 5, fps: 16, steps: 50, denoise: 0.65 },
      slots,
    };
  }
  if (haystack.includes("minimax") || haystack.includes("h3")) {
    const size = orientedSize(1344, 768, aspectRatio);
    return {
      family: "minimax_h3",
      title: "MiniMax H3 工作参数",
      description: "画面输入与容量来自当前 JSON；参数随镜头运行记录保存。",
      outputLabel: "视频",
      defaults: { ...size, durationSeconds: 5, fps: 24, steps: 20, denoise: 0.65 },
      slots,
    };
  }
  if (haystack.includes("ltx")) {
    const size = orientedSize(848, 480, aspectRatio);
    return {
      family: "ltx23",
      title: "LTX Video 工作参数",
      description: "只显示当前 Workflow 实际暴露的输入与执行参数。",
      outputLabel: "视频",
      defaults: { ...size, durationSeconds: 5, fps: 25, steps: 20, denoise: 0.65 },
      slots,
    };
  }
  if (haystack.includes("wan")) {
    const size = orientedSize(848, 480, aspectRatio);
    return {
      family: "wan22",
      title: "Wan 2.2 工作参数",
      description: "首帧或首尾帧端口由当前 Workflow 的 JSON 决定。",
      outputLabel: "视频",
      defaults: { ...size, durationSeconds: 5, fps: 16, steps: 4, denoise: 0.65 },
      slots,
    };
  }
  const size = orientedSize(848, 480, aspectRatio);
  const imageOutput = workflow
    ? ["text_to_image", "image_to_image"].includes(workflow.capability)
    : false;
  return {
    family: "custom",
    title: "Workflow 工作参数",
    description: "只显示当前 Workflow 实际声明的输入；其余参数留在 ComfyUI 中编辑。",
    outputLabel: imageOutput ? "图片" : "视频",
    defaults: { ...size, durationSeconds: 5, fps: 16, steps: 20, denoise: 0.65 },
    slots,
  };
}

const preferencePrefix = "takeboard.model-preferences.";

export function loadModelPreferences(path: string): Partial<ModelDefaults> {
  try {
    const raw = window.localStorage.getItem(`${preferencePrefix}${path}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          ["width", "height", "durationSeconds", "fps", "steps", "denoise"].includes(key) &&
          typeof value === "number" &&
          Number.isFinite(value),
      ),
    ) as Partial<ModelDefaults>;
  } catch {
    return {};
  }
}

export function saveModelPreferences(path: string, settings: ModelDefaults) {
  window.localStorage.setItem(`${preferencePrefix}${path}`, JSON.stringify(settings));
}
