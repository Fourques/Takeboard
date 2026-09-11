import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import { projectDirectory } from "./project-locations.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";
import type { WorkerPool } from "./worker-pool.js";

export type ConnectionTarget =
  | { kind: "ssh"; name: string; host: string; port: number }
  | { kind: "url"; name: string; url: string };
type Profile = { workerId: string; target: ConnectionTarget };
type Tunnel = { endpoint: string; close: () => Promise<void>; closed: Promise<void> };

export function parseConnectionTarget(input: unknown): ConnectionTarget {
  if (!input || typeof input !== "object") throw new Error("请填写生成服务地址");
  const value = input as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (name.length > 100) throw new Error("设备名称不能超过 100 个字");
  if (value.kind === "ssh") {
    const host = typeof value.host === "string" ? value.host.trim() : "";
    if (
      !host ||
      host.length > 255 ||
      host.startsWith("-") ||
      !/^[\p{L}\p{N}_.@:[\]%+-]+$/u.test(host)
    )
      throw new Error("请输入 IP、user@host 或已配置的 SSH 名称，不要填写命令");
    const port = value.port ?? 8188;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("ComfyUI 端口需要是 1–65535 的整数");
    return { kind: "ssh", name: name || host, host, port };
  }
  if (value.kind !== "url" || typeof value.url !== "string") throw new Error("连接方式无效");
  const url = new URL(value.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  )
    throw new Error("远程地址请使用 HTTPS，或选择 SSH；不要在地址中放置密码、查询参数");
  return { kind: "url", name: name || url.host, url: url.href.replace(/\/+$/, "") };
}

async function verifyComfy(endpoint: string, signal: AbortSignal) {
  const response = await fetch(`${endpoint}/system_stats`, { signal, redirect: "error" });
  if (!response.ok) throw new Error(`ComfyUI 未响应（HTTP ${response.status}）`);
  const payload = (await response.json()) as { system?: unknown; devices?: unknown };
  if (!payload.system || !Array.isArray(payload.devices))
    throw new Error("此地址不是可识别的 ComfyUI 服务");
}

export async function openComfyTunnel(
  target: Extract<ConnectionTarget, { kind: "ssh" }>,
  signal: AbortSignal,
): Promise<Tunnel> {
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) =>
        error ? reject(error) : resolve(typeof address === "object" && address ? address.port : 0),
      );
    });
  });
  signal.throwIfAborted();
  const endpoint = `http://127.0.0.1:${port}`;
  const child = spawn(
    "ssh",
    [
      "-N",
      "-v",
      "-n",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ControlMaster=no",
      "-o",
      "ControlPath=none",
      "-o",
      "ControlPersist=no",
      "-o",
      "ForkAfterAuthentication=no",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      `127.0.0.1:${port}:127.0.0.1:${target.port}`,
      target.host,
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
  );
  let failure = "";
  let listening = false;
  let exited = false;
  child.stderr.on("data", (data: Buffer) => {
    failure = (failure + data.toString()).slice(-4096);
    if (failure.includes(`Local forwarding listening on 127.0.0.1 port ${port}`)) listening = true;
  });
  const closed = new Promise<void>((resolve) => {
    const done = () => {
      exited = true;
      resolve();
    };
    child.once("error", (error) => {
      failure = error.message;
      done();
    });
    child.once("close", done);
  });
  const close = async () => {
    if (exited) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 2000);
    timer.unref();
    await closed;
    clearTimeout(timer);
  };
  const abort = () => {
    void close();
  };
  signal.addEventListener("abort", abort, { once: true });
  void closed.then(() => signal.removeEventListener("abort", abort));
  try {
    const deadline = Date.now() + 20_000;
    while (!exited && Date.now() < deadline) {
      signal.throwIfAborted();
      try {
        if (!listening) throw new Error("SSH 尚未建立本地转发");
        await verifyComfy(endpoint, AbortSignal.any([signal, AbortSignal.timeout(1000)]));
        if (exited) break;
        return { endpoint, close, closed };
      } catch {
        signal.throwIfAborted();
      }
      await delay(150, undefined, { signal });
    }
    if (/host key verification|identification has changed/i.test(failure))
      throw new Error("SSH 设备身份未获信任或发生变化。请先核实服务器指纹；不会跳过安全检查。");
    if (/permission denied|authentication failed/i.test(failure))
      throw new Error(
        "SSH 身份验证失败，请检查用户名和系统 SSH 密钥；TakeBoard 登录不能代替 SSH 授权。",
      );
    if (/ENOENT/i.test(failure))
      throw new Error("未找到系统 SSH 客户端；Windows 请安装 OpenSSH 客户端。");
    throw new Error(
      `无法连接 ${target.host} 的 ComfyUI（端口 ${target.port}）。请确认 SSH 可用且服务器已启动 ComfyUI；无需启动远程 TakeBoard。`,
    );
  } catch (error) {
    await close();
    throw error;
  }
}

/** Remembers logical endpoints, owns only its own SSH children, never stops ComfyUI. */
export class ComfyConnections {
  private profiles: Profile[] = [];
  private readonly tunnels = new Map<string, Tunnel>();
  private readonly errors = new Map<string, string>();
  private readonly connecting = new Set<string>();
  private readonly lifetime = new AbortController();
  private restoring: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly path: string;
  private configurationError: string | null = null;
  constructor(
    private readonly root: string,
    private readonly pool: WorkerPool,
    private readonly runtime = { openTunnel: openComfyTunnel, verify: verifyComfy },
  ) {
    this.path = join(root, ".system", "generation-connections.json");
    try {
      if (existsSync(this.path)) {
        const payload = JSON.parse(readFileSync(this.path, "utf8")) as {
          version: number;
          profiles: Profile[];
        };
        if (payload.version !== 1 || !Array.isArray(payload.profiles))
          throw new Error("生成服务连接记录损坏，请保留文件并检查配置");
        this.profiles = payload.profiles.map((item) => ({
          workerId: item.workerId,
          target: parseConnectionTarget(item.target),
        }));
      }
    } catch {
      this.configurationError =
        "生成连接记录无法读取，原文件未修改。仍可查看项目；请检查 .system/generation-connections.json 或从备份恢复。";
    }
    for (const profile of this.profiles)
      if (profile.target.kind === "ssh") this.pool.setManagedEndpoint(profile.workerId, null);
  }
  status() {
    const workerId = this.pool.defaultWorkerId;
    const profile = this.profiles.find((item) => item.workerId === workerId);
    const worker = this.pool.definition(workerId);
    return {
      workerId,
      name: profile?.target.name ?? worker?.name ?? "ComfyUI",
      address:
        profile?.target.kind === "ssh"
          ? `${profile.target.host}:${profile.target.port}`
          : (profile?.target.url ?? worker?.endpoint ?? ""),
      kind: profile?.target.kind ?? "existing",
      state: this.connecting.has(workerId)
        ? "connecting"
        : this.errors.has(workerId)
          ? "offline"
          : "configured",
      error: this.configurationError ?? this.errors.get(workerId) ?? null,
      profiles: this.profiles,
      localWorkerId: this.pool.localWorkerId,
    };
  }
  private async persist() {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, profiles: this.profiles }), {
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
  private install(profile: Profile, tunnel: Tunnel) {
    this.tunnels.set(profile.workerId, tunnel);
    this.pool.setManagedEndpoint(profile.workerId, tunnel.endpoint);
    this.errors.delete(profile.workerId);
    void tunnel.closed.then(() => {
      if (this.tunnels.get(profile.workerId) !== tunnel) return;
      this.tunnels.delete(profile.workerId);
      this.pool.setManagedEndpoint(profile.workerId, null);
      this.errors.set(profile.workerId, "SSH 已断开，正在等待恢复；原任务不会改派给其他设备。");
    });
  }
  async connect(input: unknown) {
    if (this.configurationError) throw new Error(this.configurationError);
    const target = parseConnectionTarget(input);
    const existing = this.profiles.find(
      (item) => JSON.stringify(item.target) === JSON.stringify(target),
    );
    if (existing && this.connecting.has(existing.workerId))
      throw new Error("此连接正在恢复，请稍候重试");
    if (existing && this.tunnels.has(existing.workerId)) {
      await this.pool.selectDefault(existing.workerId);
      await this.releaseInactive();
      return this.status();
    }
    if (existing) this.connecting.add(existing.workerId);
    let connectingWorkerId = existing?.workerId;
    const tunnel =
      target.kind === "ssh"
        ? await this.runtime.openTunnel(target, this.lifetime.signal).catch((error: unknown) => {
            if (existing) this.connecting.delete(existing.workerId);
            throw error;
          })
        : null;
    try {
      if (target.kind === "url")
        await this.runtime.verify(
          target.url,
          AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(5000)]),
        );
      const profile = existing ?? {
        target,
        workerId:
          (target.kind === "url"
            ? this.pool.definitions().find((worker) => worker.endpoint === target.url)?.id
            : undefined) ??
          (
            await this.pool.add({
              name: target.name,
              // The placeholder is never contacted: managed endpoints are restored before serving requests.
              endpoint:
                target.kind === "url" ? target.url : `http://127.0.0.1:1/ssh/${randomUUID()}`,
              kind: "remote",
              transport:
                target.kind === "ssh"
                  ? "ssh_tunnel"
                  : target.url.startsWith("https:")
                    ? "https"
                    : "loopback",
              enabled: true,
              allowSensitiveInputs: true,
              qualityTier: "balanced",
              priority: 70,
              hourlyRate: null,
              currency: "CNY",
              estimatedJobSeconds: 300,
            })
          ).id,
      };
      connectingWorkerId = profile.workerId;
      this.connecting.add(profile.workerId);
      if (!existing) {
        this.profiles.push(profile);
        try {
          await this.persist();
        } catch (error) {
          this.profiles = this.profiles.filter((item) => item !== profile);
          throw error;
        }
      }
      await this.pool.selectDefault(profile.workerId);
      if (tunnel) this.install(profile, tunnel);
      await this.releaseInactive();
      this.errors.delete(profile.workerId);
      return this.status();
    } catch (error) {
      await tunnel?.close();
      throw error;
    } finally {
      if (connectingWorkerId) this.connecting.delete(connectingWorkerId);
    }
  }
  isCurrentTarget(input: unknown) {
    const target = parseConnectionTarget(input);
    return this.profiles.some(
      (profile) =>
        profile.workerId === this.pool.defaultWorkerId &&
        JSON.stringify(profile.target) === JSON.stringify(target),
    );
  }
  async releaseInactive() {
    for (const [workerId, tunnel] of this.tunnels) {
      if (workerId === this.pool.defaultWorkerId) continue;
      await tunnel.close();
    }
  }
  async assertIdle() {
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !projectKey(entry.name)) continue;
      const store = ProjectStore.openExisting(projectDirectory(this.root, entry.name));
      if (!store) throw new Error("项目状态无法检查，暂时不能切换生成服务");
      try {
        const current = store.loadCurrent();
        if (!current) throw new Error("项目状态无法检查");
        if (
          current.snapshot.runs.some(
            (run) => !["completed", "failed", "cancelled"].includes(run.status),
          )
        )
          throw new Error(
            "仍有生成或待下载任务。请先完成或取消任务，再切换生成服务；项目位置不会改变。",
          );
      } finally {
        store.close();
      }
    }
  }
  start() {
    if (this.configurationError) return;
    const restore = async () => {
      for (const profile of this.profiles) {
        if (this.lifetime.signal.aborted) return;
        if (
          profile.workerId !== this.pool.defaultWorkerId ||
          profile.target.kind !== "ssh" ||
          this.tunnels.has(profile.workerId) ||
          this.connecting.has(profile.workerId) ||
          this.pool.definition(profile.workerId)?.retiredAt !== null
        )
          continue;
        this.connecting.add(profile.workerId);
        try {
          const tunnel = await this.runtime.openTunnel(profile.target, this.lifetime.signal);
          if (profile.workerId === this.pool.defaultWorkerId) this.install(profile, tunnel);
          else await tunnel.close();
        } catch (error) {
          this.errors.set(profile.workerId, error instanceof Error ? error.message : "连接失败");
        } finally {
          this.connecting.delete(profile.workerId);
        }
      }
    };
    const schedule = () => {
      if (this.lifetime.signal.aborted) return;
      this.restoring = restore().finally(() => {
        if (this.lifetime.signal.aborted) return;
        this.timer = setTimeout(schedule, 15_000);
        this.timer.unref();
      });
    };
    schedule();
  }
  async close() {
    this.lifetime.abort();
    clearTimeout(this.timer);
    await this.restoring;
    await Promise.all([...this.tunnels.values()].map((tunnel) => tunnel.close()));
  }
}

export function registerComfyConnections(
  app: FastifyInstance,
  connections: ComfyConnections,
  pool: WorkerPool,
) {
  app.get("/api/generation/connection", async () => connections.status());
  app.post("/api/generation/connection", async (request, reply) => {
    try {
      const body = request.body as { workerId?: unknown } | null;
      if (typeof body?.workerId === "string") {
        const target = pool.definition(body.workerId);
        if (!target?.enabled || target.retiredAt) throw new Error("此设备未配置或已停用");
        if (pool.defaultWorkerId !== target.id) await connections.assertIdle();
        await verifyComfy(target.endpoint, AbortSignal.timeout(5000));
        await pool.selectDefault(target.id);
        await connections.releaseInactive();
      } else {
        if (!connections.isCurrentTarget(body)) await connections.assertIdle();
        await connections.connect(body);
      }
      return connections.status();
    } catch (error) {
      return await reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : "连接失败" });
    }
  });
  app.addHook("onReady", async () => connections.start());
  app.addHook("onClose", async () => connections.close());
}
