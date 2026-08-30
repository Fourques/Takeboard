import { describe, expect, it } from "vitest";
import {
  approvalSchema,
  assetSchema,
  canvasEdgeSchema,
  healthResponseSchema,
  operationsDiagnosticsSchema,
  projectSnapshotJsonSchema,
  projectSnapshotSchema,
  resolveGenerationResolution,
  runSchema,
  schemaVersion,
} from "../src/index.js";

const ids = {
  project: "project_018f47a0-2c91-8a4f-a812-78f12a2c4510",
  scene: "scene_018f47a0-2c91-8a4f-a812-78f12a2c4511",
  asset: "asset_018f47a0-2c91-8a4f-a812-78f12a2c4512",
  shot: "shot_018f47a0-2c91-8a4f-a812-78f12a2c4513",
  take: "take_018f47a0-2c91-8a4f-a812-78f12a2c4514",
  recipe: "recipe_018f47a0-2c91-8a4f-a812-78f12a2c4515",
  worker: "worker_018f47a0-2c91-8a4f-a812-78f12a2c4516",
  run: "run_018f47a0-2c91-8a4f-a812-78f12a2c4517",
  approval: "approval_018f47a0-2c91-8a4f-a812-78f12a2c4518",
  canvasA: "canvas_item_018f47a0-2c91-8a4f-a812-78f12a2c4519",
  canvasB: "canvas_item_018f47a0-2c91-8a4f-a812-78f12a2c4520",
  edge: "canvas_edge_018f47a0-2c91-8a4f-a812-78f12a2c4521",
  otherProject: "project_018f47a0-2c91-8a4f-a812-78f12a2c4522",
  entity: "entity_018f47a0-2c91-8a4f-a812-78f12a2c4523",
  missingAsset: "asset_018f47a0-2c91-8a4f-a812-78f12a2c4524",
} as const;

const now = "2026-08-13T11:30:00+08:00";
const hash = "a".repeat(64);

describe("healthResponseSchema", () => {
  it("accepts a valid local service response", () => {
    expect(
      healthResponseSchema.parse({
        service: "takeboard-server",
        status: "ok",
        version: schemaVersion,
      }),
    ).toEqual({ service: "takeboard-server", status: "ok", version: schemaVersion });
  });
});

describe("operationsDiagnosticsSchema", () => {
  it("accepts a redacted support report contract", () => {
    const parsed = operationsDiagnosticsSchema.parse({
      format: "takeboard.support-report",
      reportVersion: 1,
      generatedAt: "2026-08-30T00:00:00.000Z",
      application: {
        version: "0.1.0",
        nodeVersion: "v22.23.1",
        platform: "linux",
        architecture: "x64",
        uptimeSeconds: 42,
        authMode: "required",
      },
      workload: { visibleProjects: 2, activeRuns: 1, failedRuns: 0 },
      backup: {
        count: 1,
        latestCreatedAt: "2026-08-29T00:00:00.000Z",
        automation: null,
      },
      checks: [
        {
          id: "data.writable",
          category: "data",
          status: "pass",
          title: "项目目录可写",
          detail: "服务可以保存项目。",
          action: null,
        },
      ],
      privacy: "不包含项目名称、账号、素材内容、提示词、绝对路径、Cookie、Token 或环境变量值。",
    });
    expect(parsed.checks[0]?.status).toBe("pass");
  });
});

describe("generation resolution protocol", () => {
  it("reports the effective dimensions used by native executors", () => {
    expect(resolveGenerationResolution("multiple_32", 1001, 563)).toMatchObject({
      requested: { width: 1001, height: 563 },
      effective: { width: 992, height: 576 },
      changed: true,
    });
    expect(resolveGenerationResolution("minimax_h3", 1920, 1080)).toMatchObject({
      effective: { width: 1344, height: 768 },
      changed: true,
    });
    expect(resolveGenerationResolution("exact", 1920, 1080)).toMatchObject({
      effective: { width: 1920, height: 1080 },
      changed: false,
      reason: null,
    });
  });
});

describe("assetSchema", () => {
  const validAsset = {
    id: ids.asset,
    projectId: ids.project,
    mediaType: "image",
    originalName: "reference.png",
    mimeType: "image/png",
    byteSize: 1024,
    sha256: hash,
    storagePath: `assets/originals/${hash}.png`,
    proxyPath: null,
    createdAt: now,
    updatedAt: now,
  } as const;

  it("accepts project-relative media", () => {
    expect(assetSchema.parse(validAsset).storagePath).toContain("assets/originals");
  });

  it("supports an optional project-library classification", () => {
    expect(assetSchema.parse({ ...validAsset, libraryKind: "location" }).libraryKind).toBe(
      "location",
    );
    expect(assetSchema.parse({ ...validAsset, libraryKind: null }).libraryKind).toBeNull();
    expect(() => assetSchema.parse({ ...validAsset, libraryKind: "archive" })).toThrow();
  });

  it.each(["/Users/person/key.png", "C:\\Users\\person\\key.png", "../secret.png"])(
    "rejects unsafe storage path %s",
    (storagePath) => {
      expect(() => assetSchema.parse({ ...validAsset, storagePath })).toThrow();
    },
  );
});

describe("runSchema", () => {
  it("preserves immutable provenance inputs", () => {
    const run = runSchema.parse({
      id: ids.run,
      shotId: ids.shot,
      recipeId: ids.recipe,
      recipeVersion: "1.0.0",
      workflowSha256: hash,
      workerId: ids.worker,
      promptId: null,
      status: "validating",
      inputs: [{ slot: "first_frame", refType: "asset", refId: ids.asset, assetSha256: hash }],
      parameters: { seed: 42, preserveIdentity: true },
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(run.inputs[0]?.assetSha256).toBe(hash);
    expect(run.parameters).toEqual({ seed: 42, preserveIdentity: true });
  });
});

describe("canvasEdgeSchema", () => {
  it("requires generated provenance to be immutable and linked to a run", () => {
    expect(() =>
      canvasEdgeSchema.parse({
        id: ids.edge,
        sceneId: ids.scene,
        sourceItemId: ids.canvasA,
        targetItemId: ids.canvasB,
        relation: "generated_from",
        runId: null,
        immutable: false,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });
});

describe("approvalSchema", () => {
  it("requires a revocation timestamp for revoked approvals", () => {
    expect(() =>
      approvalSchema.parse({
        id: ids.approval,
        shotId: ids.shot,
        takeId: ids.take,
        status: "revoked",
        reason: null,
        createdAt: now,
        revokedAt: null,
      }),
    ).toThrow();
  });
});

describe("projectSnapshotSchema", () => {
  const emptySnapshot = {
    schemaVersion,
    exportedAt: now,
    project: {
      id: ids.project,
      schemaVersion,
      title: "TakeBoard demo",
      defaultAspectRatio: "9:16",
      createdAt: now,
      updatedAt: now,
    },
    scenes: [],
    textItems: [],
    entities: [],
    assets: [],
    shots: [],
    runs: [],
    takes: [],
    approvals: [],
    canvasItems: [],
    canvasEdges: [],
  } as const;

  it("accepts a self-contained project export", () => {
    expect(projectSnapshotSchema.parse(emptySnapshot).project.id).toBe(ids.project);
  });

  it("rejects objects that belong to another project", () => {
    expect(() =>
      projectSnapshotSchema.parse({
        ...emptySnapshot,
        scenes: [
          {
            id: ids.scene,
            projectId: ids.otherProject,
            label: "SC-001",
            title: "Opening",
            order: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    ).toThrow(/another project/);
  });

  it("rejects entity references to assets outside the project snapshot", () => {
    expect(() =>
      projectSnapshotSchema.parse({
        ...emptySnapshot,
        entities: [
          {
            id: ids.entity,
            projectId: ids.project,
            kind: "character",
            name: "林岚",
            description: "",
            referenceAssetIds: [ids.missingAsset],
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    ).toThrow(/missing asset/);
  });

  it("publishes a portable JSON Schema", () => {
    const jsonSchema = projectSnapshotJsonSchema();
    expect(jsonSchema.$schema).toContain("2020-12");
    expect(jsonSchema.required).toContain("project");
  });
});
