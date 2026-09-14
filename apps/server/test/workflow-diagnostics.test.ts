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
  it("blocks incompatible actual native prompts and invalid model loader choices", () => {
    const input = {
      path: "Kino/Test_T2I.json",
      workflowHash: "d".repeat(64),
      prompt,
      objectInfo,
      capability: "text_to_image" as const,
      outputMediaType: "image" as const,
      bindingStatus: "built_in" as const,
      executionSource: "native_prompt" as const,
      binding: null,
      models: [],
      inventory: new Set<string>(),
    };
    const changed = buildWorkflowDiagnostic({
      ...input,
      objectInfo: {
        ...objectInfo,
        SaveImage: { input: { required: { images: ["IMAGE"], new_required: ["STRING"] } } },
      },
    });
    expect(changed.executable).toBe(false);
    expect(changed.checks).toContainEqual(
      expect.objectContaining({
        code: "TAKEBOARD_NATIVE_TEMPLATE_INCOMPATIBLE",
        status: "blocked",
      }),
    );
    const wrongFolder = buildWorkflowDiagnostic({
      ...input,
      prompt: { ...prompt, "3": { class_type: "Loader", inputs: { model: "model.safetensors" } } },
      objectInfo: {
        ...objectInfo,
        Loader: { input: { required: { model: [["other.safetensors"]] } } },
      },
      models: ["model.safetensors"],
      inventory: new Set(["model.safetensors"]),
    });
    expect(wrongFolder).toMatchObject({
      executable: false,
      modelStatus: "missing",
      missingModels: ["model.safetensors"],
    });
  });
  it("does not claim executable when model inventory could not be read", () => {
    const diagnostic = buildWorkflowDiagnostic({
      path: "Kino/Test_T2I.json",
      workflowHash: "d".repeat(64),
      prompt,
      objectInfo,
      capability: "text_to_image",
      outputMediaType: "image",
      bindingStatus: "built_in",
      binding: null,
      models: ["model.safetensors"],
      inventory: null,
    });
    expect(diagnostic.executable).toBe(false);
  });

  it("accepts real dynamic inputs but blocks a lost source in custom workflows", () => {
    const custom = {
      ...prompt,
      "3": { class_type: "Dynamic", inputs: { "values.image": ["1", 0] } },
    };
    const input = {
      path: "TakeBoard/custom.json",
      workflowHash: "e".repeat(64),
      prompt: custom,
      objectInfo: {
        ...objectInfo,
        Dynamic: { input: { required: { values: ["COMFY_AUTOGROW_V3"] } } },
      },
      capability: "text_to_image" as const,
      outputMediaType: "image" as const,
      bindingStatus: "ready" as const,
      binding: {
        version: 1 as const,
        workflowPath: "TakeBoard/custom.json",
        workflowHash: "e".repeat(64),
        capability: "text_to_image" as const,
        outputMediaType: "image" as const,
        trusted: true as const,
        verifiedAt: "2026-09-14T00:00:00.000Z",
        parameters: { prompt: [{ nodeId: "1", input: "text" }] },
        media: {},
      },
      models: [],
      inventory: new Set<string>(),
    };
    expect(buildWorkflowDiagnostic(input).executable).toBe(true);
    expect(
      buildWorkflowDiagnostic({
        ...input,
        prompt: { ...custom, "3": { ...custom["3"], inputs: { "values.image": ["missing", 0] } } },
      }).executable,
    ).toBe(false);
  });
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
