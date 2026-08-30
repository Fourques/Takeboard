#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, request } from "@playwright/test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(repositoryRoot, "test-results", "demo");
const applicationVersion = JSON.parse(
  await readFile(join(repositoryRoot, "package.json"), "utf8"),
).version;

function portAvailable(port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolvePort(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolvePort(true)));
  });
}

async function selectPort() {
  for (let port = 48240; port <= 48259; port += 1) {
    if (await portAvailable(port)) return port;
  }
  throw new Error("演示录制端口 48240–48259 均被占用");
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`演示服务提前退出：${child.exitCode}`);
    const ready = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(800),
    })
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("演示服务未在 30 秒内就绪");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function sourceState() {
  const commitResult = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const statusResult = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const value = String(commitResult.stdout ?? "").trim();
  return {
    commit: commitResult.status === 0 && /^[a-f0-9]{40}$/i.test(value) ? value : null,
    dirty: statusResult.status === 0 ? String(statusResult.stdout ?? "").trim().length > 0 : null,
  };
}

async function pause(page, milliseconds = 850) {
  await page.waitForTimeout(milliseconds);
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

async function stopOwnedServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  if (await waitForExit(server, 5_000)) return;
  server.kill("SIGKILL");
  if (!(await waitForExit(server, 5_000))) throw new Error("演示服务无法停止");
}

async function main() {
  const source = sourceState();
  if (process.env.CI && (!source.commit || source.dirty !== false)) {
    throw new Error("CI 产品演示只能从绑定 40 位 Commit 的干净工作树录制");
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "takeboard-product-demo-"));
  const dataRoot = join(temporaryRoot, "data");
  const videoScratch = join(temporaryRoot, "video");
  const port = await selectPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await rm(outputRoot, { recursive: true, force: true });
  await Promise.all([
    mkdir(outputRoot, { recursive: true }),
    mkdir(videoScratch, { recursive: true }),
  ]);
  const server = spawn(
    process.execPath,
    [join(repositoryRoot, "apps", "server", "dist", "index.js")],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
        TAKEBOARD_AUTH_MODE: "required",
        TAKEBOARD_AUTH_DATABASE: join(dataRoot, ".system", "auth.db"),
        TAKEBOARD_DATA_ROOT: dataRoot,
        TAKEBOARD_BACKUP_DESTINATION: "",
        TAKEBOARD_DEMO_DIRECTORY: join(dataRoot, "demo.takeboard"),
        TAKEBOARD_HOST: "127.0.0.1",
        TAKEBOARD_PORT: String(port),
        TAKEBOARD_WEB_ROOT: join(repositoryRoot, "apps", "web", "dist"),
        COMFY_START_SERVICE: "takeboard-demo-disabled.service",
      },
      stdio: "ignore",
    },
  );
  let browser = null;
  let api = null;
  try {
    await waitForHealth(baseUrl, server);
    api = await request.newContext({ baseURL: baseUrl });
    const authenticated = await api.post("/api/auth/bootstrap", {
      data: {
        name: "TakeBoard Demo",
        email: "demo@takeboard.local",
        password: "takeboard deterministic demo passphrase",
      },
    });
    if (!authenticated.ok()) {
      throw new Error(
        `演示账号初始化失败：${authenticated.status()} ${await authenticated.text()}`,
      );
    }
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    browser = await chromium.launch(executablePath ? { executablePath } : undefined);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      storageState: await api.storageState(),
      recordVideo: { dir: videoScratch, size: { width: 1440, height: 900 } },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const video = page.video();
    await page.addInitScript(() => window.sessionStorage.setItem("takeboard.resumeDemo", "1"));
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const closeCreate = page.getByRole("button", { name: "关闭新建项目" });
    if (await closeCreate.isVisible()) await closeCreate.click();
    await page.getByText("雾港来信", { exact: true }).first().waitFor();
    await pause(page, 1_300);

    const reset = page.getByRole("button", { name: "重置 Demo" });
    await reset.click();
    await page.getByRole("button", { name: "确认重置" }).click();
    await page.getByText("这个镜头还没有 Take").waitFor();
    await pause(page);

    await page.locator(".react-flow__node-asset").first().click();
    await page.getByLabel("素材节点检查器").waitFor();
    await pause(page, 1_100);
    await page.locator(".react-flow__pane").click({ position: { x: 44, y: 700 } });
    await pause(page, 500);

    await page.locator(".react-flow__node-shot").first().click();
    await page.getByRole("button", { name: "开始生成" }).click();
    await page.getByRole("button", { name: "选择候选 2" }).waitFor();
    await pause(page, 1_200);
    await page.getByRole("button", { name: "选择候选 2" }).click();
    await page.locator(".react-flow__node-shot").first().click();
    await page.locator(".shot-inline-console").waitFor();
    await pause(page, 900);
    await page.getByRole("button", { name: "批准此 Take" }).click();
    await page.getByText("APPROVED").first().waitFor();
    await pause(page, 1_300);

    const coverPath = join(outputRoot, "takeboard-demo-cover.png");
    await page.screenshot({ path: coverPath, animations: "disabled" });
    await page.getByRole("button", { name: "打开分镜墙" }).click();
    const storyboard = page.getByRole("dialog", { name: "项目分镜墙" });
    await storyboard.waitFor();
    await pause(page, 1_200);
    await storyboard.getByRole("tab", { name: "粗剪预览" }).click();
    await storyboard.getByLabel("只读粗剪预览").waitFor();
    await pause(page, 1_600);
    await page.keyboard.press("Escape");
    await pause(page, 700);

    await context.close();
    if (!video) throw new Error("Playwright 没有创建演示视频");
    const recordedPath = await video.path();
    const videoPath = join(outputRoot, "takeboard-product-walkthrough.webm");
    await cp(recordedPath, videoPath);
    const [videoInformation, videoSha256, coverSha256] = await Promise.all([
      stat(videoPath),
      sha256File(videoPath),
      sha256File(coverPath),
    ]);
    if (videoInformation.size < 100_000) {
      throw new Error("演示视频异常过小，拒绝发布不完整录制");
    }
    const manifest = {
      format: "takeboard.product-demo",
      version: 1,
      applicationVersion,
      sourceCommit: source.commit,
      sourceDirty: source.dirty,
      recordedAt: new Date().toISOString(),
      viewport: { width: 1440, height: 900 },
      sequence: [
        "open_demo_project",
        "reset_deterministic_state",
        "inspect_source_asset",
        "generate_four_simulated_candidates",
        "approve_candidate",
        "inspect_storyboard_and_rough_cut",
      ],
      generation: {
        mode: "deterministic_demo",
        realGpu: false,
        disclosure: "候选内容是明确标记的产品演示占位，不是模型质量样片。",
      },
      files: {
        video: {
          name: "takeboard-product-walkthrough.webm",
          size: videoInformation.size,
          sha256: videoSha256,
        },
        cover: { name: "takeboard-demo-cover.png", sha256: coverSha256 },
      },
    };
    await writeFile(
      join(outputRoot, "takeboard-demo-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    console.log(`Product demo: ${videoPath}`);
    console.log(`Cover: ${coverPath}`);
  } finally {
    await api?.dispose().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await stopOwnedServer(server);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
