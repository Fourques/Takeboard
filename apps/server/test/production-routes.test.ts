import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ProjectStore } from "../src/storage/project-store.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe("production accounting and cross-shot approval routes", () => {
  it("previews and atomically applies decisions while reporting honest cost accuracy", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-production-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "Production ledger", aspectRatio: "16:9" },
    });
    const key = created.json().key as string;
    const firstShotId = created.json().snapshot.shots[0].id as string;
    const second = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots`,
      payload: { label: "SH-002", durationSeconds: 5 },
    });
    const secondShotId = second.json().shotId as string;
    const store = ProjectStore.openExisting(join(root, key));
    const current = store?.loadCurrent();
    if (!store || !current) throw new Error("Project fixture could not be opened");
    const timestamp = toIsoTimestamp();
    const shotIds = [firstShotId, secondShotId];
    const takeIds: string[] = [];
    shotIds.forEach((shotId, index) => {
      const assetId = createTakeBoardId("asset");
      const runId = createTakeBoardId("run");
      const takeId = createTakeBoardId("take");
      takeIds.push(takeId);
      current.snapshot.assets.push({
        id: assetId,
        projectId: current.snapshot.project.id,
        mediaType: "image",
        originalName: `candidate-${index + 1}.png`,
        mimeType: "image/png",
        byteSize: 10,
        sha256: String(index + 1).repeat(64),
        storagePath: `renders/${shotId}/candidate.png`,
        proxyPath: null,
        width: 1280,
        height: 720,
        customTags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      current.snapshot.runs.push({
        id: runId,
        shotId,
        recipeId: createTakeBoardId("recipe"),
        recipeVersion: "test@1",
        workflowSha256: "a".repeat(64),
        workerId: createTakeBoardId("worker"),
        promptId: `prompt-${index}`,
        status: "completed",
        inputs: [],
        parameters: {},
        execution: null,
        estimatedCost: {
          amount: index === 0 ? null : 0.5,
          currency: "CNY",
          accuracy: index === 0 ? "unknown" : "estimated",
          source: index === 0 ? "unavailable" : "worker_rate",
          computeSeconds: 120,
          unitRatePerHour: index === 0 ? null : 15,
          recordedAt: timestamp,
        },
        actualCost: {
          amount: index === 0 ? 1.5 : null,
          currency: "CNY",
          accuracy: index === 0 ? "exact" : "unknown",
          source: index === 0 ? "provider_reported" : "unavailable",
          computeSeconds: 120,
          unitRatePerHour: null,
          recordedAt: timestamp,
        },
        errorCode: null,
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      current.snapshot.takes.push({
        id: takeId,
        runId,
        shotId,
        assetId,
        status: "candidate",
        rejectionReasons: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const shot = current.snapshot.shots.find((candidate) => candidate.id === shotId);
      if (shot) shot.status = "review";
    });
    await store.save(current.snapshot, { type: "test.production_fixture", payload: {} });
    store.close();

    const costs = await app.inject({ method: "GET", url: `/api/projects/${key}/costs` });
    expect(costs.statusCode, costs.body).toBe(200);
    expect(costs.json().summary).toMatchObject({
      runCount: 2,
      approvedShotCount: 0,
      totals: [
        {
          currency: "CNY",
          knownAmount: 2,
          accuracy: "estimated",
          exactRunCount: 1,
          estimatedRunCount: 1,
          unknownRunCount: 0,
        },
      ],
    });

    const decisions = shotIds.map((shotId, index) => ({
      shotId,
      takeId: takeIds[index],
      reason: "Cross-shot review",
    }));
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/approvals/batch/preview`,
      payload: { decisions },
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json().preview as {
      revision: number;
      confirmationToken: string;
    };
    const applied = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/approvals/batch`,
      payload: { decisions, ...preview },
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json()).toMatchObject({ approvedCount: 2, replacementCount: 0 });
    expect(applied.json().snapshot.shots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstShotId, approvedTakeId: takeIds[0] }),
        expect.objectContaining({ id: secondShotId, approvedTakeId: takeIds[1] }),
      ]),
    );
    expect(applied.json().snapshot.approvals).toHaveLength(2);

    const stale = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/approvals/batch`,
      payload: { decisions, ...preview },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "APPROVAL_PREVIEW_STALE" });
  });
});
