import type { ProjectSnapshot, Shot } from "@takeboard/contracts";
import type { WorkflowSummary } from "./api";
import { defaultGenerationSettings, type GenerationSettings } from "./generation-model";
import { modelProfile } from "./model-profiles";

/** Defaults are scoped to the actual shot/workflow, never the previously selected draft. */
export function initialGenerationDraft(
  snapshot: ProjectSnapshot | null,
  shot: Shot | null,
  workflow: WorkflowSummary | null,
  preferences: Partial<GenerationSettings> = {},
): GenerationSettings {
  if (!shot || !snapshot) return { ...defaultGenerationSettings };
  const preferred = {
    ...modelProfile(workflow, shot.aspectRatio).defaults,
    ...workflow?.parameterDefaults,
    ...preferences,
  };
  const lastRun = [...snapshot.runs].reverse().find((run) => run.shotId === shot.id);
  const number = (name: string, fallback: number) =>
    typeof lastRun?.parameters[name] === "number" ? (lastRun.parameters[name] as number) : fallback;
  return {
    ...defaultGenerationSettings,
    ...preferred,
    recipePath: workflow?.path ?? shot.workflowPath ?? defaultGenerationSettings.recipePath,
    prompt:
      typeof lastRun?.parameters.promptSource === "string"
        ? lastRun.parameters.promptSource
        : typeof lastRun?.parameters.prompt === "string"
          ? lastRun.parameters.prompt
          : shot.intent,
    negativePrompt:
      typeof lastRun?.parameters.negativePrompt === "string"
        ? lastRun.parameters.negativePrompt
        : "",
    width: number("width", preferred.width),
    height: number("height", preferred.height),
    durationSeconds: number(
      "durationSeconds",
      workflow?.parameterDefaults?.durationSeconds ?? shot.durationSeconds,
    ),
    fps: number("fps", preferred.fps),
    steps: number("steps", preferred.steps),
    denoise: number("denoise", preferred.denoise),
    seed: number("seed", workflow?.parameterDefaults?.seed ?? defaultGenerationSettings.seed),
    referenceImageSize: lastRun?.parameters.referenceImageSize === "max" ? "max" : "match",
    referenceVideoAudio:
      typeof lastRun?.parameters.referenceVideoAudio === "boolean"
        ? lastRun.parameters.referenceVideoAudio
        : Boolean(lastRun),
    executionPolicy: lastRun?.execution?.policy ?? defaultGenerationSettings.executionPolicy,
  };
}
