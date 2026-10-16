#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { acquireAcceptanceLock } from "./process-lock.mjs";
import { starterWorkflows } from "./starter-workflows.mjs";
import { submitOnce } from "./submission-recovery.mjs";

// Real loopback API acceptance; no mock worker, fabricated result, or saved administrator in the image.
export async function acceptance(configFile, prepareOnly = false, { mediaType } = {}) {
  assert.ok(mediaType === undefined || ["image", "video"].includes(mediaType));
  const config = JSON.parse(await readFile(configFile, "utf8"));
  assert.equal(config.mode, "tunnel", "验收只能使用私有 tunnel 配置");
  const base = `http://127.0.0.1:${config.port ?? 48120}`;
  const privateRoot = join(config.dataRoot, "acceptance");
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  const lease = await acquireAcceptanceLock(privateRoot);
  try {
    const sessionFile = join(privateRoot, "session.json");
    let session;
    try {
      session = JSON.parse(await readFile(sessionFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      session = {
        email: "acceptance@example.test",
        password: randomBytes(32).toString("base64url"),
        runs: {},
      };
      await writeFile(sessionFile, JSON.stringify(session), { mode: 0o600, flag: "wx" });
    }
    const persist = () => writeFile(sessionFile, JSON.stringify(session), { mode: 0o600 });
    async function request(path, body, method = body === undefined ? "GET" : "POST", revision) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(session.cookie ? { cookie: session.cookie } : {}),
          ...(session.csrf ? { "x-takeboard-csrf": session.csrf } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(revision === undefined ? {} : { "x-takeboard-revision": String(revision) }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(120_000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          `${method} ${path}: ${response.status} ${JSON.stringify(result).slice(0, 1200)}`,
        );
      if (response.headers.getSetCookie().length) {
        session.cookie = response.headers
          .getSetCookie()
          .map((cookie) => cookie.split(";")[0])
          .join("; ");
      }
      if (result.csrfToken) session.csrf = result.csrfToken;
      return result;
    }
    const health = await request("/api/health");
    assert.equal(health.status, "ok");
    const anonymous = await fetch(`${base}/api/projects`);
    assert.ok([401, 428].includes(anonymous.status), "匿名项目访问必须被拒绝");
    const status = await request("/api/auth/status");
    if (!status.configured) {
      await request("/api/auth/bootstrap", {
        email: session.email,
        password: session.password,
        name: "Cloud Acceptance",
      });
    } else {
      await request("/api/auth/login", { email: session.email, password: session.password });
    }
    await persist();
    console.log("PASS: private server, anonymous denial, authenticated session");
    const worker = await request("/api/workers/comfy/start", { action: "safe-start" });
    assert.equal(worker.status, "ready");
    console.log("PASS: managed ComfyUI safe-start");
    if (prepareOnly) return;
    if (!session.projectKey) {
      session.projectKey = (await request("/api/projects", { title: "AutoDL 验收" })).key;
      await persist();
    }
    const projectPath = `/api/projects/${session.projectKey}`;
    async function command(value) {
      const { preview } = await request(`${projectPath}/commands/preview`, { command: value });
      return await request(`${projectPath}/commands`, {
        command: value,
        requestId: randomUUID(),
        expectedRevision: preview.currentRevision,
        ...(preview.requiresConfirmation ? { confirmationToken: preview.confirmationToken } : {}),
      });
    }
    const proofFile = join(privateRoot, "proof.json");
    let previousProof;
    try {
      previousProof = JSON.parse(await readFile(proofFile, "utf8"));
      assert.equal(previousProof.instanceId, health.instanceId);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const proof = {
      format: "takeboard.autodl-acceptance.v1",
      instanceId: health.instanceId,
      version: health.version,
      observedAt: new Date().toISOString(),
      generations: previousProof?.generations ?? [],
    };
    for (const recipe of starterWorkflows.filter(
      (recipe) => mediaType === undefined || recipe.outputMediaType === mediaType,
    )) {
      const saved = session.runs[recipe.path] ?? {};
      if (!saved.runId) {
        const response = await fetch(
          `http://127.0.0.1:8188/api/userdata/${encodeURIComponent(`workflows/${recipe.path}`)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(recipe.prompt),
            signal: AbortSignal.timeout(15_000),
          },
        );
        assert.ok(response.ok, `ComfyUI workflow persistence: ${response.status}`);
        await request(
          `/api/workflows/binding?path=${encodeURIComponent(recipe.path)}`,
          {
            trusted: true,
            capability: recipe.capability,
            outputMediaType: recipe.outputMediaType,
            parameters: recipe.parameters,
            media: recipe.media,
          },
          "PUT",
        );
        await request(
          `/api/workflows/library?path=${encodeURIComponent(recipe.path)}`,
          { name: recipe.name, included: true },
          "PUT",
        );
        const inspect = await request(
          `/api/workflows/inspect?path=${encodeURIComponent(recipe.path)}`,
        );
        assert.equal(inspect.diagnostic.executable, true, JSON.stringify(inspect.diagnostic));
        if (!saved.shotId) {
          const before = await request(projectPath);
          const oldIds = new Set(before.snapshot.shots.map((shot) => shot.id));
          const created = await command({
            type: "canvas.create_shot",
            label: recipe.name,
            x: recipe.outputMediaType === "image" ? 160 : 660,
            y: 160,
          });
          saved.shotId = created.snapshot.shots.find((shot) => !oldIds.has(shot.id)).id;
          const item = created.snapshot.canvasItems.find((item) => item.refId === saved.shotId);
          await command({ type: "canvas.edit_item", itemId: item.id, workflowPath: recipe.path });
          session.runs[recipe.path] = saved;
          await persist();
        }
        const current = await request(projectPath);
        const positive = recipe.parameters.prompt[0];
        const negative = recipe.parameters.negative_prompt[0];
        session.runs[recipe.path] = saved;
        await submitOnce(
          saved,
          current.snapshot.runs,
          { shotId: saved.shotId, recipePath: recipe.path, seed: recipe.acceptance.seed },
          persist,
          () =>
            request(
              `${projectPath}/shots/${saved.shotId}/generate`,
              {
                recipePath: recipe.path,
                prompt: recipe.prompt[positive.nodeId].inputs[positive.input],
                negativePrompt: recipe.prompt[negative.nodeId].inputs[negative.input],
                ...recipe.acceptance,
              },
              "POST",
              current.revision,
            ),
        );
        console.log(`SUBMITTED: ${recipe.name}, ${saved.runId}`);
      }
      const deadline = Date.now() + 30 * 60_000;
      let result;
      let lastStatus;
      while (Date.now() < deadline) {
        result = await request(`${projectPath}/runs/${saved.runId}`);
        const state = `${result.status}:${result.progress?.phase ?? ""}:${result.progress?.percent ?? "unknown"}`;
        if (state !== lastStatus) {
          console.log(`${recipe.name}: ${state}`);
          lastStatus = state;
        }
        if (result.status === "completed") break;
        if (["failed", "cancelled", "orphaned"].includes(result.status))
          throw new Error(
            JSON.stringify(result.snapshot.runs.find((run) => run.id === saved.runId)),
          );
        await delay(2000);
      }
      assert.equal(result.status, "completed", "真实生成超时；保留任务，不重新提交");
      const run = result.snapshot.runs.find((run) => run.id === saved.runId);
      const take = result.snapshot.takes.find((take) => take.runId === saved.runId);
      assert.ok(take, "完成任务必须有 Take");
      const asset = result.snapshot.assets.find((asset) => asset.id === take.assetId);
      assert.ok(asset, "Take 必须有实际 Asset");
      const response = await fetch(`${base}${projectPath}/assets/${asset.id}/content?download=1`, {
        headers: { cookie: session.cookie },
      });
      assert.ok(response.ok, "生成素材下载失败");
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length > 10_000, "输出不是有效生成媒体");
      const output = join(
        privateRoot,
        `${recipe.outputMediaType === "image" ? "image.png" : "video.mp4"}`,
      );
      await writeFile(output, bytes);
      const media = JSON.parse(
        execFileSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,nb_frames,r_frame_rate:format=duration",
            "-of",
            "json",
            output,
          ],
          { encoding: "utf8" },
        ),
      );
      assert.equal(media.streams[0].width, recipe.acceptance.width);
      assert.equal(media.streams[0].height, recipe.acceptance.height);
      execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"], {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 120_000,
      });
      if (recipe.outputMediaType === "video") {
        assert.equal(Number(media.streams[0].nb_frames), 81);
        assert.equal(media.streams[0].r_frame_rate, "16/1");
      }
      if (
        !result.snapshot.canvasItems.some(
          (item) => item.refType === "asset" && item.refId === asset.id,
        )
      )
        await command({
          type: "canvas.add_item",
          refType: "asset",
          refId: asset.id,
          x: recipe.outputMediaType === "image" ? 160 : 660,
          y: 550,
        });
      const outputHash = createHash("sha256").update(bytes).digest("hex");
      assert.equal(outputHash, asset.sha256, "下载内容必须与归档资产哈希一致");
      const generation = {
        recipePath: recipe.path,
        runId: run.id,
        takeId: take.id,
        assetId: asset.id,
        promptId: run.promptId,
        parameters: run.parameters,
        outputHash,
        bytes: bytes.length,
        media,
      };
      proof.generations = [
        ...proof.generations.filter((entry) => entry.recipePath !== recipe.path),
        generation,
      ];
      console.log(
        `PASS: ${recipe.name}, archived Run/Take/Asset, download/hash, full decode, canvas placement`,
      );
      await writeFile(proofFile, JSON.stringify(proof, null, 2));
    }
    console.log(
      `PASS: ${proof.generations.length} real generations. Proof: ${join(privateRoot, "proof.json")}`,
    );
    return proof;
  } finally {
    await lease.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.ok(process.argv[2], "用法：node acceptance.mjs /绝对路径/cloud.json [--prepare]");
  assert.ok(
    !(process.argv.includes("--image-only") && process.argv.includes("--video-only")),
    "不能同时指定 image-only 和 video-only",
  );
  await acceptance(process.argv[2], process.argv.includes("--prepare"), {
    mediaType: process.argv.includes("--image-only")
      ? "image"
      : process.argv.includes("--video-only")
        ? "video"
        : undefined,
  });
}
