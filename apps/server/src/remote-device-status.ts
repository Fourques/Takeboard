import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RemoteDeviceStatus } from "@takeboard/contracts";

export type { RemoteDeviceStatus } from "@takeboard/contracts";

export type RemoteExecute = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;
const execute = promisify(execFile);
export const runRemoteCommand: RemoteExecute = async (file, args) => {
  const result = await execute(file, args, {
    timeout: 12000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return { stdout: result.stdout, stderr: result.stderr };
};
export function sshExecutor(host: string, run: RemoteExecute = runRemoteCommand): RemoteExecute {
  if (!host || host.startsWith("-") || !/^[\p{L}\p{N}_.@:[\]%+-]+$/u.test(host))
    throw new Error("SSH 设备地址无效");
  return (file, args) =>
    run("ssh", [
      "-n",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=8",
      host,
      [file, ...args].map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" "),
    ]);
}
export function parseGpuRows(output: string): RemoteDeviceStatus["gpu"]["devices"] {
  return output
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.split(",").map((part) => part.trim());
      const [totalMiB, usedMiB, freeMiB, utilization] = parts.slice(-4).map(Number);
      const id = parts[0] ?? "";
      const name = parts.slice(1, -4).join(", ");
      if (
        !name ||
        !id ||
        parts.slice(-4).some((value) => !value) ||
        [totalMiB, usedMiB, freeMiB, utilization].some(
          (value) => value === undefined || !Number.isFinite(value) || value < 0,
        ) ||
        !totalMiB ||
        (utilization ?? 101) > 100 ||
        (freeMiB ?? Infinity) > totalMiB ||
        (usedMiB ?? Infinity) > totalMiB
      )
        throw new Error("GPU 指标格式无法识别");
      return {
        id,
        name,
        totalMiB,
        usedMiB: usedMiB as number,
        freeMiB: freeMiB as number,
        utilization: utilization as number,
      };
    });
}
export function startupDecision(status: RemoteDeviceStatus): RemoteDeviceStatus["startup"] {
  const reason =
    status.connection !== "connected"
      ? "先连接设备"
      : status.service === "unconfigured"
        ? "尚未配置启动方式"
        : status.system.platform !== "Linux"
          ? "此系统暂不支持远程启动"
          : status.service !== "stopped"
            ? status.service === "running"
              ? "服务已经运行"
              : status.service === "starting"
                ? "服务正在启动"
                : "服务状态待确认"
            : status.gpu.state === "unavailable"
              ? "GPU 状态读取失败"
              : status.gpu.devices.length !== 1
                ? "多 GPU 启动尚需指定设备"
                : status.gpu.state === "busy"
                  ? "GPU 资源不足，稍后重试"
                  : status.system.availableMemoryMiB === null
                    ? "内存状态读取失败"
                    : status.system.availableMemoryMiB < 6144
                      ? "可用内存不足"
                      : null;
  return { allowed: reason === null, reason };
}
/** SSH reachability is established independently of telemetry and the generation service. */
export async function inspectRemoteDevice(
  host: string,
  service?: string,
  run?: RemoteExecute,
): Promise<RemoteDeviceStatus> {
  const remote = sshExecutor(host, run);
  const status: RemoteDeviceStatus = {
    connection: "connected",
    checkedAt: new Date().toISOString(),
    system: { name: null, platform: null, availableMemoryMiB: null },
    gpu: { state: "unavailable", devices: [], processes: [], processesKnown: false },
    service: service ? "unknown" : "unconfigured",
    startup: { allowed: false, reason: null },
    diagnostics: [],
  };
  try {
    await remote("echo", ["takeboard-device-probe"]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "SSH 检查失败";
    status.connection =
      /permission denied|host key|identification has changed|authentication|connection refused|ENOENT/i.test(
        detail,
      )
        ? "ssh_unavailable"
        : "unreachable";
    status.diagnostics.push(detail);
    status.startup = startupDecision(status);
    return status;
  }
  const read = async (file: string, args: string[]) => {
    try {
      return (await remote(file, args)).stdout.trim();
    } catch (error) {
      status.diagnostics.push(error instanceof Error ? error.message : `${file} 读取失败`);
      return null;
    }
  };
  const [name, platform, memory, gpu, processes, serviceState] = await Promise.all([
    read("hostname", []),
    read("uname", ["-s"]),
    read("cat", ["/proc/meminfo"]),
    read("nvidia-smi", [
      "--query-gpu=uuid,name,memory.total,memory.used,memory.free,utilization.gpu",
      "--format=csv,noheader,nounits",
    ]),
    read("nvidia-smi", [
      "--query-compute-apps=pid,process_name,used_memory",
      "--format=csv,noheader,nounits",
    ]),
    service && /^[A-Za-z0-9_.@-]+\.service$/.test(service) && !service.startsWith("-")
      ? read("systemctl", [
          "--user",
          "show",
          service,
          "--property=LoadState,ActiveState,SubState",
          "--no-pager",
        ])
      : Promise.resolve(null),
  ]);
  status.system.name = name;
  status.system.platform = platform;
  const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(memory ?? "");
  status.system.availableMemoryMiB = available ? Number(available[1]) / 1024 : null;
  if (gpu !== null) {
    try {
      status.gpu.devices = parseGpuRows(gpu);
      status.gpu.state = status.gpu.devices.some(
        (device) => device.freeMiB < 4096 || device.utilization > 85,
      )
        ? "busy"
        : "available";
    } catch (error) {
      status.diagnostics.push(error instanceof Error ? error.message : "GPU 状态读取失败");
    }
  }
  if (processes !== null) {
    status.gpu.processesKnown = true;
    for (const row of processes.split(/\r?\n/).filter(Boolean)) {
      const parts = row.split(",").map((value) => value.trim());
      const pid = Number(parts[0]);
      const usedMiB = Number(parts.at(-1));
      if (parts.length < 3 || !Number.isFinite(pid) || !Number.isFinite(usedMiB)) {
        status.gpu.processesKnown = false;
        continue;
      }
      const existing = status.gpu.processes.find((process) => process.pid === pid);
      if (existing) existing.usedMiB += usedMiB;
      else status.gpu.processes.push({ pid, name: parts.slice(1, -1).join(", "), usedMiB });
    }
  }
  if (serviceState?.includes("LoadState=loaded")) {
    const active = /^ActiveState=(.+)$/m.exec(serviceState)?.[1];
    status.service =
      active === "inactive"
        ? "stopped"
        : active === "active"
          ? "running"
          : active === "activating"
            ? "starting"
            : active === "failed"
              ? "failed"
              : "unknown";
  }
  status.startup = startupDecision(status);
  status.checkedAt = new Date().toISOString();
  return status;
}
