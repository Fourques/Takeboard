import type { ComfyObjectInfo, ComfyPrompt } from "@takeboard/executor-comfy";
import { describe, expect, it } from "vitest";
import { buildWorkflowDiagnostic } from "../src/workflow-diagnostics.js";

const prompt: ComfyPrompt = {
  "1": {
    class_type: "CLIPTextEncode",
    inputs: { text: "a quiet harbor" },
  },
  "2": {
    class_type: "SaveImage",
    inputs: { images: ["1", 0], filename_prefix: "TakeBoard" },
  },
};

const objectInfo = {
  CLIPTextEncode: { input: { required: { text: ["STRING", {}] } } },
  SaveImage: { input: { required: { images: ["IMAGE", {}] } } },
} as unknown as ComfyObjectInfo;

describe("workflow diagnostics", () => {
  it("returns stable, structured checks for an executable native workflow", () => {
    const diagnostic = buildWorkflowDiagnostic({
      path: "Kino/Test_T2I.json",
      workflowHash: "a".repeat(64),
      prompt,
      objectInfo,
      capability: "text_to_image",
      outputMediaType: "image",
      bindingStatus: "built_in",
      binding: null,
      models: [],
      inventory: new Set(),
    });
    expect(diagnostic).toMatchObject({
      path: "Kino/Test_T2I.json",
      executable: true,
      health: "attention",
      missingNodeTypes: [],
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "conversion.prompt", status: "pass" }),
        expect.objectContaining({ id: "nodes.available", status: "pass" }),
        expect.objectContaining({ id: "binding.execution", status: "pass" }),
        expect.objectContaining({ id: "output.detected", status: "pass" }),
      ]),
    });
  });

  it("does not block a native adapter on source-canvas inputs or output node naming", () => {
    const diagnostic = buildWorkflowDiagnostic({
      path: "Kino/Test_I2V.json",
      workflowHash: "c".repeat(64),
      prompt: {
        "1": {
          class_type: "CLIPTextEncode",
          inputs: {},
        },
      },
      objectInfo,
      capability: "image_to_video",
      outputMediaType: "video",
      bindingStatus: "built_in",
      binding: null,
      models: [],
      inventory: new Set(),
    });

    expect(diagnostic).toMatchObject({
      executable: true,
      health: "attention",
      checks: expect.arrayContaining([
        expect.objectContaining({
          code: "SOURCE_WORKFLOW_INPUTS_DIFFER",
          status: "warning",
        }),
        expect.objectContaining({
          code: "TAKEBOARD_NATIVE_OUTPUT",
          status: "pass",
        }),
      ]),
    });
  });

  it("blocks execution with actionable missing-node and binding checks", () => {
    const diagnostic = buildWorkflowDiagnostic({
      path: "TakeBoard/Custom.json",
      workflowHash: "b".repeat(64),
      prompt: {
        ...prompt,
        "9": { class_type: "UnknownVideoNode", inputs: {} },
      },
      objectInfo,
      capability: "image_to_video",
      outputMediaType: "video",
      bindingStatus: "needs_binding",
      binding: null,
      models: ["missing-model.safetensors"],
      inventory: new Set(["another-model.safetensors"]),
    });
    expect(diagnostic).toMatchObject({
      executable: false,
      health: "blocked",
      modelStatus: "missing",
      missingModels: ["missing-model.safetensors"],
      missingNodeTypes: ["UnknownVideoNode"],
    });
    expect(diagnostic.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "COMFY_NODE_TYPES_MISSING",
          status: "blocked",
          remediation: expect.stringContaining("安装"),
          nodeIds: ["9"],
        }),
        expect.objectContaining({ code: "TAKEBOARD_BINDING_REQUIRED", status: "blocked" }),
        expect.objectContaining({ code: "WORKFLOW_OUTPUT_MISSING", status: "blocked" }),
      ]),
    );
  });
});
