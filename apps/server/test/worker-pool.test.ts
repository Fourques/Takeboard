import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerPool } from "../src/worker-pool.js";

const cleanup: string[] = [];

afterEach(async () => {
  for (const directory of cleanup.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function runtimeFetch(input: string | URL | Request) {
  const url = String(input);
  if (url.endsWith("/system_stats")) {
    return Promise.resolve(
      Response.json({
        system: { comfyui_version: "0.9.0" },
        devices: [
          { name: url.includes("final") ? "RTX 6000" : "RTX 4090", vram_total: 24, vram_free: 20 },
        ],
      }),
    );
  }
  if (url.endsWith("/queue")) {
    return Promise.resolve(
      Response.json({
        queue_running: url.includes("busy") ? [[1]] : [],
        queue_pending: url.includes("busy") ? [[2], [3]] : [],
      }),
    );
  }
  return Promise.resolve(new Response(null, { status: 404 }));
}

describe("WorkerPool", () => {
  it("persists stable workers and explains policy decisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-workers-"));
    cleanup.push(root);
    const path = join(root, "workers.json");
    const pool = new WorkerPool(path, "http://127.0.0.1:8188", runtimeFetch as typeof fetch);
    const cheap = await pool.add({
      name: "Economy GPU",
      endpoint: "https://cheap.example.com",
      kind: "remote",
      transport: "https",
      enabled: true,
      allowSensitiveInputs: false,
      qualityTier: "draft",
      priority: 40,
      hourlyRate: 1,
      currency: "CNY",
      estimatedJobSeconds: 60,
    });
    const final = await pool.add({
      name: "Final GPU",
      endpoint: "https://final.example.com",
      kind: "remote",
      transport: "https",
      enabled: true,
      allowSensitiveInputs: true,
      qualityTier: "final",
      priority: 90,
      hourlyRate: 10,
      currency: "CNY",
      estimatedJobSeconds: 60,
    });

    const economical = await pool.select({
      policy: "economical",
      containsSensitiveInputs: false,
      estimatedJobSeconds: 60,
    });
    expect(economical.worker.id).toBe(cheap.id);
    expect(economical.reason).toContain("成本优先");
    expect(economical.candidates).toHaveLength(3);

    const quality = await pool.select({
      policy: "best_quality",
      containsSensitiveInputs: true,
      estimatedJobSeconds: 60,
    });
    expect(quality.worker.id).toBe(final.id);
    expect(quality.candidates.find((candidate) => candidate.workerId === cheap.id)).toMatchObject({
      eligible: false,
      reason: "该执行端未获准接收敏感素材",
    });

    const capped = await pool.select({
      policy: "budget_cap",
      containsSensitiveInputs: false,
      budgetCap: 0.02,
      budgetCurrency: "CNY",
      estimatedJobSeconds: 60,
    });
    expect(capped.worker.id).toBe(cheap.id);
    expect(capped.estimatedCost).toMatchObject({ accuracy: "estimated", currency: "CNY" });

    const reloaded = new WorkerPool(path, "http://127.0.0.1:8188", runtimeFetch as typeof fetch);
    expect(reloaded.definitions().map((worker) => worker.id)).toEqual(
      pool.definitions().map((worker) => worker.id),
    );
  });

  it("never lets an unencrypted remote endpoint receive sensitive inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-workers-"));
    cleanup.push(root);
    const pool = new WorkerPool(
      join(root, "workers.json"),
      "http://legacy.example.com",
      runtimeFetch as typeof fetch,
    );
    await expect(pool.update(pool.defaultWorkerId, { allowSensitiveInputs: true })).rejects.toThrow(
      /未加密/,
    );
  });

  it("retires removed workers without losing the stable endpoint needed by in-flight runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-workers-"));
    cleanup.push(root);
    const path = join(root, "workers.json");
    const pool = new WorkerPool(path, "http://127.0.0.1:8188", runtimeFetch as typeof fetch);
    const worker = await pool.add({
      name: "Remote render node",
      endpoint: "https://retired.example.com",
      kind: "remote",
      transport: "https",
      enabled: true,
      allowSensitiveInputs: true,
      qualityTier: "balanced",
      priority: 50,
      hourlyRate: 3,
      currency: "CNY",
      estimatedJobSeconds: 120,
    });

    expect(await pool.remove(worker.id)).toBe(true);
    expect(pool.definitions().some((candidate) => candidate.id === worker.id)).toBe(false);
    expect(pool.endpoint(worker.id)).toBe("https://retired.example.com");
    expect(await pool.remove(worker.id)).toBe(false);
    await expect(pool.update(worker.id, { name: "changed" })).rejects.toThrow(/已经移除/);

    const reloaded = new WorkerPool(path, "http://127.0.0.1:8188", runtimeFetch as typeof fetch);
    expect(reloaded.endpoint(worker.id)).toBe("https://retired.example.com");
    expect((await reloaded.fleet()).some((entry) => entry.worker.id === worker.id)).toBe(false);
  });
});
