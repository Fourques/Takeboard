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

export const operationsDiagnosticCheckSchema = z.object({
  id: z.string().min(1).max(120),
  category: z.enum(["runtime", "data", "storage", "worker", "backup", "security"]),
  status: z.enum(["pass", "warning", "blocked"]),
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(1_000),
  action: z.string().min(1).max(1_000).nullable(),
});

export const operationsDiagnosticsSchema = z.object({
  format: z.literal("takeboard.support-report"),
  reportVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  application: z.object({
    version: z.string().min(1),
    nodeVersion: z.string().min(1),
    platform: z.string().min(1),
    architecture: z.string().min(1),
    uptimeSeconds: z.number().int().nonnegative(),
    authMode: z.enum(["required", "trusted_local", "off"]),
  }),
  workload: z.object({
    visibleProjects: z.number().int().nonnegative(),
    activeRuns: z.number().int().nonnegative(),
    failedRuns: z.number().int().nonnegative(),
  }),
  backup: z
    .object({
      count: z.number().int().nonnegative(),
      latestCreatedAt: z.string().datetime().nullable(),
    })
    .nullable(),
  checks: z.array(operationsDiagnosticCheckSchema),
  privacy: z.literal(
    "不包含项目名称、账号、素材内容、提示词、绝对路径、Cookie、Token 或环境变量值。",
  ),
});

export type OperationTask = z.infer<typeof operationTaskSchema>;
export type OperationsTaskCenter = z.infer<typeof operationsTaskCenterSchema>;
export type StorageCategory = z.infer<typeof storageCategorySchema>;
export type ProjectStorageSummary = z.infer<typeof projectStorageSummarySchema>;
export type OperationsStorage = z.infer<typeof operationsStorageSchema>;
export type OperationsDiagnosticCheck = z.infer<typeof operationsDiagnosticCheckSchema>;
export type OperationsDiagnostics = z.infer<typeof operationsDiagnosticsSchema>;
