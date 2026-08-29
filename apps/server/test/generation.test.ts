import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { ProjectStore } from "../src/storage/project-store.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  delete process.env.TAKEBOARD_MIN_FREE_DISK_GB;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
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
  const expanded = classTypes.includes("MiniMaxH3ImageToVideo")
    ? [...classTypes, "VAEDecodeAudio"]
    : classTypes;
  return Object.fromEntries(expanded.map((classType) => [classType, { input: { required: {} } }]));
}

async function projectFixture(storage?: { inputRoot: string; outputRoot: string }) {
  const root = await mkdtemp(join(tmpdir(), "takeboard-generation-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const app = buildApp({
    projectsRoot: root,
    webRoot: null,
    comfyUrl: "http://comfy.test",
    comfyInputRoot: storage?.inputRoot ?? null,
    comfyOutputRoot: storage?.outputRoot ?? null,
  });
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
  it("blocks generation before contacting ComfyUI when the project disk cannot keep its reserve", async () => {
    const { app, key, shotId } = await projectFixture();
    process.env.TAKEBOARD_MIN_FREE_DISK_GB = "999999999";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_MinimaxH3_T2V.json",
        prompt: "空间不足时不应提交",
        width: 1920,
        height: 1080,
        durationSeconds: 10,
      },
    });

    expect(response.statusCode, response.body).toBe(507);
    expect(response.json()).toMatchObject({ code: "INSUFFICIENT_STORAGE" });
    expect(response.json().error).toContain("尚未上传素材或提交任务");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists 1–4 candidate batch identity and retries only a terminal member", async () => {
    const { app, key, shotId } = await projectFixture();
    let promptSequence = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
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
        promptSequence += 1;
        return Response.json({ prompt_id: `prompt-batch-${promptSequence}` });
      }
      if (/\/api\/jobs\/prompt-batch-\d+\/cancel$/.test(url)) {
        return Response.json({ cancelled: true });
      }
      if (url.endsWith("/history")) return new Response(null, { status: 200 });
      if (url.endsWith("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
      if (url.endsWith("/free")) return new Response(null, { status: 200 });
      throw new Error(`Unexpected ComfyUI request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_MinimaxH3_T2V.json",
        prompt: "批次边界测试",
        candidateBatchId: "batch_test1234",
        candidateIndex: 1,
        candidateCount: 5,
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const submitCandidate = (candidateIndex: number, seed: number) =>
      app.inject({
        method: "POST",
        url: `/api/projects/${key}/shots/${shotId}/generate`,
        payload: {
          recipePath: "Kino/Kino_MinimaxH3_T2V.json",
          prompt: "一组真实候选",
          seed,
          candidateBatchId: "batch_test1234",
          candidateIndex,
          candidateCount: 2,
        },
      });
    const first = await submitCandidate(1, 31);
    const second = await submitCandidate(2, 47);
    expect(first.statusCode, first.body).toBe(202);
    expect(second.statusCode, second.body).toBe(202);
    expect(second.json()).toMatchObject({
      candidateBatchId: "batch_test1234",
      candidateIndex: 2,
      candidateCount: 2,
      snapshot: {
        runs: [
          expect.objectContaining({
            parameters: expect.objectContaining({
              candidateBatchId: "batch_test1234",
              candidateIndex: 1,
              candidateCount: 2,
              seed: 31,
            }),
          }),
          expect.objectContaining({
            parameters: expect.objectContaining({
              candidateBatchId: "batch_test1234",
              candidateIndex: 2,
              candidateCount: 2,
              seed: 47,
            }),
          }),
        ],
      },
    });

    const blockedRetry = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_MinimaxH3_T2V.json",
        prompt: "不能重试运行中任务",
        retryOfRunId: second.json().runId,
      },
    });
    expect(blockedRetry.statusCode).toBe(409);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/runs/${second.json().runId}/cancel`,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);

    const retried = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_MinimaxH3_T2V.json",
        prompt: "一组真实候选",
        seed: 47,
        candidateBatchId: "batch_test1234",
        candidateIndex: 2,
        candidateCount: 2,
        retryOfRunId: second.json().runId,
      },
    });
    expect(retried.statusCode, retried.body).toBe(202);
    expect(retried.json().snapshot.runs).toHaveLength(3);
    expect(retried.json().snapshot.runs[2]).toMatchObject({
      status: "running",
      parameters: {
        candidateBatchId: "batch_test1234",
        candidateIndex: 2,
        candidateCount: 2,
        retryOfRunId: second.json().runId,
        seed: 47,
      },
    });
  });

  it("rejects workflows that have no trusted binding", async () => {
    const { app, key, shotId } = await projectFixture();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: { recipePath: "Kino/Unknown_Model.json" },
    });

    expect(response.statusCode).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("takeboard%2Fbindings");
  });

  it("cancels the remote prompt when persisting the submitted run fails", async () => {
    const { app, key, shotId } = await projectFixture();
    const originalSave = ProjectStore.prototype.save;
    vi.spyOn(ProjectStore.prototype, "save").mockImplementation(async function (
      this: ProjectStore,
      snapshot,
      event,
    ) {
      if (event?.type === "run.submitted") throw new Error("simulated submitted-run write failure");
      return await originalSave.call(this, snapshot, event);
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
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
      if (url.endsWith("/prompt")) return Response.json({ prompt_id: "prompt-compensate" });
      if (url.endsWith("/api/jobs/prompt-compensate/cancel")) {
        return Response.json({ cancelled: true });
      }
      if (url.endsWith("/history")) return new Response(null, { status: 200 });
      throw new Error(`Unexpected ComfyUI request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: { recipePath: "Kino/Kino_MinimaxH3_T2V.json", prompt: "补偿事务测试" },
    });

    expect(response.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://comfy.test/api/jobs/prompt-compensate/cancel",
      expect.objectContaining({ method: "POST" }),
    );
    const reopened = await app.inject({ method: "GET", url: `/api/projects/${key}` });
    expect(reopened.json().snapshot).toMatchObject({
      runs: [expect.objectContaining({ status: "failed", errorCode: "SUBMISSION_FAILED" })],
      shots: [
        expect.objectContaining({
          status: "draft",
          workflowPath: "Kino/Kino_MinimaxH3_T2V.json",
        }),
      ],
    });
    const switched = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: { recipePath: "Kino/Kino_QwenImage2512_T2I.json", prompt: "更换模型" },
    });
    expect(switched.statusCode).toBe(409);
    expect(switched.json().error).toContain("工作流不能直接更换");
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

  it.each([
    {
      recipePath: "Kino/Kino_Wan22_I2V.json",
      requestedSteps: 100,
      expectedSteps: 40,
      expectedCfg: 3.5,
      expectedLora: false,
      expectedVersion: "wan22-i2v-quality@2",
    },
    {
      recipePath: "Kino/Kino_Wan22_I2V_Preview.json",
      requestedSteps: 20,
      expectedSteps: 4,
      expectedCfg: 1,
      expectedLora: true,
      expectedVersion: "wan22-i2v-preview@2",
    },
  ])("keeps Wan quality profiles explicit for $recipePath", async (profile) => {
    const { app, key, shotId } = await projectFixture();
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets`,
      ...multipartFile("frame.png", "image/png", validPng()),
    });
    const assetId = uploaded.json().snapshot.assets[0].id as string;
    let submittedPrompt: Record<string, { class_type?: string; inputs?: Record<string, unknown> }> =
      {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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
        if (url.endsWith("/prompt")) {
          submittedPrompt = (JSON.parse(String(init?.body)) as { prompt: typeof submittedPrompt })
            .prompt;
          return Response.json({ prompt_id: `prompt-${profile.expectedSteps}` });
        }
        throw new Error(`Unexpected ComfyUI request: ${url}`);
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: profile.recipePath,
        firstFrameAssetId: assetId,
        prompt: "人物自然回头，镜头稳定",
        steps: profile.requestedSteps,
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(submittedPrompt.high_sample?.inputs).toMatchObject({
      steps: profile.expectedSteps,
      cfg: profile.expectedCfg,
    });
    expect(Boolean(submittedPrompt.high_lora)).toBe(profile.expectedLora);
    expect(response.json().snapshot.runs[0].recipeVersion).toBe(profile.expectedVersion);
    expect(response.json().snapshot.runs[0].parameters.steps).toBe(profile.expectedSteps);
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

  it("cancels one ComfyUI job and cleans only that run's temporary files", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "takeboard-cancel-storage-"));
    cleanup.push(() => rm(storageRoot, { recursive: true, force: true }));
    const inputRoot = join(storageRoot, "input");
    const outputRoot = join(storageRoot, "output");
    await Promise.all([
      mkdir(inputRoot, { recursive: true }),
      mkdir(outputRoot, { recursive: true }),
    ]);
    const { app, key, shotId } = await projectFixture({ inputRoot, outputRoot });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
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
      if (url.endsWith("/prompt")) return Response.json({ prompt_id: "prompt-cancel" });
      if (url.endsWith("/api/jobs/prompt-cancel/cancel")) {
        return Response.json({ cancelled: true });
      }
      if (url.endsWith("/history")) return new Response(null, { status: 200 });
      if (url.endsWith("/queue")) {
        return Response.json({ queue_running: [], queue_pending: [] });
      }
      if (url.endsWith("/free")) return new Response(null, { status: 200 });
      throw new Error(`Unexpected ComfyUI request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const submitted = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_MinimaxH3_T2V.json",
        prompt: "取消这次测试生成",
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(202);
    const runId = submitted.json().runId as string;
    const projectId = submitted.json().snapshot.project.id as string;
    const temporaryInput = join(inputRoot, `takeboard_${runId}_frame.png`);
    const runOutputDirectory = join(outputRoot, "takeboard", projectId, shotId, runId);
    await mkdir(runOutputDirectory, { recursive: true });
    await Promise.all([
      writeFile(temporaryInput, "input"),
      writeFile(join(runOutputDirectory, "partial.tmp"), "partial"),
    ]);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/runs/${runId}/cancel`,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({
      cancelled: true,
      resourcesReleased: true,
      snapshot: {
        runs: [expect.objectContaining({ id: runId, status: "cancelled" })],
        shots: [expect.objectContaining({ id: shotId, status: "draft" })],
      },
    });
    await expect(access(temporaryInput)).rejects.toThrow();
    await expect(access(runOutputDirectory)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://comfy.test/api/jobs/prompt-cancel/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps an unconfirmed remote cancellation recoverable and retries cleanup", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "takeboard-cancel-retry-"));
    cleanup.push(() => rm(storageRoot, { recursive: true, force: true }));
    const inputRoot = join(storageRoot, "input");
    const outputRoot = join(storageRoot, "output");
    await Promise.all([
      mkdir(inputRoot, { recursive: true }),
      mkdir(outputRoot, { recursive: true }),
    ]);
    const { app, key, shotId } = await projectFixture({ inputRoot, outputRoot });
    let cancellationAvailable = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
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
        if (url.endsWith("/prompt")) return Response.json({ prompt_id: "prompt-retry" });
        if (url.endsWith("/api/jobs/prompt-retry/cancel")) {
          return cancellationAvailable
            ? Response.json({ cancelled: true })
            : new Response(null, { status: 503 });
        }
        if (url.endsWith("/history")) return new Response(null, { status: 200 });
        if (url.endsWith("/queue")) {
          return Response.json({ queue_running: [], queue_pending: [] });
        }
        if (url.endsWith("/free")) return new Response(null, { status: 200 });
        throw new Error(`Unexpected ComfyUI request: ${url}`);
      }),
    );

    const submitted = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: { recipePath: "Kino/Kino_MinimaxH3_T2V.json", prompt: "稍后重试取消" },
    });
    const runId = submitted.json().runId as string;
    const projectId = submitted.json().snapshot.project.id as string;
    const temporaryInput = join(inputRoot, `takeboard_${runId}_frame.png`);
    const runOutputDirectory = join(outputRoot, "takeboard", projectId, shotId, runId);
    await mkdir(runOutputDirectory, { recursive: true });
    await Promise.all([
      writeFile(temporaryInput, "input"),
      writeFile(join(runOutputDirectory, "partial.tmp"), "partial"),
    ]);

    const unconfirmed = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/runs/${runId}/cancel`,
    });
    expect(unconfirmed.statusCode, unconfirmed.body).toBe(200);
    expect(unconfirmed.json()).toMatchObject({
      cancelled: false,
      status: "orphaned",
      snapshot: { runs: [expect.objectContaining({ errorCode: "REMOTE_CANCEL_UNCONFIRMED" })] },
    });
    await expect(access(temporaryInput)).resolves.toBeUndefined();
    await expect(access(runOutputDirectory)).resolves.toBeUndefined();

    cancellationAvailable = true;
    const retried = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/runs/${runId}/cancel`,
    });
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json()).toMatchObject({ cancelled: true, status: "cancelled" });
    await expect(access(temporaryInput)).rejects.toThrow();
    await expect(access(runOutputDirectory)).rejects.toThrow();
  });

  it.each(["images", "gifs"] as const)(
    "recovers SaveVideo MP4 metadata returned in ComfyUI's %s field",
    async (outputField) => {
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
                    [outputField]: [
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
    },
  );

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

  it("accepts a valid image larger than Fastify's former one megabyte default", async () => {
    const { app, key } = await projectFixture();
    const paddedImage = new Uint8Array(2 * 1024 * 1024);
    paddedImage.set(validPng());
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets`,
      ...multipartFile("large-frame.png", "image/png", paddedImage),
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().snapshot.assets[0]).toMatchObject({
      originalName: "large-frame.png",
      mediaType: "image",
    });
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
      recipeVersion: "minimax-h3-fl2va@2",
      inputs: [],
      parameters: { width: 480, height: 864, steps: 20 },
    });
  });

  it("submits native MiniMax Ref2VA with image, video soundtrack and audio references", async () => {
    const { app, key, shotId } = await projectFixture();
    const uploads = [];
    uploads.push(
      await app.inject({
        method: "POST",
        url: `/api/projects/${key}/assets`,
        ...multipartFile("subject.png", "image/png", validPng()),
      }),
    );
    uploads.push(
      await app.inject({
        method: "POST",
        url: `/api/projects/${key}/assets`,
        ...multipartFile(
          "motion.mp4",
          "video/mp4",
          new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
        ),
      }),
    );
    uploads.push(
      await app.inject({
        method: "POST",
        url: `/api/projects/${key}/assets`,
        ...multipartFile("voice.wav", "audio/wav", new Uint8Array([82, 73, 70, 70])),
      }),
    );
    const assets = uploads.map((response) => response.json().snapshot.assets.at(-1));
    let submittedPrompt: Record<string, unknown> | null = null;
    let uploadIndex = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/upload/image")) {
          uploadIndex += 1;
          return Response.json({ name: `reference-${uploadIndex}`, subfolder: "", type: "input" });
        }
        if (url.endsWith("/object_info")) {
          return Response.json(
            objectInfo([
              "UNETLoader",
              "CLIPLoader",
              "VAELoader",
              "MiniMaxH3ReferenceToVideo",
              "LoadImage",
              "LoadVideo",
              "GetVideoComponents",
              "LoadAudio",
              "RandomNoise",
              "BasicGuider",
              "KSamplerSelect",
              "BasicScheduler",
              "SamplerCustomAdvanced",
              "VAEDecode",
              "VAEDecodeAudio",
              "CreateVideo",
              "SaveVideo",
            ]),
          );
        }
        if (url.endsWith("/prompt")) {
          submittedPrompt = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({ prompt_id: "minimax-r2v-prompt" });
        }
        throw new Error(`Unexpected ComfyUI request: ${url}`);
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots/${shotId}/generate`,
      payload: {
        recipePath: "Kino/Kino_MinimaxH3_R2V.json",
        prompt: "Use <Picture 1>, <Video 1>, and <Audio 2>.",
        promptSource: "使用 @subject、@motion 和 @voice。",
        referenceImageAssetIds: [assets[0].id],
        referenceVideoAssetIds: [assets[1].id],
        referenceAudioAssetIds: [assets[2].id],
        referenceImageSize: "max",
        durationSeconds: 5,
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(uploadIndex).toBe(3);
    expect(submittedPrompt).toMatchObject({
      prompt: {
        model: {
          inputs: { unet_name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors" },
        },
        conditioning: {
          class_type: "MiniMaxH3ReferenceToVideo",
          inputs: {
            ref_image_size: "max",
            "ref_images.ref_image_0": ["reference_image_0", 0],
            "ref_videos.ref_video_0": ["reference_video_components_0", 0],
            "ref_video_audios.ref_video_audio_0": ["reference_video_components_0", 1],
            "ref_audios.ref_audio_0": ["reference_audio_0", 0],
          },
        },
      },
    });
    expect(response.json().snapshot.runs[0]).toMatchObject({
      recipeVersion: "minimax-h3-ref2va@2",
      inputs: [
        expect.objectContaining({ slot: "reference_image_0", refId: assets[0].id }),
        expect.objectContaining({ slot: "reference_video_0", refId: assets[1].id }),
        expect.objectContaining({ slot: "reference_audio_0", refId: assets[2].id }),
      ],
      parameters: {
        fps: 24,
        referenceImageSize: "max",
        promptSource: "使用 @subject、@motion 和 @voice。",
      },
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
