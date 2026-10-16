#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { acquireAcceptanceLock } from "./process-lock.mjs";
import { starterWorkflows } from "./starter-workflows.mjs";
import { submitOnce } from "./submission-recovery.mjs";

const config = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.equal(config.mode, "tunnel");
const root = join(config.dataRoot, "acceptance");
const lease = await acquireAcceptanceLock(root);
try {
  // Credentials stay in the private data disk and are never included in the proof or output.
  const session = JSON.parse(await readFile(join(root, "session.json"), "utf8"));
  const base = `http://127.0.0.1:${config.port ?? 48120}`;
  async function request(path, body, revision) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: session.cookie ?? "",
        ...(session.csrf ? { "x-takeboard-csrf": session.csrf } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(revision === undefined ? {} : { "x-takeboard-revision": String(revision) }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json();
    if (response.headers.getSetCookie().length)
      session.cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
    if (result.csrfToken) session.csrf = result.csrfToken;
    return { code: response.status, result };
  }
  async function ok(path, body, revision) {
    const { code, result } = await request(path, body, revision);
    assert.ok(
      code >= 200 && code < 300,
      `API status ${code}: ${String(result.error ?? "request failed")}`,
    );
    return result;
  }
  await ok("/api/auth/login", { email: session.email, password: session.password });
  await writeFile(join(root, "session.json"), JSON.stringify(session), { mode: 0o600 });
  const generationProof = JSON.parse(await readFile(join(root, "proof.json"), "utf8"));
  const video = generationProof.generations.find((entry) =>
    entry.recipePath.endsWith("Wan21_T2V.json"),
  );
  assert.ok(video, "Real video acceptance must finish before lifecycle tests");
  const path = `/api/projects/${session.projectKey}`;
  const health = await ok("/api/health");
  assert.equal(health.instanceId, generationProof.instanceId);
  const original = await ok(path);
  const completed = original.snapshot.runs.find((run) => run.id === video.runId);
  assert.equal(completed.status, "completed");
  assert.ok(
    original.snapshot.canvasItems.some(
      (item) => item.refType === "asset" && item.refId === video.assetId,
    ),
  );
  async function verifyAsset() {
    const response = await fetch(`${base}${path}/assets/${video.assetId}/content?download=1`, {
      headers: { cookie: session.cookie },
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200);
    const hash = createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");
    assert.equal(hash, video.outputHash);
    return hash;
  }
  await verifyAsset();
  if (process.argv.includes("--verify-only")) {
    const previous = JSON.parse(await readFile(join(root, "lifecycle-proof.json"), "utf8"));
    previous.takeboardRestart = {
      checkedAt: new Date().toISOString(),
      instanceStable: true,
      videoAndCanvasPreserved: true,
      assetHash: video.outputHash,
    };
    await writeFile(join(root, "lifecycle-proof.json"), JSON.stringify(previous, null, 2));
    console.log(
      "PASS: TakeBoard restart preserves instance, video run, asset, canvas and download hash",
    );
    process.exit(0);
  }
  async function queue() {
    const response = await fetch("http://127.0.0.1:8188/queue", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.ok(Array.isArray(value.queue_running) && Array.isArray(value.queue_pending));
    return value;
  }
  async function idle() {
    const value = await queue();
    return value.queue_running.length === 0 && value.queue_pending.length === 0;
  }
  function gpu() {
    const values = execFileSync(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
      { encoding: "utf8", timeout: 8000 },
    ).trim();
    assert.equal(values.split("\n").length, 1, "Acceptance requires one known GPU");
    const [usedMiB, totalMiB] = values.split(",").map(Number);
    assert.ok(Number.isFinite(usedMiB) && Number.isFinite(totalMiB));
    return { usedMiB, totalMiB };
  }
  async function until(check, timeoutMs, message) {
    const deadline = Date.now() + timeoutMs;
    do {
      if (await check()) return;
      await delay(1000);
    } while (Date.now() < deadline);
    throw new Error(message);
  }
  const journalFile = join(root, "lifecycle-journal.json");
  let journal;
  try {
    journal = JSON.parse(await readFile(journalFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    journal = {};
  }
  const persist = () => writeFile(journalFile, JSON.stringify(journal, null, 2), { mode: 0o600 });
  const proof = {
    format: "takeboard.autodl-lifecycle.v1",
    instanceId: health.instanceId,
    observedAt: new Date().toISOString(),
    videoRunId: video.runId,
  };
  assert.ok(
    await idle(),
    "Do not release resources or test cancellation while unrelated work is queued",
  );
  const worker = await ok("/api/workers/comfy");
  assert.equal(worker.status, "ready");
  assert.equal(
    worker.control.canStop,
    true,
    "Lifecycle tests require the process owned by this TakeBoard",
  );
  proof.afterGeneration = gpu();
  console.log(`Observing automatic idle release; GPU used ${proof.afterGeneration.usedMiB} MiB`);
  await until(
    async () => (await idle()) && gpu().usedMiB < 2048,
    180_000,
    "Automatic idle GPU release did not reach the expected low-memory state",
  );
  proof.automaticIdleRelease = {
    ...gpu(),
    idle: true,
    checkedAt: new Date().toISOString(),
    initiallyLoaded: proof.afterGeneration.usedMiB >= 2048,
  };
  console.log(`PASS: idle GPU memory ${proof.automaticIdleRelease.usedMiB} MiB`);

  const recipe = starterWorkflows.find((entry) => entry.outputMediaType === "video");
  const cancelSeed = recipe.acceptance.seed + 1;
  if (!journal.cancelRunId) {
    const current = await ok(path);
    const record = { submissionIntent: journal.submissionIntent };
    await submitOnce(
      record,
      current.snapshot.runs,
      { shotId: completed.shotId, recipePath: recipe.path, seed: cancelSeed },
      async () => {
        journal.submissionIntent = record.submissionIntent;
        if (record.runId) journal.cancelRunId = record.runId;
        await persist();
      },
      () =>
        ok(
          `${path}/shots/${completed.shotId}/generate`,
          {
            recipePath: recipe.path,
            prompt: recipe.prompt[recipe.parameters.prompt[0].nodeId].inputs.text,
            negativePrompt: recipe.prompt[recipe.parameters.negative_prompt[0].nodeId].inputs.text,
            ...recipe.acceptance,
            seed: cancelSeed,
          },
          current.revision,
        ),
    );
  }
  let cancelRun = (await ok(path)).snapshot.runs.find((run) => run.id === journal.cancelRunId);
  assert.ok(cancelRun);
  if (!journal.cancelled) {
    assert.ok(
      !["completed", "failed", "cancelled", "orphaned"].includes(cancelRun.status),
      "Cancellation trial is already terminal; do not silently regenerate it",
    );
    await until(
      async () => {
        const state = await queue();
        return state.queue_running.some(
          (entry) => Array.isArray(entry) && entry[1] === cancelRun.promptId,
        );
      },
      60_000,
      "Cancellation trial did not enter the running queue",
    );
    const fleet = await ok("/api/workers");
    const blockedRelease = await request("/api/workers/comfy/release", {
      workerId: fleet.defaultWorkerId,
    });
    assert.equal(blockedRelease.code, 409, "Release must be rejected while a task is running");
    const blockedStop = await request("/api/workers/comfy/stop", { action: "safe-stop" });
    assert.equal(blockedStop.code, 409, "Stop must be rejected while a task is running");
    const cancelled = await ok(`${path}/runs/${journal.cancelRunId}/cancel`, {});
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.status, "cancelled");
    journal.cancelled = true;
    journal.busyControlsRejected = true;
    await persist();
    console.log(`PASS: busy release/stop rejected, targeted cancellation ${journal.cancelRunId}`);
  }
  await until(idle, 30_000, "Cancelled task still present in execution queue");
  cancelRun = (await ok(path)).snapshot.runs.find((run) => run.id === journal.cancelRunId);
  assert.equal(cancelRun.status, "cancelled");
  const fleet = await ok("/api/workers");
  const released = await ok("/api/workers/comfy/release", { workerId: fleet.defaultWorkerId });
  assert.equal(released.requested, true);
  await until(() => gpu().usedMiB < 2048, 30_000, "GPU memory still loaded after explicit release");
  proof.cancellation = {
    runId: journal.cancelRunId,
    status: cancelRun.status,
    queueIdle: true,
    busyControlsRejected: journal.busyControlsRejected,
  };
  proof.explicitRelease = { ...gpu(), requested: true };
  assert.equal((await ok("/api/workers/comfy/stop", { action: "safe-stop" })).stopped, true);
  assert.equal((await ok("/api/workers/comfy")).status, "offline");
  assert.equal((await ok("/api/health")).status, "ok");
  proof.safeStop = { stopped: true, takeboardHealthy: true, ...gpu() };
  console.log("PASS: safe-stop releases owned service without closing TakeBoard");
  assert.equal((await ok("/api/workers/comfy/start", { action: "safe-start" })).status, "ready");
  const inspect = await ok(`/api/workflows/inspect?path=${encodeURIComponent(recipe.path)}`);
  assert.equal(inspect.diagnostic.executable, true);
  await verifyAsset();
  proof.serviceRestart = { ready: true, workflowExecutable: true, assetHash: video.outputHash };
  assert.equal((await ok("/api/workers/comfy/stop", { action: "safe-stop" })).stopped, true);
  proof.finalState = { serviceStopped: true, ...gpu() };
  await writeFile(join(root, "lifecycle-proof.json"), JSON.stringify(proof, null, 2));
  console.log(
    "PASS: ComfyUI restart preserves workflow, asset and download; service stopped after acceptance",
  );
} finally {
  await lease.close();
}
