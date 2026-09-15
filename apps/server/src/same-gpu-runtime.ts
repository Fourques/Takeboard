import { type ChildProcess, execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { freemem } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { ComfyClient } from "@takeboard/executor-comfy";

const execFile = promisify(execFileCallback);
export const MiB = 1024 ** 2;
export type GpuPoolConfig = {
  python: string;
  comfyRoot: string;
  gpuUuid: string;
  gatewayPort: number;
  ports: number[];
  instanceMemoryMiB: number;
  headroomMiB: number;
};
export type GpuSample = {
  at: number;
  total: number;
  free: number;
  processes: Array<{ pid: number; used: number }>;
};
export type GpuLane = { port: number; token: string; pid: number };
export interface GpuRuntime {
  sample(): Promise<GpuSample>;
  start(index: number, token: string, onSpawn: (lane: GpuLane) => Promise<void>): Promise<GpuLane>;
  identity(lane: GpuLane): Promise<void>;
  stop(lane: GpuLane): Promise<void>;
  stopped(lane: GpuLane): Promise<boolean>;
  client(lane: GpuLane): ComfyClient;
}

export function parseGpuPoolConfig(value: unknown): GpuPoolConfig {
  if (!value || typeof value !== "object") throw new Error("请配置单卡执行环境");
  const c = value as GpuPoolConfig;
  if (
    typeof c.python !== "string" ||
    !isAbsolute(c.python) ||
    typeof c.comfyRoot !== "string" ||
    !isAbsolute(c.comfyRoot)
  )
    throw new Error("Python 和 ComfyUI 目录必须是这台服务器上的绝对路径");
  if (typeof c.gpuUuid !== "string" || !/^GPU-[a-f0-9-]{36}$/i.test(c.gpuUuid))
    throw new Error("需要 NVIDIA GPU UUID，不能用易变化的设备序号");
  if (
    !Array.isArray(c.ports) ||
    c.ports.length < 2 ||
    c.ports.length > 4 ||
    new Set(c.ports).size !== c.ports.length ||
    c.ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)
  )
    throw new Error("请为 2–4 个独立实例配置不同的本机端口");
  if (
    !Number.isInteger(c.gatewayPort) ||
    c.gatewayPort < 1024 ||
    c.gatewayPort > 65535 ||
    c.ports.includes(c.gatewayPort)
  )
    throw new Error("执行池入口需要一个独立端口");
  if (
    !Number.isSafeInteger(c.instanceMemoryMiB) ||
    c.instanceMemoryMiB < 1024 ||
    !Number.isSafeInteger(c.headroomMiB) ||
    c.headroomMiB < 1024
  )
    throw new Error("每实例预算和显存余量至少为 1024 MiB");
  return {
    python: c.python,
    comfyRoot: c.comfyRoot,
    gpuUuid: c.gpuUuid,
    gatewayPort: c.gatewayPort,
    ports: [...c.ports],
    instanceMemoryMiB: c.instanceMemoryMiB,
    headroomMiB: c.headroomMiB,
  };
}

// Runs in the configured ComfyUI Python environment, not TakeBoard's Node process.
// Native allocator only: dynamic VRAM / external allocators must not silently bypass the cap.
export const gpuRunner = `
import os, sys, json, inspect, runpy, signal, asyncio, time
from pathlib import Path
cfg = json.loads(os.environ.pop("TAKEBOARD_GPU_LANE"))
# No CUDA initialization before the parent has durably recorded ownership.
deadline = time.monotonic() + 15
while not Path(cfg["permit"]).exists():
    if time.monotonic() > deadline:
        raise RuntimeError("Parent did not persist process ownership")
    time.sleep(0.05)
os.environ["CUDA_VISIBLE_DEVICES"] = cfg["gpuUuid"]
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "backend:native"
os.environ["PYTORCH_ALLOC_CONF"] = "backend:native"
root = Path(cfg["comfyRoot"])
os.chdir(root)
sys.path.insert(0, str(root))
for name in ("input", "output", "temp", "user"):
    Path(cfg["directory"], name).mkdir(parents=True, exist_ok=True)
sys.argv = [str(root / "main.py"), "--listen", "127.0.0.1", "--port", str(cfg["port"]),
    "--disable-auto-launch", "--disable-cuda-malloc", "--disable-dynamic-vram",
    "--input-directory", str(Path(cfg["directory"], "input")),
    "--output-directory", str(Path(cfg["directory"], "output")),
    "--temp-directory", str(Path(cfg["directory"], "temp")),
    "--user-directory", str(Path(cfg["directory"], "user"))]
import torch
if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
    raise RuntimeError("A single NVIDIA CUDA device is required")
total = torch.cuda.get_device_properties(0).total_memory
cap = cfg["memoryBytes"]
if cap <= 0 or cap >= total:
    raise RuntimeError("Invalid per-process VRAM cap")
torch.cuda.set_per_process_memory_fraction(cap / total, 0)
sys.argv += ["--reserve-vram", str((total - cap) / 1024**3)]
import comfy.options
comfy.options.enable_args_parsing()
import server
from aiohttp import web
original_init = server.PromptServer.__init__
def managed_init(self, *args, **kwargs):
    original_init(self, *args, **kwargs)
    prompt_routes = [r for r in self.routes if getattr(r, "method", None) == "POST" and getattr(r, "path", None) == "/prompt"]
    if not prompt_routes or "client_prompt_id" not in inspect.getsource(prompt_routes[0].handler):
        raise RuntimeError("Update ComfyUI: caller-assigned prompt IDs are required for safe recovery")
    def authorized(request):
        return request.headers.get("X-TakeBoard-Instance") == cfg["token"]
    @self.routes.get("/takeboard/instance")
    async def identity(request):
        if not authorized(request):
            raise web.HTTPForbidden()
        fraction = torch.cuda.get_per_process_memory_fraction(0)
        return web.json_response({"pid": os.getpid(), "gpuUuid": cfg["gpuUuid"],
            "memoryBytes": round(fraction * total), "allocator": torch.cuda.get_allocator_backend()})
    @self.routes.post("/takeboard/shutdown")
    async def shutdown(request):
        if not authorized(request):
            raise web.HTTPForbidden()
        asyncio.get_running_loop().call_later(0.2, lambda: os.kill(os.getpid(), signal.SIGTERM))
        return web.json_response({"stopping": True})
server.PromptServer.__init__ = managed_init
runpy.run_path(str(root / "main.py"), run_name="__main__")
`;

export class NvidiaGpuRuntime implements GpuRuntime {
  private readonly children = new Map<number, ChildProcess>();
  private readonly clients = new Map<string, ComfyClient>();
  constructor(
    readonly config: GpuPoolConfig,
    readonly directory: string,
  ) {}
  async sample(): Promise<GpuSample> {
    const query = async (fields: string, gpu = false) =>
      (
        await execFile(
          "nvidia-smi",
          [
            `--query-${gpu ? "gpu" : "compute-apps"}=${fields}`,
            "--format=csv,noheader,nounits",
            ...(gpu ? ["--id", this.config.gpuUuid] : []),
          ],
          { timeout: 3000, windowsHide: true },
        )
      ).stdout.trim();
    const gpu = (await query("uuid,memory.total,memory.free", true)).split(/,\s*/);
    const numeric = (s: string | undefined) => {
      const n = Number(s);
      if (!s?.trim() || !Number.isFinite(n) || n < 0) throw new Error("显存数据不可确认，保持排队");
      return n;
    };
    if (gpu[0] !== this.config.gpuUuid) throw new Error("显卡身份不匹配");
    const processes = (await query("gpu_uuid,pid,used_gpu_memory"))
      .split("\n")
      .filter((line) => line.split(/,\s*/)[0] === this.config.gpuUuid)
      .map((line) => {
        const [, pid, used] = line.split(/,\s*/);
        return { pid: numeric(pid), used: numeric(used) * MiB };
      });
    return { at: Date.now(), total: numeric(gpu[1]) * MiB, free: numeric(gpu[2]) * MiB, processes };
  }
  client(lane: GpuLane) {
    const key = `${lane.port}:${lane.token}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new ComfyClient(`http://127.0.0.1:${lane.port}`, { liveProgress: false });
      this.clients.set(key, client);
    }
    return client;
  }
  async identity(lane: GpuLane) {
    const response = await fetch(`http://127.0.0.1:${lane.port}/takeboard/instance`, {
      headers: { "X-TakeBoard-Instance": lane.token },
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("执行实例身份无法确认");
    const info = (await response.json()) as {
      pid: number;
      gpuUuid: string;
      memoryBytes: number;
      allocator: string;
    };
    if (
      info.pid !== lane.pid ||
      info.gpuUuid !== this.config.gpuUuid ||
      !Number.isFinite(info.memoryBytes) ||
      Math.abs(info.memoryBytes - this.config.instanceMemoryMiB * MiB) > 1024 ||
      info.allocator !== "native"
    )
      throw new Error("执行实例或显存上限已变化，暂停派发");
  }
  async start(index: number, token: string, onSpawn: (lane: GpuLane) => Promise<void>) {
    const port = this.config.ports[index];
    if (!port) throw new Error("实例编号无效");
    if (freemem() < 2 * 1024 ** 3) throw new Error("可用内存不足 2 GiB，未启动实例");
    // Never treat an already-listening arbitrary service as one of our processes.
    const net = await import("node:net");
    await new Promise<void>((resolve, reject) => {
      const listener = net.createServer();
      listener.once("error", reject);
      listener.listen(port, "127.0.0.1", () =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
    });
    const directory = join(this.directory, `instance-${index}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const log = await open(join(directory, "comfy.log"), "a", 0o600);
    const permit = join(directory, `start-${token}`);
    let child: ChildProcess;
    try {
      child = spawn(this.config.python, ["-u", "-c", gpuRunner], {
        cwd: this.config.comfyRoot,
        windowsHide: true,
        stdio: ["ignore", log.fd, log.fd],
        env: {
          ...process.env,
          TAKEBOARD_GPU_LANE: JSON.stringify({
            ...this.config,
            port,
            token,
            directory,
            permit,
            memoryBytes: this.config.instanceMemoryMiB * MiB,
          }),
        },
      });
      child.once("error", () => {});
    } finally {
      await log.close();
    }
    if (!child.pid) throw new Error("无法启动 Python 执行实例");
    const lane = { port, token, pid: child.pid };
    this.children.set(lane.pid, child);
    child.once("exit", () => this.children.delete(lane.pid));
    child.unref();
    try {
      await onSpawn(lane);
      const gate = await open(permit, "wx", 0o600);
      await gate.close();
      const deadline = Date.now() + 120_000;
      do {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`实例启动失败，请检查 ${directory}/comfy.log`);
        try {
          await this.identity(lane);
          return lane;
        } catch {
          /* wait for this exact process */
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
      throw new Error("实例启动超时，请检查日志及 ComfyUI 版本");
    } catch (error) {
      child.kill("SIGTERM");
      throw error;
    }
  }
  async stop(lane: GpuLane) {
    await this.identity(lane);
    const response = await fetch(`http://127.0.0.1:${lane.port}/takeboard/shutdown`, {
      method: "POST",
      headers: { "X-TakeBoard-Instance": lane.token },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("实例未确认停止");
    const deadline = Date.now() + 10_000;
    do {
      if (await this.stopped(lane)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error("实例停止尚未确认，保留其所有权");
  }
  async stopped(lane: GpuLane) {
    try {
      process.kill(lane.pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  }
}
