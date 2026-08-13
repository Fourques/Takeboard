import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

function multipartFile(filename: string, mimeType: string, bytes: Uint8Array) {
  const boundary = "----takeboard-test-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([prefix, Buffer.from(bytes), suffix]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function validPng() {
  return new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
}

function objectInfo(classTypes: string[]) {
  return Object.fromEntries(
    classTypes.map((classType) => [classType, { input: { required: {} } }]),
  );
}

async function projectFixture() {
  const root = await mkdtemp(join(tmpdir(), "takeboard-generation-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const app = buildApp({ projectsRoot: root, webRoot: null, comfyUrl: "http://comfy.test" });
  cleanup.push(() => app.close());
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { title: "生成测试", aspectRatio: "9:16" },
  });
  return {
    app,
    key: created.json().key as string,
    shotId: created.json().snapshot.shots[0].id as string,
  };
}

describe("real generation routes", () => {
  it("rejects unsupported recipes before touching ComfyUI", async () => {
    const { app, key, shotId } = await projectFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: { recipePath: "Kino/Unknown_Model.json" },
    });

    expect(response.statusCode).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-image frame assets before touching ComfyUI", async () => {
    const { app, key, shotId } = await projectFixture();
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets`,
      ...multipartFile("voice.wav", "audio/wav", new Uint8Array([82, 73, 70, 70])),
    });
    const assetId = uploaded.json().snapshot.assets[0].id as string;
    const ranged = await app.inject({
      method: "GET",
      url: `/api/projects/${key}/assets/${assetId}/content`,
      headers: { range: "bytes=1-2" },
    });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers["content-range"]).toBe("bytes 1-2/4");
    expect([...ranged.rawPayload]).toEqual([73, 70]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_Wan22_I2V.json",
        firstFrameAssetId: assetId,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain("首帧不是可用图片");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks a completed run without video output as failed", async () => {
    const { app, key, shotId } = await projectFixture();
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets`,
      ...multipartFile("frame.png", "image/png", validPng()),
    });
    const assetId = uploaded.json().snapshot.assets[0].id as string;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/upload/image")) {
          return Response.json({ name: "frame.png", subfolder: "", type: "input" });
        }
        if (url.endsWith("/object_info")) {
          return Response.json(
            objectInfo([
              "LoadImage",
              "VAELoader",
              "CLIPLoader",
              "CLIPTextEncode",
              "UNETLoader",
              "LoraLoaderModelOnly",
              "ModelSamplingSD3",
              "WanImageToVideo",
              "KSamplerAdvanced",
              "VAEDecode",
              "CreateVideo",
              "SaveVideo",
            ]),
          );
        }
        if (url.endsWith("/prompt")) return Response.json({ prompt_id: "prompt-1" });
        if (url.endsWith("/history/prompt-1")) {
          return Response.json({
            "prompt-1": {
              status: { status_str: "success", completed: true },
              outputs: {
                preview: {
                  images: [{ filename: "preview.png", subfolder: "", type: "output" }],
                },
              },
            },
          });
        }
        throw new Error(`Unexpected ComfyUI request: ${url}`);
      }),
    );

    const submitted = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_Wan22_I2V.json",
        firstFrameAssetId: assetId,
        prompt: "人物缓慢回头",
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(202);

    const polled = await app.inject({
      method: "GET",
      url: `/api/projects/${key}/runs/${submitted.json().runId}`,
    });
    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toMatchObject({
      status: "failed",
      snapshot: {
        runs: [expect.objectContaining({ errorCode: "NO_VIDEO_OUTPUT" })],
        takes: [],
      },
    });
  });

  it("recovers SaveVideo MP4 metadata returned in ComfyUI's images field", async () => {
    const { app, key, shotId } = await projectFixture();
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets`,
      ...multipartFile("frame.png", "image/png", validPng()),
    });
    const assetId = uploaded.json().snapshot.assets[0].id as string;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/upload/image")) {
          return Response.json({ name: "frame.png", subfolder: "", type: "input" });
        }
        if (url.endsWith("/object_info")) {
          return Response.json(
            objectInfo([
              "LoadImage",
              "VAELoader",
              "CLIPLoader",
              "CLIPTextEncode",
              "UNETLoader",
              "LoraLoaderModelOnly",
              "ModelSamplingSD3",
              "WanImageToVideo",
              "KSamplerAdvanced",
              "VAEDecode",
              "CreateVideo",
              "SaveVideo",
            ]),
          );
        }
        if (url.endsWith("/prompt")) return Response.json({ prompt_id: "prompt-video" });
        if (url.endsWith("/history/prompt-video")) {
          return Response.json({
            "prompt-video": {
              status: { status_str: "success", completed: true },
              outputs: {
                save: {
                  images: [
                    { filename: "shot_00001_.mp4", subfolder: "takeboard/test", type: "output" },
                  ],
                  animated: [true],
                },
              },
            },
          });
        }
        if (url.includes("/view?")) {
          return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
        }
        throw new Error(`Unexpected ComfyUI request: ${url}`);
      }),
    );

    const submitted = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_Wan22_I2V.json",
        firstFrameAssetId: assetId,
        prompt: "人物缓慢回头",
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(202);

    const polled = await app.inject({
      method: "GET",
      url: `/api/projects/${key}/runs/${submitted.json().runId}`,
    });
    expect(polled.statusCode).toBe(200);
    expect(polled.json()).toMatchObject({
      status: "completed",
      snapshot: {
        runs: [expect.objectContaining({ status: "completed" })],
        takes: [expect.objectContaining({ status: "candidate" })],
        assets: [
          expect.objectContaining({ mediaType: "image" }),
          expect.objectContaining({ mediaType: "video" }),
        ],
      },
    });
  });

  it("rejects spoofed image MIME before storing the asset", async () => {
    const { app, key } = await projectFixture();
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets`,
      ...multipartFile("fake.png", "image/png", new TextEncoder().encode("not an image")),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain("签名");
  });

  it("submits native MiniMax text-to-video without uploading a frame", async () => {
    const { app, key, shotId } = await projectFixture();
    let submittedPrompt: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/object_info")) {
        return Response.json(
          objectInfo([
            "UNETLoader",
            "CLIPLoader",
            "VAELoader",
            "MiniMaxH3ImageToVideo",
            "RandomNoise",
            "BasicGuider",
            "KSamplerSelect",
            "BasicScheduler",
            "SamplerCustomAdvanced",
            "VAEDecode",
            "CreateVideo",
            "SaveVideo",
          ]),
        );
      }
      if (url.endsWith("/prompt")) {
        submittedPrompt = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ prompt_id: "minimax-prompt-1" });
      }
      throw new Error(`Unexpected ComfyUI request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_MinimaxH3_T2V.json",
        prompt: "A silver river at dawn.",
        width: 480,
        height: 848,
        durationSeconds: 5,
        fps: 24,
        steps: 20,
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/upload/image"))).toBe(false);
    expect(submittedPrompt).toMatchObject({
      prompt: {
        conditioning: {
          class_type: "MiniMaxH3ImageToVideo",
          inputs: { prompt: "A silver river at dawn.", width: 480, height: 864, length: 124 },
        },
      },
    });
    expect(response.json().snapshot.runs[0]).toMatchObject({
      recipeVersion: "minimax-h3@1",
      inputs: [],
      parameters: { width: 480, height: 864, steps: 20 },
    });
  });

  it("stores a completed Qwen text-to-image result as a reusable image asset", async () => {
    const { app, key, shotId } = await projectFixture();
    let submittedPrompt: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/object_info")) {
        return Response.json(
          objectInfo([
            "UNETLoader",
            "CLIPLoader",
            "VAELoader",
            "CLIPTextEncode",
            "ModelSamplingAuraFlow",
            "EmptySD3LatentImage",
            "KSampler",
            "VAEDecode",
            "SaveImage",
          ]),
        );
      }
      if (url.endsWith("/prompt")) {
        submittedPrompt = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ prompt_id: "qwen-image-prompt-1" });
      }
      if (url.endsWith("/history/qwen-image-prompt-1")) {
        return Response.json({
          "qwen-image-prompt-1": {
            status: { status_str: "success", completed: true },
            outputs: {
              save: {
                images: [
                  {
                    filename: "shot_00001_.png",
                    subfolder: "takeboard/test",
                    type: "output",
                  },
                ],
              },
            },
          },
        });
      }
      if (url.includes("/view?")) return new Response(validPng());
      throw new Error(`Unexpected ComfyUI request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const submitted = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_QwenImage2512_T2I.json",
        prompt: "电影感雪山站台，真实摄影，晨雾中的冷暖对比光",
        width: 928,
        height: 1664,
        seed: 2512,
        steps: 50,
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(202);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/upload/image"))).toBe(false);
    expect(submittedPrompt).toMatchObject({
      prompt: {
        latent: {
          class_type: "EmptySD3LatentImage",
          inputs: { width: 928, height: 1664 },
        },
        sample: { inputs: { steps: 50, cfg: 4, denoise: 1 } },
        save: { class_type: "SaveImage" },
      },
    });

    const polled = await app.inject({
      method: "GET",
      url: `/api/projects/${key}/runs/${submitted.json().runId}`,
    });
    expect(polled.statusCode, polled.body).toBe(200);
    expect(polled.json()).toMatchObject({
      status: "completed",
      snapshot: {
        runs: [
          expect.objectContaining({
            recipeVersion: "qwen-image-2512-t2i@1",
            status: "completed",
            inputs: [],
          }),
        ],
        takes: [expect.objectContaining({ status: "candidate" })],
        assets: [
          expect.objectContaining({
            mediaType: "image",
            mimeType: "image/png",
            width: 1,
            height: 1,
          }),
        ],
      },
    });
  });
});
