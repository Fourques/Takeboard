import { z } from "zod";
import { sha256Schema } from "./common.js";
import { costAccuracySchema } from "./execution.js";
import { assetIdSchema, shotIdSchema, takeIdSchema } from "./project.js";

export const costAggregateSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  knownAmount: z.number().finite().nonnegative(),
  accuracy: costAccuracySchema,
  exactRunCount: z.number().int().nonnegative(),
  estimatedRunCount: z.number().int().nonnegative(),
  unknownRunCount: z.number().int().nonnegative(),
});

export const shotCostSummarySchema = z.object({
  shotId: shotIdSchema,
  shotTitle: z.string(),
  runCount: z.number().int().nonnegative(),
  approvedTakeId: takeIdSchema.nullable(),
  approvedAssetId: assetIdSchema.nullable(),
  totals: z.array(costAggregateSchema),
});

export const projectCostSummarySchema = z.object({
  generatedAt: z.string(),
  runCount: z.number().int().nonnegative(),
  completedRunCount: z.number().int().nonnegative(),
  candidateShotCount: z.number().int().nonnegative(),
  approvedShotCount: z.number().int().nonnegative(),
  acceptanceRate: z.number().finite().min(0).max(1).nullable(),
  approvedDurationSeconds: z.number().finite().nonnegative(),
  totals: z.array(costAggregateSchema),
  finishedMinuteCosts: z.array(
    z.object({
      currency: z.string().regex(/^[A-Z]{3}$/),
      amountPerMinute: z.number().finite().nonnegative().nullable(),
      accuracy: costAccuracySchema,
      knownAmountFloor: z.number().finite().nonnegative(),
    }),
  ),
  shots: z.array(shotCostSummarySchema),
});

export const batchApprovalDecisionSchema = z.object({
  shotId: shotIdSchema,
  takeId: takeIdSchema,
  reason: z.string().trim().max(2_000).nullable().default(null),
});

export const batchApprovalPreviewRequestSchema = z.object({
  decisions: z.array(batchApprovalDecisionSchema).min(1).max(100),
});

export const batchApprovalPreviewSchema = z.object({
  revision: z.number().int().nonnegative(),
  confirmationToken: sha256Schema,
  decisionCount: z.number().int().positive(),
  replacementCount: z.number().int().nonnegative(),
  decisions: z.array(
    z.object({
      shotId: shotIdSchema,
      shotTitle: z.string(),
      takeId: takeIdSchema,
      assetId: assetIdSchema,
      replacesTakeId: takeIdSchema.nullable(),
      reason: z.string().nullable(),
    }),
  ),
});

export const batchApprovalApplyRequestSchema = batchApprovalPreviewRequestSchema.extend({
  revision: z.number().int().nonnegative(),
  confirmationToken: sha256Schema,
});

export type CostAggregate = z.infer<typeof costAggregateSchema>;
export type ShotCostSummary = z.infer<typeof shotCostSummarySchema>;
export type ProjectCostSummary = z.infer<typeof projectCostSummarySchema>;
export type BatchApprovalDecision = z.infer<typeof batchApprovalDecisionSchema>;
export type BatchApprovalPreview = z.infer<typeof batchApprovalPreviewSchema>;
