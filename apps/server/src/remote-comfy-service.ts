import { createComfyLauncher } from "./comfy-launcher.js";
import {
  inspectRemoteDevice,
  type RemoteExecute,
  runRemoteCommand,
  sshExecutor,
} from "./remote-device-status.js";

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
  run: RemoteExecute = runRemoteCommand,
) {
  const service = remoteServiceName(serviceInput);
  const remote = sshExecutor(host, run);
  const launcher = createComfyLauncher({
    platform: "linux",
    provider: "systemd",
    systemdService: service,
    runtime: { execute: remote },
  });
  const check = await launcher.preflight();
  if (check.status !== "pass") throw new Error(`无法启动所选服务：${check.detail}`);
  const device = await inspectRemoteDevice(host, service, run);
  if (!device.startup.allowed) throw new Error(device.startup.reason ?? "暂时不能启动服务");
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
