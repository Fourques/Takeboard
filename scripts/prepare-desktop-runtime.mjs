#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repositoryRoot, "apps", "desktop");
const tauriRoot = join(desktopRoot, "src-tauri");
const resourceRoot = join(tauriRoot, "resources", "TakeBoard");
const serverRoot = join(resourceRoot, "app");
const binariesRoot = join(tauriRoot, "binaries");

const triples = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
};

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr || result.stdout : "";
    throw new Error(`${command} ${arguments_.join(" ")} 失败${detail ? `\n${detail}` : ""}`);
  }
  return String(result.stdout ?? "").trim();
}

function runPnpm(arguments_) {
  if (process.platform === "win32") {
    return run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "pnpm.cmd", ...arguments_]);
  }
  return run("pnpm", arguments_);
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function copyNodeLicense() {
  const prefix =
    process.platform === "win32" ? dirname(process.execPath) : dirname(dirname(process.execPath));
  const candidates = [
    process.env.TAKEBOARD_NODE_LICENSE,
    join(prefix, "LICENSE"),
    join(prefix, "LICENSE.md"),
    "/usr/share/doc/nodejs/copyright",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await cp(candidate, join(resourceRoot, "NODE-LICENSE.txt"));
      return;
    } catch {
      // Continue through official Node and distribution package locations.
    }
  }
  throw new Error("无法找到 Node.js 许可证；请设置 TAKEBOARD_NODE_LICENSE");
}

async function main() {
  const nativeKey = `${process.platform}-${process.arch}`;
  const nativeTriple = triples[nativeKey];
  if (!nativeTriple) throw new Error(`桌面构建尚不支持 ${nativeKey}`);
  const requestedTriple = process.env.TAKEBOARD_DESKTOP_TARGET?.trim() || nativeTriple;
  if (requestedTriple !== nativeTriple) {
    throw new Error(`当前 Runner 是 ${nativeTriple}，不能生成 ${requestedTriple} 的原生运行时`);
  }
  const executableSuffix = process.platform === "win32" ? ".exe" : "";
  const sidecar = join(binariesRoot, `takeboard-node-${nativeTriple}${executableSuffix}`);
  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));

  await Promise.all([
    rm(join(tauriRoot, "resources"), { recursive: true, force: true }),
    rm(binariesRoot, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(resourceRoot, { recursive: true }),
    mkdir(binariesRoot, { recursive: true }),
  ]);

  runPnpm(["build"]);
  runPnpm([
    "--config.node-linker=hoisted",
    "--filter",
    "@takeboard/server",
    "deploy",
    "--prod",
    serverRoot,
  ]);
  await Promise.all([
    cp(join(repositoryRoot, "apps", "web", "dist"), join(resourceRoot, "web"), { recursive: true }),
    cp(
      join(repositoryRoot, "scripts", "portable-launcher.mjs"),
      join(resourceRoot, "launcher.mjs"),
    ),
    cp(join(repositoryRoot, "LICENSE"), join(resourceRoot, "LICENSE")),
    cp(process.execPath, sidecar),
  ]);
  if (process.platform !== "win32") await chmod(sidecar, 0o755);
  await copyNodeLicense();
  await Promise.all([
    access(join(serverRoot, "dist", "index.js"), constants.R_OK),
    access(join(resourceRoot, "web", "index.html"), constants.R_OK),
    access(sidecar, constants.X_OK),
  ]);
  const commit = run("git", ["rev-parse", "HEAD"], { capture: true });
  await writeFile(
    join(resourceRoot, "BUILD.json"),
    `${JSON.stringify(
      {
        format: "takeboard.desktop-runtime",
        version: 1,
        applicationVersion: rootPackage.version,
        commit,
        nativeTarget: nativeKey.replace("darwin", "macos").replace("win32", "windows"),
        rustTarget: nativeTriple,
        runtime: `Node.js ${process.versions.node}`,
        runtimeSha256: await sha256(sidecar),
        codeSigned: false,
        includesComfyUI: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const verificationRoot = await mkdtemp(join(tmpdir(), "takeboard-desktop-verify-"));
  try {
    run(sidecar, [join(resourceRoot, "launcher.mjs"), "doctor"], {
      env: { ...process.env, TAKEBOARD_DATA_ROOT: verificationRoot },
    });
  } finally {
    await rm(verificationRoot, { recursive: true, force: true });
  }
  console.log(`Desktop runtime ready: ${nativeTriple}`);
  console.log(`Resources: ${resourceRoot}`);
  console.log(`Node sidecar SHA-256: ${await sha256(sidecar)}`);
}

await main();
