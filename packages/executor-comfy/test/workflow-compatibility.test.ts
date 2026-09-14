import { describe, expect, it } from "vitest";
import {
  type ComfyObjectInfo,
  convertUiWorkflowToPrompt,
  inspectPromptInputs,
  type UiWorkflow,
} from "../src/index.js";

const objectInfo: ComfyObjectInfo = {
  SaveVideo: {
    input: {
      required: {
        codec: [["auto", "h264"], { default: "auto" }],
        ref_image_size: ["INT", { default: 512, min: 64, max: 2048 }],
        values: ["COMFY_AUTOGROW_V3", {}],
      },
    },
  },
  Source: { input: { required: {} } },
};

describe("workflow compatibility", () => {
  it("follows real Autogrow minimum names, optional groups and zero-input templates", () => {
    const info = (minimum: number, group = "required"): ComfyObjectInfo => ({
      Dynamic: {
        input: {
          required: {
            values: [
              "COMFY_AUTOGROW_V3",
              {
                template: {
                  names: ["a", "b", "c"],
                  min: minimum,
                  input: { [group]: { value: ["*"] } },
                },
              },
            ],
            width: ["INT"],
          },
        },
      },
    });
    const prompt = (inputs: Record<string, unknown>) => ({
      "1": { class_type: "Dynamic", inputs },
    });
    expect(inspectPromptInputs(prompt({ width: 1 }), info(0))).toEqual([]);
    expect(inspectPromptInputs(prompt({ width: 1 }), info(2, "optional"))).toEqual([]);
    expect(inspectPromptInputs(prompt({ width: 1, "values.b": 2 }), info(1))).toEqual([
      expect.objectContaining({ field: "values.a", kind: "missing_input" }),
    ]);
    expect(inspectPromptInputs(prompt({ width: 1, "values.a": 2 }), info(1))).toEqual([]);
    expect(inspectPromptInputs(prompt({ "width.fake": 1 }), info(0))).toEqual([
      expect.objectContaining({ field: "width", kind: "missing_input" }),
    ]);
    const prefix = {
      Dynamic: {
        input: {
          required: {
            values: [
              "COMFY_AUTOGROW_V3",
              {
                template: {
                  prefix: "value",
                  min: 2,
                  max: 10,
                  input: { required: { value: ["*"] } },
                },
              },
            ],
          },
        },
      },
    };
    expect(inspectPromptInputs(prompt({ "values.value0": 1 }), prefix)).toContainEqual(
      expect.objectContaining({ field: "values.value1" }),
    );
  });
  it("uses the same dynamic-input checks as execution without accepting dangling links", () => {
    const prompt = {
      source: { class_type: "Source", inputs: {} },
      save: {
        class_type: "SaveVideo",
        inputs: { codec: "auto", ref_image_size: 512, "values.image": ["source", 0] },
      },
    };
    expect(inspectPromptInputs(prompt, objectInfo)).toEqual([]);
    expect(inspectPromptInputs({ save: prompt.save }, objectInfo)).toEqual([
      expect.objectContaining({ kind: "missing_origin", field: "values.image" }),
    ]);
    expect(
      inspectPromptInputs(
        { save: { ...prompt.save, inputs: { codec: "auto", ref_image_size: 512, "values.": 0 } } },
        objectInfo,
      ),
    ).toContainEqual(expect.objectContaining({ kind: "missing_input", field: "values" }));
  });

  it("fills only explicit safe defaults in UI conversion and preserves the original document", () => {
    const workflow: UiWorkflow = {
      nodes: [{ id: 92, type: "SaveVideo", inputs: [], widgets_values: [] }],
      links: [],
    };
    const before = structuredClone(workflow);
    const prompt = convertUiWorkflowToPrompt(workflow, objectInfo);
    expect(prompt["92"]?.inputs).toEqual({ codec: "auto", ref_image_size: 512 });
    expect(inspectPromptInputs(prompt, objectInfo)).toEqual([
      expect.objectContaining({ field: "values" }),
    ]);
    expect(workflow).toEqual(before);
    // An API prompt already represents the author's complete execution intent.
    expect(
      convertUiWorkflowToPrompt({ "92": { class_type: "SaveVideo", inputs: {} } }, objectInfo)["92"]
        ?.inputs,
    ).toEqual({});
  });

  it("never replaces a disconnected input, selected value, model, or text with defaults", () => {
    const prompt = convertUiWorkflowToPrompt(
      {
        nodes: [
          {
            id: 1,
            type: "SaveVideo",
            inputs: [
              { name: "codec", widget: { name: "codec" } },
              { name: "ref_image_size", link: 999, widget: { name: "ref_image_size" } },
            ],
            widgets_values: ["h264", 768],
          },
        ],
        links: [],
      },
      {
        SaveVideo: {
          input: {
            required: {
              ...objectInfo.SaveVideo?.input?.required,
              prompt: ["STRING", { default: "invented" }],
              model: [["a.safetensors"], { default: "a.safetensors" }],
              forced: ["INT", { default: 3, forceInput: true }],
              invalid: ["INT", { default: 4000, max: 2048 }],
            },
          },
        },
      },
    );
    expect(prompt["1"]?.inputs).toEqual({ codec: "h264" });
  });

  it("recovers named values by name, not object property order", () => {
    const prompt = convertUiWorkflowToPrompt(
      {
        nodes: [
          { id: 1, type: "SaveVideo", widgets_values: { ref_image_size: 768, codec: "h264" } },
        ],
        links: [],
      },
      objectInfo,
    );
    expect(prompt["1"]?.inputs).toEqual({ codec: "h264", ref_image_size: 768 });
    const partial = convertUiWorkflowToPrompt(
      {
        nodes: [{ id: 1, type: "SaveVideo", widgets_values: { ref_image_size: 768 } }],
        links: [],
      },
      objectInfo,
    );
    expect(partial["1"]?.inputs).toEqual({ codec: "auto", ref_image_size: 768 });
  });

  it("applies compatibility rules inside a subgraph too", () => {
    const prompt = convertUiWorkflowToPrompt(
      {
        nodes: [{ id: 1, type: "sub" }],
        links: [],
        definitions: {
          subgraphs: [
            {
              id: "sub",
              nodes: [{ id: 92, type: "SaveVideo" }],
              links: [],
              inputs: [],
              outputs: [],
            },
          ],
        },
      },
      objectInfo,
    );
    expect(prompt.node_sg_1_92?.inputs).toEqual({ codec: "auto", ref_image_size: 512 });
  });
  it("does not hide ambiguous leftover widget values behind a new default", () => {
    const prompt = convertUiWorkflowToPrompt(
      {
        nodes: [
          {
            id: 1,
            type: "SaveVideo",
            inputs: [{ name: "ref_image_size", widget: { name: "ref_image_size" } }],
            widgets_values: [768, "h264"],
          },
        ],
        links: [],
      },
      objectInfo,
    );
    expect(prompt["1"]?.inputs).toEqual({ ref_image_size: 768 });
    expect(inspectPromptInputs(prompt, objectInfo)).toContainEqual(
      expect.objectContaining({ field: "codec" }),
    );
  });
});
