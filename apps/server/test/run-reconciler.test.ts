import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { acquireProjectLock } from "../src/project-request-lock.js";
import { ProjectStore } from "../src/storage/project-store.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
});

async function fixture(background = false) {
  const root = await mkdtemp(join(tmpdir(), "takeboard-reconcile-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const options = {
    projectsRoot: root,
    webRoot: null,
    comfyUrl: "https://comfy.test",
    runReconciliation: background ? { intervalMs: 15 } : (false as const),
  };
  const app = buildApp(options);
  cleanup.push(() => app.close());
  let completed = false;
  let present = true;
  let disconnected = false;
  let submissions = 0;
  let downloads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (disconnected) throw new Error("offline");
      if (url.endsWith("/object_info"))
        return Response.json(
          Object.fromEntries(
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
            ].map((type) => [type, { input: { required: {} } }]),
          ),
        );
      if (url.endsWith("/prompt")) return Response.json({ prompt_id: `prompt-${++submissions}` });
      if (url.includes("/history/")) {
        const id = url.split("/").at(-1) ?? "";
        return Response.json(
          completed
            ? {
                [id]: {
                  status: { completed: true },
                  outputs: {
                    "1": { videos: [{ filename: "result.mp4", subfolder: "", type: "output" }] },
                  },
                },
              }
            : {},
        );
      }
      if (url.endsWith("/queue"))
        return Response.json({
          queue_running: present ? [[0, "prompt-1"]] : [],
          queue_pending: [],
        });
      if (url.includes("/view?")) {
        downloads++;
        return new Response(Buffer.from("00000018667479706d70343200000000", "hex"));
      }
      if (url.endsWith("/history")) return Response.json({});
      throw new Error(url);
    }),
  );
  const project = (
    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Recovery", aspectRatio: "9:16" },
    })
  ).json();
  const body = {
    recipePath: "Kino/Kino_MinimaxH3_T2V.json",
    prompt: "Test",
    candidateBatchId: "batch_recovery123",
    candidateIndex: 1,
    candidateCount: 3,
  };
  const generateUrl = `/api/projects/${project.key}/shots/${project.snapshot.shots[0].id}/generate`;
  const generated = await app.inject({ method: "POST", url: generateUrl, payload: body });
  expect(generated.statusCode, generated.body).toBe(202);
  const run = generated.json();
  const inspect = () => {
    const store = ProjectStore.openExisting(join(root, project.key));
    try {
      return store?.loadCurrent();
    } finally {
      store?.close();
    }
  };
  return {
    app,
    root,
    options,
    key: project.key as string,
    run,
    inspect,
    body,
    generateUrl,
    complete: () => {
      completed = true;
    },
    disappear: () => {
      present = false;
    },
    disconnect: () => {
      disconnected = true;
    },
    submissions: () => submissions,
    downloads: () => downloads,
    poll: () => app.inject({ url: `/api/projects/${project.key}/runs/${run.runId}` }),
  };
}

describe("server-owned generation recovery", () => {
  it("collects output without a browser request and does not duplicate it on later polls", async () => {
    const f = await fixture(true);
    f.complete();
    await vi.waitFor(() => expect(f.inspect()?.snapshot.runs[0]?.status).toBe("completed"), {
      timeout: 3_000,
    });
    expect(f.inspect()?.snapshot.takes).toHaveLength(1);
    expect(f.downloads()).toBe(1);
    await f.poll();
    expect(f.downloads()).toBe(1);
  });

  it("resumes collection after the TakeBoard service restarts", async () => {
    const f = await fixture();
    await f.app.close();
    f.complete();
    const restarted = buildApp({ ...f.options, runReconciliation: { intervalMs: 15 } });
    cleanup.push(() => restarted.close());
    await restarted.ready();
    await vi.waitFor(() => expect(f.inspect()?.snapshot.runs[0]?.status).toBe("completed"), {
      timeout: 3_000,
    });
    expect(f.downloads()).toBe(1);
  });

  it("observes the project lock and shuts down without starting queued collection", async () => {
    const f = await fixture(true);
    const release = await acquireProjectLock(f.key);
    f.complete();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(f.downloads()).toBe(0);
    const closing = f.app.close();
    await new Promise<void>((resolveTick) => setImmediate(resolveTick));
    release();
    await closing;
    expect(f.downloads()).toBe(0);
  });

  it("waits through a missing-history grace period, then marks uncertainty instead of fake running", async () => {
    const f = await fixture();
    f.disappear();
    expect((await f.poll()).json().status).toBe("running");
    const store = ProjectStore.openExisting(join(f.root, f.key));
    if (!store) throw new Error("missing fixture");
    try {
      const current = store.loadCurrent();
      if (!current?.snapshot.runs[0]) throw new Error("missing fixture run");
      current.snapshot.runs[0].parameters.missingFromWorkerSince = new Date(
        Date.now() - 31_000,
      ).toISOString();
      await store.save(current.snapshot);
    } finally {
      store.close();
    }
    const lost = (await f.poll()).json();
    expect(lost.status).toBe("orphaned");
    expect(lost.snapshot.runs[0].errorCode).toBe("WORKER_TASK_MISSING");
    expect(lost.progress).toBeNull();
    f.complete();
    expect((await f.poll()).json().status).toBe("completed");
    expect(f.inspect()?.snapshot.runs[0]?.errorCode).toBeNull();
  });

  it("does not declare a task lost when the worker is unreachable", async () => {
    const f = await fixture();
    f.disconnect();
    expect((await f.poll()).statusCode).toBe(500);
    expect(f.inspect()?.snapshot.runs[0]?.status).toBe("running");
    expect(f.inspect()?.snapshot.runs[0]?.parameters.missingFromWorkerSince).toBeUndefined();
  });

  it("accepts sequential browser revisions and replays the same candidate without another prompt", async () => {
    const f = await fixture();
    let revision = f.run.revision;
    for (const candidateIndex of [2, 3]) {
      const response = await f.app.inject({
        method: "POST",
        url: f.generateUrl,
        headers: { "x-takeboard-revision": String(revision) },
        payload: { ...f.body, candidateIndex },
      });
      expect(response.statusCode, response.body).toBe(202);
      revision = response.json().revision;
    }
    const replay = await f.app.inject({
      method: "POST",
      url: f.generateUrl,
      headers: { "x-takeboard-revision": String(revision) },
      payload: f.body,
    });
    expect(replay.statusCode, replay.body).toBe(202);
    expect(replay.json().replayed).toBe(true);
    expect(f.submissions()).toBe(3);
    const changed = await f.app.inject({
      method: "POST",
      url: f.generateUrl,
      payload: { ...f.body, prompt: "different" },
    });
    expect(changed.statusCode).toBe(409);
    expect(f.submissions()).toBe(3);
  });
});
