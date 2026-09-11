import { type ProjectSnapshot, projectSnapshotSchema } from "@takeboard/contracts";
import { approveTake, createTakeBoardId, rejectTake, toIsoTimestamp } from "@takeboard/domain";
import { ProjectStore } from "../storage/project-store.js";
import { createDemoSnapshot } from "./fixture.js";

const recipeId = "recipe_018f47a0-2c91-7a4f-a812-000000000101";
const workerId = "worker_018f47a0-2c91-7a4f-a812-000000000102";
const workflowHash = "c".repeat(64);

export class DemoService {
  constructor(private readonly projectDirectory: string) {}

  async get() {
    const store = await ProjectStore.open(this.projectDirectory);
    try {
      const current = store.loadCurrent();
      if (current) {
        return current;
      }
      return await store.save(createDemoSnapshot(), { type: "demo.created" });
    } finally {
      store.close();
    }
  }

  async reset() {
    return await this.mutate("demo.reset", () => createDemoSnapshot());
  }

  async moveCanvasItem(itemId: string, position: { x: number; y: number }) {
    return await this.mutate("canvas.item_moved", (snapshot, timestamp) => ({
      ...snapshot,
      canvasItems: snapshot.canvasItems.map((item) =>
        item.id === itemId ? { ...item, ...position, updatedAt: timestamp } : item,
      ),
    }));
  }

  async generate(shotId: string) {
    return await this.mutate("fake_generation.completed", (snapshot, timestamp) => {
      const shot = snapshot.shots.find((candidate) => candidate.id === shotId);
      if (!shot) {
        throw new Error("Shot not found");
      }

      const createdAt = Date.parse(timestamp);
      const newRuns = [];
      const newTakes = [];
      const newAssets = [];
      for (let index = 0; index < 4; index += 1) {
        const runId = createTakeBoardId("run", createdAt + index);
        const takeId = createTakeBoardId("take", createdAt + index + 10);
        const assetId = createTakeBoardId("asset", createdAt + index + 20);
        const variant = index + 1;
        newRuns.push({
          id: runId,
          shotId,
          recipeId,
          recipeVersion: "demo-1.0.0",
          workflowSha256: workflowHash,
          workerId,
          promptId: `fake-${runId}`,
          status: "completed" as const,
          inputs: [{ slot: "shot", refType: "shot" as const, refId: shotId, assetSha256: null }],
          parameters: { seed: 26081300 + variant, variant },
          execution: null,
          estimatedCost: {
            amount: null,
            currency: "CNY",
            accuracy: "unknown" as const,
            source: "unavailable" as const,
            computeSeconds: null,
            unitRatePerHour: null,
            recordedAt: null,
          },
          actualCost: {
            amount: null,
            currency: "CNY",
            accuracy: "unknown" as const,
            source: "unavailable" as const,
            computeSeconds: null,
            unitRatePerHour: null,
            recordedAt: null,
          },
          errorCode: null,
          errorMessage: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        newAssets.push({
          id: assetId,
          projectId: snapshot.project.id,
          mediaType: "video" as const,
          originalName: `${shot.label.toLowerCase()}-candidate-${variant}.mp4`,
          mimeType: "video/mp4",
          byteSize: 1_500_000 + index * 180_000,
          sha256: (variant + 1).toString(16).repeat(64),
          storagePath: `renders/${shotId}/${runId}/candidate-${variant}.mp4`,
          proxyPath: null,
          width: null,
          height: null,
          customTags: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        newTakes.push({
          id: takeId,
          runId,
          shotId,
          assetId,
          status: "candidate" as const,
          rejectionReasons: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      return {
        ...snapshot,
        assets: [...snapshot.assets, ...newAssets],
        runs: [...snapshot.runs, ...newRuns],
        takes: [...snapshot.takes, ...newTakes],
        shots: snapshot.shots.map((candidate) =>
          candidate.id === shotId
            ? { ...candidate, status: "review" as const, updatedAt: timestamp }
            : candidate,
        ),
      };
    });
  }

  async rejectTake(takeId: string, reason: string) {
    return await this.mutate("take.rejected", (snapshot, timestamp) => {
      const target = snapshot.takes.find((take) => take.id === takeId);
      if (!target) {
        throw new Error("Take not found");
      }
      const shot = snapshot.shots.find((candidate) => candidate.id === target.shotId);
      if (!shot) throw new Error("Shot not found");
      const result = rejectTake({
        shot,
        takes: snapshot.takes,
        approvals: snapshot.approvals,
        takeId,
        reason,
        at: timestamp,
      });
      return {
        ...snapshot,
        shots: snapshot.shots.map((candidate) =>
          candidate.id === shot.id ? result.shot : candidate,
        ),
        takes: result.takes,
        approvals: result.approvals,
      };
    });
  }

  async approve(takeId: string, reason: string | null) {
    return await this.mutate("take.approved", (snapshot, timestamp) => {
      const target = snapshot.takes.find((take) => take.id === takeId);
      if (!target) {
        throw new Error("Take not found");
      }
      const shot = snapshot.shots.find((candidate) => candidate.id === target.shotId);
      if (!shot) {
        throw new Error("Shot not found");
      }
      const result = approveTake({
        shot,
        takes: snapshot.takes,
        approvals: snapshot.approvals,
        takeId,
        approvalId: createTakeBoardId("approval", Date.parse(timestamp)),
        at: timestamp,
        reason,
      });
      return {
        ...snapshot,
        shots: snapshot.shots.map((candidate) =>
          candidate.id === shot.id ? result.shot : candidate,
        ),
        takes: result.takes,
        approvals: result.approvals,
      };
    });
  }

  private async mutate(
    eventType: string,
    mutation: (snapshot: ProjectSnapshot, timestamp: string) => ProjectSnapshot,
  ) {
    const store = await ProjectStore.open(this.projectDirectory);
    try {
      const current = store.loadCurrent();
      const base = current?.snapshot ?? createDemoSnapshot();
      const timestamp = toIsoTimestamp();
      const next = projectSnapshotSchema.parse({
        ...mutation(base, timestamp),
        exportedAt: timestamp,
        project: { ...base.project, updatedAt: timestamp },
      });
      return await store.save(next, { type: eventType });
    } finally {
      store.close();
    }
  }
}
