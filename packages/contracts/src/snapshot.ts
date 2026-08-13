import { z } from "zod";
import { canvasEdgeSchema, canvasItemSchema } from "./canvas.js";
import { isoTimestampSchema, schemaVersionSchema } from "./common.js";
import {
  assetSchema,
  entitySchema,
  projectSchema,
  sceneSchema,
  shotSchema,
  textItemSchema,
} from "./project.js";
import { approvalSchema, runSchema, takeSchema } from "./run.js";

const projectSnapshotShape = z.object({
  schemaVersion: schemaVersionSchema,
  exportedAt: isoTimestampSchema,
  project: projectSchema,
  scenes: z.array(sceneSchema),
  textItems: z.array(textItemSchema),
  entities: z.array(entitySchema),
  assets: z.array(assetSchema),
  shots: z.array(shotSchema),
  runs: z.array(runSchema),
  takes: z.array(takeSchema),
  approvals: z.array(approvalSchema),
  canvasItems: z.array(canvasItemSchema),
  canvasEdges: z.array(canvasEdgeSchema),
});

function duplicateIds(items: ReadonlyArray<{ id: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return true;
    }
    seen.add(item.id);
    return false;
  });
}

export const projectSnapshotSchema = projectSnapshotShape.superRefine((snapshot, context) => {
  const projectId = snapshot.project.id;
  const scenes = new Map(snapshot.scenes.map((scene) => [scene.id, scene]));
  const textItems = new Set(snapshot.textItems.map((item) => item.id));
  const entities = new Set(snapshot.entities.map((entity) => entity.id));
  const assets = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  const shots = new Map(snapshot.shots.map((shot) => [shot.id, shot]));
  const runs = new Map(snapshot.runs.map((run) => [run.id, run]));
  const takes = new Map(snapshot.takes.map((take) => [take.id, take]));
  const canvasItems = new Map(snapshot.canvasItems.map((item) => [item.id, item]));

  const collections = [
    ["scenes", snapshot.scenes],
    ["textItems", snapshot.textItems],
    ["entities", snapshot.entities],
    ["assets", snapshot.assets],
    ["shots", snapshot.shots],
    ["runs", snapshot.runs],
    ["takes", snapshot.takes],
    ["approvals", snapshot.approvals],
    ["canvasItems", snapshot.canvasItems],
    ["canvasEdges", snapshot.canvasEdges],
  ] as const;

  for (const [collectionName, collection] of collections) {
    if (duplicateIds(collection).length > 0) {
      context.addIssue({
        code: "custom",
        message: `${collectionName} contains duplicate IDs`,
        path: [collectionName],
      });
    }
  }

  for (const [collectionName, collection] of [
    ["scenes", snapshot.scenes],
    ["textItems", snapshot.textItems],
    ["entities", snapshot.entities],
    ["assets", snapshot.assets],
    ["shots", snapshot.shots],
  ] as const) {
    collection.forEach((item, index) => {
      if (item.projectId !== projectId) {
        context.addIssue({
          code: "custom",
          message: `${collectionName} item belongs to another project`,
          path: [collectionName, index, "projectId"],
        });
      }
    });
  }

  snapshot.textItems.forEach((item, index) => {
    if (!scenes.has(item.sceneId)) {
      context.addIssue({
        code: "custom",
        message: "Text item references a missing scene",
        path: ["textItems", index, "sceneId"],
      });
    }
  });

  snapshot.entities.forEach((entity, index) => {
    entity.referenceAssetIds.forEach((assetId, referenceIndex) => {
      if (!assets.has(assetId)) {
        context.addIssue({
          code: "custom",
          message: "Entity references a missing asset",
          path: ["entities", index, "referenceAssetIds", referenceIndex],
        });
      }
    });
  });

  snapshot.shots.forEach((shot, index) => {
    if (!scenes.has(shot.sceneId)) {
      context.addIssue({
        code: "custom",
        message: "Shot references a missing scene",
        path: ["shots", index, "sceneId"],
      });
    }

    if (shot.approvedTakeId !== null) {
      const approvedTake = takes.get(shot.approvedTakeId);
      if (approvedTake?.shotId !== shot.id || approvedTake.status !== "approved") {
        context.addIssue({
          code: "custom",
          message: "approvedTakeId must reference an approved take from the same shot",
          path: ["shots", index, "approvedTakeId"],
        });
      }
    }
  });

  snapshot.runs.forEach((run, index) => {
    if (!shots.has(run.shotId)) {
      context.addIssue({
        code: "custom",
        message: "Run references a missing shot",
        path: ["runs", index, "shotId"],
      });
    }
    run.inputs.forEach((input, inputIndex) => {
      const referenceExists = {
        text: textItems.has(input.refId),
        entity: entities.has(input.refId),
        asset: assets.has(input.refId),
        shot: shots.has(input.refId),
        take: takes.has(input.refId),
      }[input.refType];
      if (!referenceExists) {
        context.addIssue({
          code: "custom",
          message: `Run input references a missing ${input.refType}`,
          path: ["runs", index, "inputs", inputIndex, "refId"],
        });
      }
      const referencedAsset = input.refType === "asset" ? assets.get(input.refId) : null;
      if (
        referencedAsset &&
        input.assetSha256 !== null &&
        input.assetSha256 !== referencedAsset.sha256
      ) {
        context.addIssue({
          code: "custom",
          message: "Run input asset hash does not match the referenced asset",
          path: ["runs", index, "inputs", inputIndex, "assetSha256"],
        });
      }
    });
  });

  snapshot.takes.forEach((take, index) => {
    const run = runs.get(take.runId);
    if (!run || run.shotId !== take.shotId) {
      context.addIssue({
        code: "custom",
        message: "Take must reference a run from the same shot",
        path: ["takes", index, "runId"],
      });
    }
    if (!assets.has(take.assetId)) {
      context.addIssue({
        code: "custom",
        message: "Take references a missing asset",
        path: ["takes", index, "assetId"],
      });
    }
  });

  const activeApprovalShots = new Set<string>();
  snapshot.approvals.forEach((approval, index) => {
    const take = takes.get(approval.takeId);
    if (!take || take.shotId !== approval.shotId) {
      context.addIssue({
        code: "custom",
        message: "Approval must reference a take from the same shot",
        path: ["approvals", index, "takeId"],
      });
    }
    if (approval.status === "active") {
      const shot = shots.get(approval.shotId);
      if (take?.status !== "approved" || shot?.approvedTakeId !== approval.takeId) {
        context.addIssue({
          code: "custom",
          message: "An active approval must match the shot's approved take",
          path: ["approvals", index, "status"],
        });
      }
      if (activeApprovalShots.has(approval.shotId)) {
        context.addIssue({
          code: "custom",
          message: "A shot can have only one active approval",
          path: ["approvals", index, "status"],
        });
      }
      activeApprovalShots.add(approval.shotId);
    }
  });

  snapshot.canvasItems.forEach((item, index) => {
    if (!scenes.has(item.sceneId)) {
      context.addIssue({
        code: "custom",
        message: "Canvas item references a missing scene",
        path: ["canvasItems", index, "sceneId"],
      });
    }

    const refExists = {
      text: textItems.has(item.refId),
      entity: entities.has(item.refId),
      asset: assets.has(item.refId),
      shot: shots.has(item.refId),
      take_stack: shots.has(item.refId),
    }[item.refType];
    if (!refExists) {
      context.addIssue({
        code: "custom",
        message: `Canvas ${item.refType} item references a missing domain object`,
        path: ["canvasItems", index, "refId"],
      });
    }
  });

  snapshot.canvasEdges.forEach((edge, index) => {
    const source = canvasItems.get(edge.sourceItemId);
    const target = canvasItems.get(edge.targetItemId);
    if (!source || !target || source.sceneId !== edge.sceneId || target.sceneId !== edge.sceneId) {
      context.addIssue({
        code: "custom",
        message: "Canvas edge endpoints must exist in the same scene",
        path: ["canvasEdges", index],
      });
    }
    if (edge.runId !== null && !runs.has(edge.runId)) {
      context.addIssue({
        code: "custom",
        message: "Canvas edge references a missing run",
        path: ["canvasEdges", index, "runId"],
      });
    }
  });
});

export function projectSnapshotJsonSchema() {
  return z.toJSONSchema(projectSnapshotShape, {
    target: "draft-2020-12",
    unrepresentable: "any",
  });
}

export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;
