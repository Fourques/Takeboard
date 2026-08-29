import { z } from "zod";
import { runIdSchema, runStatusSchema } from "./run.js";

export const operationTaskSchema = z.object({
  projectKey: z.string().min(1),
  projectId: z.string().min(1),
  projectTitle: z.string().min(1),
  projectRole: z.enum(["owner", "editor", "viewer"]),
  canCancel: z.boolean(),
  shotId: z.string().min(1),
  shotLabel: z.string().min(1),
  runId: runIdSchema,
  status: runStatusSchema,
  recipePath: z.string().nullable(),
  outputMediaType: z.enum(["image", "video"]).nullable(),
  progress: z.number().min(0).max(100).nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const operationsTaskCenterSchema = z.object({
  tasks: z.array(operationTaskSchema),
  activeCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export const storageCategorySchema = z.object({
  originals: z.number().int().nonnegative(),
  proxies: z.number().int().nonnegative(),
  renders: z.number().int().nonnegative(),
  runData: z.number().int().nonnegative(),
  recipes: z.number().int().nonnegative(),
  exports: z.number().int().nonnegative(),
  backups: z.number().int().nonnegative(),
  other: z.number().int().nonnegative(),
});

export const projectStorageSummarySchema = z.object({
  projectKey: z.string().min(1),
  projectId: z.string().min(1),
  projectTitle: z.string().min(1),
  totalBytes: z.number().int().nonnegative(),
  categories: storageCategorySchema,
});

export const operationsStorageSchema = z.object({
  projects: z.array(projectStorageSummarySchema),
  activeProjectBytes: z.number().int().nonnegative(),
  trashBytes: z.number().int().nonnegative(),
  systemBytes: z.number().int().nonnegative().nullable(),
  visibleBytes: z.number().int().nonnegative(),
  filesystem: z
    .object({
      totalBytes: z.number().int().nonnegative(),
      availableBytes: z.number().int().nonnegative(),
      reserveBytes: z.number().int().nonnegative(),
      generationReady: z.boolean(),
    })
    .nullable(),
  scannedAt: z.string().datetime(),
});

export type OperationTask = z.infer<typeof operationTaskSchema>;
export type OperationsTaskCenter = z.infer<typeof operationsTaskCenterSchema>;
export type StorageCategory = z.infer<typeof storageCategorySchema>;
export type ProjectStorageSummary = z.infer<typeof projectStorageSummarySchema>;
export type OperationsStorage = z.infer<typeof operationsStorageSchema>;
