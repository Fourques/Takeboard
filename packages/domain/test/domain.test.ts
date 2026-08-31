import type { Approval, ProjectSnapshot, Run, Shot, Take } from "@takeboard/contracts";
import { describe, expect, it } from "vitest";
import {
  approveTake,
  approveTakesBatch,
  canTransitionRun,
  createTakeBoardId,
  createUuidV7,
  DomainError,
  summarizeProjectCosts,
  transitionRun,
} from "../src/index.js";

const now = "2026-08-13T03:30:00.000Z";
const later = "2026-08-13T03:31:00.000Z";
const hash = "a".repeat(64);
const uuid = "018f47a0-2c91-7a4f-a812-78f12a2c4510";
const ids = {
  project: `project_${uuid}`,
  scene: `scene_${uuid}`,
  shot: `shot_${uuid}`,
  asset: `asset_${uuid}`,
  recipe: `recipe_${uuid}`,
  worker: `worker_${uuid}`,
  run: `run_${uuid}`,
  takeA: `take_${uuid}`,
  takeB: "take_018f47a0-2c91-7a4f-a812-78f12a2c4511",
  approvalA: `approval_${uuid}`,
  approvalB: "approval_018f47a0-2c91-7a4f-a812-78f12a2c4511",
} as const;

const run: Run = {
  id: ids.run,
  shotId: ids.shot,
  recipeId: ids.recipe,
  recipeVersion: "1.0.0",
  workflowSha256: hash,
  workerId: ids.worker,
  promptId: null,
  status: "draft",
  inputs: [{ slot: "prompt", refType: "shot", refId: ids.shot, assetSha256: null }],
  parameters: {},
  errorCode: null,
  errorMessage: null,
  createdAt: now,
  updatedAt: now,
};

const shot: Shot = {
  id: ids.shot,
  projectId: ids.project,
  sceneId: ids.scene,
  label: "SH-001",
  order: 0,
  intent: "Opening frame",
  durationSeconds: 3,
  aspectRatio: "9:16",
  status: "review",
  approvedTakeId: null,
  createdAt: now,
  updatedAt: now,
};

const takes: Take[] = [
  {
    id: ids.takeA,
    runId: ids.run,
    shotId: ids.shot,
    assetId: ids.asset,
    status: "approved",
    rejectionReasons: [],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: ids.takeB,
    runId: ids.run,
    shotId: ids.shot,
    assetId: ids.asset,
    status: "candidate",
    rejectionReasons: [],
    createdAt: now,
    updatedAt: now,
  },
];

const approvals: Approval[] = [
  {
    id: ids.approvalA,
    shotId: ids.shot,
    takeId: ids.takeA,
    status: "active",
    reason: null,
    createdAt: now,
    revokedAt: null,
  },
];

describe("TakeBoard identity", () => {
  it("creates a UUIDv7 with the supplied timestamp", () => {
    const value = createUuidV7(1_700_000_000_000);
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
    expect(createTakeBoardId("canvas_item", 1_700_000_000_000)).toMatch(/^canvas_item_/);
  });
});

describe("run state machine", () => {
  it("supports the local ComfyUI happy path", () => {
    expect(canTransitionRun("validating", "queued")).toBe(true);
    const validating = transitionRun(run, "validating", { at: later });
    expect(transitionRun(validating, "queued", { at: later }).status).toBe("queued");
  });

  it("rejects terminal-state rewrites", () => {
    const completed = { ...run, status: "completed" as const };
    expect(() => transitionRun(completed, "running", { at: later })).toThrow(DomainError);
  });

  it("requires structured failure provenance", () => {
    const validating = { ...run, status: "validating" as const };
    expect(() => transitionRun(validating, "failed", { at: later })).toThrow(
      /must record an error code/,
    );
  });
});

describe("approveTake", () => {
  it("revokes the old decision and approves the replacement without deleting history", () => {
    const result = approveTake({
      shot,
      takes,
      approvals,
      takeId: ids.takeB,
      approvalId: ids.approvalB,
      at: later,
      reason: "Stronger performance",
    });

    expect(result.shot.approvedTakeId).toBe(ids.takeB);
    expect(result.takes.map((take) => take.status)).toEqual(["candidate", "approved"]);
    expect(result.approvals).toHaveLength(2);
    expect(result.approvals[0]).toMatchObject({ status: "revoked", revokedAt: later });
    expect(result.approvals[1]).toMatchObject({ status: "active", takeId: ids.takeB });
    expect(approvals[0]?.status).toBe("active");
  });

  it("validates the complete cross-shot batch before applying decisions", () => {
    const candidateTake = takes[1];
    if (!candidateTake) throw new Error("Candidate fixture is missing");
    const secondShot: Shot = {
      ...shot,
      id: "shot_018f47a0-2c91-7a4f-a812-78f12a2c4512",
      label: "SH-002",
    };
    const secondTake: Take = {
      ...candidateTake,
      id: "take_018f47a0-2c91-7a4f-a812-78f12a2c4513",
      shotId: secondShot.id,
    };
    const result = approveTakesBatch({
      shots: [shot, secondShot],
      takes: [...takes, secondTake],
      approvals,
      decisions: [
        { shotId: shot.id, takeId: ids.takeB, reason: "Batch review" },
        { shotId: secondShot.id, takeId: secondTake.id, reason: null },
      ],
      approvalIds: [ids.approvalB, "approval_018f47a0-2c91-7a4f-a812-78f12a2c4514"],
      at: later,
      actorUserId: "user-editor",
      actorName: "Editor",
    });

    expect(result.shots.map((item) => item.approvedTakeId)).toEqual([ids.takeB, secondTake.id]);
    expect(result.approvals.filter((approval) => approval.status === "active")).toHaveLength(2);
    expect(result.approvals.at(-1)).toMatchObject({ actorName: "Editor" });
    expect(() =>
      approveTakesBatch({
        shots: [shot],
        takes,
        approvals,
        decisions: [
          { shotId: shot.id, takeId: ids.takeA, reason: null },
          { shotId: shot.id, takeId: ids.takeB, reason: null },
        ],
        approvalIds: [ids.approvalB, "approval_018f47a0-2c91-7a4f-a812-78f12a2c4515"],
        at: later,
      }),
    ).toThrow(/only one decision/);
  });
});

describe("production cost summary", () => {
  it("keeps known spend as a floor when any run cost is unknown", () => {
    const approvedTake = takes[0];
    if (!approvedTake) throw new Error("Approved take fixture is missing");
    const exactRun: Run = {
      ...run,
      status: "completed",
      execution: null,
      estimatedCost: {
        amount: null,
        currency: "CNY",
        accuracy: "unknown",
        source: "unavailable",
        computeSeconds: null,
        unitRatePerHour: null,
        recordedAt: null,
      },
      actualCost: {
        amount: 2.5,
        currency: "CNY",
        accuracy: "exact",
        source: "provider_reported",
        computeSeconds: 120,
        unitRatePerHour: null,
        recordedAt: later,
      },
    };
    const unknownRun: Run = {
      ...exactRun,
      id: "run_018f47a0-2c91-7a4f-a812-78f12a2c4516",
      actualCost: {
        ...exactRun.actualCost,
        amount: null,
        accuracy: "unknown",
        source: "unavailable",
      },
    };
    const snapshot = {
      schemaVersion: "0.1.0",
      exportedAt: later,
      project: {
        id: ids.project,
        schemaVersion: "0.1.0",
        title: "Cost test",
        defaultAspectRatio: "9:16",
        createdAt: now,
        updatedAt: later,
      },
      scenes: [],
      textItems: [],
      entities: [],
      assets: [],
      shots: [{ ...shot, approvedTakeId: ids.takeA, status: "approved" }],
      runs: [exactRun, unknownRun],
      takes: [approvedTake],
      approvals,
      canvasItems: [],
      canvasEdges: [],
    } satisfies ProjectSnapshot;
    const summary = summarizeProjectCosts(snapshot, later);

    expect(summary.totals[0]).toMatchObject({
      knownAmount: 2.5,
      accuracy: "unknown",
      exactRunCount: 1,
      unknownRunCount: 1,
    });
    expect(summary.finishedMinuteCosts[0]).toMatchObject({
      amountPerMinute: null,
      knownAmountFloor: 2.5,
    });
  });
});
