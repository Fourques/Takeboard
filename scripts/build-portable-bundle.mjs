#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(repositoryRoot, "release");
const stagingRoot = join(outputRoot, ".staging");
const bundleRoot = join(stagingRoot, "TakeBoard");
const serverRoot = join(bundleRoot, "app");
const skipBuild = process.argv.includes("--skip-build");

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const detail = [result.error?.message, options.capture ? result.stderr || result.stdout : null]
      .filter(Boolean)
      .join("\n");
    throw new Error(`${command} ${arguments_.join(" ")} 失败${detail ? `\n${detail}` : ""}`);
  }
  return String(result.stdout ?? "").trim();
}

function runPnpm(arguments_, options = {}) {
  if (process.platform === "win32") {
    return run(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", "pnpm.cmd", ...arguments_],
      options,
    );
  }
  return run("pnpm", arguments_, options);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function copyNodeRuntime() {
  const runtimeRoot = join(bundleRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const executable = join(runtimeRoot, executableName);
  await cp(process.execPath, executable);
  if (process.platform !== "win32") await chmod(executable, 0o755);
  const prefix =
    process.platform === "win32" ? dirname(process.execPath) : dirname(dirname(process.execPath));
  const licenseCandidates = [
    process.env.TAKEBOARD_NODE_LICENSE,
    join(prefix, "LICENSE"),
    join(prefix, "LICENSE.md"),
    "/usr/share/doc/nodejs/copyright",
  ].filter(Boolean);
  let license = null;
  for (const candidate of licenseCandidates) {
    try {
      await cp(candidate, join(runtimeRoot, "NODE-LICENSE.txt"));
      license = candidate;
      break;
    } catch {
      // Try the next location used by official distributions or system packages.
    }
  }
  if (!license) throw new Error("无法找到 Node.js 许可证；请设置 TAKEBOARD_NODE_LICENSE");
  return `Node.js ${process.versions.node}`;
}

async function writeLaunchers() {
  const shell = `#!/bin/sh\nset -eu\nhere=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$here/runtime/node" "$here/launcher.mjs" start "$@"\n`;
  const command = `@echo off\r\nsetlocal\r\n"%~dp0runtime\\node.exe" "%~dp0launcher.mjs" start %*\r\nif errorlevel 1 pause\r\n`;
  const doctorShell = `#!/bin/sh\nset -eu\nhere=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$here/runtime/node" "$here/launcher.mjs" doctor\n`;
  await Promise.all([
    writeFile(join(bundleRoot, "START-TAKEBOARD.command"), shell, { mode: 0o755 }),
    writeFile(join(bundleRoot, "start-takeboard.sh"), shell, { mode: 0o755 }),
    writeFile(join(bundleRoot, "START-TAKEBOARD.cmd"), command, "utf8"),
    writeFile(join(bundleRoot, "doctor.sh"), doctorShell, { mode: 0o755 }),
    writeFile(
      join(bundleRoot, "README.txt"),
      [
        "TakeBoard portable preview",
        "",
        "macOS: double-click START-TAKEBOARD.command (first run may require right-click > Open).",
        "Windows: double-click START-TAKEBOARD.cmd.",
        "Linux: run ./start-takeboard.sh.",
        "",
        "The launcher only listens on 127.0.0.1 and selects the first free port from 48120–48139.",
        "Project data defaults to ~/TakeBoardData. Keep the terminal open while using TakeBoard.",
        "ComfyUI and model files are not bundled. Configure them separately when real generation is needed.",
        "This preview bundle has build provenance and SHA-256 checksums but is not code-signed.",
        "Source and documentation: https://github.com/Fourques/Takeboard",
        "",
      ].join("\n"),
      "utf8",
    ),
  ]);
}

function freeLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("无法分配便携包自检端口"));
        return;
      }
      server.close((error) => (error ? rejectPort(error) : resolvePort(address.port)));
    });
  });
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

function sendControlMessage(child, message) {
  if (!child.connected) return Promise.resolve(false);
  return new Promise((resolveSend) => {
    try {
      child.send(message, (error) => resolveSend(!error));
    } catch {
      resolveSend(false);
    }
  });
}

async function stopPortableLauncher(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (
    (await sendControlMessage(child, { type: "takeboard.launcher.shutdown" })) &&
    (await waitForExit(child, 15_000))
  ) {
    return;
  }
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (await waitForExit(child, 5_000)) return;
    throw new Error("便携包自检进程树无法停止");
  }
  child.kill("SIGTERM");
  if (await waitForExit(child, 5_000)) return;
  child.kill("SIGKILL");
  if (!(await waitForExit(child, 5_000))) throw new Error("便携包自检服务无法停止");
}

async function smokePortableServer(runtimeExecutable, extracted, dataRoot, applicationVersion) {
  const port = await freeLoopbackPort();
  const output = [];
  const child = spawn(runtimeExecutable, [join(extracted, "launcher.mjs"), "start", "--no-open"], {
    cwd: extracted,
    env: {
      ...process.env,
      TAKEBOARD_BACKUP_DESTINATION: "",
      TAKEBOARD_DATA_ROOT: dataRoot,
      TAKEBOARD_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  const collect = (chunk) => {
    output.push(String(chunk));
    if (output.length > 80) output.shift();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`便携服务提前退出（${child.exitCode}）\n${output.join("")}`);
      }
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      })
        .then(async (response) => (response.ok ? await response.json() : null))
        .catch(() => null);
      if (health) {
        if (
          health.service !== "takeboard-server" ||
          health.status !== "ok" ||
          health.version !== applicationVersion ||
          typeof health.instanceId !== "string"
        ) {
          throw new Error("便携服务健康信息与构建不一致");
        }
        const page = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(3_000),
        });
        const html = await page.text();
        if (!page.ok || !/<(?:html|div\s+id=["']root["'])/i.test(html)) {
          throw new Error("便携服务未返回可用网页入口");
        }
        return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error(`便携服务未在 30 秒内就绪\n${output.join("")}`);
  } finally {
    await stopPortableLauncher(child);
  }
}

async function main() {
  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const platform =
    process.platform === "darwin"
      ? "macos"
      : process.platform === "win32"
        ? "windows"
        : process.platform;
  const nativeTarget = `${platform}-${process.arch}`;
  const expectedTarget = process.env.TAKEBOARD_BUNDLE_TARGET?.trim();
  if (expectedTarget && expectedTarget !== nativeTarget) {
    throw new Error(`Runner 架构与发行目标不一致：期望 ${expectedTarget}，实际 ${nativeTarget}`);
  }
  const artifactBase = `takeboard-v${rootPackage.version}-${nativeTarget}`;
  const artifact = join(outputRoot, `${artifactBase}.tar.gz`);
  const checksum = `${artifact}.sha256`;
  const smokeRoot = join(outputRoot, `.smoke-${platform}-${process.arch}`);
  let digest = null;
  try {
    await Promise.all([
      rm(artifact, { force: true }),
      rm(checksum, { force: true }),
      rm(smokeRoot, { recursive: true, force: true }),
    ]);
    await rm(stagingRoot, { recursive: true, force: true });
    await mkdir(bundleRoot, { recursive: true });
    if (!skipBuild) runPnpm(["build"]);
    runPnpm([
      "--config.node-linker=hoisted",
      "--filter",
      "@takeboard/server",
      "deploy",
      "--prod",
      serverRoot,
    ]);
    await Promise.all([
      cp(join(repositoryRoot, "apps", "web", "dist"), join(bundleRoot, "web"), {
        recursive: true,
      }),
      cp(
        join(repositoryRoot, "scripts", "portable-launcher.mjs"),
        join(bundleRoot, "launcher.mjs"),
      ),
      cp(join(repositoryRoot, "LICENSE"), join(bundleRoot, "LICENSE")),
    ]);
    const runtime = await copyNodeRuntime();
    await writeLaunchers();
    const commit = run("git", ["rev-parse", "HEAD"], { capture: true });
    const sourceDirty = Boolean(
      run("git", ["status", "--porcelain", "--untracked-files=all"], { capture: true }),
    );
    if (process.env.CI && sourceDirty) {
      throw new Error("CI 便携包只能从干净的 Git 工作区构建");
    }
    await writeFile(
      join(bundleRoot, "BUILD.json"),
      `${JSON.stringify(
        {
          format: "takeboard.portable-build",
          version: 1,
          applicationVersion: rootPackage.version,
          commit,
          sourceDirty,
          nativeTarget,
          platform,
          architecture: process.arch,
          runtime,
          codeSigned: false,
          includesComfyUI: false,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    run(process.platform === "win32" ? "tar.exe" : "tar", [
      "-czf",
      artifact,
      "-C",
      stagingRoot,
      "TakeBoard",
    ]);
    digest = await sha256File(artifact);
    await writeFile(checksum, `${digest}  ${artifactBase}.tar.gz\n`, "utf8");
    await mkdir(smokeRoot, { recursive: true });
    run(process.platform === "win32" ? "tar.exe" : "tar", ["-xzf", artifact, "-C", smokeRoot]);
    const extracted = join(smokeRoot, "TakeBoard");
    const runtimeExecutable = join(
      extracted,
      "runtime",
      process.platform === "win32" ? "node.exe" : "node",
    );
    if (process.platform !== "win32") {
      await access(join(extracted, "start-takeboard.sh"), constants.X_OK);
    }
    run(runtimeExecutable, [join(extracted, "launcher.mjs"), "doctor"], {
      env: { TAKEBOARD_DATA_ROOT: join(smokeRoot, "smoke-data") },
    });
    await smokePortableServer(
      runtimeExecutable,
      extracted,
      join(smokeRoot, "smoke-data"),
      rootPackage.version,
    );
  } catch (error) {
    await Promise.all([rm(artifact, { force: true }), rm(checksum, { force: true })]);
    throw error;
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
    await rm(stagingRoot, { recursive: true, force: true });
  }
  console.log(`Portable bundle: ${artifact}`);
  console.log(`SHA-256: ${digest}`);
}

await main();
