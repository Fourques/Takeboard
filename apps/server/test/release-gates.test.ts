import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const h3ObjectInfo = Object.fromEntries(
  [
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
    "VAEDecodeAudio",
    "CreateVideo",
    "SaveVideo",
  ].map((classType) => [classType, { input: { required: {} } }]),
);

describe("release reliability gates", () => {
  it("recovers and correctly associates 40 persisted runs after a server restart", async () => {
    const gateStartedAt = performance.now();
    const root = await mkdtemp(join(tmpdir(), "takeboard-40-run-gate-"));
    roots.push(root);
    let sequence = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/object_info")) return Response.json(h3ObjectInfo);
        if (url.endsWith("/prompt")) {
          sequence += 1;
          return Response.json({ prompt_id: `gate-prompt-${sequence}` });
        }
        const history = /\/history\/(gate-prompt-\d+)$/.exec(url)?.[1];
        if (history) {
          return Response.json({
            [history]: {
              status: { status_str: "success", completed: true },
              outputs: {
                save: {
                  videos: [
                    {
                      filename: `${history}.mp4`,
                      subfolder: "takeboard/release-gate",
                      type: "output",
                    },
                  ],
                },
              },
            },
          });
        }
        if (url.includes("/view?")) {
          return new Response(
            new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
          );
        }
        throw new Error(`Unexpected ComfyUI request: ${url}`);
      }),
    );

    const options = {
      projectsRoot: root,
      webRoot: null,
      comfyUrl: "http://comfy.release-gate",
    } as const;
    const submittingApp = buildApp(options);
    const created = await submittingApp.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "40 Run Gate", aspectRatio: "16:9" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const key = created.json().key as string;
    const shotId = created.json().snapshot.shots[0].id as string;
    const runIds: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const submitted = await submittingApp.inject({
        method: "POST",
        url: `/api/projects/${key}/shots/${shotId}/generate`,
        payload: {
          recipePath: "Kino/Kino_MinimaxH3_T2V.json",
          prompt: `Release gate shot candidate ${index + 1}`,
          seed: 10_000 + index,
          candidateBatchId: `batch_gate${String(Math.floor(index / 4)).padStart(4, "0")}`,
          candidateIndex: (index % 4) + 1,
          candidateCount: 4,
        },
      });
      expect(submitted.statusCode, submitted.body).toBe(202);
      runIds.push(submitted.json().runId as string);
    }
    expect(new Set(runIds).size).toBe(40);
    await submittingApp.close();

    const recoveringApp = buildApp(options);
    try {
      const before = await recoveringApp.inject({ method: "GET", url: `/api/projects/${key}` });
      expect(before.json().snapshot.runs).toHaveLength(40);
      for (const runId of runIds) {
        const recovered = await recoveringApp.inject({
          method: "GET",
          url: `/api/projects/${key}/runs/${runId}`,
        });
        expect(recovered.statusCode, recovered.body).toBe(200);
        expect(recovered.json().status).toBe("completed");
      }
      const final = await recoveringApp.inject({ method: "GET", url: `/api/projects/${key}` });
      const snapshot = final.json().snapshot as {
        runs: Array<{ id: string; status: string }>;
        takes: Array<{ runId: string; assetId: string }>;
        assets: Array<{ id: string; mediaType: string }>;
      };
      expect(snapshot.runs).toHaveLength(40);
      expect(snapshot.runs.every((run) => run.status === "completed")).toBe(true);
      expect(snapshot.takes).toHaveLength(40);
      expect(new Set(snapshot.takes.map((take) => take.runId))).toEqual(new Set(runIds));
      const videoAssets = new Set(
        snapshot.assets.filter((asset) => asset.mediaType === "video").map((asset) => asset.id),
      );
      expect(videoAssets.size).toBe(40);
      expect(snapshot.takes.every((take) => videoAssets.has(take.assetId))).toBe(true);
      console.log(
        `40-run gate: completed=40, associated=40, elapsed=${Math.round(performance.now() - gateStartedAt)}ms`,
      );
    } finally {
      await recoveringApp.close();
    }
  }, 60_000);
});
