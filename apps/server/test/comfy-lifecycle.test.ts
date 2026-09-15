import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { ComfyLauncher } from "../src/comfy-launcher.js";

it("remembers explicit start, restores on reopen, and remembers explicit stop", async () => {
  const root = await mkdtemp(join(tmpdir(), "takeboard-lifecycle-"));
  let online = false;
  const launcher: ComfyLauncher = {
    kind: "process",
    preflight: async () => ({
      id: "launcher",
      label: "fixture",
      status: "pass",
      detail: "fixture",
    }),
    canStop: async () => online,
    start: vi.fn(async () => {
      online = true;
    }),
    stop: vi.fn(async () => {
      online = false;
    }),
  };
  const make = () =>
    buildApp({
      projectsRoot: root,
      webRoot: null,
      workerOptions: {
        launcher,
        platform: "linux",
        accelerator: "cpu",
        minFreeRamBytes: 1,
        runtime: {
          freeMemory: () => 1024,
          delay: async () => {},
          fetch: (async (url) => {
            if (!online) throw new Error("offline");
            if (String(url).endsWith("/queue"))
              return Response.json({ queue_running: [], queue_pending: [] });
            return Response.json({ system: { comfyui_version: "fixture" }, devices: [] });
          }) as typeof fetch,
        },
      },
    });
  const apps = [];
  try {
    const first = make();
    apps.push(first);
    await first.listen({ host: "127.0.0.1", port: 0 });
    expect(launcher.start).not.toHaveBeenCalled();
    expect(
      (
        await first.inject({
          method: "POST",
          url: "/api/workers/comfy/start",
          payload: { action: "safe-start" },
        })
      ).statusCode,
    ).toBe(200);
    await first.close();
    expect(online).toBe(false);
    const second = make();
    apps.push(second);
    await second.listen({ host: "127.0.0.1", port: 0 });
    await vi.waitFor(() => expect(launcher.start).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () =>
      expect(
        (
          await second.inject({
            method: "POST",
            url: "/api/workers/comfy/stop",
            payload: { action: "safe-stop" },
          })
        ).statusCode,
      ).toBe(200),
    );
    await second.close();
    const third = make();
    apps.push(third);
    await third.listen({ host: "127.0.0.1", port: 0 });
    await third.close();
    expect(launcher.start).toHaveBeenCalledTimes(2);
  } finally {
    for (const app of apps) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
