import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("ComfyUI workflow detection", () => {
  it("turns workflow JSON into a user-facing recipe summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/userdata?dir=workflows")) {
          return Response.json(["Kino/Kino_Wan22_FLF2V.json"]);
        }
        return Response.json({
          nodes: [
            { type: "LoadImage", title: "起始帧", widgets_values: ["start.png"] },
            { type: "LoadImage", title: "结束帧", widgets_values: ["end.png"] },
            {
              type: "WanFirstLastFrameToVideo",
              widgets_values: [480, 848, 81, 1],
            },
            {
              type: "UNETLoader",
              widgets_values: ["wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"],
            },
            { type: "SaveVideo", widgets_values: ["takeboard/output"] },
          ],
        });
      }),
    );
    const app = buildApp({
      comfyUrl: "http://comfy.test",
      comfyEditorUrl: "http://editor.test",
      webRoot: null,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      editorUrl: "http://editor.test",
      workflows: [
        {
          path: "Kino/Kino_Wan22_FLF2V.json",
          capability: "first_last_video",
          capabilityLabel: "首尾帧视频",
          execution: "native",
          inputs: expect.arrayContaining(["prompt", "first_frame", "last_frame"]),
          models: ["wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"],
        },
      ],
    });
  });
});
