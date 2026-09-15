import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComfyClient } from "@takeboard/executor-comfy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { completionFor } from "../src/background-completion.js";
import type { ComfyLauncher } from "../src/comfy-launcher.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture(options: { owned?: boolean; queue?: unknown; wait?: Promise<void> } = {}) {
  const root = await mkdtemp(join(tmpdir(), "takeboard-worker-stop-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  let online = true;
  const launcher: ComfyLauncher = {
    kind: "process",
    preflight: async () => ({ id: "launcher", label: "启动", status: "pass", detail: "fixture" }),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {
      online = false;
    }),
    canStop: async () => options.owned !== false,
  };
  const app = buildApp({
    projectsRoot: root,
    webRoot: null,
    workerOptions: {
      launcher,
      runtime: {
        delay: async () => {},
        fetch: (async (url: string | URL | Request) => {
          if (String(url).endsWith("/queue")) {
            await options.wait;
            return Response.json(options.queue ?? { queue_running: [], queue_pending: [] });
          }
          if (!online) throw new Error("offline");
          return Response.json({ system: { comfyui_version: "fixture" }, devices: [] });
        }) as typeof fetch,
      },
    },
  });
  cleanup.push(() => app.close());
  return { app, launcher };
}
describe("safe managed ComfyUI stop", () => {
  it("stops owned service after interrupted exit cleanup, but never an external one", async () => {
    for (const owned of [true, false]) {
      const { app, launcher } = await fixture({ owned, queue: {} });
      await app.ready();
      completionFor(app).interrupted = true;
      await app.close();
      expect(launcher.stop).toHaveBeenCalledTimes(owned ? 1 : 0);
    }
  });
  it("releases the selected idle service without stopping it and rejects stale device selections", async () => {
    const { app, launcher } = await fixture({ owned: false });
    const workerId = (await app.inject("/api/workers")).json().defaultWorkerId;
    const release = vi.spyOn(ComfyClient.prototype, "freeResourcesIfIdle").mockResolvedValue(true);
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/workers/comfy/release",
            payload: { workerId: "old" },
          })
        ).statusCode,
      ).toBe(409);
      expect(release).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/workers/comfy/release",
            payload: { workerId },
          })
        ).json(),
      ).toMatchObject({ requested: true });
      expect(release).toHaveBeenCalledOnce();
      expect(launcher.stop).not.toHaveBeenCalled();
    } finally {
      release.mockRestore();
    }
  });
  it("never releases models when the selected service has queued work", async () => {
    const { app } = await fixture({ queue: { queue_running: [], queue_pending: [[1]] } });
    const workerId = (await app.inject("/api/workers")).json().defaultWorkerId;
    const release = vi.spyOn(ComfyClient.prototype, "freeResourcesIfIdle").mockResolvedValue(true);
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/workers/comfy/release",
            payload: { workerId },
          })
        ).statusCode,
      ).toBe(409);
      expect(release).not.toHaveBeenCalled();
    } finally {
      release.mockRestore();
    }
  });
  it("stops an idle owned service when its TakeBoard server exits", async () => {
    const { app, launcher } = await fixture();
    await app.ready();
    await app.close();
    expect(launcher.stop).toHaveBeenCalledOnce();
  });
  it.each([
    { owned: false },
    { queue: { queue_running: [[1]], queue_pending: [] } },
    { queue: {} },
  ])("preserves external, busy and uncertain services on exit", async (options) => {
    const { app, launcher } = await fixture(options);
    await app.ready();
    await app.close();
    expect(launcher.stop).not.toHaveBeenCalled();
  });
  it("requires explicit confirmation and never stops an external service", async () => {
    const { app, launcher } = await fixture({ owned: false });
    expect(
      (await app.inject({ method: "POST", url: "/api/workers/comfy/stop", payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/workers/comfy/stop",
          payload: { action: "safe-stop" },
        })
      ).statusCode,
    ).toBe(409);
    expect(launcher.stop).not.toHaveBeenCalled();
  });
  it.each([
    { queue_running: [[1]], queue_pending: [] },
    {},
    { queue_running: [], queue_pending: [[2]] },
  ])("blocks nonempty or unknown queues", async (queue) => {
    const { app, launcher } = await fixture({ queue });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/workers/comfy/stop",
          payload: { action: "safe-stop" },
        })
      ).statusCode,
    ).toBe(409);
    expect(launcher.stop).not.toHaveBeenCalled();
  });
  it("confirms offline after stopping an idle owned service", async () => {
    const { app, launcher } = await fixture();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/workers/comfy/stop",
          payload: { action: "safe-stop" },
        })
      ).json(),
    ).toEqual({ stopped: true });
    expect(launcher.stop).toHaveBeenCalledOnce();
  });
  it("blocks startup and new submissions until a stop handler completes", async () => {
    let release: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, launcher } = await fixture({ wait });
    await app.ready();
    const stopping = app
      .inject({ method: "POST", url: "/api/workers/comfy/stop", payload: { action: "safe-stop" } })
      .then((result) => result);
    await vi.waitFor(async () => {
      const status = await app.inject({
        method: "POST",
        url: "/api/workers/comfy/start",
        payload: { action: "safe-start" },
      });
      expect(status.statusCode).toBe(409);
    });
    const generated = await app.inject({
      method: "POST",
      url: "/api/projects/test.takeboard/shots/shot_test/generate",
      payload: {},
    });
    expect(generated.statusCode).toBe(409);
    release();
    expect((await stopping).statusCode).toBe(200);
    expect(launcher.start).not.toHaveBeenCalled();
  });
});
