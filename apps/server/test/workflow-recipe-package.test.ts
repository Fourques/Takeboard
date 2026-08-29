import { describe, expect, it } from "vitest";
import { workflowHash } from "../src/workflow-bindings.js";
import {
  createWorkflowRecipeArchive,
  parseWorkflowRecipeArchive,
} from "../src/workflow-recipe-package.js";

async function streamBytes(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("portable Workflow Recipe package", () => {
  it("round-trips a workflow, binding, dependency manifest and integrity hashes", async () => {
    const workflow = {
      "1": { class_type: "PromptNode", inputs: { text: "morning fog" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const hash = workflowHash(workflow);
    const binding = {
      version: 1,
      workflowPath: "TakeBoard/fog.json",
      workflowHash: hash,
      capability: "text_to_image",
      outputMediaType: "image",
      parameters: { prompt: [{ nodeId: "1", input: "text" }] },
      media: {},
      trusted: true,
      verifiedAt: "2026-08-30T00:00:00.000Z",
    };
    const bytes = await streamBytes(
      createWorkflowRecipeArchive({
        name: "Fog Study",
        sourcePath: "TakeBoard/fog.json",
        workflowHash: hash,
        capability: "text_to_image",
        outputMediaType: "image",
        models: ["model.safetensors", "model.safetensors"],
        nodeTypes: ["SaveImage", "PromptNode", "SaveImage"],
        workflow,
        binding,
      }),
    );
    const parsed = await parseWorkflowRecipeArchive(bytes);
    expect(parsed).toMatchObject({
      manifest: {
        format: "takeboard.workflow-recipe",
        version: 1,
        workflowHash: hash,
        bindingIncluded: true,
        dependencies: {
          models: ["model.safetensors"],
          nodeTypes: ["PromptNode", "SaveImage"],
        },
      },
      workflow,
      binding,
    });
    await expect(
      parseWorkflowRecipeArchive(Buffer.concat([bytes.subarray(0, 20), Buffer.from("broken")])),
    ).rejects.toThrow("不是有效的 .tgz");
  });
});
