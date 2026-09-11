import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import {
  ComfyConnections,
  parseConnectionTarget,
  registerComfyConnections,
} from "../src/comfy-connection.js";
import { WorkerPool } from "../src/worker-pool.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "takeboard-comfy-connect-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
const target = { kind: "ssh" as const, name: "家里的工作站", host: "user@workstation", port: 8188 };

describe("generation connection ownership", () => {
  it("verifies registered devices before switching and preserves selection on failure", async () => {
    const root = await fixture();
    const pool = new WorkerPool(join(root, "workers.json"), "http://127.0.0.1:8188");
    const registered = await pool.add({
      name: "已配对的工作站",
      endpoint: "https://studio.test",
      kind: "remote",
      transport: "https",
      enabled: true,
      allowSensitiveInputs: false,
      qualityTier: "balanced",
      priority: 0,
      hourlyRate: null,
      currency: "CNY",
      estimatedJobSeconds: 60,
    });
    const connections = new ComfyConnections(root, pool);
    const app = Fastify();
    registerComfyConnections(app, connections, pool);
    cleanup.push(() => app.close());
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    const choose = () =>
      app.inject({
        method: "POST",
        url: "/api/generation/connection",
        payload: { workerId: registered.id },
      });
    expect((await choose()).statusCode).toBe(409);
    expect(pool.defaultWorkerId).toBe(pool.localWorkerId);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ system: { os: "linux" }, devices: [] })),
    );
    expect((await choose()).statusCode).toBe(200);
    expect(pool.defaultWorkerId).toBe(registered.id);
    await pool.update(registered.id, { enabled: false });
    expect((await choose()).statusCode).toBe(409);
    expect(pool.defaultWorkerId).toBe(registered.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/generation/connection",
          payload: { workerId: "missing" },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("does not block local projects or overwrite a damaged optional connection file", async () => {
    const root = await fixture();
    await mkdir(join(root, ".system"));
    const path = join(root, ".system", "generation-connections.json");
    await writeFile(path, "damaged configuration");
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());
    const status = await app.inject({ method: "GET", url: "/api/generation/connection" });
    expect(status.json().error).toContain("原文件未修改");
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "仍然可以创作" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const attempted = await app.inject({
      method: "POST",
      url: "/api/generation/connection",
      payload: target,
    });
    expect(attempted.statusCode).toBe(409);
    expect(await readFile(path, "utf8")).toBe("damaged configuration");
  });
  it.each(["-oProxyCommand=bad", "server;shutdown", "server\ncommand", "user@server -p 22", ""])(
    "rejects SSH command injection: %s",
    (host) => {
      expect(() => parseConnectionTarget({ ...target, host })).toThrow();
    },
  );
  it.each([
    "http://192.168.1.2:8188",
    "https://user:password@example.com",
    "https://example.com?token=secret",
    "file:///etc/passwd",
  ])("rejects unsafe direct URLs: %s", (url) => {
    expect(() => parseConnectionTarget({ kind: "url", url })).toThrow();
  });
  it("remembers logical identity, restores a different port and never falls back to local GPU", async () => {
    const root = await fixture();
    const file = join(root, ".system", "workers.json");
    const pool = new WorkerPool(file, "http://127.0.0.1:8188");
    let end = () => {};
    const closed = new Promise<void>((resolve) => {
      end = resolve;
    });
    const close = vi.fn(async () => end());
    const manager = new ComfyConnections(root, pool, {
      verify: vi.fn(),
      openTunnel: vi.fn(async () => ({ endpoint: "http://127.0.0.1:54321", closed, close })),
    });
    cleanup.push(() => manager.close());
    const connected = await manager.connect(target);
    expect(connected).toMatchObject({
      name: target.name,
      address: "user@workstation:8188",
      kind: "ssh",
    });
    expect(pool.endpoint(connected.workerId)).toBe("http://127.0.0.1:54321");
    expect(await readFile(file, "utf8")).not.toContain("54321");
    expect(
      await readFile(join(root, ".system", "generation-connections.json"), "utf8"),
    ).not.toContain("54321");
    await manager.close();
    expect(close).toHaveBeenCalledOnce();
    expect(() => pool.client(connected.workerId)).toThrow(/SSH/);
    expect(() => pool.client("worker_missing")).toThrow();
    expect(pool.endpoint("worker_missing")).toBeUndefined();

    const restoredPool = new WorkerPool(file, "http://127.0.0.1:8188");
    let endRestored = () => {};
    const restoredClosed = new Promise<void>((resolve) => {
      endRestored = resolve;
    });
    const restore = vi.fn(async () => ({
      endpoint: "http://127.0.0.1:55432",
      closed: restoredClosed,
      close: async () => endRestored(),
    }));
    const restored = new ComfyConnections(root, restoredPool, {
      verify: vi.fn(),
      openTunnel: restore,
    });
    cleanup.push(() => restored.close());
    expect(restoredPool.defaultWorkerId).toBe(connected.workerId);
    expect(() => restoredPool.client(connected.workerId)).toThrow(/SSH/);
    restored.start();
    await vi.waitFor(() =>
      expect(restoredPool.endpoint(connected.workerId)).toBe("http://127.0.0.1:55432"),
    );
    expect(restored.status().workerId).toBe(connected.workerId);
  });
  it("rolls back only its new tunnel if connection-record persistence fails", async () => {
    // A directory at the target path forces atomic rename to fail on every platform.
    const secondRoot = await fixture();
    const secondPool = new WorkerPool(
      join(secondRoot, ".system", "workers.json"),
      "http://127.0.0.1:8188",
    );
    let end = () => {};
    const closed = new Promise<void>((resolve) => {
      end = resolve;
    });
    const close = vi.fn(async () => end());
    const second = new ComfyConnections(secondRoot, secondPool, {
      verify: vi.fn(),
      openTunnel: vi.fn(async () => ({ endpoint: "http://127.0.0.1:54321", closed, close })),
    });
    cleanup.push(() => second.close());
    await mkdir(join(secondRoot, ".system", "generation-connections.json"), { recursive: true });
    await expect(second.connect(target)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
    expect(secondPool.defaultWorkerId).toBe(secondPool.localWorkerId);
    expect(second.status().profiles).toEqual([]);
  });
  it("routes discovery to the selected ComfyUI and never starts the local launcher for it", async () => {
    const root = await fixture();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/system_stats"))
          return Response.json({
            system: { os: "linux", comfyui_version: "test" },
            devices: [{ name: "Remote GPU" }],
          });
        if (url.endsWith("/queue")) return Response.json({ queue_running: [], queue_pending: [] });
        if (url.includes("/api/userdata?")) return Response.json([]);
        if (url.endsWith("/object_info")) return Response.json({});
        throw new Error(url);
      }),
    );
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());
    const before = await app.inject({ method: "GET", url: "/api/device" });
    const result = await app.inject({
      method: "POST",
      url: "/api/generation/connection",
      payload: { kind: "url", name: "远程生成", url: "https://comfy.test" },
    });
    expect(result.statusCode, result.body).toBe(200);
    calls.length = 0;
    const workflows = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(workflows.statusCode, workflows.body).toBe(200);
    expect(workflows.json().editorUrl).toBe("https://comfy.test");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => url.startsWith("https://comfy.test/"))).toBe(true);
    const status = await app.inject({ method: "GET", url: "/api/workers/comfy" });
    expect(status.json()).toMatchObject({
      status: "ready",
      device: "Remote GPU",
      control: { canStop: false },
    });
    const start = await app.inject({
      method: "POST",
      url: "/api/workers/comfy/start",
      payload: { action: "safe-start" },
    });
    expect(start.statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/api/device" })).json().projectsDirectory).toBe(
      before.json().projectsDirectory,
    );
  });
});
