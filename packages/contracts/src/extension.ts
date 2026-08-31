import { z } from "zod";
import { isoTimestampSchema, sha256Schema } from "./common.js";

export const extensionIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/, "Use a lowercase reverse-domain extension ID");

export const extensionPermissionSchema = z.enum(["project.read", "project.write", "network.open"]);
export const extensionFeatureSchema = z.enum([
  "storyboard.rough_cut",
  "production.cost_insights",
  "production.batch_approval",
]);
export const extensionQcCheckSchema = z.enum([
  "unapproved_shots",
  "failed_runs",
  "missing_asset_metadata",
  "unknown_costs",
  "shots_without_candidates",
]);

export const extensionManifestSchema = z
  .object({
    format: z.literal("takeboard.extension"),
    manifestVersion: z.literal(1),
    id: extensionIdSchema,
    name: z.string().trim().min(1).max(100),
    version: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    description: z.string().trim().min(1).max(1_000),
    author: z.string().trim().min(1).max(100),
    homepage: z
      .string()
      .url()
      .max(2_000)
      .refine((value) => /^https?:\/\//i.test(value), "Homepage must use HTTP or HTTPS")
      .nullable()
      .default(null),
    permissions: z.array(extensionPermissionSchema).max(10).default([]),
    contributions: z
      .object({
        features: z.array(extensionFeatureSchema).max(20).default([]),
        links: z
          .array(
            z.object({
              id: z
                .string()
                .regex(/^[a-z0-9][a-z0-9._-]*$/)
                .max(100),
              title: z.string().trim().min(1).max(100),
              description: z.string().trim().max(500).default(""),
              url: z
                .string()
                .url()
                .max(2_000)
                .refine((value) => /^https?:\/\//i.test(value), "Links must use HTTP or HTTPS"),
              category: z.enum(["workflow", "asset", "review", "utility"]).default("utility"),
            }),
          )
          .max(20)
          .default([]),
        qcRules: z
          .array(
            z.object({
              id: z
                .string()
                .regex(/^[a-z0-9][a-z0-9._-]*$/)
                .max(100),
              title: z.string().trim().min(1).max(100),
              description: z.string().trim().max(500).default(""),
              check: extensionQcCheckSchema,
              severity: z.enum(["info", "warning", "blocker"]).default("warning"),
            }),
          )
          .max(50)
          .default([]),
      })
      .default(() => ({ features: [], links: [], qcRules: [] })),
  })
  .superRefine((manifest, context) => {
    if (manifest.contributions.links.length > 0 && !manifest.permissions.includes("network.open")) {
      context.addIssue({
        code: "custom",
        message: "External links require the network.open permission",
        path: ["permissions"],
      });
    }
    if (
      manifest.contributions.qcRules.length > 0 &&
      !manifest.permissions.includes("project.read")
    ) {
      context.addIssue({
        code: "custom",
        message: "QC rules require the project.read permission",
        path: ["permissions"],
      });
    }
    if (
      manifest.contributions.features.length > 0 &&
      !manifest.permissions.includes("project.read")
    ) {
      context.addIssue({
        code: "custom",
        message: "Workspace features require the project.read permission",
        path: ["permissions"],
      });
    }
    if (
      manifest.contributions.features.includes("production.batch_approval") &&
      !manifest.permissions.includes("project.write")
    ) {
      context.addIssue({
        code: "custom",
        message: "Batch approval requires the project.write permission",
        path: ["permissions"],
      });
    }
    const contributionIds = [
      ...manifest.contributions.links.map((item) => item.id),
      ...manifest.contributions.qcRules.map((item) => item.id),
    ];
    if (new Set(contributionIds).size !== contributionIds.length) {
      context.addIssue({
        code: "custom",
        message: "Contribution IDs must be unique inside an extension",
        path: ["contributions"],
      });
    }
    if (new Set(manifest.contributions.features).size !== manifest.contributions.features.length) {
      context.addIssue({
        code: "custom",
        message: "Workspace features must be unique inside an extension",
        path: ["contributions", "features"],
      });
    }
  });

export const installedExtensionSchema = z.object({
  manifest: extensionManifestSchema,
  contentSha256: sha256Schema,
  source: z.enum(["built_in", "local_manifest"]),
  enabled: z.boolean(),
  trust: z.enum(["built_in", "user_trusted"]),
  installedAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const extensionQcIssueSchema = z.object({
  extensionId: extensionIdSchema,
  ruleId: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(["info", "warning", "blocker"]),
  count: z.number().int().nonnegative(),
  affectedIds: z.array(z.string()).max(500),
});

export type ExtensionPermission = z.infer<typeof extensionPermissionSchema>;
export type ExtensionFeature = z.infer<typeof extensionFeatureSchema>;
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;
export type InstalledExtension = z.infer<typeof installedExtensionSchema>;
export type ExtensionQcIssue = z.infer<typeof extensionQcIssueSchema>;
