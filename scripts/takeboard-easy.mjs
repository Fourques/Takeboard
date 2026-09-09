#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connectRemote, validateRemoteHost } from "./remote-connection.mjs";

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const applicationVersion = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8")).version;
const stateDir =
  platform() === "win32"
    ? join(process.env.LOCALAPPDATA || homedir(), "TakeBoard")
    : join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "takeboard");
const stateFile = join(stateDir, "easy-service.json");
const launchLockFile = join(stateDir, "easy-start.lock");
const logFile = join(stateDir, "takeboard.log");
const defaultDataRoot = join(homedir(), "TakeBoardData");
const nodeExecutable = process.execPath;
const serverBuild = join(repoDir, "apps", "server", "dist", "index.js");
const webBuild = join(repoDir, "apps", "web", "dist", "index.html");
if (platform() !== "win32") process.umask(0o077);

function readUserConfiguration() {
  const configFile =
    process.env.TAKEBOARD_CONFIG_FILE || join(homedir(), ".config", "takeboard", "env");
  try {
    const values = {};
    for (const sourceLine of readFileSync(configFile, "utf8").split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      const quoted = rawValue.trim();
      values[key] =
        quoted.startsWith('"') && quoted.endsWith('"')
          ? quoted.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\")
          : quoted;
    }
    return values;
  } catch {
    return {};
  }
}

const userConfiguration = readUserConfiguration();
const runtimeEnvironment = { ...userConfiguration, ...process.env };

function dataRoot() {
  const configured = runtimeEnvironment.TAKEBOARD_DATA_ROOT || defaultDataRoot;
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}

function persistentInstanceId() {
  const path = join(dataRoot(), ".takeboard-instance-id");
  const read = () => readFileSync(path, "utf8").trim();
  let value;
  try {
    value = read();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    value = randomUUID();
    try {
      writeFileSync(path, `${value}\n`, { flag: "wx", mode: 0o600 });
    } catch (writeError) {
      if (writeError?.code !== "EEXIST") throw writeError;
      value = read();
    }
  }
  if (!/^[A-Za-z0-9-]{10,100}$/.test(value)) {
    throw new Error(`项目目录中的实例标识无效：${path}`);
  }
  return value;
}

async function dataRootWritable() {
  const root = dataRoot();
  const probe = join(root, `.takeboard-write-check-${process.pid}-${randomUUID()}`);
  try {
    await mkdir(root, { recursive: true });
    writeFileSync(probe, "ok", { mode: 0o600 });
    rmSync(probe, { force: true });
    return true;
  } catch {
    rmSync(probe, { force: true });
    return false;
  }
}

const messages = {
  title: "TakeBoard 简易启动器",
  noPnpm: "没有找到 pnpm/Corepack。请先安装 Node.js 22 LTS，然后重新运行。",
};

function printHeader() {
  console.log(`\n${messages.title}`);
  console.log("─".repeat(42));
}

function packageManager() {
  const suffix = platform() === "win32" ? ".cmd" : "";
  if (spawnSync(`pnpm${suffix}`, ["--version"], { stdio: "ignore" }).status === 0) {
    return { command: `pnpm${suffix}`, prefix: [] };
  }
  if (spawnSync(`corepack${suffix}`, ["pnpm", "--version"], { stdio: "ignore" }).status === 0) {
    return { command: `corepack${suffix}`, prefix: ["pnpm"] };
  }
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoDir,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function newestModification(path) {
  if (!existsSync(path)) return 0;
  const information = statSync(path);
  if (!information.isDirectory()) return information.mtimeMs;
  return readdirSync(path, { withFileTypes: true }).reduce((latest, entry) => {
    if (["dist", "node_modules", ".git"].includes(entry.name)) return latest;
    return Math.max(latest, newestModification(join(path, entry.name)));
  }, information.mtimeMs);
}

function buildOutdated() {
  if (!existsSync(serverBuild) || !existsSync(webBuild)) return true;
  const builtAt = Math.min(statSync(serverBuild).mtimeMs, statSync(webBuild).mtimeMs);
  const sourceAt = Math.max(
    newestModification(join(repoDir, "apps", "server", "src")),
    newestModification(join(repoDir, "apps", "server", "package.json")),
    newestModification(join(repoDir, "apps", "server", "tsconfig.json")),
    newestModification(join(repoDir, "apps", "server", "tsconfig.build.json")),
    newestModification(join(repoDir, "apps", "web", "src")),
    newestModification(join(repoDir, "apps", "web", "package.json")),
    newestModification(join(repoDir, "apps", "web", "index.html")),
    newestModification(join(repoDir, "apps", "web", "tsconfig.json")),
    newestModification(join(repoDir, "apps", "web", "vite.config.ts")),
    newestModification(join(repoDir, "packages")),
    newestModification(join(repoDir, "package.json")),
    newestModification(join(repoDir, "pnpm-workspace.yaml")),
    newestModification(join(repoDir, "tsconfig.base.json")),
  );
  return sourceAt > builtAt;
}

function currentBuildStamp() {
  if (!existsSync(serverBuild) || !existsSync(webBuild)) return null;
  return [
    newestModification(join(repoDir, "apps", "server", "dist")),
    newestModification(join(repoDir, "apps", "web", "dist")),
  ]
    .map((value) => Math.trunc(value))
    .join(":");
}

function installOutdated() {
  const modulesState = join(repoDir, "node_modules", ".modules.yaml");
  if (!existsSync(modulesState)) return true;
  return newestModification(join(repoDir, "pnpm-lock.yaml")) > statSync(modulesState).mtimeMs;
}

async function waitForStop(port, pid = null) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await portAvailable(port)) && (pid === null || !processAlive(pid))) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}

async function portAvailable(port) {
  return await new Promise((resolvePort) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePort(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolvePort(true)));
  });
}

async function healthPayload(port, timeout = 1_500) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function health(port, timeout = 1_500, expectedInstanceId = null) {
  const payload = await healthPayload(port, timeout);
  return (
    payload?.service === "takeboard-server" &&
    (!expectedInstanceId || payload?.instanceId === expectedInstanceId)
  );
}

async function comfyHealth() {
  try {
    const comfyUrl = runtimeEnvironment.COMFY_URL || "http://127.0.0.1:8188";
    const response = await fetch(`${comfyUrl.replace(/\/$/, "")}/system_stats`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function readState() {
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    return Number.isSafeInteger(state.pid) && Number.isSafeInteger(state.port) ? state : null;
  } catch {
    return null;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(port, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await health(port)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  return false;
}

async function findTakeBoard(ports, expectedInstanceId) {
  for (const port of ports) {
    if (await health(port, 500, expectedInstanceId)) return port;
  }
  return null;
}

function openBrowser(url) {
  const command =
    platform() === "darwin"
      ? ["open", [url]]
      : platform() === "win32"
        ? ["cmd.exe", ["/d", "/s", "/c", "start", "", url]]
        : ["xdg-open", [url]];
  const opened = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
  opened.on("error", () => console.log(`请在浏览器打开：${url}`));
  opened.unref();
}

async function setup(lockHeld = false) {
  printHeader();
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22 || major >= 27) {
    console.error(`需要 Node.js 22–26；当前是 ${process.version}。`);
    process.exit(1);
  }
  const manager = packageManager();
  if (!manager) {
    console.error(messages.noPnpm);
    process.exit(1);
  }
  console.log("1/3 正在安装项目依赖…");
  run(manager.command, [...manager.prefix, "install", "--frozen-lockfile"]);
  console.log("2/3 正在检查并构建 TakeBoard…");
  run(manager.command, [...manager.prefix, "verify"]);
  console.log("3/3 安装完成。正在启动…");
  await (lockHeld ? startUnlocked() : start());
}

async function startUnlocked() {
  if (!(await dataRootWritable())) {
    throw new Error(`项目目录不可写：${dataRoot()}。请检查目录权限或修改 TAKEBOARD_DATA_ROOT`);
  }
  const instanceId = persistentInstanceId();
  const existing = readState();
  const existingHealth =
    existing?.instanceId && processAlive(existing.pid)
      ? await healthPayload(existing.port, 1_500)
      : null;
  const ownedInstanceRunning = Boolean(
    existing?.instanceId &&
      existingHealth?.service === "takeboard-server" &&
      existingHealth.instanceId === existing.instanceId,
  );
  if (existing && processAlive(existing.pid) && !ownedInstanceRunning) {
    throw new Error(
      `启动记录中的进程 ${existing.pid} 仍存在，但无法确认它属于 TakeBoard。请先运行 npm run easy:doctor，避免覆盖进程所有权记录。`,
    );
  }
  if (ownedInstanceRunning && existing?.instanceId !== instanceId) {
    throw new Error(
      "简易启动器正在管理另一个项目目录。请先运行 npm run easy:stop，再切换 TAKEBOARD_DATA_ROOT。",
    );
  }
  const needsInstall = installOutdated();
  const needsBuild = buildOutdated();
  const runningBuildIsCurrent = existing?.buildStamp === currentBuildStamp();
  if (
    ownedInstanceRunning &&
    existing?.instanceId === instanceId &&
    existingHealth?.version === applicationVersion &&
    runningBuildIsCurrent &&
    !needsInstall &&
    !needsBuild
  ) {
    const url = `http://127.0.0.1:${existing.port}`;
    console.log(`TakeBoard 已在运行：${url}`);
    openBrowser(url);
    return;
  }
  if (ownedInstanceRunning) {
    console.log("检测到项目已经更新，正在安全重启到新版本…");
    process.kill(existing.pid, "SIGTERM");
    rmSync(stateFile, { force: true });
    await waitForStop(existing.port);
  }
  if (needsInstall) {
    console.log("首次使用需要完成安装与构建。");
    await setup(true);
    return;
  }
  if (needsBuild) {
    const manager = packageManager();
    if (!manager) throw new Error(messages.noPnpm);
    console.log("检测到代码更新，正在自动构建最新版本…");
    run(manager.command, [...manager.prefix, "build"]);
  }
  const configuredPort = runtimeEnvironment.TAKEBOARD_PORT;
  const portCandidates = configuredPort
    ? [Number(configuredPort)]
    : Array.from({ length: 20 }, (_, index) => 48120 + index);
  if (
    portCandidates.some(
      (candidate) => !Number.isSafeInteger(candidate) || candidate < 1 || candidate > 65535,
    )
  ) {
    throw new Error("TAKEBOARD_PORT 必须是 1–65535 的有效端口");
  }
  let port = null;
  try {
    const record = JSON.parse(readFileSync(join(dataRoot(), ".system", "instance.json"), "utf8"));
    if (
      record.instanceId === instanceId &&
      Number.isSafeInteger(record.port) &&
      record.port > 0 &&
      record.port <= 65535
    )
      portCandidates.unshift(record.port);
  } catch {
    /* Discovery metadata is optional for older releases. */
  }
  for (const candidate of portCandidates) {
    const running = await healthPayload(candidate);
    if (running?.service === "takeboard-server" && running?.instanceId === instanceId) {
      if (running.version !== applicationVersion) {
        throw new Error(
          `同一项目目录已有 TakeBoard ${running.version ?? "未知版本"} 在 ${candidate} 端口运行；请先从原启动方式停止，再启动 ${applicationVersion}`,
        );
      }
      const url = `http://127.0.0.1:${candidate}`;
      console.log(`TakeBoard 已在运行：${url}`);
      openBrowser(url);
      return;
    }
    if (
      port === null &&
      (!configuredPort || candidate === Number(configuredPort)) &&
      (await portAvailable(candidate))
    )
      port = candidate;
  }
  if (port === null) {
    throw new Error(
      configuredPort
        ? `配置端口 ${configuredPort} 已被其他软件占用`
        : "48120–48139 都被占用，请关闭占用端口的软件后重试。",
    );
  }
  await mkdir(stateDir, { recursive: true });
  if (existsSync(logFile) && statSync(logFile).size > 10 * 1024 * 1024) {
    const previousLog = `${logFile}.previous`;
    rmSync(previousLog, { force: true });
    renameSync(logFile, previousLog);
  }
  const log = openSync(logFile, "a", 0o600);
  const child = spawn(nodeExecutable, [serverBuild], {
    cwd: repoDir,
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...runtimeEnvironment,
      TAKEBOARD_HOST: "127.0.0.1",
      TAKEBOARD_PORT: String(port),
      TAKEBOARD_INSTANCE_ID: instanceId,
      TAKEBOARD_DATA_ROOT: dataRoot(),
      TAKEBOARD_WEB_ROOT: join(repoDir, "apps", "web", "dist"),
    },
  });
  closeSync(log);
  child.unref();
  const buildStamp = currentBuildStamp();
  if (!buildStamp) throw new Error("TakeBoard 构建产物不存在，请重新运行 npm run easy");
  writeFileSync(
    stateFile,
    JSON.stringify(
      {
        pid: child.pid,
        port,
        instanceId,
        buildStamp,
        startedAt: new Date().toISOString(),
        logFile,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  if (!(await waitForHealth(port)) || !(await health(port, 1_500, instanceId))) {
    if (child.pid) process.kill(child.pid, "SIGTERM");
    rmSync(stateFile, { force: true });
    console.error(`启动没有成功。日志位置：${logFile}`);
    process.exit(1);
  }
  const url = `http://127.0.0.1:${port}`;
  console.log(`TakeBoard 已启动：${url}`);
  console.log(`项目数据：${dataRoot()}`);
  openBrowser(url);
}

async function start() {
  await mkdir(stateDir, { recursive: true });
  let lock = null;
  try {
    try {
      lock = openSync(launchLockFile, "wx", 0o600);
      writeFileSync(lock, String(process.pid));
    } catch {
      let ownerPid = null;
      try {
        const candidate = Number(readFileSync(launchLockFile, "utf8").trim());
        if (Number.isSafeInteger(candidate) && candidate > 0) ownerPid = candidate;
      } catch {
        // Legacy or partially written lock files are judged by age below.
      }
      const stale = ownerPid
        ? !processAlive(ownerPid)
        : existsSync(launchLockFile) && Date.now() - statSync(launchLockFile).mtimeMs > 30 * 60_000;
      if (!stale) throw new Error("另一个 TakeBoard 启动过程正在运行，请稍候再试");
      rmSync(launchLockFile, { force: true });
      lock = openSync(launchLockFile, "wx", 0o600);
      writeFileSync(lock, String(process.pid));
    }
    return await startUnlocked();
  } finally {
    if (lock !== null) {
      closeSync(lock);
      rmSync(launchLockFile, { force: true });
    }
  }
}

async function stop() {
  const state = readState();
  if (!state?.instanceId || !processAlive(state.pid)) {
    rmSync(stateFile, { force: true });
    console.log("TakeBoard 简易服务当前没有运行。");
    return;
  }
  if (!(await health(state.port, 1_500, state.instanceId))) {
    throw new Error(
      `记录中的进程 ${state.pid} 仍存在，但无法验证它是否属于 TakeBoard。状态文件已保留，请先运行 npm run easy:doctor，避免误停其他程序。`,
    );
  }
  process.kill(state.pid, "SIGTERM");
  if (!(await waitForStop(state.port, state.pid))) {
    throw new Error(`TakeBoard 进程 ${state.pid} 没有在预期时间内停止，请查看日志：${logFile}`);
  }
  rmSync(stateFile, { force: true });
  console.log("TakeBoard 已停止。项目数据不会删除。");
}

async function doctor() {
  printHeader();
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push([major >= 22 && major < 27, `Node.js ${process.version}`, "安装 Node.js 22 LTS"]);
  checks.push([Boolean(packageManager()), "pnpm / Corepack", "运行 corepack enable"]);
  checks.push([
    !buildOutdated(),
    "TakeBoard 构建与当前代码一致",
    "运行 npm run easy，启动器会自动重新构建",
  ]);
  checks.push([
    await dataRootWritable(),
    `项目目录 ${dataRoot()}`,
    "检查目录权限，或在配置中修改 TAKEBOARD_DATA_ROOT",
  ]);
  const state = readState();
  const instanceId = persistentInstanceId();
  const defaultPorts = Array.from({ length: 20 }, (_, index) => 48120 + index);
  const discoveredPort = await findTakeBoard(
    runtimeEnvironment.TAKEBOARD_PORT ? [Number(runtimeEnvironment.TAKEBOARD_PORT)] : defaultPorts,
    instanceId,
  );
  checks.push([
    Boolean(
      discoveredPort ||
        (state?.instanceId &&
          processAlive(state.pid) &&
          (await health(state.port, 1_500, state.instanceId))),
    ),
    discoveredPort ? `TakeBoard 服务（端口 ${discoveredPort}）` : "TakeBoard 服务",
    "运行 npm run easy",
  ]);
  checks.push([
    await comfyHealth(),
    "ComfyUI 连接（可选）",
    "先启动 ComfyUI，或在 TakeBoard 首页使用安全启动",
  ]);
  for (const [ok, label, action] of checks) {
    console.log(`${ok ? "[正常]" : "[需要处理]"} ${label}${ok ? "" : ` → ${action}`}`);
  }
  console.log(`\n日志：${logFile}`);
}

async function remote(host) {
  const profileFile = join(stateDir, "remote-connections.json");
  let profiles = [];
  try {
    const saved = JSON.parse(readFileSync(profileFile, "utf8"));
    if (Array.isArray(saved))
      profiles = saved.filter((entry) => typeof entry?.host === "string").slice(0, 20);
  } catch {
    // A missing or damaged preference file must not block a new connection.
  }
  const target = validateRemoteHost(host || profiles[0]?.host);
  const previous = profiles.find((entry) => entry.host === target);
  const configuredRemotePort = runtimeEnvironment.TAKEBOARD_REMOTE_PORT;
  const remoteTakeBoardPorts = configuredRemotePort
    ? [Number(configuredRemotePort)]
    : Array.from({ length: 20 }, (_, index) => 48120 + index);
  if (remoteTakeBoardPorts.includes(previous?.remotePort)) {
    remoteTakeBoardPorts.splice(remoteTakeBoardPorts.indexOf(previous.remotePort), 1);
    remoteTakeBoardPorts.unshift(previous.remotePort);
  }
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.once(signal, disconnect);
  let connection;
  try {
    console.log(`正在连接 ${target}，自动检查 TakeBoard 服务…`);
    console.log("首次连接请核实 SSH 指纹；需要时在此输入服务器密码。按 Ctrl-C 可取消。");
    connection = await connectRemote({
      host: target,
      remotePorts: remoteTakeBoardPorts,
      preferredLocalPort:
        Number.isInteger(previous?.localPort) &&
        previous.localPort >= 1024 &&
        previous.localPort <= 65535
          ? previous.localPort
          : 48230,
      comfyRemotePort:
        runtimeEnvironment.COMFY_REMOTE_PORT === "off"
          ? null
          : Number(runtimeEnvironment.COMFY_REMOTE_PORT || 8188),
      signal: controller.signal,
      onStderr: (message) =>
        process.stderr.write(
          message.replace(/^channel \d+: open failed: connect failed:.*\r?\n/gm, ""),
        ),
    });
    if (previous?.instanceId && previous.instanceId !== connection.instanceId) {
      throw new Error(
        "这个地址对应的 TakeBoard 实例已变化。为避免打开错误的项目，已断开连接。确认服务器后，请移除连接记录再连接：" +
          profileFile,
      );
    }
    try {
      await mkdir(stateDir, { recursive: true, mode: 0o700 });
      const updated = [
        {
          host: target,
          localPort: connection.localPort,
          remotePort: connection.remotePort,
          instanceId: connection.instanceId,
        },
        ...profiles.filter((entry) => entry.host !== target),
      ].slice(0, 20);
      const temporary = `${profileFile}.${process.pid}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(updated), { mode: 0o600, flag: "wx" });
        renameSync(temporary, profileFile);
      } finally {
        rmSync(temporary, { force: true });
      }
    } catch {
      console.warn("连接成功，但无法保存连接记录。下次仍可输入 SSH 主机连接。");
    }
    console.log(`远程 TakeBoard 已连接：${connection.url}`);
    console.log(`已验证实例：${connection.instanceId}（服务端口 ${connection.remotePort}）`);
    if (connection.comfyUrl)
      console.log(
        `ComfyUI 编辑器转发地址：${connection.comfyUrl}（是否在线请在 TakeBoard 中检查）`,
      );
    console.log("下次可直接运行 npm run easy:remote，或在双击入口留空以连接上次服务器。");
    console.log("关闭此窗口或按 Ctrl-C 即可断开；不会停止服务器上的生成任务。");
    openBrowser(connection.url);
    await connection.closed;
    if (!controller.signal.aborted)
      throw new Error("远程连接已中断。请重新运行连接入口；不会自动重试或重复提交生成任务。");
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    await connection?.close();
    for (const signal of signals) process.removeListener(signal, disconnect);
    console.log("远程连接已关闭，已释放本次连接占用的端口。");
  }
}

async function restore(archive, confirmation) {
  if (!archive || confirmation !== "--confirm") {
    throw new Error(
      "用法：npm run easy -- restore /path/to/backup.takeboard-instance.tgz --confirm",
    );
  }
  const source = resolve(archive);
  if (!existsSync(source) || !statSync(source).isFile())
    throw new Error(`找不到实例备份：${source}`);
  const state = readState();
  if (
    state?.instanceId &&
    processAlive(state.pid) &&
    (await health(state.port, 1_500, state.instanceId))
  ) {
    throw new Error("TakeBoard 仍在运行。请先执行 npm run easy:stop，再进行离线恢复");
  }
  const configuredPort = Number(runtimeEnvironment.TAKEBOARD_PORT);
  const candidatePorts = Number.isSafeInteger(configuredPort)
    ? [configuredPort]
    : Array.from({ length: 20 }, (_, index) => 48120 + index);
  const detectedPort = await findTakeBoard(candidatePorts);
  if (detectedPort !== null) {
    throw new Error(
      `端口 ${detectedPort} 仍有 TakeBoard 服务运行。请先停止 systemd、开发服务或其他启动方式，再进行离线恢复。`,
    );
  }
  if (buildOutdated()) {
    const manager = packageManager();
    if (!manager) throw new Error(messages.noPnpm);
    console.log("正在准备恢复工具…");
    run(manager.command, [...manager.prefix, "build"]);
  }
  const module = await import(
    pathToFileURL(join(repoDir, "apps", "server", "dist", "instance-backup.js")).href
  );
  const { resolveAuthDatabasePath } = await import(
    pathToFileURL(join(repoDir, "apps", "server", "dist", "auth-database-path.js")).href
  );
  const authDatabase = resolveAuthDatabasePath(
    dataRoot(),
    runtimeEnvironment.TAKEBOARD_AUTH_DATABASE,
  );
  console.log("正在隔离解包并验证所有哈希、身份数据库和项目数据库…");
  const receipt = await module.restoreInstanceOffline(dataRoot(), source, authDatabase);
  console.log(`恢复完成：${receipt.projects} 个项目、${receipt.users} 个账号。`);
  console.log(`恢复前数据保留在：${receipt.previousData}`);
  console.log("现在可以运行 npm run easy 启动 TakeBoard。");
}

function help() {
  printHeader();
  console.log(`用法：node scripts/takeboard-easy.mjs <命令>

  setup          首次安装、检查并启动
  start          后台启动并打开浏览器
  stop           停止简易后台服务
  doctor         用中文检查常见问题并给出下一步
  remote <主机>  通过标准 SSH 连接远端 TakeBoard
  restore <文件> --confirm
                 停止服务后完整恢复实例备份，并保留恢复前数据
  help           显示帮助`);
}

const [command = "start", argument, confirmation] = process.argv.slice(2);
try {
  if (command === "setup") await setup();
  else if (command === "start") await start();
  else if (command === "stop") await stop();
  else if (command === "doctor") await doctor();
  else if (command === "remote") await remote(argument);
  else if (command === "restore") await restore(argument, confirmation);
  else help();
} catch (error) {
  console.error(`操作失败：${error instanceof Error ? error.message : String(error)}`);
  console.error(`可运行诊断：node scripts/takeboard-easy.mjs doctor`);
  process.exitCode = 1;
}
