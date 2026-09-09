// Packaged, narrow management entry point. It starts only the adjacent TakeBoard
// launcher, never a command supplied by the connecting client.
import { spawn } from "node:child_process";
import { access, mkdir, open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { takeboardHealth } from "./remote-connection.mjs";

export async function inspectService(bundleRoot, dataRoot) {
  const build = JSON.parse(await readFile(join(bundleRoot, "BUILD.json"), "utf8"));
  if (typeof build.applicationVersion !== "string")
    throw new Error("安装信息无效，请重新安装 TakeBoard");
  await access(join(bundleRoot, "launcher.mjs"));
  let instanceId = null;
  let port = null;
  let busy = false;
  try {
    instanceId = (await readFile(join(dataRoot, ".takeboard-instance-id"), "utf8")).trim();
    if (!/^[A-Za-z0-9-]{10,100}$/.test(instanceId)) throw new Error("数据目录中的实例标识无效");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    const record = JSON.parse(await readFile(join(dataRoot, ".system", "instance.json"), "utf8"));
    if (
      record.instanceId === instanceId &&
      Number.isInteger(record.port) &&
      record.port > 0 &&
      record.port <= 65535
    ) {
      const health = await takeboardHealth(record.port, undefined, 1500);
      if (
        health?.service === "takeboard-server" &&
        health.status === "ok" &&
        health.instanceId === instanceId
      ) {
        if (health.version !== build.applicationVersion)
          throw new Error("该数据位置已有其他版本运行，请先管理现有服务，不会重复启动");
        port = record.port;
      } else if (Number.isInteger(record.pid) && record.pid > 0) {
        // A live recorded PID is only a reason to refuse a duplicate start,
        // never authority to signal that process (PIDs may be reused).
        try {
          process.kill(record.pid, 0);
          busy = true;
        } catch (error) {
          busy = error?.code !== "ESRCH";
        }
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    protocol: 1,
    installed: true,
    state: port ? "running" : busy ? "busy" : "stopped",
    port,
    instanceId,
    version: build.applicationVersion,
    dataRoot,
    platform: process.platform,
  };
}

export async function startService(bundleRoot, dataRoot, expectedInstanceId) {
  const initial = await inspectService(bundleRoot, dataRoot);
  if (expectedInstanceId && expectedInstanceId !== initial.instanceId)
    throw new Error("服务器身份变化，拒绝自动启动；请重新核实设备");
  if (initial.state === "running") return initial;
  if (initial.state === "busy")
    throw new Error("已有 TakeBoard 进程但尚未就绪，请稍后重试或检查现有服务；不会重复启动");
  await mkdir(join(dataRoot, ".system"), { recursive: true, mode: 0o700 });
  // Server-side instance leasing serializes concurrent startup attempts. This
  // helper never stops an existing launcher or kills a PID read from disk.
  const log = await open(join(dataRoot, ".system", "remote-start.log"), "a", 0o600);
  let child;
  let ready = false;
  try {
    child = spawn(process.execPath, [join(bundleRoot, "launcher.mjs"), "start", "--no-open"], {
      cwd: bundleRoot,
      detached: true,
      windowsHide: true,
      env: { ...process.env, TAKEBOARD_DATA_ROOT: dataRoot, TAKEBOARD_DESKTOP: "0" },
      stdio: ["ignore", log.fd, log.fd, "ipc"],
    });
    let launchError = null;
    child.once("error", (error) => {
      launchError = error;
    });
    child.unref();
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      const status = await inspectService(bundleRoot, dataRoot);
      if (status.state === "running") {
        ready = true;
        return status;
      }
      if (child.exitCode !== null && child.exitCode !== 0)
        throw new Error("TakeBoard 启动失败，请查看服务器 remote-start.log");
      await delay(300);
    }
    throw new Error("TakeBoard 启动超时，请检查服务器日志；不会结束未知进程");
  } finally {
    if (child?.connected && !ready && child.exitCode === null) {
      // Use the launcher's ownership-aware shutdown protocol, not a PID file.
      // It stops only the child it launched and leaves a reused server alone.
      await new Promise((done) =>
        child.send({ type: "takeboard.launcher.shutdown" }, () => done()),
      );
      const deadline = Date.now() + 26000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline)
        await delay(100);
    }
    if (child?.connected) child.disconnect();
    await log.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const bundleRoot = dirname(fileURLToPath(import.meta.url));
  const dataRoot = resolve(process.env.TAKEBOARD_DATA_ROOT || join(homedir(), "TakeBoardData"));
  try {
    const action = process.argv[2];
    if (!["inspect", "start"].includes(action)) throw new Error("仅支持 inspect 或 start 操作");
    const result =
      action === "start"
        ? await startService(bundleRoot, dataRoot, process.argv[3] || null)
        : await inspectService(bundleRoot, dataRoot);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(
      JSON.stringify({
        protocol: 1,
        state: "failed",
        message: error instanceof Error ? error.message : "无法管理 TakeBoard 服务",
      }),
    );
    process.exitCode = 1;
  }
}
