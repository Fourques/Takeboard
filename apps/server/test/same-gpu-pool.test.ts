import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComfyClient, type ComfyOutputFile, type ComfyPrompt } from "@takeboard/executor-comfy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGpuGateway } from "../src/same-gpu-gateway.js";
import { atomicGpuJson, gpuAdmission, SameGpuPool } from "../src/same-gpu-pool.js";
import {
  type GpuLane,
  type GpuPoolConfig,
  type GpuRuntime,
  type GpuSample,
  MiB,
  parseGpuPoolConfig,
} from "../src/same-gpu-runtime.js";

const config: GpuPoolConfig = {
  python: "/python",
  comfyRoot: "/comfy",
  gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
  gatewayPort: 18200,
  ports: [18201, 18202],
  instanceMemoryMiB: 8192,
  headroomMiB: 2048,
};
const prompt: ComfyPrompt = { "1": { class_type: "TestImage", inputs: { seed: 1 } } };
type History = NonNullable<Awaited<ReturnType<ComfyClient["history"]>>>;
class TestClient extends ComfyClient {
  jobs = new Map<string, ComfyPrompt>();
  results = new Map<string, History>();
  cancelled: string[] = [];
  uploads: string[] = [];
  loseAck = false;
  constructor(readonly index: number) {
    super("http://unused.test", { liveProgress: false });
  }
  override async submit(p: ComfyPrompt, _client?: string, id?: string) {
    if (!id) throw new Error("A durable caller-assigned UUID is required");
    this.jobs.set(id, p);
    if (this.loseAck) throw new Error("Response lost after acceptance");
    return id;
  }
  override async queueState(id: string) {
    return { running: this.jobs.has(id), pending: false };
  }
  override async history(id: string) {
    return this.results.get(id) ?? null;
  }
  override async preflightPrompt() {
    return [];
  }
  override async uploadInput(_bytes: Uint8Array, filename: string) {
    this.uploads.push(filename);
    return filename;
  }
  override async cancel(id: string) {
    this.cancelled.push(id);
    this.jobs.delete(id);
    return true;
  }
  override async freeResourcesIfIdle() {
    return this.jobs.size === 0;
  }
  override async isIdle() {
    return this.jobs.size === 0;
  }
  override async downloadResponse(_file: ComfyOutputFile) {
    return new Response(`instance-${this.index}`);
  }
  complete(id: string, error = false) {
    this.jobs.delete(id);
    this.results.set(id, {
      outputs: { "1": { images: [{ filename: "same.png", subfolder: "", type: "output" }] } },
      status: {
        completed: true,
        status_str: error ? "error" : "success",
        messages: error ? ["CUDA out of memory"] : [],
      },
    });
  }
}
class TestRuntime implements GpuRuntime {
  clients = [new TestClient(0), new TestClient(1)];
  lanes: GpuLane[] = [];
  dead = new Set<number>();
  telemetry: GpuSample = { at: Date.now(), total: 24576 * MiB, free: 22528 * MiB, processes: [] };
  missing = false;
  mismatch = false;
  stopCalls: number[] = [];
  async sample() {
    if (this.missing) throw new Error("Telemetry offline");
    return { ...this.telemetry, at: Date.now() };
  }
  async start(index: number, token: string, onSpawn: (lane: GpuLane) => Promise<void>) {
    const lane = { pid: 100 + index, port: config.ports[index] ?? 0, token };
    this.lanes[index] = lane;
    this.dead.delete(lane.pid);
    await onSpawn(lane);
    return lane;
  }
  async identity(lane: GpuLane) {
    if (this.mismatch || this.dead.has(lane.pid) || !this.lanes.some((l) => l.token === lane.token))
      throw new Error("Identity mismatch");
  }
  client(lane: GpuLane) {
    const c = this.clients[config.ports.indexOf(lane.port)];
    if (!c) throw new Error("Unknown lane");
    return c;
  }
  async stopped(lane: GpuLane) {
    return this.dead.has(lane.pid);
  }
  async stop(lane: GpuLane) {
    await this.identity(lane);
    this.stopCalls.push(lane.pid);
    this.dead.add(lane.pid);
    this.client(lane).jobs.clear();
  }
}
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(writer = atomicGpuJson) {
  const root = await mkdtemp(join(tmpdir(), "takeboard-same-gpu-test-"));
  roots.push(root);
  const runtime = new TestRuntime();
  const pool = new SameGpuPool(config, root, runtime, writer);
  await pool.start();
  return { root, runtime, pool };
}

describe("same physical GPU admission and isolated execution", () => {
  it("retains reservations on archive failure and retries only after explicit recovery", async () => {
    const { pool, runtime } = await fixture();
    const id = await pool.enqueue(prompt, "a");
    await pool.pump();
    const client = runtime.clients[0];
    if (!client) throw new Error("Missing lane");
    const download = vi
      .spyOn(client, "downloadResponse")
      .mockRejectedValueOnce(new Error("disk unavailable"));
    client.complete(id);
    await pool.pump();
    await pool.settled();
    expect(pool.status().reserved).toBe(1);
    expect(pool.status().paused).toContain("输出尚未安全保存");
    expect(await pool.history(id)).toBeNull();
    await pool.pump();
    expect(download).toHaveBeenCalledTimes(1);
    await pool.start();
    await pool.pump();
    await pool.settled();
    expect(pool.status().reserved).toBe(0);
    expect(await pool.history(id)).not.toBeNull();
    expect(download).toHaveBeenCalledTimes(2);
  });
  it("rolls back only newly created instances on partial startup failure", async () => {
    const { pool, runtime } = await fixture();
    await pool.stop();
    runtime.stopCalls = [];
    const start = runtime.start.bind(runtime);
    vi.spyOn(runtime, "start").mockImplementation(async (index, token, onSpawn) => {
      if (index === 1) throw new Error("boot failed");
      return start(index, token, onSpawn);
    });
    await expect(pool.start()).rejects.toThrow("boot failed");
    expect(runtime.stopCalls).toEqual([100]);
    expect(pool.status().enabled).toBe(false);
  });
  it("rejects output paths escaping the managed archive", async () => {
    const { root, pool, runtime } = await fixture();
    const id = await pool.enqueue(prompt, "a");
    await pool.pump();
    runtime.clients[0]?.complete(id);
    await pool.pump();
    await pool.settled();
    const journal = JSON.parse(await readFile(join(root, "journal.json"), "utf8"));
    journal.jobs[0].archives[0].path = "../../outside";
    await atomicGpuJson(join(root, "journal.json"), journal);
    expect(() => new SameGpuPool(config, root, runtime)).toThrow("记录损坏");
  });
  it("runs two independent jobs on one GPU and durably queues the third", async () => {
    const { pool, runtime, root } = await fixture();
    const ids = await Promise.all([1, 2, 3].map(() => pool.enqueue(prompt, "client")));
    await Promise.all([pool.pump(), pool.pump()]);
    expect(runtime.clients.map((c) => c.jobs.size)).toEqual([1, 1]);
    expect(pool.status()).toMatchObject({ running: 2, queued: 1 });
    const journal = JSON.parse(await readFile(join(root, "journal.json"), "utf8"));
    expect(journal.jobs.map((job: { id: string }) => job.id)).toEqual(ids);
    expect(new Set(journal.lanes.map((lane: GpuLane) => lane.pid)).size).toBe(2);
  });
  it("holds future peak reservations instead of reusing apparently free VRAM", async () => {
    const { pool, runtime } = await fixture();
    runtime.telemetry.free = 12288 * MiB;
    await pool.enqueue(prompt, "a");
    await pool.enqueue(prompt, "b");
    await pool.pump();
    expect(pool.status()).toMatchObject({ running: 1, queued: 1 });
    runtime.telemetry.free = 16384 * MiB;
    runtime.telemetry.processes = [{ pid: 100, used: 8192 * MiB }];
    await pool.pump();
    expect(pool.status().running).toBe(2);
  });
  it("queues when telemetry disappears or a foreign compute process is present", async () => {
    const { pool, runtime } = await fixture();
    await pool.enqueue(prompt, "client");
    runtime.missing = true;
    await pool.pump();
    expect(pool.status()).toMatchObject({ running: 0, queued: 1 });
    runtime.missing = false;
    runtime.telemetry.processes = [{ pid: 999, used: MiB }];
    await pool.pump();
    expect(runtime.clients[0]?.jobs.size).toBe(0);
    expect(pool.status().waiting).toContain("非受管");
  });
  it("cancels queued work without touching a process, and running work without touching its peer", async () => {
    const { pool, runtime } = await fixture();
    const a = await pool.enqueue(prompt, "a");
    const b = await pool.enqueue(prompt, "b");
    const queued = await pool.enqueue(prompt, "c");
    await pool.pump();
    await pool.cancel(queued);
    expect(runtime.clients.flatMap((c) => c.cancelled)).toEqual([]);
    await pool.cancel(a);
    expect(runtime.clients[0]?.cancelled).toEqual([a]);
    expect(runtime.clients[1]?.jobs.has(b)).toBe(true);
    expect(runtime.stopCalls).toEqual([]);
  });
  it("persists ownership before submit and recovers a lost acknowledgement without resubmission", async () => {
    const { pool, runtime, root } = await fixture();
    const first = runtime.clients[0];
    if (!first) throw new Error("missing fixture lane");
    first.loseAck = true;
    const id = await pool.enqueue(prompt, "a");
    await pool.pump();
    expect(pool.status().paused).toContain("提交结果");
    expect(first.jobs.has(id)).toBe(true);
    const restored = new SameGpuPool(config, root, runtime);
    await restored.resume();
    await restored.pump();
    expect(restored.queue(id).running).toBe(true);
    expect(first.jobs.size).toBe(1);
    expect(restored.status().paused).not.toBeNull();
  });
  it("stops only the uncertain instance when cancelling an unacknowledged submission", async () => {
    const { pool, runtime } = await fixture();
    const first = runtime.clients[0];
    if (!first) throw new Error("missing fixture lane");
    first.loseAck = true;
    const id = await pool.enqueue(prompt, "a");
    await pool.pump();
    await pool.cancel(id);
    expect(runtime.stopCalls).toEqual([100]);
    expect(pool.queue(id).running).toBe(false);
  });
  it("does not dispatch after reservation persistence fails", async () => {
    let fail = false;
    const { pool, runtime } = await fixture(async (path, state) => {
      if (fail && JSON.stringify(state).includes('"dispatching"')) throw new Error("Disk full");
      await atomicGpuJson(path, state);
    });
    await pool.enqueue(prompt, "a");
    fail = true;
    await expect(pool.pump()).rejects.toThrow("Disk full");
    expect(runtime.clients.flatMap((c) => [...c.jobs])).toEqual([]);
    expect(pool.status().poisoned).toBe(true);
  });
  it("binds identical filenames to their original instance and preserves routing after restart", async () => {
    const { pool, runtime, root } = await fixture();
    const a = await pool.enqueue(prompt, "a");
    const b = await pool.enqueue(prompt, "b");
    await pool.pump();
    runtime.clients[0]?.complete(a);
    runtime.clients[1]?.complete(b);
    await pool.pump();
    await pool.settled();
    const restored = new SameGpuPool(config, root, runtime);
    await restored.resume();
    for (const [index, id] of [a, b].entries()) {
      const file = (await restored.history(id))?.outputs?.["1"]?.images?.[0];
      if (!file) throw new Error("Missing recorded output");
      expect(await (await restored.download(file)).text()).toBe(`instance-${index}`);
      await expect(restored.download({ ...file, filename: "other.png" })).rejects.toThrow("不属于");
    }
    runtime.mismatch = true;
    const file = (await restored.history(a))?.outputs?.["1"]?.images?.[0];
    if (!file) throw new Error("Missing output");
    expect(await (await restored.download(file)).text()).toBe("instance-0");
    await expect(restored.verifyLane(0)).rejects.toThrow("Identity");
  });
  it("pauses admissions after OOM without cancelling an independent running job", async () => {
    const { pool, runtime } = await fixture();
    const a = await pool.enqueue(prompt, "a");
    const b = await pool.enqueue(prompt, "b");
    await pool.enqueue(prompt, "c");
    await pool.pump();
    runtime.clients[0]?.complete(a, true);
    await pool.pump();
    await pool.settled();
    expect(pool.status().paused).toContain("显存上限");
    expect(pool.status().queued).toBe(1);
    expect(runtime.clients[1]?.jobs.has(b)).toBe(true);
  });
  it("routes the real Comfy HTTP protocol through the pool without exposing global interrupt", async () => {
    const { pool } = await fixture();
    const gateway = createGpuGateway(pool);
    try {
      const sent = await gateway.inject({
        method: "POST",
        url: "/prompt",
        headers: { host: "127.0.0.1" },
        payload: { prompt, client_id: "a" },
      });
      expect(sent.statusCode, sent.body).toBe(200);
      const id = sent.json().prompt_id;
      const q = await gateway.inject({
        method: "GET",
        url: "/queue",
        headers: { host: "127.0.0.1" },
      });
      expect(q.json().queue_pending).toEqual([[0, id]]);
      const broadcast = await gateway.inject({
        method: "POST",
        url: "/interrupt",
        headers: { host: "127.0.0.1" },
        payload: {},
      });
      expect(broadcast.statusCode).toBe(400);
      const cancelled = await gateway.inject({
        method: "POST",
        url: `/api/jobs/${id}/cancel`,
        headers: { host: "127.0.0.1" },
      });
      expect(cancelled.json().cancelled).toBe(true);
      const crossOrigin = await gateway.inject({
        method: "GET",
        url: "/queue",
        headers: { host: "127.0.0.1", origin: "https://evil.test" },
      });
      expect(crossOrigin.statusCode).toBe(403);
    } finally {
      await gateway.close();
    }
  });
  it("rejects stale or invalid telemetry and unsafe configuration", () => {
    const sample = new TestRuntime().telemetry;
    expect(gpuAdmission({ ...sample, at: Date.now() - 10000 }, [], [], 0, config)).toContain(
      "不可确认",
    );
    expect(gpuAdmission({ ...sample, free: Number.NaN }, [], [], 0, config)).toContain("不可确认");
    expect(() => parseGpuPoolConfig({ ...config, ports: [8188, 8188] })).toThrow();
    expect(() => parseGpuPoolConfig({ ...config, python: "python" })).toThrow();
  });
});
