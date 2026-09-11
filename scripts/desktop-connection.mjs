import { isMainModule } from "./is-main-module.mjs";
import { manageRemoteService } from "./remote-bootstrap.mjs";
import { connectRemote, validateRemoteHost } from "./remote-connection.mjs";

export function connectionTarget(input) {
  if (!input || !["ssh", "https", "portal"].includes(input.kind)) throw new Error("请选择连接方式");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (
    name.length > 100 ||
    [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error("设备名称无效");
  if (input.kind === "ssh") {
    const host = validateRemoteHost(String(input.address ?? "").trim());
    const port =
      input.port === null || input.port === undefined || input.port === ""
        ? null
        : Number(input.port);
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))
      throw new Error("服务端口必须为 1–65535，留空可自动检测");
    const platform = input.platform ?? "auto";
    if (!["auto", "posix", "windows"].includes(platform)) throw new Error("远程系统选项无效");
    return {
      kind: "ssh",
      address: host,
      port,
      ...(name ? { name } : {}),
      ...(input.allowStart === true ? { allowStart: true } : {}),
      ...(platform !== "auto" ? { platform } : {}),
    };
  }
  let url;
  try {
    url = new URL(String(input.address ?? "").trim());
  } catch {
    throw new Error("地址格式不正确，请填写完整的 HTTPS 地址，例如 https://takeboard.example.com");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("请输入不含路径、密码或参数的 HTTPS 地址；HTTP 仅允许本机隧道地址");
  }
  return { kind: input.kind, address: url.origin, port: null, ...(name ? { name } : {}) };
}

export async function verifyConnection(input, signal) {
  const target = connectionTarget(input);
  let connection;
  if (target.kind === "ssh") {
    let remotePort = target.port;
    if (!remotePort) {
      // Read-only discovery can be unavailable on an SSH account restricted to
      // forwarding. In that case retain the existing verified-port connection.
      let service = await manageRemoteService({
        host: target.address,
        platform: target.platform,
        signal,
      }).catch((error) => {
        if (error?.code === "REMOTE_SERVICE_ERROR") throw error;
        return null;
      });
      if (service?.state === "busy")
        throw new Error("远端 TakeBoard 进程尚未就绪，请稍后重试或检查服务器日志；不会重复启动。");
      if (service?.state === "stopped") {
        if (input.instanceId && input.instanceId !== service.instanceId)
          throw new Error("服务器身份与保存记录不同，请先核实设备");
        if (!target.allowStart) {
          const error = new Error(
            `远端 TakeBoard 已安装但未启动。版本 ${service.version}，项目位置 ${service.dataRoot}。授权后可启动；不会同时启动 ComfyUI。`,
          );
          error.code = "START_REQUIRED";
          throw error;
        }
        service = await manageRemoteService({
          host: target.address,
          platform: service.platform === "win32" ? "windows" : "posix",
          action: "start",
          instanceId: input.instanceId ?? service.instanceId ?? "",
          signal,
        });
      }
      if (
        service?.state === "running" &&
        Number.isInteger(service.port) &&
        service.port > 0 &&
        service.port <= 65535
      )
        remotePort = service.port;
    }
    connection = await connectRemote({
      host: target.address,
      ...(remotePort ? { remotePorts: [remotePort] } : {}),
      ...(Number.isInteger(input.localPort) && input.localPort >= 1024 && input.localPort <= 65535
        ? { preferredLocalPort: input.localPort }
        : {}),
      comfyRemotePort: null,
      signal,
      sshPrefix: ["-n", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes"],
      timeoutMs: 20000,
    });
  } else {
    const path = target.kind === "portal" ? "/__portal/api/health" : "/api/health";
    const response = await fetch(target.address + path, {
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`服务器健康检查失败（HTTP ${response.status}）`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("服务器健康检查没有返回内容");
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) throw new Error("服务器响应异常");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const health = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const service = target.kind === "portal" ? "takeboard-portal" : "takeboard-server";
    if (health.service !== service || health.status !== "ok")
      throw new Error("此地址不是所选类型的 TakeBoard 服务");
    if (target.kind !== "portal" && (typeof health.instanceId !== "string" || !health.instanceId))
      throw new Error("服务器缺少持久实例标识，请先更新并通过 TakeBoard 启动器运行");
    connection = {
      url: target.address,
      instanceId: target.kind === "portal" ? target.address : health.instanceId,
      close: async () => {},
    };
  }
  if (input.instanceId && input.instanceId !== connection.instanceId) {
    await connection.close();
    throw new Error("服务器身份与保存记录不同。请核实服务器后移除旧记录，重新连接。");
  }
  return { ...connection, target };
}

if (isMainModule(import.meta.url)) {
  const controller = new AbortController();
  let connection;
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    controller.abort();
    await connection?.close();
    process.exit(0);
  }
  process.stdin.setEncoding("utf8");
  let pending = "";
  process.stdin.on("data", (chunk) => {
    pending = (pending + chunk).slice(-4096);
    if (pending.includes("takeboard.launcher.shutdown\n")) void close();
  });
  process.stdin.on("end", () => void close());
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  try {
    connection = await verifyConnection(JSON.parse(process.argv[2] ?? "{}"), controller.signal);
    if (closing) await connection.close();
    else {
      console.log(
        JSON.stringify({
          state: "ready",
          url: connection.url,
          instanceId: connection.instanceId,
          localPort: connection.localPort ?? null,
          remotePort: connection.remotePort ?? null,
          target: connection.target,
        }),
      );
      if (connection.closed)
        await connection.closed.then(() => {
          if (!closing) {
            console.log(
              JSON.stringify({
                state: "failed",
                message: "SSH 连接已断开。生成任务仍由服务器管理；重新连接后请先检查任务状态。",
              }),
            );
            process.exitCode = 1;
            process.stdin.destroy();
          }
        });
    }
  } catch (error) {
    console.log(
      JSON.stringify({
        state: "failed",
        code: error?.code === "START_REQUIRED" ? "START_REQUIRED" : null,
        message: error instanceof Error ? error.message : "连接失败",
      }),
    );
    await connection?.close();
    process.exitCode = 1;
    process.stdin.destroy();
  }
}
