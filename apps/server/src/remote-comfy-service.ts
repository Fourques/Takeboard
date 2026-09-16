import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createComfyLauncher } from "./comfy-launcher.js";

type Execute = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
const execute = promisify(execFile);
export function remoteServiceName(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_.@-]+\.service$/.test(value) ||
    value.startsWith("-")
  )
    throw new Error("请填写服务器上已配置的 Linux 用户服务名（以 .service 结尾），不是启动命令");
  return value;
}
/** Explicit Linux user-service adapter, independent of the client's OS and directory layout. */
export async function startRemoteComfy<T>(
  host: string,
  serviceInput: unknown,
  connect: () => Promise<T>,
  run: Execute = async (file, args) => {
    const result = await execute(file, args, {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
) {
  if (!host || host.startsWith("-") || !/^[A-Za-z0-9_.@:[\]-]+$/.test(host))
    throw new Error("SSH 设备地址无效");
  const service = remoteServiceName(serviceInput);
  const remote: Execute = (file, args) =>
    run("ssh", [
      "-n",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=10",
      host,
      [file, ...args].map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" "),
    ]);
  const launcher = createComfyLauncher({
    platform: "linux",
    provider: "systemd",
    systemdService: service,
    runtime: { execute: remote },
  });
  const check = await launcher.preflight();
  if (check.status !== "pass") throw new Error(`无法启动所选服务：${check.detail}`);
  const memory = (await remote("cat", ["/proc/meminfo"])).stdout;
  const availableKiB = Number(/^MemAvailable:\s+(\d+)\s+kB$/m.exec(memory)?.[1]);
  if (!Number.isFinite(availableKiB) || availableKiB < 6 * 1024 ** 2)
    throw new Error("远端可用内存不足 6 GiB 或无法确认，未启动服务");
  const rows = (
    await remote("nvidia-smi", [
      "--query-gpu=memory.free,utilization.gpu",
      "--format=csv,noheader,nounits",
    ])
  ).stdout
    .trim()
    .split("\n");
  const metrics = (rows[0] ?? "").split(",").map((s) => s.trim());
  const [free, load] = metrics.map(Number);
  if (
    rows.length !== 1 ||
    metrics.length !== 2 ||
    metrics.some((value) => !value) ||
    !Number.isFinite(free) ||
    !Number.isFinite(load) ||
    (free ?? 0) < 4096 ||
    (load ?? 100) > 85
  )
    throw new Error("无法确认远端单卡 NVIDIA 设备有足够余量，请在服务器上检查后启动");
  try {
    await launcher.start();
    return await connect();
  } catch (error) {
    if (await launcher.canStop?.()) {
      try {
        await launcher.stop();
      } catch {
        throw new Error("连接未成功，且远端服务停止未确认，请检查服务器；不会强杀进程");
      }
    }
    throw error;
  }
}
