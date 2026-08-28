import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("ComfyUI workflow detection", () => {
  it("requires an explicit, hash-bound mapping before a custom workflow becomes executable", async () => {
    const workflow = {
      nodes: [
        {
          id: 1,
          type: "PromptNode",
          title: "Positive Prompt",
          inputs: [{ name: "text", link: null, widget: { name: "text" } }],
          widgets_values: ["A quiet landscape"],
        },
        {
          id: 2,
          type: "ImageMaker",
          inputs: [
            { name: "prompt", link: 10 },
            { name: "width", link: null, widget: { name: "width" } },
            { name: "height", link: null, widget: { name: "height" } },
          ],
          widgets_values: [512, 512],
        },
        {
          id: 3,
          type: "SaveImage",
          inputs: [
            { name: "images", link: 11 },
            { name: "filename_prefix", link: null, widget: { name: "filename_prefix" } },
          ],
          widgets_values: ["output"],
        },
      ],
      links: [
        [10, 1, 0, 2, 0, "STRING"],
        [11, 2, 0, 3, 0, "IMAGE"],
      ],
    };
    const objectInfo = {
      PromptNode: { input: { required: { text: ["STRING"] } } },
      ImageMaker: {
        input: { required: { prompt: ["STRING"], width: ["INT"], height: ["INT"] } },
      },
      SaveImage: {
        input: {
          required: { images: ["IMAGE"] },
          optional: { filename_prefix: ["STRING"] },
        },
      },
    };
    let savedBinding: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = decodeURIComponent(String(input));
        if (url.includes("/userdata?dir=workflows")) {
          return Response.json(["TakeBoard/custom-t2i.json"]);
        }
        if (url.endsWith("/object_info")) return Response.json(objectInfo);
        if (url.includes("takeboard/bindings/")) {
          if (init?.method === "POST") {
            savedBinding = String(init.body);
            return Response.json({});
          }
          return savedBinding
            ? new Response(savedBinding, { headers: { "content-type": "application/json" } })
            : new Response("missing", { status: 404 });
        }
        return Response.json(workflow);
      }),
    );
    const app = buildApp({ comfyUrl: "http://comfy.test", webRoot: null });
    apps.push(app);

    const before = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(before.json().workflows[0]).toMatchObject({
      execution: "comfy_only",
      bindingStatus: "needs_binding",
    });
    const inspect = await app.inject({
      method: "GET",
      url: "/api/workflows/binding?path=TakeBoard%2Fcustom-t2i.json",
    });
    expect(inspect.statusCode, inspect.body).toBe(200);
    const draft = inspect.json().suggested;
    expect(draft.parameters.prompt).toEqual([{ nodeId: "1", input: "text" }]);

    const enabled = await app.inject({
      method: "PUT",
      url: "/api/workflows/binding?path=TakeBoard%2Fcustom-t2i.json",
      payload: { ...draft, trusted: true },
    });
    expect(enabled.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(after.json().workflows[0]).toMatchObject({
      execution: "bound",
      bindingStatus: "ready",
    });

    const promptNode = workflow.nodes.find((node) => node.type === "PromptNode");
    expect(promptNode).toBeDefined();
    if (promptNode) promptNode.widgets_values = ["Changed after binding"];
    const stale = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(stale.json().workflows[0]).toMatchObject({
      execution: "comfy_only",
      bindingStatus: "stale",
    });
  });

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
          modelStatus: "ready",
          missingModels: [],
        },
      ],
    });
  });

  it("exposes Wan quality and preview as distinct native recipes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/userdata?dir=workflows")) {
          return Response.json(["Kino/Kino_Wan22_I2V.json", "Kino/Kino_Wan22_I2V_Preview.json"]);
        }
        return Response.json({
          nodes: [
            { type: "WanImageToVideo", widgets_values: [480, 848, 81, 1] },
            { type: "KSamplerAdvanced", widgets_values: ["enable", 1, "fixed", 20] },
          ],
        });
      }),
    );
    const app = buildApp({ comfyUrl: "http://comfy.test", webRoot: null });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/workflows" });
    const workflows = response.json().workflows as Array<{
      path: string;
      name: string;
      execution: string;
      inputs: string[];
    }>;
    expect(workflows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "Kino/Kino_Wan22_I2V.json",
          name: "Wan 2.2 I2V · 高质量",
          execution: "native",
          inputs: expect.arrayContaining(["steps"]),
        }),
        expect.objectContaining({
          path: "Kino/Kino_Wan22_I2V_Preview.json",
          name: "Wan 2.2 I2V · 快速预演",
          execution: "native",
        }),
      ]),
    );
    expect(
      workflows.find((workflow) => workflow.path.endsWith("_Preview.json"))?.inputs,
    ).not.toContain("steps");
  });

  it("exposes MiniMax H3's optional last-frame control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/userdata?dir=workflows")) {
          return Response.json(["Kino/Kino_MinimaxH3_I2V.json"]);
        }
        return Response.json({
          nodes: [
            { type: "LoadImage", widgets_values: ["start.png"] },
            { type: "MiniMaxH3ImageToVideo", widgets_values: [] },
            { type: "SaveVideo", widgets_values: ["video/MiniMax_H3"] },
          ],
        });
      }),
    );
    const app = buildApp({ comfyUrl: "http://comfy.test", webRoot: null });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(response.json().workflows[0]).toMatchObject({
      path: "Kino/Kino_MinimaxH3_I2V.json",
      name: "MiniMax H3 I2V · 原生音画",
      inputs: expect.arrayContaining(["first_frame", "last_frame"]),
      mediaInputs: { first_frame: 1, last_frame: 1 },
      execution: "native",
    });
  });

  it("exposes MiniMax H3 Ref2VA as a native multimodal workflow", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/userdata?dir=workflows")) {
          return Response.json(["Kino/Kino_MinimaxH3_R2V.json"]);
        }
        return Response.json({
          nodes: [
            {
              type: "UNETLoader",
              widgets_values: ["minimax_h3_ref2va_pruned_int8_convrot.safetensors", "default"],
            },
            { type: "MiniMaxH3ReferenceToVideo", widgets_values: [] },
            { type: "SaveVideo", widgets_values: ["video/MiniMax_H3"] },
          ],
        });
      }),
    );
    const app = buildApp({ comfyUrl: "http://comfy.test", webRoot: null });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(response.json().workflows[0]).toMatchObject({
      path: "Kino/Kino_MinimaxH3_R2V.json",
      name: "MiniMax H3 Ref2VA · 多模态参考",
      capability: "reference_video",
      inputs: expect.arrayContaining(["reference_images", "reference_videos", "reference_audio"]),
      mediaInputs: { reference: 9, reference_video: 3, reference_audio: 3 },
      execution: "native",
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
