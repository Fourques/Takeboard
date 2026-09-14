import { describe, expect, it } from "vitest";
import { generationPromptPlaceholder } from "./generation-model";

describe("task-specific prompt guidance", () => {
  it("keeps image tasks free of timeline and audio instructions", () => {
    expect(generationPromptPlaceholder("qwen_image", "text_to_image")).toContain("构图");
    expect(generationPromptPlaceholder("qwen_image", "image_to_image", true)).toContain(
      "要改变的部分",
    );
    expect(generationPromptPlaceholder("qwen_image", "image_to_image", true)).not.toContain("秒");
  });
  it("provides reference syntax or H3 timeline guidance in the input itself", () => {
    expect(generationPromptPlaceholder("minimax_h3", "reference_video", true)).toContain("@素材名");
    expect(generationPromptPlaceholder("minimax_h3", "text_to_video")).toContain("[0–2秒]");
    expect(generationPromptPlaceholder("wan22", "image_to_video", true)).toContain("已连接素材");
  });
});
