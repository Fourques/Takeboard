#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = (process.env.TAKEBOARD_GATE_URL ?? "http://127.0.0.1:48120").replace(/\/$/, "");
const email = process.env.TAKEBOARD_GATE_EMAIL;
const password = process.env.TAKEBOARD_GATE_PASSWORD;
const authOff = process.env.TAKEBOARD_GATE_AUTH === "off";
const workflowPath = process.env.TAKEBOARD_GATE_WORKFLOW ?? "Kino/Kino_MinimaxH3_T2V.json";
const timeoutMinutes = Number(process.env.TAKEBOARD_GATE_TIMEOUT_MINUTES ?? 45);
const keepProject = process.env.TAKEBOARD_GATE_KEEP === "1";

if (!authOff && (!email || !password)) {
  throw new Error(
    "真实 GPU Gate 需要 TAKEBOARD_GATE_EMAIL 和 TAKEBOARD_GATE_PASSWORD；凭据只用于本次本机登录，不会写入报告。",
  );
}
if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 240) {
  throw new Error("TAKEBOARD_GATE_TIMEOUT_MINUTES 必须在 1–240 之间");
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
          width: Number(process.env.TAKEBOARD_GATE_WIDTH ?? 480),
          height: Number(process.env.TAKEBOARD_GATE_HEIGHT ?? 848),
          durationSeconds: Number(process.env.TAKEBOARD_GATE_DURATION ?? 5),
          fps: Number(process.env.TAKEBOARD_GATE_FPS ?? 24),
          steps: Number(process.env.TAKEBOARD_GATE_STEPS ?? 20),
          seed: Number(process.env.TAKEBOARD_GATE_SEED ?? 20260830),
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
  if (!take || !asset || asset.mediaType !== "video")
    throw new Error("Run 完成但没有登记可复用视频 Take");
  const media = await fetch(
    `${baseUrl}/api/projects/${encodeURIComponent(projectKey)}/assets/${encodeURIComponent(asset.id)}/content`,
    { headers: { cookie, range: "bytes=0-63" }, signal: AbortSignal.timeout(30_000) },
  );
  const bytes = new Uint8Array(await media.arrayBuffer());
  if (![200, 206].includes(media.status) || bytes.length < 8)
    throw new Error("生成视频无法从项目资产库读取");
  report = {
    format: "takeboard.gpu-release-gate",
    version: 1,
    passed: true,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    elapsedSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    takeboardVersion: health.version,
    worker: {
      engine: worker.engine,
      version: worker.version,
      device: worker.device,
      vramTotal: worker.vramTotal,
    },
    workflow: {
      path: workflow.path,
      execution: workflow.execution,
      workflowHash: workflow.workflowHash,
      models: workflow.models,
    },
    output: {
      runId,
      assetId: asset.id,
      mediaType: asset.mediaType,
      contentType: media.headers.get("content-type"),
      probeBytes: bytes.length,
    },
  };
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
