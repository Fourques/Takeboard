import { z } from "zod";
import { idSchema, isoTimestampSchema } from "./common.js";

export const workerIdSchema = idSchema("worker");

export const costAccuracySchema = z.enum(["exact", "estimated", "unknown"]);
export const costSourceSchema = z.enum([
  "provider_reported",
  "worker_rate",
  "manual",
  "unavailable",
]);

export const runCostSchema = z
  .object({
    amount: z.number().finite().nonnegative().nullable().default(null),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/)
      .default("CNY"),
    accuracy: costAccuracySchema.default("unknown"),
    source: costSourceSchema.default("unavailable"),
    computeSeconds: z.number().finite().nonnegative().nullable().default(null),
    unitRatePerHour: z.number().finite().nonnegative().nullable().default(null),
    recordedAt: isoTimestampSchema.nullable().default(null),
  })
  .superRefine((cost, context) => {
    if (cost.accuracy === "unknown" && cost.amount !== null) {
      context.addIssue({
        code: "custom",
        message: "Unknown costs cannot contain an amount",
        path: ["amount"],
      });
    }
    if (cost.accuracy !== "unknown" && cost.amount === null) {
      context.addIssue({
        code: "custom",
        message: "Known or estimated costs require an amount",
        path: ["amount"],
      });
    }
  });

export const executionPolicySchema = z.enum([
  "balanced",
  "local_only",
  "private",
  "fastest",
  "economical",
  "best_quality",
  "budget_cap",
]);

export const workerKindSchema = z.enum(["local", "remote"]);
export const workerTransportSchema = z.enum(["loopback", "ssh_tunnel", "https", "direct_http"]);
export const workerQualityTierSchema = z.enum(["draft", "balanced", "final"]);

export const workerDefinitionSchema = z
  .object({
    id: workerIdSchema,
    name: z.string().trim().min(1).max(80),
    endpoint: z.string().url().max(2_000),
    kind: workerKindSchema,
    transport: workerTransportSchema,
    enabled: z.boolean().default(true),
    allowSensitiveInputs: z.boolean().default(false),
    qualityTier: workerQualityTierSchema.default("balanced"),
    priority: z.number().int().min(0).max(100).default(50),
    hourlyRate: z.number().finite().nonnegative().nullable().default(null),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/)
      .default("CNY"),
    estimatedJobSeconds: z.number().int().min(1).max(86_400).default(300),
    retiredAt: isoTimestampSchema.nullable().default(null),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .superRefine((worker, context) => {
    const endpoint = worker.endpoint.toLowerCase();
    const authority = endpoint.replace(/^https?:\/\//, "").split("/", 1)[0] ?? "";
    if (authority.includes("@") || endpoint.includes("?") || endpoint.includes("#")) {
      context.addIssue({
        code: "custom",
        message: "Worker endpoints cannot contain credentials, query parameters, or fragments",
        path: ["endpoint"],
      });
    }
    const loopback = /^(?:https?:\/\/)(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(
      endpoint,
    );
    if (worker.transport === "https" && !endpoint.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        message: "HTTPS workers require an https:// endpoint",
        path: ["endpoint"],
      });
    }
    if ((worker.transport === "loopback" || worker.transport === "ssh_tunnel") && !loopback) {
      context.addIssue({
        code: "custom",
        message: "Loopback and SSH tunnel workers must use a loopback endpoint",
        path: ["endpoint"],
      });
    }
    if (worker.transport === "direct_http" && (loopback || !endpoint.startsWith("http://"))) {
      context.addIssue({
        code: "custom",
        message: "Direct HTTP transport is reserved for non-loopback legacy endpoints",
        path: ["endpoint"],
      });
    }
    if (!loopback && !endpoint.startsWith("https://") && worker.transport !== "direct_http") {
      context.addIssue({
        code: "custom",
        message: "Remote workers must use HTTPS; use a loopback SSH tunnel for plain HTTP",
        path: ["endpoint"],
      });
    }
    if (worker.kind === "local" && worker.transport !== "loopback") {
      context.addIssue({
        code: "custom",
        message: "Local workers must use loopback transport",
        path: ["transport"],
      });
    }
    if (worker.kind === "remote" && worker.transport === "loopback") {
      context.addIssue({
        code: "custom",
        message: "Remote loopback endpoints must be declared as SSH tunnels",
        path: ["transport"],
      });
    }
    if (worker.retiredAt !== null && worker.enabled) {
      context.addIssue({
        code: "custom",
        message: "Retired workers cannot remain enabled",
        path: ["enabled"],
      });
    }
  });

export const workerHealthSchema = z.object({
  worker: workerDefinitionSchema,
  status: z.enum(["ready", "offline", "disabled"]),
  version: z.string().max(200).nullable().default(null),
  device: z.string().max(500).nullable().default(null),
  vramTotal: z.number().finite().nonnegative().nullable().default(null),
  vramFree: z.number().finite().nonnegative().nullable().default(null),
  queueRunning: z.number().int().nonnegative().default(0),
  queuePending: z.number().int().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().nullable().default(null),
  checkedAt: isoTimestampSchema,
  error: z.string().max(2_000).nullable().default(null),
});

export const workerSelectionCandidateSchema = z.object({
  workerId: workerIdSchema,
  workerName: z.string().min(1).max(80),
  eligible: z.boolean(),
  score: z.number().finite().nullable(),
  estimatedCost: runCostSchema,
  queueDepth: z.number().int().nonnegative(),
  reason: z.string().min(1).max(1_000),
});

export const runExecutionSchema = z.object({
  policy: executionPolicySchema,
  requestedWorkerId: workerIdSchema.nullable().default(null),
  selectedWorkerId: workerIdSchema,
  workerName: z.string().min(1).max(80),
  workerKind: workerKindSchema,
  transport: workerTransportSchema,
  selectionReason: z.string().min(1).max(2_000),
  candidates: z.array(workerSelectionCandidateSchema).max(100).default([]),
  submittedAt: isoTimestampSchema,
  finishedAt: isoTimestampSchema.nullable().default(null),
});

export type CostAccuracy = z.infer<typeof costAccuracySchema>;
export type RunCost = z.infer<typeof runCostSchema>;
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;
export type WorkerDefinition = z.infer<typeof workerDefinitionSchema>;
export type WorkerHealth = z.infer<typeof workerHealthSchema>;
export type WorkerSelectionCandidate = z.infer<typeof workerSelectionCandidateSchema>;
export type RunExecution = z.infer<typeof runExecutionSchema>;
