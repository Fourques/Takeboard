import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, stat, statfs, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ComfyClient, ComfyOutputFile, ComfyPrompt } from "@takeboard/executor-comfy";
import {
  type GpuLane,
  type GpuPoolConfig,
  type GpuRuntime,
  type GpuSample,
  MiB,
} from "./same-gpu-runtime.js";

type History = NonNullable<Awaited<ReturnType<ComfyClient["history"]>>>;
type Job = {
  id: string;
  prompt: ComfyPrompt;
  clientId: string;
  state: "queued" | "dispatching" | "running" | "collecting" | "completed" | "cancelled";
  executionRunning: boolean;
  lane: number | null;
  history: History | null;
  createdAt: string;
  archives?: Array<{ file: ComfyOutputFile; path: string; mime: string }>;
  collectionError?: string;
};
type Journal = {
  version: 1;
  configHash: string;
  identityHash: string;
  lanes: Array<GpuLane | null>;
  jobs: Job[];
  paused: string | null;
};
const active = (job: Job) => ["running", "dispatching", "collecting"].includes(job.state);

export async function atomicGpuJson(path: string, value: unknown) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const file = await open(tmp, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

/** Fixed per-process allocator caps are reservations, not guessed model requirements. */
export function gpuAdmission(
  sample: GpuSample,
  lanes: Array<GpuLane | null>,
  reserved: number[],
  candidate: number,
  config: GpuPoolConfig,
  now = Date.now(),
): string | null {
  if (
    now - sample.at > 5000 ||
    sample.at > now + 1000 ||
    !Number.isFinite(sample.total) ||
    !Number.isFinite(sample.free) ||
    sample.total <= 0 ||
    sample.free < 0 ||
    sample.free > sample.total ||
    sample.processes.some(
      (p) => !Number.isSafeInteger(p.pid) || p.pid <= 0 || !Number.isFinite(p.used) || p.used < 0,
    )
  )
    return "显存数据不可确认，等待检测恢复";
  const owned = new Set(lanes.flatMap((lane) => (lane ? [lane.pid] : [])));
  if (sample.processes.some((p) => !owned.has(p.pid))) return "这块显卡还有非受管任务，等待其结束";
  const cap = config.instanceMemoryMiB * MiB;
  const used = (index: number) =>
    sample.processes.find((p) => p.pid === lanes[index]?.pid)?.used ?? 0;
  // Current occupancy is already subtracted from free; reserve only future headroom.
  const promised = [...new Set([...reserved, candidate])].reduce(
    (sum, index) => sum + Math.max(0, cap - used(index)),
    0,
  );
  if (sample.free < promised + config.headroomMiB * MiB)
    return "显存预算不足，等待当前任务释放资源";
  return null;
}

export class SameGpuPool {
  private state: Journal;
  private tail = Promise.resolve();
  private poisoned = false;
  private enabled = false;
  private waiting = "执行实例尚未启动";
  private sampleValue: GpuSample | null = null;
  private readonly collections = new Map<string, { abort: AbortController; done: Promise<void> }>();
  async verifyLane(index: number) {
    const lane = this.state.lanes[index];
    if (!lane) throw new Error("执行实例尚未启动");
    await this.runtime.identity(lane);
  }
  constructor(
    readonly config: GpuPoolConfig,
    readonly directory: string,
    readonly runtime: GpuRuntime,
    private readonly writeJournal: typeof atomicGpuJson = atomicGpuJson,
  ) {
    const identityHash = createHash("sha256")
      .update(
        JSON.stringify([
          config.python,
          config.comfyRoot,
          config.gpuUuid,
          config.gatewayPort,
          config.ports,
        ]),
      )
      .digest("hex");
    const configHash = createHash("sha256")
      .update(JSON.stringify([identityHash, config.instanceMemoryMiB, config.headroomMiB]))
      .digest("hex");
    const path = join(directory, "journal.json");
    this.state = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Journal)
      : {
          version: 1,
          configHash,
          identityHash,
          lanes: config.ports.map(() => null),
          jobs: [],
          paused: null,
        };
    if (
      this.state.version !== 1 ||
      !Array.isArray(this.state.jobs) ||
      !Array.isArray(this.state.lanes) ||
      this.state.lanes.length !== config.ports.length
    )
      throw new Error("执行池配置与记录不一致；请使用原配置恢复，不能将旧任务路由到新实例");
    if (
      this.state.identityHash !== identityHash ||
      (this.state.configHash !== configHash &&
        (this.state.lanes.some(Boolean) || this.state.jobs.some(active)))
    )
      throw new Error("请先停止所有实例再修改预算；设备和目录不可替换，避免旧输出归属丢失");
    if (
      new Set(this.state.jobs.map((job) => job.id)).size !== this.state.jobs.length ||
      this.state.jobs.some(
        (job) =>
          !/^[a-f0-9-]{36}$/.test(job.id) ||
          !["queued", "dispatching", "running", "collecting", "completed", "cancelled"].includes(
            job.state,
          ) ||
          (job.lane !== null &&
            (!Number.isInteger(job.lane) || job.lane < 0 || job.lane >= config.ports.length)) ||
          (job.archives !== undefined &&
            (!Array.isArray(job.archives) ||
              job.archives.some(
                (archive) => !new RegExp(`^outputs/${job.id}/[0-9]+$`).test(archive.path),
              ))),
      ) ||
      this.state.lanes.some(
        (lane, index) =>
          lane &&
          (lane.port !== config.ports[index] ||
            !Number.isSafeInteger(lane.pid) ||
            lane.pid <= 0 ||
            !/^[a-f0-9-]{36}$/.test(lane.token)),
      )
    )
      throw new Error("执行记录损坏，已停止自动恢复");
    this.state.configHash = configHash;
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
  private async save() {
    try {
      await this.writeJournal(join(this.directory, "journal.json"), this.state);
    } catch (error) {
      this.poisoned = true;
      this.enabled = false;
      throw error;
    }
  }
  status() {
    return {
      enabled: this.enabled,
      paused: this.state.paused,
      waiting: this.waiting,
      poisoned: this.poisoned,
      gpuUuid: this.config.gpuUuid,
      instanceMemoryMiB: this.config.instanceMemoryMiB,
      headroomMiB: this.config.headroomMiB,
      sample: this.sampleValue,
      instances: this.state.lanes.map((lane, index) => ({
        index,
        port: lane?.port ?? this.config.ports[index],
        active: this.state.jobs.filter((job) => job.lane === index && active(job)).length,
      })),
      queued: this.state.jobs.filter(
        (job) => job.state === "queued" || (active(job) && !job.executionRunning),
      ).length,
      running: this.state.jobs.filter((job) => active(job) && job.executionRunning).length,
      reserved: this.state.jobs.filter(active).length,
    };
  }
  async start() {
    return await this.exclusive(async () => {
      if (this.poisoned) throw new Error("运行记录未写入，需先恢复磁盘后重新启动 TakeBoard");
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const sample = await this.runtime.sample();
      if (
        (this.config.ports.length * this.config.instanceMemoryMiB + this.config.headroomMiB) * MiB >
        sample.total
      )
        throw new Error("实例预算总和超过显卡容量，请减少实例数或每实例预算");
      const reason = gpuAdmission(sample, this.state.lanes, [], 0, this.config);
      if (reason) throw new Error(reason);
      const created: GpuLane[] = [];
      try {
        for (let index = 0; index < this.state.lanes.length; index++) {
          const lane = this.state.lanes[index];
          if (lane) {
            if (!(await this.runtime.stopped(lane))) {
              await this.runtime.identity(lane);
              continue;
            }
            if (this.state.jobs.some((job) => job.lane === index && active(job)))
              throw new Error("原实例已退出，请先取消其未确认任务，再重新启动");
          }
          const spawned = await this.runtime.start(index, randomUUID(), async (owned) => {
            created.push(owned);
            this.state.lanes[index] = owned;
            await this.save();
          });
          this.state.lanes[index] = spawned;
          try {
            await this.save();
          } catch (error) {
            await this.runtime.stop(spawned).catch(() => {});
            throw error;
          }
        }
        this.state.paused = null;
        for (const job of this.state.jobs)
          if (job.state === "collecting") delete job.collectionError;
        await this.save();
        this.enabled = true;
        this.waiting = "";
      } catch (error) {
        this.enabled = false;
        for (const lane of created.reverse()) {
          try {
            if (!(await this.runtime.stopped(lane))) await this.runtime.stop(lane);
            const index = this.state.lanes.findIndex((item) => item?.token === lane.token);
            if (index >= 0) this.state.lanes[index] = null;
            await this.save();
          } catch {
            /* retain journal ownership; never stop an unverified process */
          }
        }
        throw error;
      }
    });
  }
  /** Restore routing only. Never silently launch replacement processes on restart. */
  async resume() {
    await this.exclusive(async () => {
      if (!this.state.lanes.every(Boolean)) return;
      for (const lane of this.state.lanes) if (lane) await this.runtime.identity(lane);
      this.enabled = !this.state.paused;
    });
  }
  async stop() {
    await this.exclusive(async () => {
      if (this.state.jobs.some(active)) throw new Error("请先取消运行中的任务，再停止执行实例");
      this.enabled = false;
      for (let index = 0; index < this.state.lanes.length; index++) {
        const lane = this.state.lanes[index];
        if (!lane) continue;
        // Keep lane identities while results still refer to their media directories.
        await this.runtime.stop(lane);
        this.state.lanes[index] = null;
        await this.save();
      }
      this.waiting = "实例已停止；输出文件保留在原目录";
    });
  }
  async upload(bytes: Uint8Array, filename: string) {
    const name = `tbpool_${randomUUID()}_${basename(filename)
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .slice(-100)}`;
    await mkdir(join(this.directory, "staging"), { recursive: true, mode: 0o700 });
    const file = await open(join(this.directory, "staging", name), "wx", 0o600);
    try {
      await file.writeFile(bytes);
    } finally {
      await file.close();
    }
    return name;
  }
  async enqueue(prompt: ComfyPrompt, clientId: string) {
    return await this.exclusive(async () => {
      if (this.poisoned) throw new Error("运行记录不可写，未接收任务");
      if (this.state.jobs.filter((job) => job.state === "queued").length >= 256)
        throw new Error("等待队列已满，请先处理现有任务");
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const job: Job = {
        id: randomUUID(),
        prompt: structuredClone(prompt),
        clientId,
        state: "queued",
        executionRunning: false,
        lane: null,
        history: null,
        createdAt: new Date().toISOString(),
      };
      this.state.jobs.push(job);
      await this.save();
      return job.id;
    });
  }
  private job(id: string) {
    const job = this.state.jobs.find((item) => item.id === id);
    if (!job) throw new Error("执行池中没有这个任务；不会改用其他实例");
    return job;
  }
  private async laneClient(job: Job) {
    const lane = job.lane === null ? null : this.state.lanes[job.lane];
    if (!lane) throw new Error("原执行实例不可用");
    await this.runtime.identity(lane);
    return this.runtime.client(lane);
  }
  async pump() {
    await this.exclusive(async () => {
      if (this.poisoned) return;
      // Reconciliation also runs when admissions are paused.
      for (const job of this.state.jobs.filter(active)) {
        if (job.state === "collecting") {
          if (!this.collections.has(job.id) && !job.collectionError) this.collect(job);
          continue;
        }
        try {
          const client = await this.laneClient(job);
          const history = await client.history(job.id);
          const queue = await client.queueState(job.id);
          if (
            history &&
            (history.status?.completed ||
              ["success", "error"].includes(history.status?.status_str ?? "")) &&
            !queue.running &&
            !queue.pending
          ) {
            job.history = {
              ...(history.outputs ? { outputs: history.outputs } : {}),
              ...(history.status ? { status: history.status } : {}),
            };
            job.prompt = {};
            job.executionRunning = false;
            job.state = "collecting";
            if (
              /out.of.memory|OutOfMemory|allocation.*fail/i.test(
                JSON.stringify(history.status?.messages),
              )
            )
              this.state.paused = "任务超出实例显存上限，已暂停新任务；请检查预算后继续";
            await this.save();
            await client.freeResourcesIfIdle();
            client.forgetProgress(job.id);
            this.collect(job);
          } else if (queue.running || queue.pending) {
            if (job.state !== "running" || job.executionRunning !== queue.running) {
              job.state = "running";
              job.executionRunning = queue.running;
              await this.save();
            }
          } else {
            this.state.paused = "任务提交或执行结果尚未确认；保留预算，不自动重试";
            await this.save();
          }
        } catch (error) {
          this.waiting = error instanceof Error ? error.message : "实例暂时不可达";
          return;
        }
      }
      if (!this.enabled || this.state.paused) return;
      let sample: GpuSample;
      try {
        sample = await this.runtime.sample();
        this.sampleValue = sample;
      } catch {
        this.sampleValue = null;
        this.waiting = "显存数据不可确认，等待检测恢复";
        return;
      }
      for (let index = 0; index < this.state.lanes.length; index++) {
        if (this.state.jobs.some((job) => job.lane === index && active(job))) continue;
        const job = this.state.jobs.find((item) => item.state === "queued");
        const lane = this.state.lanes[index];
        if (!job || !lane) continue;
        const reserved = this.state.jobs
          .filter(active)
          .flatMap((item) => (item.lane === null ? [] : [item.lane]));
        this.waiting = gpuAdmission(sample, this.state.lanes, reserved, index, this.config) ?? "";
        if (this.waiting) return;
        await this.runtime.identity(lane);
        const client = this.runtime.client(lane);
        // No foreign task may share an instance (including users manually queuing in ComfyUI).
        if (!(await client.isIdle())) {
          this.waiting = "实例仍有任务或状态不可确认";
          return;
        }
        const prompt = structuredClone(job.prompt);
        const visit = async (value: unknown): Promise<unknown> => {
          if (typeof value === "string" && /^tbpool_[a-f0-9-]+_[a-zA-Z0-9_.-]+$/.test(value)) {
            const bytes = await readFile(join(this.directory, "staging", value));
            return await client.uploadInput(bytes, value, "application/octet-stream");
          }
          if (Array.isArray(value)) return await Promise.all(value.map(visit));
          if (value && typeof value === "object") {
            const pairs = await Promise.all(
              Object.entries(value).map(async ([key, child]) => [key, await visit(child)]),
            );
            return Object.fromEntries(pairs);
          }
          return value;
        };
        const readyPrompt = (await visit(prompt)) as ComfyPrompt;
        const issues = await client.preflightPrompt(readyPrompt);
        if (issues.length) {
          this.waiting = "这个实例缺少工作流依赖，请检查 ComfyUI 环境";
          return;
        }
        // Uploads and node checks can take longer than the telemetry freshness window.
        try {
          sample = await this.runtime.sample();
          this.sampleValue = sample;
        } catch {
          this.sampleValue = null;
          this.waiting = "显存数据不可确认，等待检测恢复";
          return;
        }
        this.waiting = gpuAdmission(sample, this.state.lanes, reserved, index, this.config) ?? "";
        if (this.waiting) return;
        await this.runtime.identity(lane);
        job.lane = index;
        job.state = "dispatching";
        await this.save(); // Reserve before the external side effect; crash recovery uses this same UUID.
        try {
          await client.submit(readyPrompt, job.clientId, job.id);
        } catch {
          this.state.paused = "提交结果尚未确认，已保留预算；不会重复提交";
          await this.save();
          return;
        }
        job.state = "running";
        await this.save();
        try {
          job.executionRunning = (await client.queueState(job.id)).running;
          await this.save();
        } catch {
          this.waiting = "任务已提交，等待实例状态恢复";
          return;
        }
        // Refresh telemetry; reservations for other active lanes survive snapshots showing low usage.
        try {
          sample = await this.runtime.sample();
          this.sampleValue = sample;
        } catch {
          this.waiting = "显存数据不可确认，等待检测恢复";
          return;
        }
      }
    });
  }
  async cancel(id: string) {
    this.collections.get(id)?.abort.abort();
    return await this.exclusive(async () => {
      const job = this.job(id);
      if (job.state === "queued") {
        job.state = "cancelled";
        await this.save();
        return true;
      }
      if (job.state === "completed" || job.state === "cancelled") return true;
      if (job.state === "collecting") {
        job.state = "cancelled";
        await this.save();
        return true;
      }
      const lane = job.lane === null ? null : this.state.lanes[job.lane];
      if (lane && (await this.runtime.stopped(lane))) {
        job.state = "cancelled";
        await this.save();
        return true;
      }
      const client = await this.laneClient(job);
      if (job.state === "dispatching") {
        // An absent queue entry cannot prove a timed-out HTTP submission won't arrive later.
        if (!lane) return false;
        await this.runtime.stop(lane);
        if (job.lane !== null) this.state.lanes[job.lane] = null;
        job.state = "cancelled";
        await this.save();
        return true;
      }
      if (!(await client.cancel(id))) return false;
      job.state = "cancelled";
      await this.save();
      await client.freeResourcesIfIdle();
      return true;
    });
  }
  queue(id: string) {
    const job = this.job(id);
    return {
      running: active(job) && job.executionRunning,
      pending: job.state === "queued" || (active(job) && !job.executionRunning),
    };
  }
  queueEntries() {
    return {
      queue_running: this.state.jobs
        .filter((job) => active(job) && job.executionRunning)
        .map((job) => [0, job.id]),
      queue_pending: this.state.jobs
        .filter((job) => job.state === "queued" || (active(job) && !job.executionRunning))
        .map((job) => [0, job.id]),
    };
  }
  ownsClient(id: string, clientId: string) {
    return this.state.jobs.some((job) => job.id === id && job.clientId === clientId);
  }
  async freeIdle() {
    return await this.exclusive(async () => {
      for (const [index, lane] of this.state.lanes.entries()) {
        if (!lane || this.state.jobs.some((job) => job.lane === index && active(job))) continue;
        await this.runtime.identity(lane);
        await this.runtime.client(lane).freeResourcesIfIdle();
      }
    });
  }
  async pause() {
    await this.exclusive(async () => {
      this.enabled = false;
    });
  }
  progress(id: string) {
    const job = this.job(id);
    if (job.lane === null) return null;
    const lane = this.state.lanes[job.lane];
    return lane ? this.runtime.client(lane).progress(job.id) : null;
  }
  async history(id: string): Promise<History | null> {
    const job = this.job(id);
    if (!job.history || job.state !== "completed") return null;
    const history = structuredClone(job.history);
    for (const output of Object.values(history.outputs ?? {}))
      for (const files of [output.images, output.videos, output.gifs])
        for (const file of files ?? []) file.subfolder = `__tbpool/${id}/${file.subfolder}`;
    return history;
  }
  async download(file: ComfyOutputFile, signal?: AbortSignal): Promise<Response> {
    const match = /^__tbpool\/([a-f0-9-]{36})\/(.*)$/.exec(file.subfolder);
    if (!match?.[1]) throw new Error("输出缺少执行实例归属");
    const job = this.job(match[1]);
    const original = { ...file, subfolder: match[2] ?? "" };
    const allowed = Object.values(job.history?.outputs ?? {}).flatMap((output) => [
      ...(output.images ?? []),
      ...(output.videos ?? []),
      ...(output.gifs ?? []),
    ]);
    if (
      !allowed.some(
        (item) =>
          item.filename === original.filename &&
          item.subfolder === original.subfolder &&
          item.type === original.type,
      )
    )
      throw new Error("文件不属于这个任务的输出");
    const archive = job.archives?.find(
      (item) =>
        item.file.filename === original.filename &&
        item.file.subfolder === original.subfolder &&
        item.file.type === original.type,
    );
    if (!archive) throw new Error("输出副本尚未保存，请检查执行池状态");
    const path = join(this.directory, archive.path);
    const info = await stat(path);
    const stream = createReadStream(path, { ...(signal ? { signal } : {}) });
    return new Response(Readable.toWeb(stream) as ConstructorParameters<typeof Response>[0], {
      headers: { "content-type": archive.mime, "content-length": String(info.size) },
    });
  }
  private collect(job: Job) {
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30 * 60_000)]);
    const done = (async () => {
      try {
        const client = await this.laneClient(job);
        const files = Object.values(job.history?.outputs ?? {}).flatMap((output) => [
          ...(output.images ?? []),
          ...(output.videos ?? []),
          ...(output.gifs ?? []),
        ]);
        const archives: NonNullable<Job["archives"]> = [];
        await mkdir(join(this.directory, "outputs", job.id), { recursive: true, mode: 0o700 });
        for (const [index, file] of files.entries()) {
          const path = `outputs/${job.id}/${index}`;
          const temporary = join(this.directory, `${path}.partial`);
          const response = await client.downloadResponse(file, signal);
          if (!response.body) throw new Error("生成结果为空");
          const disk = await statfs(this.directory);
          const limit = disk.bavail * disk.bsize - 512 * MiB;
          if (limit <= 0) throw new Error("保存输出的磁盘空间不足");
          let written = 0;
          const budget = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              written += chunk.length;
              callback(written > limit ? new Error("输出超过当前磁盘余量") : null, chunk);
            },
          });
          try {
            await pipeline(
              Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
              budget,
              createWriteStream(temporary, { flags: "w", mode: 0o600 }),
              { signal },
            );
            const handle = await open(temporary, "r+");
            try {
              await handle.sync();
            } finally {
              await handle.close();
            }
            await rename(temporary, join(this.directory, path));
          } catch (error) {
            await unlink(temporary).catch(() => {});
            throw error;
          }
          archives.push({
            file,
            path,
            mime: response.headers.get("content-type") ?? "application/octet-stream",
          });
        }
        await this.exclusive(async () => {
          if (job.state !== "collecting") return;
          job.archives = archives;
          job.state = "completed";
          await this.save();
        });
      } catch (error) {
        await this.exclusive(async () => {
          if (job.state !== "collecting") return;
          job.collectionError = error instanceof Error ? error.message : "输出保存失败";
          this.state.paused = "输出尚未安全保存，保留原实例，请检查磁盘或连接后继续";
          await this.save();
        });
      } finally {
        this.collections.delete(job.id);
      }
    })();
    this.collections.set(job.id, { abort, done });
    void done.catch(() => {
      this.poisoned = true;
      this.enabled = false;
    });
  }
  async settled() {
    await Promise.allSettled([...this.collections.values()].map((item) => item.done));
  }
  async suspendCollections() {
    for (const item of this.collections.values()) item.abort.abort();
    await this.settled();
  }
}
