import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { arch, freemem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { executionPolicySchema, workerDefinitionSchema } from "@takeboard/contracts";
import type { FastifyInstance } from "fastify";
import { completionFor } from "./background-completion.js";
import {
  type ComfyLauncher,
  createComfyLauncher,
  launcherConfigFromEnvironment,
} from "./comfy-launcher.js";
import { assertComfyIdle, recordInterruptedExit, stopOwnedIdleComfy } from "./comfy-lifecycle.js";
import { atomicGpuJson } from "./same-gpu-pool.js";
import { WorkerPool, WorkerSelectionError } from "./worker-pool.js";

const execFile = promisify(execFileCallback);
const GIBIBYTE = 1024 * 1024 * 1024;

type SafetyCheck = {
  id: "endpoint" | "launcher" | "memory" | "accelerator" | "vram" | "load";
  label: string;
  status: "pass" | "blocked";
  detail: string;
};

type StartupInfo = {
  state: "ready" | "available" | "blocked" | "starting";
  canStart: boolean;
  message: string;
  platform: NodeJS.Platform;
  launcher: ComfyLauncher["kind"];
  checks: SafetyCheck[];
};

type WorkerPayload = {
  status: "ready" | "offline";
  engine: "ComfyUI";
  version?: string;
  device?: string;
  vramTotal?: number | null;
  vramFree?: number | null;
  error?: string;
  startup: StartupInfo;
  control?: { canStop: boolean; message: string };
};

export type WorkerRuntime = {
  fetch: typeof fetch;
  execute: (file: string, args: string[]) => Promise<{ stdout: string }>;
  freeMemory: () => number;
  delay: (milliseconds: number) => Promise<void>;
};

export type WorkerRouteOptions = {
  launcher?: ComfyLauncher;
  platform?: NodeJS.Platform;
  architecture?: string;
  accelerator?: "auto" | "nvidia" | "apple" | "cpu";
  gpuIndex?: number;
  minFreeRamBytes?: number;
  minFreeVramMib?: number;
  maxGpuUtilization?: number;
  startupTimeoutMs?: number;
  runtime?: Partial<WorkerRuntime>;
};

const defaultRuntime: WorkerRuntime = {
  fetch,
  execute: async (file, args) => {
    const result = await execFile(file, args, { timeout: 8_000, windowsHide: true });
    return { stdout: result.stdout };
  },
  freeMemory: freemem,
  delay: async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function localEndpoint(comfyUrl: string) {
  try {
    const hostname = new URL(comfyUrl).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function blockedStartup(
  platform: NodeJS.Platform,
  launcher: ComfyLauncher,
  checks: SafetyCheck[],
  message: string,
): StartupInfo {
  return {
    state: "blocked",
    canStart: false,
    message,
    platform,
    launcher: launcher.kind,
    checks,
  };
}

async function probeWorker(
  runtime: WorkerRuntime,
  comfyUrl: string,
  platform: NodeJS.Platform,
  launcher: ComfyLauncher,
): Promise<WorkerPayload | null> {
  try {
    const response = await runtime.fetch(`${comfyUrl}/system_stats`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      system?: { comfyui_version?: string };
      devices?: Array<{ name?: string; vram_total?: number; vram_free?: number }>;
    };
    const device = payload.devices?.[0];
    return {
      status: "ready",
      engine: "ComfyUI",
      version: payload.system?.comfyui_version ?? "unknown",
      device: device?.name ?? "执行设备",
      vramTotal: device?.vram_total ?? null,
      vramFree: device?.vram_free ?? null,
      startup: {
        state: "ready",
        canStart: false,
        message: "ComfyUI 已连接",
        platform,
        launcher: launcher.kind,
        checks: [],
      },
    };
  } catch {
    return null;
  }
}

async function preflight(
  runtime: WorkerRuntime,
  comfyUrl: string,
  launcher: ComfyLauncher,
  options: Required<Omit<WorkerRouteOptions, "launcher" | "runtime">>,
): Promise<StartupInfo> {
  const checks: SafetyCheck[] = [];
  if (!localEndpoint(comfyUrl)) {
    checks.push({
      id: "endpoint",
      label: "执行端地址",
      status: "blocked",
      detail: "当前地址不是本机回环地址",
    });
    return blockedStartup(options.platform, launcher, checks, "TakeBoard 不会远程启动 ComfyUI");
  }
  checks.push({
    id: "endpoint",
    label: "执行端地址",
    status: "pass",
    detail: "本机回环地址",
  });

  const launcherCheck = await launcher.preflight();
  checks.push(launcherCheck);
  if (launcherCheck.status === "blocked") {
    return blockedStartup(options.platform, launcher, checks, "没有可安全使用的启动方式");
  }

  const availableMemory = runtime.freeMemory();
  const memoryPass = availableMemory >= options.minFreeRamBytes;
  checks.push({
    id: "memory",
    label: options.accelerator === "apple" ? "可用统一内存" : "可用内存",
    status: memoryPass ? "pass" : "blocked",
    detail: `${(availableMemory / GIBIBYTE).toFixed(1)} GB 可用，最低需要 ${(options.minFreeRamBytes / GIBIBYTE).toFixed(0)} GB`,
  });
  if (!memoryPass) {
    return blockedStartup(options.platform, launcher, checks, "系统内存不足，已阻止启动");
  }

  const appleAccelerator =
    options.accelerator === "apple" ||
    (options.accelerator === "auto" &&
      options.platform === "darwin" &&
      options.architecture === "arm64");
  if (appleAccelerator) {
    checks.push({
      id: "accelerator",
      label: "加速设备",
      status: "pass",
      detail: "Apple Silicon · 使用统一内存安全阈值",
    });
    return {
      state: "available",
      canStart: true,
      message: "资源检查通过，可以安全启动",
      platform: options.platform,
      launcher: launcher.kind,
      checks,
    };
  }

  if (options.accelerator === "cpu") {
    checks.push({
      id: "accelerator",
      label: "执行模式",
      status: "pass",
      detail: "CPU 模式 · 不检查独立显存",
    });
    return {
      state: "available",
      canStart: true,
      message: "资源检查通过，可以安全启动",
      platform: options.platform,
      launcher: launcher.kind,
      checks,
    };
  }

  try {
    const { stdout } = await runtime.execute("nvidia-smi", [
      "--query-gpu=index,name,memory.total,memory.free,utilization.gpu",
      "--format=csv,noheader,nounits",
    ]);
    const device = stdout
      .trim()
      .split("\n")
      .map((line) => line.split(",").map((value) => value.trim()))
      .find(([index]) => Number.parseInt(index ?? "", 10) === options.gpuIndex);
    if (!device) throw new Error("Configured GPU was not found");
    const [, name, totalText, freeText, utilizationText] = device;
    const totalMib = Number.parseInt(totalText ?? "", 10);
    const freeMib = Number.parseInt(freeText ?? "", 10);
    const utilization = Number.parseInt(utilizationText ?? "", 10);
    if (![totalMib, freeMib, utilization].every(Number.isFinite)) {
      throw new Error("Invalid GPU telemetry");
    }
    checks.push({
      id: "accelerator",
      label: "加速设备",
      status: "pass",
      detail: name || `NVIDIA GPU ${options.gpuIndex}`,
    });
    const vramPass = freeMib >= options.minFreeVramMib;
    checks.push({
      id: "vram",
      label: "空闲显存",
      status: vramPass ? "pass" : "blocked",
      detail: `${(freeMib / 1024).toFixed(1)} / ${(totalMib / 1024).toFixed(1)} GB，最低需要 ${(options.minFreeVramMib / 1024).toFixed(0)} GB`,
    });
    if (!vramPass) {
      return blockedStartup(options.platform, launcher, checks, "GPU 显存不足，已阻止启动");
    }
    const loadPass = utilization <= options.maxGpuUtilization;
    checks.push({
      id: "load",
      label: "GPU 负载",
      status: loadPass ? "pass" : "blocked",
      detail: `${utilization}% · 安全阈值 ${options.maxGpuUtilization}%`,
    });
    if (!loadPass) {
      return blockedStartup(options.platform, launcher, checks, "GPU 正在高负载运行，已阻止启动");
    }
  } catch {
    checks.push({
      id: "accelerator",
      label: "加速设备",
      status: "blocked",
      detail: "无法验证 NVIDIA GPU；如使用 CPU，请显式配置 COMFY_ACCELERATOR=cpu",
    });
    return blockedStartup(options.platform, launcher, checks, "无法确认加速设备，已阻止启动");
  }

  return {
    state: "available",
    canStart: true,
    message: "资源检查通过，可以安全启动",
    platform: options.platform,
    launcher: launcher.kind,
    checks,
  };
}

export function registerWorkerRoutes(
  app: FastifyInstance,
  comfyUrl: string,
  routeOptions: WorkerRouteOptions = {},
  workerPool = new WorkerPool(
    ".takeboard-data/.system/workers.json",
    comfyUrl,
    routeOptions.runtime?.fetch,
  ),
  projectsRoot?: string,
) {
  const runtime: WorkerRuntime = { ...defaultRuntime, ...routeOptions.runtime };
  const launcher = routeOptions.launcher ?? createComfyLauncher(launcherConfigFromEnvironment());
  const platform = routeOptions.platform ?? process.platform;
  const inferredAccelerator =
    routeOptions.accelerator ??
    ((process.env.COMFY_ACCELERATOR as WorkerRouteOptions["accelerator"]) || "auto");
  const options: Required<Omit<WorkerRouteOptions, "launcher" | "runtime">> = {
    platform,
    architecture: routeOptions.architecture ?? arch(),
    accelerator: inferredAccelerator,
    gpuIndex: routeOptions.gpuIndex ?? Number.parseInt(process.env.COMFY_GPU_INDEX ?? "0", 10),
    minFreeRamBytes:
      routeOptions.minFreeRamBytes ??
      Number.parseFloat(process.env.COMFY_MIN_FREE_RAM_GB ?? "6") * GIBIBYTE,
    minFreeVramMib:
      routeOptions.minFreeVramMib ??
      Number.parseFloat(process.env.COMFY_MIN_FREE_VRAM_GB ?? "4") * 1024,
    maxGpuUtilization:
      routeOptions.maxGpuUtilization ??
      Number.parseInt(process.env.COMFY_MAX_GPU_UTILIZATION ?? "85", 10),
    startupTimeoutMs: routeOptions.startupTimeoutMs ?? 30_000,
  };
  let starting = false;
  let lifecycleBusy = false;
  let submissions = 0;
  let closing = false;
  let restoring: Promise<void> | null = null;
  const preferencePath = projectsRoot
    ? join(projectsRoot, ".system", "comfy-lifecycle.json")
    : null;
  const serviceIdentity = createHash("sha256")
    .update(
      JSON.stringify({
        endpoint: comfyUrl,
        platform,
        launcher: launcher.kind,
        config: launcherConfigFromEnvironment(),
      }),
    )
    .digest("hex");
  const rememberManagedService = async (enabled: boolean) => {
    if (!preferencePath || !projectsRoot) return;
    await mkdir(join(projectsRoot, ".system"), { recursive: true });
    await atomicGpuJson(preferencePath, { version: 1, serviceIdentity, enabled });
  };
  const launchAndWait = async () => {
    await launcher.start();
    const startedAt = Date.now();
    while (!closing && Date.now() - startedAt < options.startupTimeoutMs) {
      await runtime.delay(1000);
      const worker = await probeWorker(runtime, comfyUrl, platform, launcher);
      if (worker) return worker;
    }
    return null;
  };
  app.addHook("onListen", async () => {
    // A prior successful explicit start is consent to restore this exact local service.
    // Restoring is background work: the app can still display startup diagnostics.
    if (
      !preferencePath ||
      workerPool.defaultWorkerId !== workerPool.localWorkerId ||
      !workerPool.definition(workerPool.localWorkerId)?.enabled ||
      !localEndpoint(comfyUrl)
    )
      return;
    restoring = (async () => {
      const saved = await readFile(preferencePath, "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (
        !saved?.enabled ||
        saved.serviceIdentity !== serviceIdentity ||
        closing ||
        lifecycleBusy ||
        submissions
      )
        return;
      lifecycleBusy = true;
      starting = true;
      let launched = false;
      try {
        if (await probeWorker(runtime, comfyUrl, platform, launcher)) return;
        const check = await preflight(runtime, comfyUrl, launcher, options);
        if (!check.canStart || closing) return;
        launched = true;
        if (!(await launchAndWait())) throw new Error("恢复生成服务超时");
      } catch (error) {
        if (launched)
          await launcher
            .stop()
            .catch((cause) => app.log.warn({ err: cause }, "ComfyUI restore rollback failed"));
        app.log.warn({ err: error }, "ComfyUI restore deferred; explicit retry remains available");
      } finally {
        starting = false;
        lifecycleBusy = false;
      }
    })();
  });
  // Hold the gate until the handler itself completes, even if a client aborts.
  // HTTP response/abort hooks alone would release it while an upload still runs.
  app.addHook("onRoute", (route) => {
    const control =
      (route.url === "/api/generation/connection/:workerId" &&
        (route.method === "PATCH" || route.method === "DELETE")) ||
      (route.method === "POST" &&
        [
          "/api/workers/comfy/start",
          "/api/workers/comfy/stop",
          "/api/workers/comfy/release",
          "/api/generation/connection",
          "/api/generation/connection/start",
        ].includes(route.url));
    const generation =
      route.method === "POST" && route.url === "/api/projects/:key/shots/:shotId/generate";
    const workflow = route.url.startsWith("/api/workflows");
    if (!control && !generation && !workflow) return;
    const handler = route.handler;
    route.handler = async function (request, reply) {
      if (lifecycleBusy || (control && submissions > 0))
        return await reply.code(409).send({ error: "生成请求或服务启停正在处理，请稍后重试" });
      if (control) lifecycleBusy = true;
      else submissions += 1;
      try {
        return await handler.call(this, request, reply);
      } finally {
        if (control) lifecycleBusy = false;
        else submissions -= 1;
      }
    };
  });
  const controlStatus = async () => {
    const canStop =
      workerPool.defaultWorkerId === workerPool.localWorkerId &&
      workerPool.definition(workerPool.defaultWorkerId)?.enabled === true &&
      localEndpoint(comfyUrl) &&
      (await launcher.canStop?.().catch(() => false)) === true;
    return {
      canStop,
      message: canStop
        ? "可停止由本次 TakeBoard 启动的生成服务；停止前会再次检查任务"
        : "此服务不属于可验证的受管进程，只连接，不代为关闭",
    };
  };
  app.addHook("onClose", async () => {
    // Only the actual server owner closes this process. Closing a remote browser
    // does not close the shared server or its GPU service.
    closing = true;
    await restoring;
    if (!projectsRoot || !localEndpoint(comfyUrl)) return;
    try {
      if (completionFor(app).interrupted && (await launcher.canStop?.())) {
        await launcher.stop();
        await recordInterruptedExit(projectsRoot, workerPool.localWorkerId);
        return;
      }
      await stopOwnedIdleComfy(launcher, async () => {
        if (starting || submissions || lifecycleBusy) throw new Error("启停或提交尚未结束");
        await assertComfyIdle(projectsRoot, workerPool.localWorkerId, comfyUrl, runtime.fetch);
      });
    } catch (error) {
      app.log.warn(
        { err: error },
        "ComfyUI retained: work or ownership could not be safely cleared",
      );
    }
  });

  app.get("/api/workers", async () => ({
    defaultWorkerId: workerPool.defaultWorkerId,
    policies: executionPolicySchema.options,
    workers: await workerPool.fleet(),
  }));

  app.post("/api/workers/selection/preview", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const policy = executionPolicySchema.safeParse(body.policy ?? "balanced");
    if (!policy.success) return await reply.code(400).send({ error: "执行策略无效" });
    try {
      return await workerPool.select({
        policy: policy.data,
        requestedWorkerId: typeof body.workerId === "string" ? body.workerId : null,
        containsSensitiveInputs: body.containsSensitiveInputs === true,
        budgetCap: typeof body.budgetCap === "number" ? body.budgetCap : null,
        budgetCurrency: typeof body.budgetCurrency === "string" ? body.budgetCurrency : null,
        estimatedJobSeconds:
          typeof body.estimatedJobSeconds === "number" ? body.estimatedJobSeconds : null,
      });
    } catch (error) {
      if (error instanceof WorkerSelectionError) {
        return await reply.code(409).send({ error: error.message, candidates: error.candidates });
      }
      throw error;
    }
  });

  app.post("/api/admin/workers", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const now = new Date().toISOString();
    const candidate = workerDefinitionSchema.safeParse({
      ...body,
      id: "worker_00000000-0000-0000-8000-000000000000",
      createdAt: now,
      updatedAt: now,
    });
    if (!candidate.success) {
      return await reply.code(400).send({
        error: candidate.error.issues[0]?.message ?? "执行端配置无效",
      });
    }
    if (
      candidate.data.transport === "direct_http" &&
      process.env.TAKEBOARD_ALLOW_INSECURE_REMOTE_WORKER !== "1"
    ) {
      return await reply.code(400).send({
        error: "远程执行端必须使用 HTTPS；普通 HTTP 请先通过 SSH 映射到本机回环地址",
      });
    }
    const {
      id: _id,
      retiredAt: _retiredAt,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...input
    } = candidate.data;
    try {
      const worker = await workerPool.add(input);
      return await reply.code(201).send({ worker });
    } catch (error) {
      return await reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : "无法添加执行端" });
    }
  });

  app.patch<{ Params: { workerId: string } }>(
    "/api/admin/workers/:workerId",
    async (request, reply) => {
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      if (
        body.id !== undefined ||
        body.retiredAt !== undefined ||
        body.createdAt !== undefined ||
        body.updatedAt !== undefined
      ) {
        return await reply.code(400).send({ error: "执行端身份字段不能修改" });
      }
      const current = workerPool.definition(request.params.workerId);
      const resultingTransport = body.transport ?? current?.transport;
      if (
        (body.endpoint !== undefined || body.transport !== undefined) &&
        resultingTransport === "direct_http" &&
        process.env.TAKEBOARD_ALLOW_INSECURE_REMOTE_WORKER !== "1"
      ) {
        return await reply.code(400).send({
          error: "远程执行端必须使用 HTTPS；普通 HTTP 请先通过 SSH 映射到本机回环地址",
        });
      }
      try {
        const worker = await workerPool.update(request.params.workerId, body);
        return { worker };
      } catch (error) {
        return await reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : "无法更新执行端" });
      }
    },
  );

  app.delete<{ Params: { workerId: string } }>(
    "/api/admin/workers/:workerId",
    async (request, reply) => {
      try {
        const removed = await workerPool.remove(request.params.workerId);
        return removed ? { removed: true } : await reply.code(404).send({ error: "执行端不存在" });
      } catch (error) {
        return await reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : "无法删除执行端" });
      }
    },
  );

  app.get("/api/workers/comfy", async () => {
    const selectedDevice = workerPool.definition(workerPool.defaultWorkerId);
    if (!selectedDevice?.enabled || selectedDevice.retiredAt) {
      return {
        status: "offline",
        engine: "ComfyUI",
        startup: blockedStartup(platform, launcher, [], "请选择或启用生成设备"),
        control: { canStop: false, message: "未选择可用的生成设备" },
      };
    }
    if (workerPool.defaultWorkerId !== workerPool.localWorkerId) {
      const selected = workerPool.definition(workerPool.defaultWorkerId);
      const health = selected ? await workerPool.probe(selected) : null;
      return {
        status: health?.status === "ready" ? "ready" : "offline",
        engine: "ComfyUI",
        device: health?.device ?? undefined,
        version: health?.version ?? undefined,
        error: health?.error ?? undefined,
        vramTotal: health?.vramTotal ?? undefined,
        vramFree: health?.vramFree ?? undefined,
        startup: blockedStartup(
          platform,
          launcher,
          [],
          "当前使用独立连接的生成服务；不会在项目设备上代启或关闭它",
        ),
        control: { canStop: false, message: "仅管理连接，不会停止远端 ComfyUI 或其他用户的任务" },
      };
    }
    const worker = await probeWorker(runtime, comfyUrl, platform, launcher);
    if (worker) return { ...worker, control: await controlStatus() };
    const startup = await preflight(runtime, comfyUrl, launcher, options);
    return {
      status: "offline",
      engine: "ComfyUI",
      error: "ComfyUI 接口未响应",
      startup,
    } satisfies WorkerPayload;
  });

  app.post<{ Body: { workerId?: string } }>(
    "/api/workers/comfy/release",
    async (request, reply) => {
      const workerId = workerPool.defaultWorkerId;
      if (request.body?.workerId !== workerId)
        return reply.code(409).send({ error: "生成设备已变化，请刷新后重试" });
      if (!projectsRoot || !workerPool.definition(workerId)?.enabled)
        return reply.code(409).send({ error: "请先连接生成设备" });
      try {
        const endpoint = workerPool.endpoint(workerId);
        if (!endpoint) throw new Error("生成设备地址不可用");
        await assertComfyIdle(projectsRoot, workerId, endpoint, runtime.fetch);
        const accepted = await workerPool.client(workerId, false).freeResourcesIfIdle();
        if (!accepted)
          return reply.code(409).send({ error: "设备仍有任务或未接受释放请求，请稍后重试" });
        return { requested: true, workerId };
      } catch (error) {
        return reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : "无法确认设备空闲，未释放显存" });
      }
    },
  );
  app.post<{ Body: { action?: string } }>("/api/workers/comfy/stop", async (request, reply) => {
    if (request.body?.action !== "safe-stop")
      return await reply.code(400).send({ error: "请确认停止生成服务" });
    if (!(await controlStatus()).canStop)
      return await reply.code(409).send({ error: "不能确认服务归属，不会关闭外部启动的 ComfyUI" });
    if (!projectsRoot)
      return await reply.code(409).send({ error: "无法检查项目任务，已阻止停止服务" });
    try {
      await assertComfyIdle(projectsRoot, workerPool.localWorkerId, comfyUrl, runtime.fetch);
      if (!(await controlStatus()).canStop) throw new Error("服务归属已变化，已取消停止操作");
      await launcher.stop();
      await rememberManagedService(false);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (!(await probeWorker(runtime, comfyUrl, platform, launcher))) return { stopped: true };
        await runtime.delay(500);
      }
      return await reply
        .code(502)
        .send({ error: "已发送停止请求，但接口仍响应；未强制结束进程，请重新检测" });
    } catch (cause) {
      return await reply
        .code(409)
        .send({ error: cause instanceof Error ? cause.message : "无法安全停止生成服务" });
    }
  });

  app.post<{ Body: { action?: string } }>("/api/workers/comfy/start", async (request, reply) => {
    if (!workerPool.definition(workerPool.defaultWorkerId)?.enabled)
      return reply.code(409).send({ error: "请先选择或启用生成设备" });
    if (workerPool.defaultWorkerId !== workerPool.localWorkerId)
      return await reply
        .code(409)
        .send({ error: "当前连接的是独立生成服务，不会在本机误启动 ComfyUI" });
    if (!request.headers["content-type"]?.includes("application/json")) {
      return await reply.code(415).send({ error: "需要 JSON 启动确认" });
    }
    if (request.body?.action !== "safe-start") {
      return await reply.code(400).send({ error: "缺少安全启动确认" });
    }
    const connected = await probeWorker(runtime, comfyUrl, platform, launcher);
    if (connected) return connected;
    if (starting) {
      return await reply.code(409).send({
        status: "offline",
        engine: "ComfyUI",
        startup: {
          state: "starting",
          canStart: false,
          message: "ComfyUI 正在启动，请稍候",
          platform,
          launcher: launcher.kind,
          checks: [],
        },
      } satisfies WorkerPayload);
    }

    const startup = await preflight(runtime, comfyUrl, launcher, options);
    if (!startup.canStart) {
      return await reply.code(409).send({
        status: "offline",
        engine: "ComfyUI",
        error: startup.message,
        startup,
      } satisfies WorkerPayload);
    }

    starting = true;
    try {
      const worker = await launchAndWait();
      if (worker) {
        if (await launcher.canStop?.()) await rememberManagedService(true);
        return worker;
      }
      try {
        await launcher.stop();
      } catch (rollbackError) {
        const detail = rollbackError instanceof Error ? rollbackError.message : "未知回滚错误";
        return await reply.code(502).send({
          status: "offline",
          engine: "ComfyUI",
          error: `ComfyUI 未在限定时间内响应，自动停止失败：${detail}`,
          startup: blockedStartup(
            platform,
            launcher,
            startup.checks,
            "启动超时且自动回滚失败，请立即检查对应平台的服务状态",
          ),
        } satisfies WorkerPayload);
      }
      return await reply.code(502).send({
        status: "offline",
        engine: "ComfyUI",
        error: "ComfyUI 未在限定时间内响应，已自动停止",
        startup: blockedStartup(platform, launcher, startup.checks, "启动超时，已安全回滚"),
      } satisfies WorkerPayload);
    } catch (error) {
      let rollbackError: unknown = null;
      try {
        await launcher.stop();
      } catch (cause) {
        rollbackError = cause;
      }
      const launchDetail = error instanceof Error ? error.message : "ComfyUI 启动失败";
      const rollbackDetail =
        rollbackError instanceof Error ? rollbackError.message : "未知回滚错误";
      return await reply.code(502).send({
        status: "offline",
        engine: "ComfyUI",
        error: rollbackError ? `${launchDetail}；自动回滚失败：${rollbackDetail}` : launchDetail,
        startup: blockedStartup(
          platform,
          launcher,
          startup.checks,
          rollbackError
            ? "启动失败且自动回滚失败，请立即检查对应平台的服务状态"
            : "启动失败，请检查对应平台的服务日志",
        ),
      } satisfies WorkerPayload);
    } finally {
      starting = false;
    }
  });
}
