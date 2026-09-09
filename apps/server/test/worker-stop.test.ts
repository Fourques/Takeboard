import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
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
