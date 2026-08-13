import { createHash } from "node:crypto";
import { z } from "zod";

const slotTypeSchema = z.enum(["text", "integer", "number", "boolean", "image", "video", "audio"]);

export const recipeBindingSchema = z.object({
  node: z.string().min(1),
  field: z.string().min(1),
  type: slotTypeSchema,
  required: z.boolean().default(false),
});

export const recipeManifestSchema = z.object({
  schemaVersion: z.literal("0.1"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().trim().min(1).max(200),
  capability: z.enum([
    "text_to_image",
    "image_to_image",
    "text_to_video",
    "image_to_video",
    "first_last_video",
    "reference_video",
  ]),
  workflowSha256: z.string().regex(/^[a-f0-9]{64}$/),
  inputs: z.record(z.string().min(1), recipeBindingSchema),
  outputs: z.record(
    z.string().min(1),
    z.object({
      node: z.string().min(1),
      type: z.enum(["image", "video", "audio"]),
      required: z.boolean(),
    }),
  ),
  requirements: z.object({
    nodeClasses: z.array(z.string().min(1)),
    models: z.array(z.string().min(1)),
  }),
});

export type RecipeManifest = z.infer<typeof recipeManifestSchema>;
export type ApiPromptNode = { class_type: string; inputs: Record<string, unknown> };
export type ApiPrompt = Record<string, ApiPromptNode>;

export function workflowSha256(prompt: ApiPrompt) {
  return createHash("sha256").update(JSON.stringify(prompt)).digest("hex");
}

export function validateRecipePrompt(manifestInput: unknown, prompt: ApiPrompt) {
  const manifest = recipeManifestSchema.parse(manifestInput);
  if (workflowSha256(prompt) !== manifest.workflowSha256) {
    throw new Error("Recipe Workflow hash does not match its manifest");
  }
  for (const [slot, binding] of Object.entries(manifest.inputs)) {
    const node = prompt[binding.node];
    if (!node) throw new Error(`Recipe input ${slot} references missing node ${binding.node}`);
    if (!(binding.field in node.inputs)) {
      throw new Error(`Recipe input ${slot} references missing field ${binding.field}`);
    }
  }
  for (const [output, binding] of Object.entries(manifest.outputs)) {
    if (!prompt[binding.node]) {
      throw new Error(`Recipe output ${output} references missing node ${binding.node}`);
    }
  }
  return manifest;
}

function valueMatches(type: z.infer<typeof slotTypeSchema>, value: unknown) {
  if (["text", "image", "video", "audio"].includes(type)) return typeof value === "string";
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "boolean";
}

export function bindRecipeInputs(
  manifestInput: unknown,
  prompt: ApiPrompt,
  values: Record<string, unknown>,
) {
  const manifest = validateRecipePrompt(manifestInput, prompt);
  const copy = structuredClone(prompt);
  for (const [slot, binding] of Object.entries(manifest.inputs)) {
    const value = values[slot];
    if (value === undefined || value === null || value === "") {
      if (binding.required) throw new Error(`Recipe input ${slot} is required`);
      continue;
    }
    if (!valueMatches(binding.type, value)) {
      throw new Error(`Recipe input ${slot} must be ${binding.type}`);
    }
    const node = copy[binding.node];
    if (!node) throw new Error(`Recipe input ${slot} references missing node ${binding.node}`);
    node.inputs[binding.field] = value;
  }
  return copy;
}
