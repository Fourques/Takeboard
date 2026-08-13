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

  it("prefers an explicit filename over generic helper nodes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/userdata?dir=workflows")) {
          return Response.json(["Kino/Kino_MinimaxH3_T2V.json", "Kino/Kino_LTX23_I2V.json"]);
        }
        return Response.json({
          nodes: [
            { type: "ReferenceVideoConditioning", widgets_values: [] },
            { type: "TextToVideoConditioning", widgets_values: [] },
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
    const payload = response.json() as {
      workflows: Array<{ path: string; capability: string }>;
    };
    expect(payload.workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "Kino/Kino_MinimaxH3_T2V.json",
          capability: "text_to_video",
        }),
        expect.objectContaining({
          path: "Kino/Kino_LTX23_I2V.json",
          capability: "image_to_video",
        }),
      ]),
    );
  });

  it("keeps healthy workflows when one JSON cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = decodeURIComponent(String(input));
        if (url.includes("/userdata?dir=workflows")) {
          return Response.json(["Kino/healthy_I2V.json", "Kino/broken_T2V.json"]);
        }
        if (url.includes("broken_T2V.json")) return new Response("broken", { status: 500 });
        return Response.json({ nodes: [{ type: "WanImageToVideo", widgets_values: [] }] });
      }),
    );
    const app = buildApp({ comfyUrl: "http://comfy.test", webRoot: null });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workflows: [expect.objectContaining({ path: "Kino/healthy_I2V.json" })],
      warnings: [expect.stringContaining("broken_T2V.json")],
    });
  });
});
