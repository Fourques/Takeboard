#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateCompatibilityEvidence } from "./compatibility-evidence.mjs";

const baseUrl = (process.env.TAKEBOARD_GATE_URL ?? "http://127.0.0.1:48120").replace(/\/$/, "");
const email = process.env.TAKEBOARD_GATE_EMAIL;
const password = process.env.TAKEBOARD_GATE_PASSWORD;
const authOff = process.env.TAKEBOARD_GATE_AUTH === "off";
const workflowPath = process.env.TAKEBOARD_GATE_WORKFLOW ?? "Kino/Kino_MinimaxH3_T2V.json";
const timeoutMinutes = Number(process.env.TAKEBOARD_GATE_TIMEOUT_MINUTES ?? 45);
const keepProject = process.env.TAKEBOARD_GATE_KEEP === "1";
const generation = {
  width: Number(process.env.TAKEBOARD_GATE_WIDTH ?? 480),
  height: Number(process.env.TAKEBOARD_GATE_HEIGHT ?? 848),
  durationSeconds: Number(process.env.TAKEBOARD_GATE_DURATION ?? 5),
  fps: Number(process.env.TAKEBOARD_GATE_FPS ?? 24),
  steps: Number(process.env.TAKEBOARD_GATE_STEPS ?? 20),
  seed: Number(process.env.TAKEBOARD_GATE_SEED ?? 20260830),
};

if (!authOff && (!email || !password)) {
  throw new Error(
    "真实 GPU Gate 需要 TAKEBOARD_GATE_EMAIL 和 TAKEBOARD_GATE_PASSWORD；凭据只用于本次本机登录，不会写入报告。",
  );
}
if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 240) {
  throw new Error("TAKEBOARD_GATE_TIMEOUT_MINUTES 必须在 1–240 之间");
}
if (
  !Number.isInteger(generation.width) ||
  !Number.isInteger(generation.height) ||
  generation.width < 64 ||
  generation.height < 64 ||
  !Number.isFinite(generation.durationSeconds) ||
  generation.durationSeconds <= 0 ||
  !Number.isFinite(generation.fps) ||
  generation.fps <= 0 ||
  !Number.isInteger(generation.steps) ||
  generation.steps <= 0 ||
  !Number.isSafeInteger(generation.seed)
) {
  throw new Error("GPU Gate 的宽高、时长、FPS、步数或 Seed 配置无效");
}

function sourceState() {
  const environmentCommit = process.env.GITHUB_SHA?.trim();
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const repositoryCommit = String(result.stdout ?? "").trim();
  const commit =
    result.status === 0 && /^[a-f0-9]{40}$/i.test(repositoryCommit) ? repositoryCommit : null;
  if (
    environmentCommit &&
    /^[a-f0-9]{40}$/i.test(environmentCommit) &&
    commit &&
    environmentCommit.toLowerCase() !== commit.toLowerCase()
  ) {
    throw new Error("GITHUB_SHA 与当前检出的 Git Commit 不一致，拒绝生成错误归属的证据");
  }
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    encoding: "utf8",
  });
  return {
    commit,
    dirty: status.status === 0 ? String(status.stdout ?? "").trim().length > 0 : null,
  };
}

const source = sourceState();
if (!source.commit || source.dirty !== false) {
  throw new Error(
    "真实 GPU Release Gate 只接受绑定干净工作树的 40 位 Commit；请先提交代码再运行，避免耗费显存后才发现证据不可发布。",
  );
}

let cookie = "";
let csrf = "";
let projectKey = "";
let revision = 0;
let runId = "";
let runTerminal = false;

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("cookie", cookie);
  const method = (options.method ?? "GET").toUpperCase();
  if (csrf && !["GET", "HEAD"].includes(method)) headers.set("x-takeboard-csrf", csrf);
  if (
    projectKey &&
    path.startsWith(`/api/projects/${encodeURIComponent(projectKey)}`) &&
    !["GET", "HEAD"].includes(method)
  ) {
    headers.set("x-takeboard-revision", String(revision));
  }
  if (options.body && typeof options.body === "string")
    headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json") ? await response.json() : null;
  if (!response.ok)
    throw new Error(payload?.error ?? `${method} ${path} failed with ${response.status}`);
  if (payload && typeof payload.revision === "number") revision = payload.revision;
  return { response, payload };
}

const startedAt = new Date();
let report;
try {
  if (!authOff) {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(30_000),
    });
    const login = await loginResponse.json();
    if (!loginResponse.ok) throw new Error(login.error ?? "TakeBoard Gate 登录失败");
    cookie = (loginResponse.headers.get("set-cookie") ?? "").split(";", 1)[0];
    csrf = login.csrfToken;
    if (!cookie || !csrf) throw new Error("登录没有建立安全会话");
  }

  const health = (await request("/api/health")).payload;
  const worker = (await request("/api/workers/comfy")).payload;
  if (worker.status !== "ready")
    throw new Error(worker.error ?? "ComfyUI 尚未连接，不能执行真实 GPU Gate");
  const workflows = (await request("/api/workflows")).payload.workflows;
  const workflow = workflows.find((candidate) => candidate.path === workflowPath);
  if (!workflow) throw new Error(`没有检测到 Gate 工作流：${workflowPath}`);
  if (!["native", "bound"].includes(workflow.execution) || workflow.modelStatus === "missing") {
    throw new Error(
      `工作流尚不可执行：${workflow.execution} / ${workflow.modelStatus ?? "unknown"}`,
    );
  }

  const created = (
    await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title: `GPU Release Gate ${startedAt.toISOString()}` }),
    })
  ).payload;
  projectKey = created.key;
  revision = created.revision;
  const shot = (
    await request(`/api/projects/${encodeURIComponent(projectKey)}/commands`, {
      method: "POST",
      body: JSON.stringify({
        command: { type: "canvas.create_shot", label: "GPU-GATE-01" },
        requestId: `gpu-gate:${crypto.randomUUID()}`,
        expectedRevision: revision,
      }),
    })
  ).payload;
  const submitted = (
    await request(
      `/api/projects/${encodeURIComponent(projectKey)}/shots/${encodeURIComponent(shot.shotId)}/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          recipePath: workflowPath,
          prompt:
            process.env.TAKEBOARD_GATE_PROMPT ??
            "[Shot 1] A quiet silver river at dawn, gentle mist, one slow cinematic push-in, stable exposure, natural ambience, no dialogue.",
          negativePrompt: "flicker, unstable identity, warped geometry, abrupt camera motion",
          ...generation,
        }),
      },
    )
  ).payload;
  runId = submitted.runId;
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let latest = submitted;
  while (Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
    latest = (
      await request(
        `/api/projects/${encodeURIComponent(projectKey)}/runs/${encodeURIComponent(runId)}`,
      )
    ).payload;
    process.stdout.write(
      `\rGPU Gate ${latest.status}${latest.progress?.percent !== null && latest.progress?.percent !== undefined ? ` · ${Math.round(latest.progress.percent)}%` : ""}     `,
    );
    if (["completed", "failed", "cancelled", "orphaned"].includes(latest.status)) break;
  }
  process.stdout.write("\n");
  runTerminal = ["completed", "failed", "cancelled", "orphaned"].includes(latest.status);
  if (!runTerminal) throw new Error(`真实生成超过 ${timeoutMinutes} 分钟，Gate 超时`);
  if (latest.status !== "completed") {
    const run = latest.snapshot?.runs?.find((candidate) => candidate.id === runId);
    throw new Error(
      `真实生成未完成：${latest.status} · ${run?.errorMessage ?? run?.errorCode ?? "无诊断"}`,
    );
  }
  const take = latest.snapshot.takes.find((candidate) => candidate.runId === runId);
  const asset = latest.snapshot.assets.find((candidate) => candidate.id === take?.assetId);
  const completedRun = latest.snapshot.runs.find((candidate) => candidate.id === runId);
  if (!take || !asset || !completedRun || asset.mediaType !== "video")
    throw new Error("Run 完成但没有登记可复用视频 Take");
  if (
    !asset.width ||
    !asset.height ||
    !asset.durationSeconds ||
    !asset.frameRate ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !/^[a-f0-9]{64}$/.test(completedRun.workflowSha256)
  ) {
    throw new Error("生成视频缺少可验证的尺寸、时长、帧率或内容哈希");
  }
  const media = await fetch(
    `${baseUrl}/api/projects/${encodeURIComponent(projectKey)}/assets/${encodeURIComponent(asset.id)}/content`,
    { headers: { cookie, range: "bytes=0-63" }, signal: AbortSignal.timeout(30_000) },
  );
  const bytes = new Uint8Array(await media.arrayBuffer());
  if (![200, 206].includes(media.status) || bytes.length < 8)
    throw new Error("生成视频无法从项目资产库读取");
  report = {
    format: "takeboard.gpu-release-gate",
    version: 2,
    evidenceId: randomUUID(),
    evidenceKind: "real_gpu_end_to_end",
    passed: true,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    elapsedSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    takeboardVersion: health.version,
    source,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
    },
    worker: {
      engine: worker.engine,
      version: worker.version,
      device: worker.device,
      vramTotal: worker.vramTotal ?? null,
      vramFreeAtStart: worker.vramFree ?? null,
    },
    workflow: {
      path: workflow.path,
      execution: workflow.execution,
      workflowHash: workflow.workflowHash,
      executionPromptSha256: completedRun.workflowSha256,
      models: workflow.models,
    },
    generation,
    output: {
      mediaType: asset.mediaType,
      contentType: media.headers.get("content-type"),
      byteSize: asset.byteSize,
      sha256: asset.sha256,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds ?? null,
      frameRate: asset.frameRate ?? null,
      probeBytes: bytes.length,
    },
    review: {
      automatedIntegrity: "passed",
      visualQuality: "not_reviewed",
    },
    privacy: "不包含账号、密码、Cookie、Token、项目名称、提示词、素材内容、绝对路径或运行标识。",
  };
  validateCompatibilityEvidence(report, "generated GPU gate evidence");
  const reportRoot = resolve("test-results", "release-gates");
  await mkdir(reportRoot, { recursive: true });
  const reportPath = resolve(
    reportRoot,
    `gpu-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`,
  );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`真实 GPU Gate 通过。证据：${reportPath}`);
} finally {
  if (projectKey && !keepProject) {
    if (runId && !runTerminal) {
      await request(
        `/api/projects/${encodeURIComponent(projectKey)}/runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST" },
      ).catch(() => undefined);
    }
    try {
      await request(`/api/projects/${encodeURIComponent(projectKey)}`, { method: "DELETE" });
    } catch {
      await request(`/api/projects/${encodeURIComponent(projectKey)}`).catch(() => undefined);
      await request(`/api/projects/${encodeURIComponent(projectKey)}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  } else if (projectKey) {
    console.log(`已按 TAKEBOARD_GATE_KEEP=1 保留 Gate 项目：${projectKey}`);
  }
}
