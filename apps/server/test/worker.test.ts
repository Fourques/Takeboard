import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { type ComfyLauncher, createComfyLauncher } from "../src/comfy-launcher.js";

const GIBIBYTE = 1024 * 1024 * 1024;
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function launcher(kind: ComfyLauncher["kind"] = "systemd") {
  return {
    kind,
    preflight: vi.fn(async () => ({
      id: "launcher" as const,
      label: "启动方式",
      status: "pass" as const,
      detail: kind,
    })),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  } satisfies ComfyLauncher;
}

const offlineFetch = vi.fn(async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

describe("ComfyUI safe startup", () => {
  it("selects native launch providers for Linux, macOS, Windows, and portable installs", () => {
    expect(
      createComfyLauncher({ platform: "linux", systemdService: "takeboard-comfy.service" }).kind,
    ).toBe("systemd");
    expect(createComfyLauncher({ platform: "darwin", launchdLabel: "app.comfyui" }).kind).toBe(
      "launchd",
    );
    expect(createComfyLauncher({ platform: "win32", windowsService: "ComfyUI" }).kind).toBe(
      "windows-service",
    );
    expect(
      createComfyLauncher({
        platform: "freebsd",
        provider: "process",
        executable: "/opt/comfy/python",
        cwd: "/opt/comfy",
      }).kind,
    ).toBe("process");
  });

  it.each(["activating", "reloading", "deactivating"] as const)(
    "blocks a systemd service while it is %s",
    async (activeState) => {
      const comfyLauncher = createComfyLauncher({
        platform: "linux",
        provider: "systemd",
        systemdService: "takeboard-comfy.service",
        runtime: {
          execute: async () => ({
            stdout: `LoadState=loaded\nActiveState=${activeState}\nSubState=${activeState}\n`,
            stderr: "",
          }),
        },
      });

      await expect(comfyLauncher.preflight()).resolves.toMatchObject({
        status: "blocked",
        detail: expect.stringContaining("不是可安全启动的停止状态"),
      });
    },
  );

  it("accepts only a confirmed inactive/dead systemd service", async () => {
    const comfyLauncher = createComfyLauncher({
      platform: "linux",
      provider: "systemd",
      systemdService: "takeboard-comfy.service",
      runtime: {
        execute: async () => ({
          stdout: "LoadState=loaded\nActiveState=inactive\nSubState=dead\n",
          stderr: "",
        }),
      },
    });

    await expect(comfyLauncher.preflight()).resolves.toMatchObject({ status: "pass" });
  });

  it("does not stop a system service that this launcher did not start", async () => {
    const execute = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const comfyLauncher = createComfyLauncher({
      platform: "linux",
      provider: "systemd",
      systemdService: "takeboard-comfy.service",
      runtime: { execute },
    });

    await comfyLauncher.stop();
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks transient launchd jobs and accepts only a loaded idle job", async () => {
    const transientLauncher = createComfyLauncher({
      platform: "darwin",
      provider: "launchd",
      launchdLabel: "app.comfyui",
      runtime: {
        execute: async () => ({ stdout: "state = waiting\n", stderr: "" }),
      },
    });
    const idleLauncher = createComfyLauncher({
      platform: "darwin",
      provider: "launchd",
      launchdLabel: "app.comfyui",
      runtime: {
        execute: async () => ({ stdout: "state = not running\n", stderr: "" }),
      },
    });

    await expect(transientLauncher.preflight()).resolves.toMatchObject({ status: "blocked" });
    await expect(idleLauncher.preflight()).resolves.toMatchObject({ status: "pass" });
  });

  it("terminates a spawned process if its PID file cannot be persisted", async () => {
    const stopProcess = vi.fn(async () => undefined);
    const comfyLauncher = createComfyLauncher({
      platform: "linux",
      provider: "process",
      executable: "/usr/bin/node",
      cwd: "/tmp",
      pidFile: `/tmp/takeboard-missing-${Date.now()}/comfy.pid`,
      runtime: {
        startProcess: () => 43210,
        stopProcess,
        processRunning: () => true,
      },
    });

    await expect(comfyLauncher.start()).rejects.toThrow();
    expect(stopProcess).toHaveBeenCalledExactlyOnceWith(43210);
  });

  it("retains process ownership when immediate PID rollback fails", async () => {
    const stopProcess = vi
      .fn<(pid: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary stop failure"))
      .mockResolvedValueOnce(undefined);
    const comfyLauncher = createComfyLauncher({
      platform: "linux",
      provider: "process",
      executable: "/usr/bin/node",
      cwd: "/tmp",
      pidFile: `/tmp/takeboard-missing-${Date.now()}-retry/comfy.pid`,
      runtime: {
        startProcess: () => 43211,
        stopProcess,
        processRunning: () => true,
      },
    });

    await expect(comfyLauncher.start()).rejects.toThrow("回滚均失败");
    await expect(comfyLauncher.stop()).resolves.toBeUndefined();
    expect(stopProcess).toHaveBeenNthCalledWith(1, 43211);
    expect(stopProcess).toHaveBeenNthCalledWith(2, 43211);
  });

  it("allows a configured Linux launcher only after memory and NVIDIA checks pass", async () => {
    const comfyLauncher = launcher();
    const app = buildApp({
      comfyUrl: "http://127.0.0.1:8188",
      workerOptions: {
        launcher: comfyLauncher,
        platform: "linux",
        runtime: {
          fetch: offlineFetch,
          freeMemory: () => 24 * GIBIBYTE,
          execute: async () => ({ stdout: "0, NVIDIA RTX 4090, 24564, 22000, 3\n" }),
        },
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/workers/comfy" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "offline",
      startup: {
        state: "available",
        canStart: true,
        launcher: "systemd",
      },
    });
  });

  it("does not execute the launcher when free VRAM is below the safe threshold", async () => {
    const comfyLauncher = launcher();
    const app = buildApp({
      comfyUrl: "http://127.0.0.1:8188",
      workerOptions: {
        launcher: comfyLauncher,
        platform: "win32",
        runtime: {
          fetch: offlineFetch,
          freeMemory: () => 24 * GIBIBYTE,
          execute: async () => ({ stdout: "0, NVIDIA RTX 4060, 8192, 1024, 5\n" }),
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/workers/comfy/start",
      headers: { "content-type": "application/json" },
      payload: { action: "safe-start" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      startup: { state: "blocked", canStart: false, message: expect.stringContaining("显存不足") },
    });
    expect(comfyLauncher.start).not.toHaveBeenCalled();
  });

  it("supports Apple Silicon by applying the unified-memory threshold", async () => {
    const comfyLauncher = launcher("launchd");
    const execute = vi.fn(async () => ({ stdout: "" }));
    const app = buildApp({
      comfyUrl: "http://localhost:8188",
      workerOptions: {
        launcher: comfyLauncher,
        platform: "darwin",
        architecture: "arm64",
        runtime: {
          fetch: offlineFetch,
          freeMemory: () => 18 * GIBIBYTE,
          execute,
        },
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/workers/comfy" });

    expect(response.json()).toMatchObject({
      startup: { state: "available", canStart: true, launcher: "launchd" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("starts once and reports the confirmed ComfyUI connection", async () => {
    const comfyLauncher = launcher("windows-service");
    let probeCount = 0;
    const workerFetch = vi.fn(async () => {
      probeCount += 1;
      if (probeCount === 1) throw new Error("offline");
      return Response.json({
        system: { comfyui_version: "0.9.1" },
        devices: [{ name: "NVIDIA GPU", vram_total: 12 * GIBIBYTE, vram_free: 10 * GIBIBYTE }],
      });
    }) as unknown as typeof fetch;
    const app = buildApp({
      comfyUrl: "http://127.0.0.1:8188",
      workerOptions: {
        launcher: comfyLauncher,
        platform: "win32",
        startupTimeoutMs: 2_000,
        runtime: {
          fetch: workerFetch,
          freeMemory: () => 24 * GIBIBYTE,
          execute: async () => ({ stdout: "0, NVIDIA GPU, 12288, 10240, 1\n" }),
          delay: async () => undefined,
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/workers/comfy/start",
      headers: { "content-type": "application/json" },
      payload: { action: "safe-start" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ready", version: "0.9.1" });
    expect(comfyLauncher.start).toHaveBeenCalledOnce();
    expect(comfyLauncher.stop).not.toHaveBeenCalled();
  });

  it("rolls back the launched service when ComfyUI never becomes healthy", async () => {
    const comfyLauncher = launcher();
    const app = buildApp({
      comfyUrl: "http://127.0.0.1:8188",
      workerOptions: {
        launcher: comfyLauncher,
        platform: "linux",
        startupTimeoutMs: 0,
        runtime: {
          fetch: offlineFetch,
          freeMemory: () => 24 * GIBIBYTE,
          execute: async () => ({ stdout: "0, NVIDIA GPU, 24564, 22000, 1\n" }),
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/workers/comfy/start",
      headers: { "content-type": "application/json" },
      payload: { action: "safe-start" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      startup: { state: "blocked", message: expect.stringContaining("回滚") },
    });
    expect(comfyLauncher.start).toHaveBeenCalledOnce();
    expect(comfyLauncher.stop).toHaveBeenCalledOnce();
  });

  it("reports a rollback failure instead of claiming the service was stopped", async () => {
    const comfyLauncher = launcher();
    comfyLauncher.stop.mockRejectedValueOnce(new Error("systemctl stop failed"));
    const app = buildApp({
      comfyUrl: "http://127.0.0.1:8188",
      workerOptions: {
        launcher: comfyLauncher,
        platform: "linux",
        startupTimeoutMs: 0,
        runtime: {
          fetch: offlineFetch,
          freeMemory: () => 24 * GIBIBYTE,
          execute: async () => ({ stdout: "0, NVIDIA GPU, 24564, 22000, 1\n" }),
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/workers/comfy/start",
      headers: { "content-type": "application/json" },
      payload: { action: "safe-start" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining("自动停止失败"),
      startup: { message: expect.stringContaining("自动回滚失败") },
    });
    expect(comfyLauncher.stop).toHaveBeenCalledOnce();
  });

  it("refuses to start a remote ComfyUI endpoint", async () => {
    const comfyLauncher = launcher("process");
    const app = buildApp({
      comfyUrl: "http://192.168.1.20:8188",
      workerOptions: {
        launcher: comfyLauncher,
        runtime: { fetch: offlineFetch, freeMemory: () => 24 * GIBIBYTE },
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/workers/comfy" });

    expect(response.json()).toMatchObject({
      startup: { state: "blocked", canStart: false, message: expect.stringContaining("远程") },
    });
    expect(comfyLauncher.preflight).not.toHaveBeenCalled();
  });
});
