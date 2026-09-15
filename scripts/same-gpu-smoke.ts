import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SameGpuPool } from "../apps/server/src/same-gpu-pool.js";
import { NvidiaGpuRuntime, parseGpuPoolConfig } from "../apps/server/src/same-gpu-runtime.js";

// Explicit opt-in hardware test. Never use the user's original ComfyUI endpoint.
if (process.env.TAKEBOARD_REAL_GPU_TEST !== "1")
  throw new Error("Set TAKEBOARD_REAL_GPU_TEST=1 explicitly");
const config = parseGpuPoolConfig(JSON.parse(process.env.TAKEBOARD_GPU_TEST_CONFIG ?? "null"));
const root = await mkdtemp(join(tmpdir(), "takeboard-real-gpu-"));
const runtime = new NvidiaGpuRuntime(config, root);
const pool = new SameGpuPool(config, root, runtime);
const ids: string[] = [];
const report: Record<string, unknown> = {
  root,
  startedAt: new Date().toISOString(),
  workload: "H3 VAE encode/decode, not diffusion video generation",
};
console.log(JSON.stringify(report));
try {
  report.before = await runtime.sample();
  await pool.start();
  console.log("Independent instances verified");
  for (let index = 0; index < 2; index++)
    ids.push(
      await pool.enqueue(
        {
          "1": {
            class_type: "VAELoader",
            inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
          },
          "2": {
            class_type: "EmptyImage",
            inputs: { width: 512, height: 512, batch_size: 1, color: index ? 16711680 : 255 },
          },
          "3": { class_type: "VAEEncode", inputs: { pixels: ["2", 0], vae: ["1", 0] } },
          "4": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["1", 0] } },
          "5": {
            class_type: "SaveImage",
            inputs: { images: ["4", 0], filename_prefix: "takeboard_pool_smoke" },
          },
        },
        `smoke-${index}`,
      ),
    );
  const deadline = Date.now() + 10 * 60_000;
  let overlap = false;
  let peakUsed = 0;
  while (Date.now() < deadline) {
    await pool.pump();
    const sample = await runtime.sample();
    peakUsed = Math.max(peakUsed, sample.total - sample.free);
    overlap ||= pool.status().running === 2 && sample.processes.length === 2;
    console.log(
      JSON.stringify({
        running: pool.status().running,
        queued: pool.status().queued,
        paused: pool.status().paused,
        waiting: pool.status().waiting,
        freeMiB: Math.round(sample.free / 1024 ** 2),
      }),
    );
    if (pool.status().paused) throw new Error(pool.status().paused ?? "paused");
    if ((await Promise.all(ids.map((id) => pool.history(id)))).every(Boolean)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  report.overlap = overlap;
  report.peakUsedBytes = peakUsed;
  report.results = await Promise.all(
    ids.map(async (id) => {
      const history = await pool.history(id);
      if (history?.status?.status_str !== "success")
        throw new Error(`Generation did not succeed: ${JSON.stringify(history)}`);
      const file = Object.values(history.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
      if (!file) throw new Error("Missing image");
      const bytes = new Uint8Array(await (await pool.download(file)).arrayBuffer());
      await writeFile(join(root, `${id}.png`), bytes);
      return { id, bytes: bytes.length, file };
    }),
  );
  if (!overlap) throw new Error("No simultaneous GPU execution observed");
  // New UUIDs/seeds defeat Comfy's output cache. Cancel only one active lane.
  const extra = [];
  for (let index = 0; index < 2; index++)
    extra.push(
      await pool.enqueue(
        {
          "1": {
            class_type: "VAELoader",
            inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
          },
          "2": {
            class_type: "EmptyImage",
            inputs: { width: 512, height: 512, batch_size: 1, color: index ? 65280 : 16776960 },
          },
          "3": { class_type: "VAEEncode", inputs: { pixels: ["2", 0], vae: ["1", 0] } },
          "4": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["1", 0] } },
          "5": {
            class_type: "SaveImage",
            inputs: { images: ["4", 0], filename_prefix: "takeboard_pool_cancel" },
          },
        },
        `cancel-${index}`,
      ),
    );
  ids.push(...extra);
  await pool.pump();
  if (pool.status().running !== 2) throw new Error("Cancellation test did not start both lanes");
  const cancelled = extra[0];
  const survivor = extra[1];
  if (!cancelled || !survivor) throw new Error("Missing cancellation test IDs");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!(await pool.cancel(cancelled))) throw new Error("Target cancellation unconfirmed");
  const cancelDeadline = Date.now() + 120_000;
  while (Date.now() < cancelDeadline && !(await pool.history(survivor))) {
    await pool.pump();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if ((await pool.history(survivor))?.status?.status_str !== "success")
    throw new Error("Peer did not survive targeted cancellation");
  report.targetedCancellation = { cancelled, survivor, passed: true };
  await pool.freeIdle();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  report.idleBeforeStop = await runtime.sample();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  for (const id of ids)
    await pool.cancel(id).catch((error) => console.error("Cancel failed", error));
  await pool.suspendCollections();
  await pool.stop().catch((error) => {
    report.stopError = String(error);
    process.exitCode = 1;
  });
  report.after = await runtime.sample();
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
