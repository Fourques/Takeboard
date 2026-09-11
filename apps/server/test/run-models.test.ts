import { describe, expect, it } from "vitest";
import { submittedModelFiles } from "../src/run-models.js";

describe("generation model provenance", () => {
  it("records actual literal model inputs without confusing links or prompt text", () => {
    expect(
      submittedModelFiles({
        "1": { class_type: "UNETLoader", inputs: { unet_name: "h3/model.safetensors" } },
        "2": { class_type: "LoraLoader", inputs: { model: ["1", 0], lora_name: "detail.gguf" } },
        "3": { class_type: "TextEncode", inputs: { text: "example.ckpt" } },
        "4": { class_type: "UNETLoader", inputs: { unet_name: "h3/model.safetensors" } },
      }),
    ).toEqual(["h3/model.safetensors", "detail.gguf"]);
    expect(submittedModelFiles({})).toEqual([]);
  });
});
