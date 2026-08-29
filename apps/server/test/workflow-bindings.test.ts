import { describe, expect, it } from "vitest";
import {
  applyWorkflowBinding,
  discoverBindingCandidates,
  validateWorkflowBinding,
  type WorkflowBinding,
  workflowHash,
} from "../src/workflow-bindings.js";

const binding: WorkflowBinding = {
  version: 1,
  workflowPath: "TakeBoard/custom.json",
  workflowHash: "hash",
  capability: "image_to_video",
  outputMediaType: "video",
  parameters: {
    prompt: [{ nodeId: "text", input: "value" }],
    seed: [{ nodeId: "sampler", input: "seed" }],
    denoise: [{ nodeId: "sampler", input: "denoise" }],
    duration: [{ nodeId: "video", input: "duration", transform: "seconds_to_frames" }],
  },
  media: { first_frame: [{ nodeId: "image", input: "image" }] },
  trusted: true,
  verifiedAt: "2026-08-27T00:00:00.000Z",
};

describe("workflow binding execution", () => {
  it("injects project values into a cloned prompt and scopes output filenames", () => {
    const source = {
      text: { class_type: "TextNode", inputs: { value: "old" } },
      image: { class_type: "LoadImage", inputs: { image: "old.png" } },
      sampler: { class_type: "Sampler", inputs: { seed: 1, denoise: 1 } },
      video: { class_type: "VideoNode", inputs: { duration: 3 } },
      save: { class_type: "SaveVideo", inputs: { filename_prefix: "unsafe/default" } },
    };
    const result = applyWorkflowBinding(source, binding, {
      prompt: "new prompt",
      seed: 42,
      denoise: 0.55,
      duration: 7,
      fps: 24,
      firstFrame: "takeboard/input.png",
      filenamePrefix: "takeboard/project/shot/run/result",
    });
    expect(result.text?.inputs.value).toBe("new prompt");
    expect(result.image?.inputs.image).toBe("takeboard/input.png");
    expect(result.sampler?.inputs.seed).toBe(42);
    expect(result.sampler?.inputs.denoise).toBe(0.55);
    expect(result.video?.inputs.duration).toBe(168);
    expect(result.save?.inputs.filename_prefix).toBe("takeboard/project/shot/run/result");
    expect(source.text.inputs.value).toBe("old");
  });

  it("recognizes frame-count controls and suggests a safe FPS conversion", () => {
    const candidates = discoverBindingCandidates({
      video: {
        class_type: "CreateVideo",
        inputs: { num_frames: 81, frame_rate: 24 },
        _meta: { title: "Video length" },
      },
    });
    expect(candidates.parameters.duration).toEqual([
      expect.objectContaining({
        nodeId: "video",
        input: "num_frames",
        suggestedTransform: "seconds_to_frames",
      }),
    ]);
    expect(candidates.parameters.fps).toEqual([
      expect.objectContaining({ nodeId: "video", input: "frame_rate" }),
    ]);
  });

  it("uses a canonical content hash and rejects missing binding targets", () => {
    expect(workflowHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      workflowHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
    const issues = validateWorkflowBinding(
      { save: { class_type: "SaveVideo", inputs: { filename_prefix: "output" } } },
      binding,
    );
    expect(issues).toEqual(
      expect.arrayContaining([expect.stringContaining("节点 text.value 不存在")]),
    );
  });
});
