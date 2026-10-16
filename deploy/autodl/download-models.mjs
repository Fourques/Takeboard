#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, statfs } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireDownloadLock } from "./process-lock.mjs";

export function modelUrl(model, origin = "https://huggingface.co") {
  if (!["https://huggingface.co", "https://hf-mirror.com"].includes(origin))
    throw new Error("只允许官方模型站或 AutoDL 文档列出的 HTTPS 镜像，仍需核对官方哈希");
  const safePath = (value) =>
    typeof value === "string" &&
    value
      .split("/")
      .every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..");
  if (
    !safePath(model.path) ||
    !safePath(model.file) ||
    !safePath(model.repository) ||
    model.repository.split("/").length !== 2 ||
    !/^[a-f0-9]{40}$/.test(model.revision) ||
    !/^[a-f0-9]{64}$/.test(model.sha256) ||
    !Number.isSafeInteger(model.bytes) ||
    model.bytes <= 0
  )
    throw new Error("模型清单无效；必须包含固定版本、大小和 SHA-256");
  return `${origin}/${model.repository}/resolve/${model.revision}/${model.file}`;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function optionalStat(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function download(url, destination, transport, signal, lockFd) {
  return new Promise((done, fail) => {
    let failure;
    const child = spawn(
      transport,
      transport === "aria2c"
        ? [
            "--max-connection-per-server=8",
            "--split=8",
            "--min-split-size=16M",
            "--continue=true",
            "--file-allocation=none",
            "--auto-file-renaming=false",
            "--allow-overwrite=false",
            "--check-certificate=true",
            "--max-tries=3",
            "--retry-wait=5",
            "--timeout=30",
            "--connect-timeout=20",
            "--summary-interval=30",
            "--console-log-level=warn",
            `--dir=${dirname(destination)}`,
            `--out=${basename(destination)}`,
            url,
          ]
        : [
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--retry",
            "2",
            "--connect-timeout",
            "20",
            "--max-time",
            "1800",
            "--speed-limit",
            "102400",
            "--speed-time",
            "60",
            "--continue-at",
            "-",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--output",
            destination,
            url,
          ],
      { stdio: ["inherit", "inherit", "inherit", lockFd], signal },
    );
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) =>
      code === 0 && !failure
        ? done()
        : fail(failure ?? new Error(`模型下载未完成 (${code})；保留断点，不标记成功`)),
    );
  });
}

export async function downloadModels(
  modelRoot,
  manifestFile = new URL("./models.json", import.meta.url),
  { signal, transport = process.env.TAKEBOARD_MODEL_DOWNLOAD_TOOL ?? "curl" } = {},
) {
  if (!isAbsolute(modelRoot) || resolve(modelRoot) === "/")
    throw new Error("请指定模型目录的绝对路径");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (manifest.format !== "takeboard.autodl-models.v1" || !Array.isArray(manifest.models))
    throw new Error("模型清单格式无效");
  const origin = process.env.TAKEBOARD_MODEL_MIRROR ?? "https://huggingface.co";
  if (!["curl", "aria2c"].includes(transport)) throw new Error("下载工具必须为 curl 或 aria2c");
  signal?.throwIfAborted();
  for (const model of manifest.models) modelUrl(model, origin);
  await mkdir(modelRoot, { recursive: true });
  const lock = await acquireDownloadLock(modelRoot);
  try {
    const pending = [];
    for (const model of manifest.models) {
      const file = join(modelRoot, model.path);
      const existing = await optionalStat(file);
      if (existing) {
        if (existing.size !== model.bytes || (await sha256(file)) !== model.sha256)
          throw new Error(`已有模型与清单不符，未覆盖：${model.path}`);
        console.log(`校验通过：${model.path}`);
      } else pending.push(model);
    }
    if (pending.length === 0) return;
    const space = await statfs(modelRoot);
    // Deliberately budget full files, including resumed ones, to leave a conservative reserve.
    const required = pending.reduce((sum, model) => sum + model.bytes, 0) + 6 * 1024 ** 3;
    if (space.bavail * space.bsize < required)
      throw new Error("模型磁盘空间不足（另需保留 6 GiB）；未开始下载");
    for (const model of pending) {
      signal?.throwIfAborted();
      const file = join(modelRoot, model.path);
      const partial = `${file}.part`;
      await mkdir(dirname(file), { recursive: true });
      const partialStat = await optionalStat(partial);
      if (partialStat?.size > model.bytes)
        throw new Error(`断点文件过大，保留供检查：${model.path}`);
      console.log(`下载：${model.path} (${(model.bytes / 1024 ** 3).toFixed(2)} GiB)`);
      // aria2 preallocates the apparent file size; its control file means data is still incomplete.
      if (partialStat?.size !== model.bytes || (await optionalStat(`${partial}.aria2`)))
        await download(modelUrl(model, origin), partial, transport, signal, lock.fd);
      signal?.throwIfAborted();
      if ((await stat(partial)).size !== model.bytes || (await sha256(partial)) !== model.sha256)
        throw new Error(`模型校验失败，未启用：${model.path}`);
      await chmod(partial, 0o644);
      await rename(partial, file);
      console.log(`校验通过：${model.path}`);
    }
  } finally {
    await lock.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("用法：node download-models.mjs /绝对路径/ComfyUI/models");
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    await downloadModels(process.argv[2], undefined, { signal: controller.signal });
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
