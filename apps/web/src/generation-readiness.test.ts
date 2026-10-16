import { expect, it } from "vitest";
import type { WorkflowSummary } from "./api";
import { defaultGenerationSettings } from "./generation-model";
import { generationProblem } from "./generation-readiness";
import { generationStepPolicy, modelProfile } from "./model-profiles";

const workflow = {
  path: "custom/fixed.json",
  execution: "bound",
  capability: "text_to_image",
  inputs: ["prompt"],
  diagnostic: { executable: true, health: "ready", checks: [] },
} as unknown as WorkflowSummary;
it("validates only controls the workflow exposes, not hidden settings from another model", () => {
  const check = (inputs: string[]) =>
    generationProblem({
      projectMode: "project",
      selectedWorkflow: { ...workflow, inputs },
      generationSettings: {
        ...defaultGenerationSettings,
        prompt: "A portrait",
        width: Number.NaN,
        seed: -1,
        steps: -1,
      },
      selectedModelProfile: modelProfile(workflow, "16:9"),
      selectedInputCounts: { reference: 0, reference_video: 0, reference_audio: 0 },
      assets: [],
    });
  expect(check(["prompt"])).toBeNull();
  for (const input of ["resolution", "seed", "steps"])
    expect(check(["prompt", input])).not.toBeNull();
});
it("keeps preview sampling fixed and does not apply native constraints to custom workflows", () => {
  const preview = {
    ...workflow,
    execution: "native" as const,
    path: "Kino/TakeBoard/abcdef/Kino_Wan22_I2V_Preview.json",
  };
  expect(generationStepPolicy(preview)).toEqual({ min: 4, max: 4, fixed: true });
  expect(generationStepPolicy({ ...preview, path: "Kino/Kino_Wan22_I2V.json" })).toEqual({
    min: 8,
    max: 40,
    fixed: false,
  });
  expect(generationStepPolicy({ ...preview, execution: "bound" })).toEqual({
    min: 1,
    max: 100,
    fixed: false,
  });
});
