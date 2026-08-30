#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const bundleRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(bundleRoot, "app");
const serverEntry = join(serverRoot, "dist", "index.js");
const webRoot = join(bundleRoot, "web");
const arguments_ = process.argv.slice(2);
const command = arguments_.find((argument) => !argument.startsWith("-")) ?? "start";
const openRequested = !arguments_.includes("--no-open");
if (process.platform !== "win32") process.umask(0o077);

function fail(message) {
  console.error(`\nTakeBoard 无法启动：${message}\n`);
  process.exitCode = 1;
}

function validNodeVersion() {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return (major === 22 && minor >= 12) || (major > 22 && major < 27);
}

async function writableDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const probe = join(path, `.takeboard-write-${process.pid}-${Date.now()}`);
  const handle = await open(probe, "wx", 0o600);
  await handle.close();
  await rm(probe, { force: true });
}

async function persistentInstanceId(dataRoot) {
  const path = join(dataRoot, ".takeboard-instance-id");
  const read = async () => (await readFile(path, "utf8")).trim();
  let value;
  try {
    value = await read();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    value = randomUUID();
    try {
      await writeFile(path, `${value}\n`, { flag: "wx", mode: 0o600 });
    } catch (writeError) {
      if (writeError?.code !== "EEXIST") throw writeError;
      value = await read();
    }
  }
  if (!/^[A-Za-z0-9-]{10,100}$/.test(value)) {
    throw new Error(`数据目录中的实例标识无效：${path}`);
  }
  return value;
}

async function doctor() {
  if (!validNodeVersion()) {
    throw new Error(`内置 Node.js ${process.versions.node} 不在支持范围 22.12–26.x`);
  }
  await Promise.all([
    access(serverEntry, constants.R_OK),
    access(join(webRoot, "index.html"), constants.R_OK),
  ]);
  const configuredDataRoot = process.env.TAKEBOARD_DATA_ROOT || join(homedir(), "TakeBoardData");
  const dataRoot =
    configuredDataRoot === "~"
      ? homedir()
      : configuredDataRoot.startsWith("~/") || configuredDataRoot.startsWith("~\\")
        ? resolve(homedir(), configuredDataRoot.slice(2))
        : resolve(configuredDataRoot);
  await writableDirectory(dataRoot);
  const [instanceId, build] = await Promise.all([
    persistentInstanceId(dataRoot),
    readFile(join(bundleRoot, "BUILD.json"), "utf8").then((value) => JSON.parse(value)),
  ]);
  if (typeof build.applicationVersion !== "string" || !build.applicationVersion) {
    throw new Error("BUILD.json 缺少应用版本");
  }
  const requireFromServer = createRequire(join(serverRoot, "package.json"));
  const sqliteModule = await import(
    pathToFileURL(requireFromServer.resolve("better-sqlite3")).href
  );
  const database = new sqliteModule.default(":memory:");
  database.close();
  await import(pathToFileURL(requireFromServer.resolve("sharp")).href);
  console.log("TakeBoard 启动检查通过");
  console.log(`系统：${process.platform} ${process.arch}`);
  console.log(`运行时：Node.js ${process.versions.node}`);
  console.log(`数据目录：${dataRoot}`);
  return { applicationVersion: build.applicationVersion, dataRoot, instanceId };
}

function health(port, timeout = 1_200) {
  return fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(timeout),
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.service === "takeboard-server" && payload?.status === "ok" ? payload : null;
    })
    .catch(() => null);
}

function portAvailable(port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolvePort(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolvePort(true)));
  });
}

async function selectPort(instanceId, applicationVersion) {
  const configured = process.env.TAKEBOARD_PORT?.trim();
  if (configured && !/^\d+$/.test(configured)) {
    throw new Error("TAKEBOARD_PORT 必须是 1–65535 的整数");
  }
  const ports = configured
    ? [Number(configured)]
    : Array.from({ length: 20 }, (_, index) => 48120 + index);
  for (const port of ports) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) continue;
    const running = await health(port, 500);
    if (running?.instanceId === instanceId) {
      if (running.version !== applicationVersion) {
        throw new Error(
          `同一数据目录已有 TakeBoard ${running.version ?? "未知版本"} 在 ${port} 端口运行；请先在原窗口按 Ctrl+C 停止，再启动 ${applicationVersion}`,
        );
      }
      return { port, existing: true };
    }
    if (await portAvailable(port)) return { port, existing: false };
  }
  throw new Error(
    configured ? `配置端口 ${configured} 已被其他程序使用` : "48120–48139 都已被其他程序使用",
  );
}

function openBrowser(url) {
  try {
    const child =
      process.platform === "darwin"
        ? spawn("open", [url], { detached: true, stdio: "ignore" })
        : process.platform === "win32"
          ? spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], {
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            })
          : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The URL remains visible in the terminal when no desktop browser is available.
  }
}

async function waitForServer(child, port, instanceId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (child.exitCode !== null) {
      throw new Error(`服务提前退出（代码 ${child.exitCode}）`);
    }
    if ((await health(port))?.instanceId === instanceId) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 350));
  }
  throw new Error("服务在 30 秒内没有完成启动");
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const completed = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", completed);
      resolveExit(false);
    }, timeout);
    child.once("exit", completed);
  });
}

async function stopOwnedServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 10_000)) return;
  child.kill("SIGKILL");
  if (!(await waitForExit(child, 5_000))) {
    throw new Error("服务未能安全停止，请从任务管理器结束 TakeBoard Node.js 进程");
  }
}

async function start() {
  const { applicationVersion, dataRoot, instanceId } = await doctor();
  const selected = await selectPort(instanceId, applicationVersion);
  const url = `http://127.0.0.1:${selected.port}`;
  if (selected.existing) {
    console.log(`TakeBoard 已经在运行：${url}`);
    if (openRequested) openBrowser(url);
    return;
  }
  const child = spawn(process.execPath, [serverEntry], {
    cwd: serverRoot,
    env: {
      ...process.env,
      TAKEBOARD_AUTH_MODE: process.env.TAKEBOARD_AUTH_MODE || "required",
      TAKEBOARD_DATA_ROOT: dataRoot,
      TAKEBOARD_HOST: "127.0.0.1",
      TAKEBOARD_INSTANCE_ID: instanceId,
      TAKEBOARD_PORT: String(selected.port),
      TAKEBOARD_WEB_ROOT: webRoot,
    },
    stdio: "inherit",
    windowsHide: false,
  });
  let stopPromise = null;
  const terminate = () => {
    stopPromise ??= stopOwnedServer(child);
    void stopPromise.catch(() => undefined);
  };
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  try {
    await waitForServer(child, selected.port, instanceId);
    console.log(`\nTakeBoard 已启动：${url}`);
    console.log("保持此窗口打开；按 Ctrl+C 安全停止。\n");
    if (openRequested) openBrowser(url);
    const code = await new Promise((resolveExit) => child.once("exit", resolveExit));
    if (code && code !== 0) process.exitCode = code;
  } catch (error) {
    if (!stopPromise) stopPromise = stopOwnedServer(child);
    await stopPromise;
    throw error;
  } finally {
    if (stopPromise) await stopPromise;
    process.removeListener("SIGINT", terminate);
    process.removeListener("SIGTERM", terminate);
  }
}

try {
  if (command === "doctor") await doctor();
  else if (command === "start") await start();
  else throw new Error("只支持 start 或 doctor 命令");
} catch (error) {
  fail(error instanceof Error ? error.message : "未知错误");
}
