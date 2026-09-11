import { describe, expect, it } from "vitest";
import type { WorkflowBinding } from "../src/workflow-bindings.js";
import { workflowDefaults } from "../src/workflow-defaults.js";

describe("bound workflow defaults", () => {
  const binding = {
    parameters: {
      fps: [{ nodeId: "1", input: "fps" }],
      duration: [{ nodeId: "1", input: "frames", transform: "seconds_to_frames_plus_one" }],
      steps: [{ nodeId: "1", input: "steps" }],
      seed: [{ nodeId: "1", input: "seed" }],
    },
  } as WorkflowBinding;
  it("reads actual values and reverses explicit frame conversions", () => {
    expect(
      workflowDefaults(
        { "1": { class_type: "Custom", inputs: { fps: 24, frames: 121, steps: 25, seed: 72 } } },
        binding,
      ),
    ).toEqual({ fps: 24, durationSeconds: 5, steps: 25, seed: 72 });
  });
  it("does not invent defaults from connected values, disagreement or unknown FPS", () => {
    expect(
      workflowDefaults(
        { "1": { class_type: "Custom", inputs: { fps: ["other", 0], frames: 121, steps: 25 } } },
        {
          ...binding,
          parameters: {
            ...binding.parameters,
            steps: [
              { nodeId: "1", input: "steps" },
              { nodeId: "missing", input: "steps" },
            ],
          },
        },
      ),
    ).toEqual({});
  });
});
