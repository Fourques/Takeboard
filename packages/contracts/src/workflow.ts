import { z } from "zod";

export const workflowDiagnosticCheckSchema = z.object({
  id: z.string().min(1).max(160),
  category: z.enum(["document", "conversion", "nodes", "models", "binding", "output"]),
  status: z.enum(["pass", "warning", "blocked", "unknown"]),
  code: z.string().min(1).max(160),
  title: z.string().min(1).max(200),
  detail: z.string().max(2_000),
  nodeIds: z.array(z.string().max(200)).default([]),
  remediation: z.string().max(1_000).nullable().default(null),
});

export const workflowDiagnosticSchema = z.object({
  path: z.string().min(1),
  workflowHash: z.string().regex(/^[a-f0-9]{64}$/),
  health: z.enum(["ready", "attention", "blocked", "unknown"]),
  executable: z.boolean(),
  nodeCount: z.number().int().nonnegative(),
  capability: z.enum([
    "text_to_image",
    "image_to_image",
    "text_to_video",
    "image_to_video",
    "first_last_video",
    "reference_video",
  ]),
  outputMediaType: z.enum(["image", "video"]),
  bindingStatus: z.enum(["built_in", "ready", "stale", "needs_binding"]),
  modelStatus: z.enum(["ready", "missing", "unknown"]),
  models: z.array(z.string()),
  missingModels: z.array(z.string()),
  missingNodeTypes: z.array(z.string()),
  checks: z.array(workflowDiagnosticCheckSchema),
});

export type WorkflowDiagnosticCheck = z.infer<typeof workflowDiagnosticCheckSchema>;
export type WorkflowDiagnostic = z.infer<typeof workflowDiagnosticSchema>;
