import {
  buildMiniMaxH3Prompt,
  buildMiniMaxH3ReferencePrompt,
  buildQwenImage2512Prompt,
  buildWan22FirstLastPrompt,
  buildWan22I2VPrompt,
  type ComfyPrompt,
} from "./index.js";

/** One artifact source: recommended downloads and native execution use these builders.
 * LTX is intentionally excluded: its adapter still requires an external source graph.
 */
export const nativeRecipes = [
  {
    id: "h3-t2v",
    filename: "Kino_MinimaxH3_T2V.json",
    name: "MiniMax H3 · 文生视频",
    capability: "text_to_video",
  },
  {
    id: "h3-i2v",
    filename: "Kino_MinimaxH3_I2V.json",
    name: "MiniMax H3 · 图生视频",
    capability: "image_to_video",
  },
  {
    id: "h3-reference",
    filename: "Kino_MinimaxH3_R2V.json",
    name: "MiniMax H3 · 多素材参考",
    capability: "reference_video",
  },
  {
    id: "qwen-t2i",
    filename: "Kino_QwenImage2512_T2I.json",
    name: "Qwen Image · 文生图",
    capability: "text_to_image",
  },
  {
    id: "qwen-i2i",
    filename: "Kino_QwenImage2512_I2I.json",
    name: "Qwen Image · 图生图",
    capability: "image_to_image",
  },
  {
    id: "wan-i2v",
    filename: "Kino_Wan22_I2V.json",
    name: "Wan 2.2 · 图生视频",
    capability: "image_to_video",
  },
  {
    id: "wan-flf",
    filename: "Kino_Wan22_FLF2V.json",
    name: "Wan 2.2 · 首尾帧",
    capability: "first_last_video",
  },
  {
    id: "wan-i2v-preview",
    filename: "Kino_Wan22_I2V_Preview.json",
    name: "Wan 2.2 · 图生视频预览",
    capability: "image_to_video",
  },
  {
    id: "wan-flf-preview",
    filename: "Kino_Wan22_FLF2V_Preview.json",
    name: "Wan 2.2 · 首尾帧预览",
    capability: "first_last_video",
  },
] as const;

export function nativeRecipeForPath(path: string) {
  return path.startsWith("Kino/")
    ? nativeRecipes.find((recipe) => path.endsWith(`/${recipe.filename}`))
    : undefined;
}

/** Structural probe, never submitted: media are explicit placeholders replaced at generation. */
export function nativeRecipePrompt(path: string): ComfyPrompt | null {
  const recipe = nativeRecipeForPath(path);
  if (!recipe) return null;
  const shared = {
    positivePrompt: "Describe your shot",
    width: 848,
    height: 480,
    durationSeconds: 5,
    fps: 24,
    seed: 1,
    steps: 20,
    filenamePrefix: "takeboard/output",
  };
  switch (recipe.id) {
    case "h3-t2v":
      return buildMiniMaxH3Prompt(shared);
    case "h3-i2v":
      return buildMiniMaxH3Prompt({
        ...shared,
        firstImage: "first-frame.png",
        lastImage: "last-frame.png",
      });
    case "h3-reference":
      return buildMiniMaxH3ReferencePrompt({
        ...shared,
        referenceImages: ["reference.png"],
        referenceVideos: ["reference.mp4"],
        referenceAudios: ["reference.wav"],
        referenceVideoAudio: false,
      });
    case "qwen-t2i":
      return buildQwenImage2512Prompt({ ...shared, width: 1664, height: 928, steps: 50 });
    case "qwen-i2i":
      return buildQwenImage2512Prompt({
        ...shared,
        width: 1664,
        height: 928,
        image: "first-frame.png",
        steps: 4,
        denoise: 0.65,
      });
    case "wan-i2v":
    case "wan-i2v-preview":
      return buildWan22I2VPrompt({
        ...shared,
        image: "first-frame.png",
        qualityProfile: recipe.id.endsWith("preview") ? "preview" : "quality",
      });
    case "wan-flf":
    case "wan-flf-preview":
      return buildWan22FirstLastPrompt({
        ...shared,
        image: "first-frame.png",
        lastImage: "last-frame.png",
        qualityProfile: recipe.id.endsWith("preview") ? "preview" : "quality",
      });
  }
}
