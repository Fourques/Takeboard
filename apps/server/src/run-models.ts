import type { ComfyPrompt } from "@takeboard/executor-comfy";

/** Record literal weight files from the submitted graph, never the picker defaults.
 * Custom loaders without a recognizable weight input remain unreported. */
export function submittedModelFiles(prompt: ComfyPrompt): string[] {
  const files = new Set<string>();
  for (const node of Object.values(prompt)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (
        /(?:ckpt|model|unet|vae|clip|lora|encoder|checkpoint|diffusion)/i.test(key) &&
        typeof value === "string" &&
        /\.(?:safetensors|ckpt|pt|pth|bin|gguf)$/i.test(value)
      )
        files.add(value);
    }
  }
  return [...files];
}
