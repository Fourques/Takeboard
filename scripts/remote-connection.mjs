import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export function validateRemoteHost(host) {
  if (
    typeof host !== "string" ||
    !host ||
    host.length > 255 ||
    /^-/.test(host) ||
    !/^[\p{L}\p{N}_.@:[\]%+-]+$/u.test(host)
  ) {
    throw new Error("请输入 SSH 主机名、IP 或 user@host；不要在这里填写命令或端口参数。");
  }
  return host;
}

export function remoteFailure(detail, exited = false) {
  if (/permission denied|authentication failed/i.test(detail))
    return "SSH 身份验证失败。请检查服务器用户名、SSH 密钥或密码；TakeBoard 账号不是 SSH 账号。";
  if (/host key verification failed|remote host identification has changed/i.test(detail))
    return "服务器的 SSH 身份未获信任或已经变化。请核实服务器指纹；TakeBoard 不会跳过身份检查。";
  if (/could not resolve hostname|name or service not known/i.test(detail))
    return "找不到这个 SSH 主机。请检查 IP、主机别名以及当前网络连接。";
  if (/connection refused/i.test(detail) && !/channel \d+: open failed/i.test(detail))
    return "服务器拒绝了 SSH 连接。请检查服务器是否启动 SSH 服务，以及防火墙是否允许连接。";
  if (/address already in use|cannot listen to port/i.test(detail))
    return "本地端口在连接期间被其他程序占用。请重试，TakeBoard 会重新选择空闲端口，不会关闭其他程序。";
  return exited
    ? "SSH 连接已退出。请检查上方的 SSH 错误和服务器连接配置。"
    : "没有找到可响应的 TakeBoard。请确认服务器已启动 TakeBoard；自定义服务端口可通过 TAKEBOARD_REMOTE_PORT 指定。";
}

async function availablePort(port) {
  return await new Promise((resolve) => {
    const listener = createServer();
    listener.once("error", () => resolve(null));
    listener.listen({ host: "127.0.0.1", port }, () => {
      const selected = listener.address().port;
      listener.close(() => resolve(selected));
    });
  });
}

export async function takeboardHealth(port, signal, timeout = 750) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
      redirect: "error",
    });
    if (!response.ok) return null;
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16_384) return null;
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const health = JSON.parse(text);
    return health?.service === "takeboard-server" &&
      health.status === "ok" &&
      typeof health.instanceId === "string" &&
      health.instanceId.length > 0
      ? health
      : null;
  } catch {
    return null;
  }
}

// Own only the SSH child created here. Never terminate an existing listener or server.
// A GUI may reuse this lifecycle; terminal prompting remains a caller concern.
export async function connectRemote({
  host,
  remotePorts = Array.from({ length: 20 }, (_, index) => 48120 + index),
  preferredLocalPort = 48230,
  comfyRemotePort = 8188,
  timeoutMs = 45_000,
  signal,
  onStderr = () => {},
  sshCommand = process.platform === "win32" ? "ssh.exe" : "ssh",
  sshPrefix = [],
}) {
  validateRemoteHost(host);
  if (
    !remotePorts.length ||
    remotePorts.length > 20 ||
    [
      ...remotePorts,
      preferredLocalPort,
      ...(comfyRemotePort === null ? [] : [comfyRemotePort]),
    ].some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
  )
    throw new Error("远端或本地端口配置无效");
  signal?.throwIfAborted();
  const allocated = new Set();
  async function allocate(preferred) {
    let port = allocated.has(preferred) ? null : await availablePort(preferred);
    for (let attempt = 0; (!port || allocated.has(port)) && attempt < 10; attempt += 1) {
      signal?.throwIfAborted();
      port = await availablePort(0);
    }
    if (!port || allocated.has(port))
      throw new Error("无法分配本地连接端口，请检查网络权限或系统资源。");
    allocated.add(port);
    return port;
  }
  const mappings = [];
  for (const remotePort of [...new Set(remotePorts)])
    mappings.push({ remotePort, localPort: await allocate(preferredLocalPort) });
  const comfyPort = comfyRemotePort === null ? null : await allocate(48188);
  signal?.throwIfAborted();
  const controller = new AbortController();
  let detail = "";
  let spawnError = null;
  let ended = false;
  const child = spawn(
    sshCommand,
    [
      ...sshPrefix,
      "-N",
      // Do not attach forwards to a user's unrelated ControlMaster, or allow
      // ssh_config to daemonize this owned process behind our lifecycle.
      "-o",
      "ControlPath=none",
      "-o",
      "ControlMaster=no",
      "-o",
      "ControlPersist=no",
      "-o",
      "ForkAfterAuthentication=no",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      ...mappings.flatMap(({ localPort, remotePort }) => [
        "-L",
        `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      ]),
      ...(comfyPort === null ? [] : ["-L", `127.0.0.1:${comfyPort}:127.0.0.1:${comfyRemotePort}`]),
      host,
    ],
    { stdio: ["inherit", "ignore", "pipe"], shell: false },
  );
  const closed = new Promise((resolve) => {
    const finish = () => {
      ended = true;
      controller.abort();
      resolve();
    };
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", finish);
  });
  child.stderr.on("data", (chunk) => {
    detail = (detail + chunk.toString()).slice(-8192);
    onStderr(chunk.toString());
  });
  let stopping;
  const close = () => {
    if (!stopping)
      stopping = (async () => {
        controller.abort();
        if (!ended) child.kill("SIGTERM");
        const force = setTimeout(() => {
          if (!ended) child.kill("SIGKILL");
        }, 2500);
        force.unref();
        await closed;
        clearTimeout(force);
      })();
    return stopping;
  };
  const onAbort = () => {
    void close();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  // Cover cancellation between the pre-spawn check and listener registration.
  if (signal?.aborted) onAbort();
  void closed.then(() => signal?.removeEventListener("abort", onAbort));
  const deadline = Date.now() + timeoutMs;
  try {
    while (!ended && !controller.signal.aborted && Date.now() < deadline) {
      // Probe concurrently: one dead forwarded port must not stall every other candidate.
      const statuses = await Promise.all(
        mappings.map(async (mapping) => ({
          ...mapping,
          health: await takeboardHealth(
            mapping.localPort,
            controller.signal,
            Math.min(750, Math.max(1, deadline - Date.now())),
          ),
        })),
      );
      const matches = statuses.filter((status) => status.health);
      if (matches.length > 1)
        throw new Error(
          "服务器上发现多个 TakeBoard 服务。请通过 TAKEBOARD_REMOTE_PORT 指定要连接的服务，避免打开错误的项目目录。",
        );
      const match = matches[0];
      if (match && !ended && !controller.signal.aborted) {
        return {
          url: `http://127.0.0.1:${match.localPort}`,
          localPort: match.localPort,
          remotePort: match.remotePort,
          instanceId: match.health.instanceId,
          comfyUrl: comfyPort === null ? null : `http://127.0.0.1:${comfyPort}`,
          close,
          closed,
        };
      }
      await delay(200, undefined, { signal: controller.signal }).catch(() => {});
    }
    signal?.throwIfAborted();
    if (spawnError)
      throw new Error(`无法启动 SSH：${spawnError.message}。Windows 请安装 OpenSSH 客户端。`);
    throw new Error(remoteFailure(detail, ended));
  } catch (error) {
    await close();
    throw error;
  }
}
