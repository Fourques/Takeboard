import { execFile as execFileCallback } from "node:child_process";
import { arch, freemem } from "node:os";
import { promisify } from "node:util";
import { executionPolicySchema, workerDefinitionSchema } from "@takeboard/contracts";
import type { FastifyInstance } from "fastify";
import {
  type ComfyLauncher,
  createComfyLauncher,
  launcherConfigFromEnvironment,
} from "./comfy-launcher.js";
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
    const worker = await probeWorker(runtime, comfyUrl, platform, launcher);
    if (worker) return worker;
    const startup = await preflight(runtime, comfyUrl, launcher, options);
    return {
      status: "offline",
      engine: "ComfyUI",
      error: "ComfyUI 接口未响应",
      startup,
    } satisfies WorkerPayload;
  });

  app.post<{ Body: { action?: string } }>("/api/workers/comfy/start", async (request, reply) => {
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
      await launcher.start();
      const startedAt = Date.now();
      while (Date.now() - startedAt < options.startupTimeoutMs) {
        await runtime.delay(1_000);
        const worker = await probeWorker(runtime, comfyUrl, platform, launcher);
        if (worker) return worker;
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
