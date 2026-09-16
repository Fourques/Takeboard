import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { completionFor } from "./background-completion.js";
import { createGpuGateway } from "./same-gpu-gateway.js";
import { SameGpuPool } from "./same-gpu-pool.js";
import {
  type GpuPoolConfig,
  type GpuRuntime,
  NvidiaGpuRuntime,
  parseGpuPoolConfig,
} from "./same-gpu-runtime.js";

export function registerSameGpuPool(
  app: FastifyInstance,
  root: string,
  options?: { config: GpuPoolConfig; runtime?: GpuRuntime },
  selectedEndpoint?: () => string,
) {
  const file = process.env.TAKEBOARD_GPU_POOL_CONFIG;
  const raw =
    options?.config ?? (file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
  if (file && !raw) throw new Error("TAKEBOARD_GPU_POOL_CONFIG 不存在");
  if (!raw) {
    const remote = async () => {
      const endpoint = selectedEndpoint?.();
      if (!endpoint) return null;
      const response = await fetch(`${endpoint}/takeboard/pool`, {
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      });
      if (!response.ok) return null;
      const status = (await response.json()) as Record<string, unknown>;
      return status.service === "takeboard-gpu-pool" ? { endpoint, status } : null;
    };
    app.get("/api/workers/gpu-pool", async () => {
      const result = await remote().catch(() => null);
      return result ? { ...result.status, configured: true, remote: true } : { configured: false };
    });
    for (const action of ["start", "stop"] as const)
      app.post(`/api/workers/gpu-pool/${action}`, async (_request, reply) => {
        try {
          const result = await remote();
          if (!result) return reply.code(409).send({ error: "当前设备不是已配置的单卡执行池" });
          const response = await fetch(`${result.endpoint}/takeboard/pool/${action}`, {
            method: "POST",
            signal: AbortSignal.timeout(5 * 60_000),
            redirect: "error",
          });
          if (response.status === 401 || response.status === 403)
            return reply
              .code(502)
              .send({ error: "远端执行池拒绝访问，请检查设备权限；这不是 TakeBoard 账号登录问题" });
          return reply.code(response.status).send(await response.json());
        } catch {
          return reply
            .code(503)
            .send({ error: "执行池状态无法确认，请恢复连接后检查；不会自动重试" });
        }
      });
    return;
  }
  const config = parseGpuPoolConfig(raw);
  const directory = resolve(root, ".system", "gpu-pool");
  const pool = new SameGpuPool(
    config,
    directory,
    options?.runtime ?? new NvidiaGpuRuntime(config, directory),
  );
  const gateway = createGpuGateway(pool);
  let lease: Database.Database | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let closing = false;
  const tick = () => {
    if (closing) return;
    timer = setTimeout(() => {
      inFlight = pool
        .pump()
        .catch((error) => app.log.warn({ err: error }, "GPU pool admission deferred"))
        .finally(() => {
          inFlight = null;
          tick();
        });
    }, 2000);
    timer.unref();
  };
  app.addHook("onReady", async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // One controller per physical GPU and OS user, even across different project roots.
    // SQLite releases this exclusive lock on crashes; child identity remains in the journal.
    const lockRoot = join(tmpdir(), `takeboard-gpu-${userInfo().uid}`);
    await mkdir(lockRoot, { recursive: true, mode: 0o700 });
    const owner = await lstat(lockRoot);
    if (
      !owner.isDirectory() ||
      (process.platform !== "win32" && (owner.uid !== userInfo().uid || (owner.mode & 0o077) !== 0))
    )
      throw new Error("GPU 锁目录的所有权或权限不安全");
    lease = new Database(join(lockRoot, `${config.gpuUuid}.sqlite`));
    try {
      lease.pragma("busy_timeout = 0");
      lease.exec("BEGIN EXCLUSIVE");
      await gateway.listen({ host: "127.0.0.1", port: config.gatewayPort });
      await pool
        .resume()
        .catch((error) => app.log.warn({ err: error }, "GPU instances need explicit recovery"));
      tick();
    } catch (error) {
      lease.close();
      lease = null;
      throw error;
    }
  });
  app.addHook("preClose", async () => {
    closing = true;
    clearTimeout(timer);
    await inFlight;
    await pool.pause();
    if (completionFor(app).interrupted) {
      const queue = pool.queueEntries();
      for (const entry of [...queue.queue_running, ...queue.queue_pending]) {
        const id = entry[1];
        if (typeof id === "string")
          await pool
            .cancel(id)
            .catch((error) => app.log.warn({ err: error }, "Exit cancellation unconfirmed"));
      }
    }
    await pool.suspendCollections();
    if (pool.status().reserved === 0) {
      await pool
        .stop()
        .catch((error) => app.log.warn({ err: error }, "Idle GPU pool stop unconfirmed"));
    }
    await gateway.close();
    lease?.close();
    lease = null;
    // Busy processes may finish accepted work while TakeBoard restarts.
  });
  app.get("/api/workers/gpu-pool", async () => ({
    configured: true,
    ...pool.status(),
    endpoint: `http://127.0.0.1:${config.gatewayPort}`,
  }));
  app.post("/api/workers/gpu-pool/start", async (_request, reply) => {
    try {
      await pool.start();
      return { started: true, ...pool.status() };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "实例未启动" });
    }
  });
  app.post("/api/workers/gpu-pool/stop", async (_request, reply) => {
    try {
      await pool.stop();
      return { stopped: true, ...pool.status() };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "实例未停止" });
    }
  });
}
