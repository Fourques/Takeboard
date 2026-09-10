import type { ProjectSnapshot } from "@takeboard/contracts";
import type { WorkflowSummary } from "./api";
import type { GenerationSettings } from "./generation-model";
import type { modelProfile } from "./model-profiles";

export function generationProblem({
  projectMode,
  selectedWorkflow,
  generationSettings,
  selectedModelProfile,
  selectedInputCounts,
  assets,
}: {
  projectMode: "demo" | "project";
  selectedWorkflow: WorkflowSummary | null;
  generationSettings: GenerationSettings;
  selectedModelProfile: ReturnType<typeof modelProfile>;
  selectedInputCounts: { reference: number; reference_video: number; reference_audio: number };
  assets: ProjectSnapshot["assets"];
}) {
  const firstFrameAvailable = assets.some(
    (asset) => asset.mediaType === "image" && asset.id === generationSettings.firstFrameAssetId,
  );
  const lastFrameAvailable = assets.some(
    (asset) => asset.mediaType === "image" && asset.id === generationSettings.lastFrameAssetId,
  );
  if (projectMode === "demo" || selectedWorkflow?.execution === "comfy_only") return null;
  if (!selectedWorkflow) return "请先选择一个可用 Workflow";
  if (selectedWorkflow.modelStatus === "missing") {
    return `当前电脑缺少模型：${(selectedWorkflow.missingModels ?? []).slice(0, 2).join("、")}`;
  }
  if (!generationSettings.prompt.trim()) return "请先输入镜头提示词";
  if (selectedWorkflow.inputs.includes("first_frame") && !firstFrameAvailable) {
    return "请从资产库选择一张起始帧";
  }
  if (selectedWorkflow.capability === "first_last_video" && !lastFrameAvailable) {
    return "首尾帧模式还需要一张结束帧";
  }
  if (
    selectedWorkflow.capability === "reference_video" &&
    selectedInputCounts.reference +
      selectedInputCounts.reference_video +
      selectedInputCounts.reference_audio ===
      0
  ) {
    return "Ref2VA 至少需要一张参考图、一段参考视频或参考音频";
  }
  const imageWorkflow = ["text_to_image", "image_to_image"].includes(selectedWorkflow.capability);
  const invalidVideoParameters =
    !imageWorkflow &&
    (!Number.isFinite(generationSettings.durationSeconds) ||
      generationSettings.durationSeconds < (selectedModelProfile.family === "minimax_h3" ? 4 : 1) ||
      generationSettings.durationSeconds > 15 ||
      !Number.isFinite(generationSettings.fps) ||
      generationSettings.fps < 8 ||
      generationSettings.fps > 60);
  const invalidDenoise =
    selectedWorkflow.inputs.includes("denoise") &&
    (!Number.isFinite(generationSettings.denoise) ||
      generationSettings.denoise < 0.05 ||
      generationSettings.denoise > 1);
  if (
    !Number.isFinite(generationSettings.width) ||
    generationSettings.width < 256 ||
    generationSettings.width > 2048 ||
    !Number.isFinite(generationSettings.height) ||
    generationSettings.height < 256 ||
    generationSettings.height > 2048 ||
    invalidVideoParameters ||
    invalidDenoise ||
    !Number.isSafeInteger(generationSettings.seed) ||
    generationSettings.seed < 0 ||
    !Number.isSafeInteger(generationSettings.steps) ||
    generationSettings.steps < 1 ||
    generationSettings.steps > 100
  ) {
    return imageWorkflow
      ? "请检查分辨率、Steps、重绘强度和 Seed"
      : "请检查分辨率、时长、帧率和 Seed";
  }
  return null;
}
