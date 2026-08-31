import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ExecutionPolicy,
  RunCost,
  WorkerDefinition,
  WorkerHealth,
  WorkerSelectionCandidate,
} from "@takeboard/contracts";
import { workerDefinitionSchema } from "@takeboard/contracts";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import { ComfyClient } from "@takeboard/executor-comfy";

type WorkerFile = { version: 1; workers: WorkerDefinition[] };

export type WorkerSelectionInput = {
  policy: ExecutionPolicy;
  requestedWorkerId?: string | null;
  containsSensitiveInputs: boolean;
  budgetCap?: number | null;
  budgetCurrency?: string | null;
  estimatedJobSeconds?: number | null;
  deferSingleWorkerProbe?: boolean;
};

export type WorkerSelection = {
  worker: WorkerDefinition;
  health: WorkerHealth;
  estimatedCost: RunCost;
  reason: string;
  candidates: WorkerSelectionCandidate[];
};

export class WorkerSelectionError extends Error {
  constructor(
    message: string,
    readonly candidates: WorkerSelectionCandidate[],
  ) {
    super(message);
    this.name = "WorkerSelectionError";
  }
}

function normalizeEndpoint(value: string) {
  return value.replace(/\/+$/, "");
}

function loopbackEndpoint(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function deterministicWorkerId(endpoint: string) {
  const hex = createHash("sha256").update(normalizeEndpoint(endpoint)).digest("hex").slice(0, 32);
  return `worker_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function defaultWorker(endpoint: string): WorkerDefinition {
  const now = toIsoTimestamp();
  const loopback = loopbackEndpoint(endpoint);
  return workerDefinitionSchema.parse({
    id: deterministicWorkerId(endpoint),
    name: loopback ? "本机 ComfyUI" : "默认远程 ComfyUI",
    endpoint: normalizeEndpoint(endpoint),
    kind: loopback ? "local" : "remote",
    transport: loopback ? "loopback" : endpoint.startsWith("https://") ? "https" : "direct_http",
    enabled: true,
    allowSensitiveInputs: loopback || endpoint.startsWith("https://"),
    qualityTier: "balanced",
    priority: 70,
    hourlyRate: null,
    currency: "CNY",
    estimatedJobSeconds: 300,
    retiredAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

function parseQueue(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return { running: 0, pending: 0 };
  const record = payload as Record<string, unknown>;
  return {
    running: Array.isArray(record.queue_running) ? record.queue_running.length : 0,
    pending: Array.isArray(record.queue_pending) ? record.queue_pending.length : 0,
  };
}

function estimateCost(worker: WorkerDefinition, seconds: number, at: string): RunCost {
  if (worker.hourlyRate === null) {
    return {
      amount: null,
      currency: worker.currency,
      accuracy: "unknown",
      source: "unavailable",
      computeSeconds: seconds,
      unitRatePerHour: null,
      recordedAt: at,
    };
  }
  return {
    amount: Number(((worker.hourlyRate * seconds) / 3_600).toFixed(6)),
    currency: worker.currency,
    accuracy: "estimated",
    source: "worker_rate",
    computeSeconds: seconds,
    unitRatePerHour: worker.hourlyRate,
    recordedAt: at,
  };
}

function qualityRank(tier: WorkerDefinition["qualityTier"]) {
  if (tier === "final") return 3;
  if (tier === "balanced") return 2;
  return 1;
}

function policyLabel(policy: ExecutionPolicy) {
  return {
    balanced: "均衡",
    local_only: "仅本机",
    private: "隐私优先",
    fastest: "最快完成",
    economical: "成本优先",
    best_quality: "质量优先",
    budget_cap: "预算上限",
  }[policy];
}

export class WorkerPool {
  readonly defaultWorkerId: string;
  private workers: WorkerDefinition[];
  private readonly clients = new Map<string, ComfyClient>();
  private readonly runtimeFetch: typeof fetch;

  constructor(
    private readonly storagePath: string,
    defaultEndpoint: string,
    runtimeFetch: typeof fetch = fetch,
  ) {
    this.runtimeFetch = runtimeFetch;
    const primary = defaultWorker(defaultEndpoint);
    this.defaultWorkerId = primary.id;
    this.workers = this.load();
    const existing = this.workers.find((worker) => worker.id === primary.id);
    if (existing) {
      this.workers = this.workers.map((worker) =>
        worker.id === primary.id ? { ...worker, endpoint: primary.endpoint } : worker,
      );
    } else {
      this.workers.unshift(primary);
    }
  }

  private load() {
    if (!existsSync(this.storagePath)) return [];
    try {
      const payload = JSON.parse(readFileSync(this.storagePath, "utf8")) as Partial<WorkerFile>;
      if (payload.version !== 1 || !Array.isArray(payload.workers)) return [];
      return payload.workers.flatMap((worker) => {
        const parsed = workerDefinitionSchema.safeParse(worker);
        return parsed.success ? [parsed.data] : [];
      });
    } catch {
      return [];
    }
  }

  private async persist() {
    await mkdir(dirname(this.storagePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.storagePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify({ version: 1, workers: this.workers } satisfies WorkerFile, null, 2)}\n`,
      { flag: "w", mode: 0o600 },
    );
    await rename(temporary, this.storagePath);
    await chmod(this.storagePath, 0o600).catch(() => undefined);
  }

  definitions() {
    return this.workers
      .filter((worker) => worker.retiredAt === null)
      .map((worker) => ({ ...worker }));
  }

  definition(workerId: string) {
    return this.workers.find((worker) => worker.id === workerId) ?? null;
  }

  async add(input: Omit<WorkerDefinition, "id" | "retiredAt" | "createdAt" | "updatedAt">) {
    const now = toIsoTimestamp();
    const worker = workerDefinitionSchema.parse({
      ...input,
      endpoint: normalizeEndpoint(input.endpoint),
      id: createTakeBoardId("worker"),
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    });
    if (this.workers.some((candidate) => candidate.endpoint === worker.endpoint)) {
      throw new Error("这个执行端地址已经存在");
    }
    this.workers.push(worker);
    await this.persist();
    return worker;
  }

  async update(workerId: string, patch: Partial<WorkerDefinition>) {
    const current = this.definition(workerId);
    if (!current) throw new Error("执行端不存在");
    if (current.retiredAt !== null) throw new Error("执行端已经移除，不能继续修改");
    const updated = workerDefinitionSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      endpoint: normalizeEndpoint(patch.endpoint ?? current.endpoint),
      createdAt: current.createdAt,
      updatedAt: toIsoTimestamp(),
    });
    if (updated.transport === "direct_http" && updated.allowSensitiveInputs) {
      throw new Error("未加密的远程 HTTP 执行端不能接收敏感素材");
    }
    if (
      this.workers.some(
        (candidate) => candidate.id !== updated.id && candidate.endpoint === updated.endpoint,
      )
    ) {
      throw new Error("这个执行端地址已经存在");
    }
    this.workers = this.workers.map((worker) => (worker.id === workerId ? updated : worker));
    this.invalidateClients(workerId);
    await this.persist();
    return updated;
  }

  async remove(workerId: string) {
    if (workerId === this.defaultWorkerId) throw new Error("默认执行端不能删除，可以停用");
    const current = this.definition(workerId);
    if (!current || current.retiredAt !== null) return false;
    const retiredAt = toIsoTimestamp();
    this.workers = this.workers.map((worker) =>
      worker.id === workerId
        ? { ...worker, enabled: false, retiredAt, updatedAt: retiredAt }
        : worker,
    );
    await this.persist();
    return true;
  }

  private invalidateClients(workerId: string) {
    for (const key of this.clients.keys()) {
      if (key.startsWith(`${workerId}:`)) this.clients.delete(key);
    }
  }

  client(workerId: string | null | undefined, liveProgress = true) {
    const worker = this.definition(workerId ?? "") ?? this.definition(this.defaultWorkerId);
    if (!worker) throw new Error("没有可用的 ComfyUI 执行端");
    const cacheKey = `${worker.id}:${liveProgress ? "live" : "quiet"}`;
    const cached = this.clients.get(cacheKey);
    if (cached) return cached;
    const client = new ComfyClient(worker.endpoint, { liveProgress });
    this.clients.set(cacheKey, client);
    return client;
  }

  endpoint(workerId: string | null | undefined) {
    return (
      this.definition(workerId ?? "")?.endpoint ?? this.definition(this.defaultWorkerId)?.endpoint
    );
  }

  async probe(worker: WorkerDefinition): Promise<WorkerHealth> {
    const checkedAt = toIsoTimestamp();
    if (!worker.enabled) {
      return {
        worker,
        status: "disabled",
        version: null,
        device: null,
        vramTotal: null,
        vramFree: null,
        queueRunning: 0,
        queuePending: 0,
        latencyMs: null,
        checkedAt,
        error: null,
      };
    }
    const startedAt = performance.now();
    try {
      const statsResponse = await this.runtimeFetch(`${worker.endpoint}/system_stats`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!statsResponse.ok) throw new Error(`HTTP ${statsResponse.status}`);
      const stats = (await statsResponse.json()) as {
        system?: { comfyui_version?: string };
        devices?: Array<{ name?: string; vram_total?: number; vram_free?: number }>;
      };
      const queueResponse = await this.runtimeFetch(`${worker.endpoint}/queue`, {
        signal: AbortSignal.timeout(3_000),
      }).catch(() => null);
      const queue =
        queueResponse?.ok === true
          ? parseQueue(await queueResponse.json().catch(() => null))
          : parseQueue(null);
      const device = stats.devices?.[0];
      return {
        worker,
        status: "ready",
        version: stats.system?.comfyui_version ?? "unknown",
        device: device?.name ?? "执行设备",
        vramTotal: device?.vram_total ?? null,
        vramFree: device?.vram_free ?? null,
        queueRunning: queue.running,
        queuePending: queue.pending,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        checkedAt,
        error: null,
      };
    } catch (error) {
      return {
        worker,
        status: "offline",
        version: null,
        device: null,
        vramTotal: null,
        vramFree: null,
        queueRunning: 0,
        queuePending: 0,
        latencyMs: null,
        checkedAt,
        error: error instanceof Error ? error.message.slice(0, 2_000) : "执行端未响应",
      };
    }
  }

  async fleet() {
    return await Promise.all(
      this.workers
        .filter((worker) => worker.retiredAt === null)
        .map(async (worker) => await this.probe(worker)),
    );
  }

  async select(input: WorkerSelectionInput): Promise<WorkerSelection> {
    const enabledWorkers = this.workers.filter(
      (worker) => worker.enabled && worker.retiredAt === null,
    );
    const deferredSingleWorker = input.deferSingleWorkerProbe && enabledWorkers.length === 1;
    const health = deferredSingleWorker
      ? [
          {
            worker: enabledWorkers[0] as WorkerDefinition,
            status: "ready" as const,
            version: null,
            device: null,
            vramTotal: null,
            vramFree: null,
            queueRunning: 0,
            queuePending: 0,
            latencyMs: null,
            checkedAt: toIsoTimestamp(),
            error: null,
          },
        ]
      : await this.fleet();
    const at = toIsoTimestamp();
    const candidates = health.map((entry) => {
      const seconds = input.estimatedJobSeconds ?? entry.worker.estimatedJobSeconds;
      const estimatedCost = estimateCost(entry.worker, seconds, at);
      const queueDepth = entry.queueRunning + entry.queuePending;
      let eligible = entry.status === "ready";
      let reason = eligible
        ? deferredSingleWorker
          ? "唯一已配置节点；连接能力将由 Recipe 预检再次确认"
          : "在线，满足基础执行条件"
        : entry.status === "disabled"
          ? "已停用"
          : "当前离线";
      if (eligible && input.policy === "local_only" && entry.worker.kind !== "local") {
        eligible = false;
        reason = "仅本机策略不使用远程执行端";
      }
      if (
        eligible &&
        (input.policy === "private" || input.containsSensitiveInputs) &&
        !entry.worker.allowSensitiveInputs
      ) {
        eligible = false;
        reason = "该执行端未获准接收敏感素材";
      }
      if (eligible && input.policy === "budget_cap") {
        if (
          estimatedCost.amount === null ||
          !input.budgetCurrency ||
          estimatedCost.currency !== input.budgetCurrency
        ) {
          eligible = false;
          reason = "无法用所选币种验证预算上限";
        } else if (input.budgetCap === null || input.budgetCap === undefined) {
          eligible = false;
          reason = "预算策略缺少单次预算上限";
        } else if (estimatedCost.amount > input.budgetCap) {
          eligible = false;
          reason = `预计成本 ${estimatedCost.amount.toFixed(2)} ${estimatedCost.currency} 超过上限`;
        }
      }
      let score: number | null = null;
      if (eligible) {
        const queueSeconds = queueDepth * seconds;
        const latencySeconds = (entry.latencyMs ?? 3_000) / 1_000;
        if (input.policy === "fastest") score = queueSeconds + latencySeconds;
        else if (input.policy === "economical") {
          score = estimatedCost.amount === null ? 1_000_000 + queueSeconds : estimatedCost.amount;
        } else if (input.policy === "best_quality") {
          score =
            -qualityRank(entry.worker.qualityTier) * 1_000_000 -
            entry.worker.priority * 1_000 +
            queueSeconds;
        } else {
          score =
            queueSeconds +
            latencySeconds -
            entry.worker.priority * 2 +
            (entry.worker.kind === "local" ? -30 : 0);
        }
        reason = `${policyLabel(input.policy)}候选 · 队列 ${queueDepth} · 优先级 ${entry.worker.priority}`;
      }
      return {
        workerId: entry.worker.id,
        workerName: entry.worker.name,
        eligible,
        score,
        estimatedCost,
        queueDepth,
        reason,
      } satisfies WorkerSelectionCandidate;
    });

    if (input.requestedWorkerId) {
      const requested = candidates.find(
        (candidate) => candidate.workerId === input.requestedWorkerId,
      );
      if (!requested?.eligible) {
        throw new WorkerSelectionError(requested?.reason ?? "指定的执行端不存在", candidates);
      }
      const selectedHealth = health.find((entry) => entry.worker.id === requested.workerId);
      if (!selectedHealth) throw new WorkerSelectionError("指定的执行端不存在", candidates);
      return {
        worker: selectedHealth.worker,
        health: selectedHealth,
        estimatedCost: requested.estimatedCost,
        reason: `已按用户指定选择 ${selectedHealth.worker.name}；${requested.reason}`,
        candidates,
      };
    }

    const selected = candidates
      .filter((candidate) => candidate.eligible && candidate.score !== null)
      .sort((left, right) => (left.score ?? 0) - (right.score ?? 0))[0];
    if (!selected) {
      throw new WorkerSelectionError("当前策略下没有可用的执行端", candidates);
    }
    const selectedHealth = health.find((entry) => entry.worker.id === selected.workerId);
    if (!selectedHealth) throw new WorkerSelectionError("选中的执行端已不可用", candidates);
    return {
      worker: selectedHealth.worker,
      health: selectedHealth,
      estimatedCost: selected.estimatedCost,
      reason: `${policyLabel(input.policy)}策略选择 ${selected.workerName}；${selected.reason}`,
      candidates,
    };
  }
}
