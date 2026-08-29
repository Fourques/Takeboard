import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { discoverBindingCandidates, workflowHash } from "../src/workflow-bindings.js";

const apps: ReturnType<typeof buildApp>[] = [];
const directories: string[] = [];

function multipartFile(filename: string, mimeType: string, bytes: Uint8Array) {
  const boundary = "----takeboard-workflow-package";
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ComfyUI workflow detection", () => {
  it("exports and safely imports a portable Recipe without inheriting execution trust", async () => {
    const sourcePath = "TakeBoard/custom-t2i.json";
    const workflow = {
      "1": {
        class_type: "PromptNode",
        inputs: { text: "A quiet harbor" },
        _meta: { title: "Positive Prompt" },
      },
      "2": {
        class_type: "SaveImage",
        inputs: { images: ["1", 0], filename_prefix: "output" },
      },
    };
    const hash = workflowHash(workflow);
    const binding = {
      version: 1,
      workflowPath: sourcePath,
      workflowHash: hash,
      capability: "text_to_image",
      outputMediaType: "image",
      parameters: { prompt: [{ nodeId: "1", input: "text" }] },
      media: {},
      trusted: true,
      verifiedAt: "2026-08-30T00:00:00.000Z",
    };
    const bindingPath = `takeboard/bindings/${Buffer.from(sourcePath).toString("base64url")}.json`;
    const documents = new Map<string, unknown>([
      [`workflows/${sourcePath}`, workflow],
      [bindingPath, binding],
    ]);
    const objectInfo = {
      PromptNode: { input: { required: { text: ["STRING"] } } },
      SaveImage: {
        input: {
          required: { images: ["IMAGE"] },
          optional: { filename_prefix: ["STRING"] },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = decodeURIComponent(String(input));
        if (url.endsWith("/object_info")) return Response.json(objectInfo);
        const marker = "/api/userdata/";
        const markerIndex = url.indexOf(marker);
        if (markerIndex >= 0) {
          const path = url.slice(markerIndex + marker.length);
          if (init?.method === "POST") {
            documents.set(path, JSON.parse(String(init.body)));
            return Response.json({});
          }
          const document = documents.get(path);
          return document === undefined
            ? new Response("missing", { status: 404 })
            : Response.json(document);
        }
        throw new Error(`Unexpected ComfyUI request: ${url}`);
      }),
    );
    const app = buildApp({ comfyUrl: "http://comfy.test", webRoot: null });
    apps.push(app);

    const exported = await app.inject({
      method: "GET",
      url: `/api/workflows/recipe-package?path=${encodeURIComponent(sourcePath)}`,
    });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers["content-type"]).toContain("application/gzip");
    expect(exported.headers["content-disposition"]).toContain("takeboard-recipe.tgz");

    const imported = await app.inject({
      method: "POST",
      url: "/api/workflows/recipe-package/import",
      ...multipartFile("portable.takeboard-recipe.tgz", "application/gzip", exported.rawPayload),
    });
    expect(imported.statusCode, imported.body).toBe(201);
    expect(imported.json()).toMatchObject({
      imported: true,
      execution: "comfy_only",
      bindingStatus: "needs_binding",
      bindingProposal: "recipe_package",
      recipePackage: {
        sourcePath,
        bindingProposalIncluded: true,
        trustRequired: true,
      },
      binding: {
        capability: "text_to_image",
        parameters: { prompt: [{ nodeId: "1", input: "text" }] },
      },
    });
    const destination = imported.json().path as string;
    const activeBindingPath = `takeboard/bindings/${Buffer.from(destination).toString("base64url")}.json`;
    const proposalPath = `takeboard/binding-proposals/${Buffer.from(destination).toString("base64url")}.json`;
    expect(documents.has(`workflows/${destination}`)).toBe(true);
    expect(documents.has(proposalPath)).toBe(true);
    expect(documents.has(activeBindingPath)).toBe(false);

    const trusted = await app.inject({
      method: "PUT",
      url: `/api/workflows/binding?path=${encodeURIComponent(destination)}`,
      payload: { ...imported.json().binding, trusted: true },
    });
    expect(trusted.statusCode, trusted.body).toBe(200);
    expect(documents.has(activeBindingPath)).toBe(true);
  });

  it("imports plain JSON into diagnosis without granting execution or binding it implicitly", async () => {
    const workflow = {
      "1": {
        class_type: "PromptNode",
        inputs: { text: "A quiet harbor" },
        _meta: { title: "Positive Prompt" },
      },
      "2": {
        class_type: "SaveImage",
        inputs: { images: ["1", 0], filename_prefix: "output" },
      },
    };
    const documents = new Map<string, unknown>();
    const objectInfo = {
      PromptNode: { input: { required: { text: ["STRING"] } } },
      SaveImage: {
        input: {
          required: { images: ["IMAGE"] },
          optional: { filename_prefix: ["STRING"] },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = decodeURIComponent(String(input));
        if (url.endsWith("/object_info")) return Response.json(objectInfo);
        const marker = "/api/userdata/";
        const markerIndex = url.indexOf(marker);
        if (markerIndex < 0) throw new Error(`Unexpected ComfyUI request: ${url}`);
        const path = url.slice(markerIndex + marker.length);
        if (init?.method === "POST") {
          documents.set(path, JSON.parse(String(init.body)));
          return Response.json({});
        }
        const document = documents.get(path);
        return document === undefined
          ? new Response("missing", { status: 404 })
          : Response.json(document);
      }),
    );
    const app = buildApp({ comfyUrl: "http://comfy.test", webRoot: null });
    apps.push(app);

    const imported = await app.inject({
      method: "POST",
      url: "/api/workflows/import",
      ...multipartFile(
        "custom-image.json",
        "application/json",
        Buffer.from(JSON.stringify(workflow)),
      ),
    });
    expect(imported.statusCode, imported.body).toBe(201);
    expect(imported.json()).toMatchObject({
      imported: true,
      execution: "comfy_only",
      bindingStatus: "needs_binding",
      candidates: {
        parameters: { prompt: [expect.objectContaining({ nodeId: "1", input: "text" })] },
      },
      diagnostic: { executable: false },
    });
    const destination = imported.json().path as string;
    expect(documents.has(`workflows/${destination}`)).toBe(true);
    expect(
      documents.has(`takeboard/bindings/${Buffer.from(destination).toString("base64url")}.json`),
    ).toBe(false);
  });

  it("blocks referenced workflows, then archives and restores unreferenced imports", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-workflow-archive-"));
    directories.push(root);
    let paths = ["TakeBoard/custom-t2i.json"];
    const workflow = {
      nodes: [{ id: 1, type: "SaveImage", widgets_values: ["output"] }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = decodeURIComponent(String(input));
        if (url.includes("/userdata?dir=workflows")) return Response.json(paths);
        if (url.endsWith("/object_info")) return Response.json({ SaveImage: {} });
        if (url.includes("/move/")) {
          expect(init?.method).toBe("POST");
          const [, source = "", destination = ""] =
            /\/userdata\/workflows\/(.+)\/move\/workflows\/(.+)\?overwrite=false/.exec(url) ?? [];
          paths = paths.filter((path) => path !== source);
          paths.push(destination);
          return Response.json({});
        }
        if (url.includes("takeboard/bindings/")) return new Response("missing", { status: 404 });
        return Response.json(workflow);
      }),
    );
    const app = buildApp({ projectsRoot: root, comfyUrl: "http://comfy.test", webRoot: null });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "引用检查" },
    });
    const key = created.json().key as string;
    const shot = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: { type: "canvas.create_shot", label: "引用镜头" },
        requestId: "test:workflow-archive-shot:1",
      },
    });
    await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: {
          type: "canvas.edit_item",
          itemId: shot.json().itemId,
          workflowPath: "TakeBoard/custom-t2i.json",
        },
        requestId: "test:workflow-archive-bind:1",
      },
    });
    const blockedPreview = await app.inject({
      method: "GET",
      url: "/api/workflows/archive-preview?path=TakeBoard%2Fcustom-t2i.json",
    });
    expect(blockedPreview.statusCode, blockedPreview.body).toBe(200);
    expect(blockedPreview.json()).toMatchObject({
      blocked: true,
      references: [expect.objectContaining({ projectTitle: "引用检查", shotLabels: ["引用镜头"] })],
    });
    const blockedArchive = await app.inject({
      method: "POST",
      url: "/api/workflows/archive",
      payload: {
        path: "TakeBoard/custom-t2i.json",
        confirmationToken: blockedPreview.json().confirmationToken,
      },
    });
    expect(blockedArchive.statusCode).toBe(409);

    await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: {
          type: "canvas.edit_item",
          itemId: shot.json().itemId,
          workflowPath: "TakeBoard/replacement.json",
        },
        requestId: "test:workflow-archive-unbind:1",
      },
    });
    const safePreview = await app.inject({
      method: "GET",
      url: "/api/workflows/archive-preview?path=TakeBoard%2Fcustom-t2i.json",
    });
    expect(safePreview.json()).toMatchObject({ blocked: false, references: [] });
    const archived = await app.inject({
      method: "POST",
      url: "/api/workflows/archive",
      payload: {
        path: "TakeBoard/custom-t2i.json",
        confirmationToken: safePreview.json().confirmationToken,
      },
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const archivePath = archived.json().archivePath as string;
    expect(archivePath).toContain("TakeBoard/.archive/");
    const listed = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(listed.json().workflows).toEqual([]);
    const archives = await app.inject({ method: "GET", url: "/api/workflows/archives" });
    expect(archives.json().archives).toEqual([
      expect.objectContaining({ archivePath, originalPath: "TakeBoard/custom-t2i.json" }),
    ]);
    const restored = await app.inject({
      method: "POST",
      url: "/api/workflows/archives/restore",
      payload: { archivePath },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ restored: true, path: "TakeBoard/custom-t2i.json" });
  });

  it("does not mistake model loader filenames for prompts and discovers denoise", () => {
    const candidates = discoverBindingCandidates({
      "2": {
        class_type: "CLIPLoader",
        inputs: { clip_name: "qwen_encoder.safetensors", type: "qwen_image" },
        _meta: { title: "Qwen Text Encoder" },
      },
      "5": {
        class_type: "CLIPTextEncode",
        inputs: { text: "cinematic daylight" },
        _meta: { title: "正向提示词" },
      },
      "6": {
        class_type: "CLIPTextEncode",
        inputs: { text: "watermark" },
        _meta: { title: "负向提示词" },
      },
      "10": {
        class_type: "KSampler",
        inputs: { seed: 42, steps: 4, denoise: 0.65 },
        _meta: { title: "生成（Denoise 控制重绘强度）" },
      },
    });

    expect(candidates.parameters.prompt).toEqual([
      expect.objectContaining({ nodeId: "5", input: "text" }),
    ]);
    expect(candidates.parameters.negative_prompt).toEqual([
      expect.objectContaining({ nodeId: "6", input: "text" }),
    ]);
    expect(candidates.parameters.denoise).toEqual([
      expect.objectContaining({ nodeId: "10", input: "denoise" }),
    ]);
  });

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
    expect(inspect.json().diagnostic).toMatchObject({
      health: "blocked",
      executable: false,
      bindingStatus: "needs_binding",
      missingNodeTypes: [],
      checks: expect.arrayContaining([
        expect.objectContaining({ code: "WORKFLOW_PROMPT_CONVERTED", status: "pass" }),
        expect.objectContaining({ code: "TAKEBOARD_BINDING_REQUIRED", status: "blocked" }),
        expect.objectContaining({ code: "WORKFLOW_OUTPUT_DETECTED", status: "pass" }),
      ]),
    });

    const structuredInspect = await app.inject({
      method: "GET",
      url: "/api/workflows/inspect?path=TakeBoard%2Fcustom-t2i.json",
    });
    expect(structuredInspect.statusCode, structuredInspect.body).toBe(200);
    expect(structuredInspect.json()).toMatchObject({
      status: "needs_binding",
      diagnostic: { path: "TakeBoard/custom-t2i.json" },
    });

    const invalidTransform = await app.inject({
      method: "PUT",
      url: "/api/workflows/binding?path=TakeBoard%2Fcustom-t2i.json",
      payload: {
        ...draft,
        trusted: true,
        parameters: {
          ...draft.parameters,
          prompt: [{ nodeId: "1", input: "text", transform: "arbitrary_expression" }],
        },
      },
    });
    expect(invalidTransform.statusCode).toBe(400);

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
      diagnostic: { executable: true },
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
