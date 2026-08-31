import { z } from "zod";
import { idSchema, jsonValueSchema, sha256Schema, timestampsSchema } from "./common.js";
import { runCostSchema, runExecutionSchema, workerIdSchema } from "./execution.js";
import { assetIdSchema, shotIdSchema, takeIdSchema } from "./project.js";

export const recipeIdSchema = idSchema("recipe");
export const runIdSchema = idSchema("run");
export const approvalIdSchema = idSchema("approval");

export const runStatusSchema = z.enum([
  "draft",
  "validating",
  "uploading_inputs",
  "queued",
  "running",
  "collecting_outputs",
  "completed",
  "failed",
  "cancelled",
  "orphaned",
  "reconciling",
]);

export const runInputSnapshotSchema = z.object({
  slot: z.string().min(1).max(200),
  refType: z.enum(["text", "entity", "asset", "shot", "take"]),
  refId: z.string().min(1),
  assetSha256: sha256Schema.nullable().default(null),
});

export const runSchema = timestampsSchema.extend({
  id: runIdSchema,
  shotId: shotIdSchema,
  recipeId: recipeIdSchema,
  recipeVersion: z.string().min(1).max(100),
  workflowSha256: sha256Schema,
  workerId: workerIdSchema,
  promptId: z.string().min(1).max(500).nullable().default(null),
  status: runStatusSchema,
  inputs: z.array(runInputSnapshotSchema).default([]),
  parameters: z.record(z.string(), jsonValueSchema),
  execution: runExecutionSchema.nullable().default(null),
  estimatedCost: runCostSchema.default(
    () =>
      ({
        amount: null,
        currency: "CNY",
        accuracy: "unknown",
        source: "unavailable",
        computeSeconds: null,
        unitRatePerHour: null,
        recordedAt: null,
      }) as const,
  ),
  actualCost: runCostSchema.default(
    () =>
      ({
        amount: null,
        currency: "CNY",
        accuracy: "unknown",
        source: "unavailable",
        computeSeconds: null,
        unitRatePerHour: null,
        recordedAt: null,
      }) as const,
  ),
  errorCode: z.string().max(200).nullable().default(null),
  errorMessage: z.string().max(20_000).nullable().default(null),
});

export const takeSchema = timestampsSchema.extend({
  id: takeIdSchema,
  runId: runIdSchema,
  shotId: shotIdSchema,
  assetId: assetIdSchema,
  status: z.enum(["candidate", "rejected", "approved", "media_missing"]),
  rejectionReasons: z.array(z.string().trim().min(1).max(200)).default([]),
});

export const approvalSchema = z
  .object({
    id: approvalIdSchema,
    shotId: shotIdSchema,
    takeId: takeIdSchema,
    status: z.enum(["active", "revoked"]),
    reason: z.string().trim().max(2_000).nullable().default(null),
    actorUserId: z.string().max(500).nullable().default(null),
    actorName: z.string().trim().max(200).nullable().default(null),
    createdAt: timestampsSchema.shape.createdAt,
    revokedAt: timestampsSchema.shape.updatedAt.nullable().default(null),
  })
  .superRefine((approval, context) => {
    if (approval.status === "active" && approval.revokedAt !== null) {
      context.addIssue({
        code: "custom",
        message: "An active approval cannot have a revokedAt timestamp",
        path: ["revokedAt"],
      });
    }

    if (approval.status === "revoked" && approval.revokedAt === null) {
      context.addIssue({
        code: "custom",
        message: "A revoked approval must have a revokedAt timestamp",
        path: ["revokedAt"],
      });
    }
  });

export type RunStatus = z.infer<typeof runStatusSchema>;
export type Run = z.infer<typeof runSchema>;
export type Take = z.infer<typeof takeSchema>;
export type Approval = z.infer<typeof approvalSchema>;
