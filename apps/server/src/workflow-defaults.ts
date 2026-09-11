import type { ComfyPrompt } from "@takeboard/executor-comfy";
import type { WorkflowBinding, WorkflowParameterKey } from "./workflow-bindings.js";

/** Only expose unambiguous literal defaults, never infer values from node names. */
export function workflowDefaults(prompt: ComfyPrompt, binding: WorkflowBinding) {
  const defaults: Partial<
    Record<"width" | "height" | "fps" | "steps" | "denoise" | "seed" | "durationSeconds", number>
  > = {};
  const literal = (key: WorkflowParameterKey) => {
    const targets = binding.parameters[key] ?? [];
    const values = targets.map((target) => prompt[target.nodeId]?.inputs[target.input]);
    const first = values[0];
    return typeof first === "number" &&
      Number.isFinite(first) &&
      values.every((value) => value === first)
      ? first
      : undefined;
  };
  for (const key of ["width", "height", "fps", "steps", "denoise", "seed"] as const) {
    const value = literal(key);
    if (value !== undefined) defaults[key] = value;
  }
  const duration = binding.parameters.duration ?? [];
  const durations = duration.map((target) => {
    const value = prompt[target.nodeId]?.inputs[target.input];
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (!target.transform) return value;
    if (!defaults.fps || defaults.fps <= 0) return undefined;
    const offset =
      target.transform === "seconds_to_frames_plus_one"
        ? 1
        : target.transform === "seconds_to_frames_minus_one"
          ? -1
          : 0;
    return (value - offset) / defaults.fps;
  });
  const seconds = durations[0];
  if (seconds !== undefined && seconds > 0 && durations.every((value) => value === seconds))
    defaults.durationSeconds = seconds;
  return defaults;
}
