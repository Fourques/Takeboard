import { describe, expect, it } from "vitest";
import { bindRecipeInputs, workflowSha256 } from "../src/index.js";

describe("Recipe Contract", () => {
  it("validates a versioned API prompt and only injects declared fields", () => {
    const prompt = {
      text: { class_type: "CLIPTextEncode", inputs: { text: "default", clip: ["clip", 0] } },
      save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "test" } },
    };
    const manifest = {
      schemaVersion: "0.1",
      id: "test-t2i",
      version: "1.0.0",
      name: "Test T2I",
      capability: "text_to_image",
      workflowSha256: workflowSha256(prompt),
      inputs: { prompt: { node: "text", field: "text", type: "text", required: true } },
      outputs: { image: { node: "save", type: "image", required: true } },
      requirements: { nodeClasses: ["CLIPTextEncode", "SaveImage"], models: [] },
    };

    const bound = bindRecipeInputs(manifest, prompt, { prompt: "A silver lighthouse" });
    expect(bound.text?.inputs.text).toBe("A silver lighthouse");
    expect(prompt.text.inputs.text).toBe("default");
  });

  it("rejects a changed workflow hash", () => {
    const prompt = { save: { class_type: "SaveImage", inputs: { filename_prefix: "test" } } };
    expect(() =>
      bindRecipeInputs(
        {
          schemaVersion: "0.1",
          id: "test-t2i",
          version: "1.0.0",
          name: "Test",
          capability: "text_to_image",
          workflowSha256: "a".repeat(64),
          inputs: {},
          outputs: { image: { node: "save", type: "image", required: true } },
          requirements: { nodeClasses: [], models: [] },
        },
        prompt,
        {},
      ),
    ).toThrow(/hash/);
  });
});
