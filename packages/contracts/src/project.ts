import { z } from "zod";
import {
  aspectRatioSchema,
  idSchema,
  isoTimestampSchema,
  relativeStoragePathSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampsSchema,
} from "./common.js";

export const projectIdSchema = idSchema("project");
export const sceneIdSchema = idSchema("scene");
export const textItemIdSchema = idSchema("text");
export const entityIdSchema = idSchema("entity");
export const assetIdSchema = idSchema("asset");
export const shotIdSchema = idSchema("shot");
export const takeIdSchema = idSchema("take");

export const projectSchema = timestampsSchema.extend({
  id: projectIdSchema,
  schemaVersion: schemaVersionSchema,
  title: z.string().trim().min(1).max(200),
  defaultAspectRatio: aspectRatioSchema,
});

export const sceneSchema = timestampsSchema.extend({
  id: sceneIdSchema,
  projectId: projectIdSchema,
  label: z.string().trim().min(1).max(80),
  title: z.string().trim().max(200).default(""),
  order: z.number().int().nonnegative(),
});

export const textItemSchema = timestampsSchema.extend({
  id: textItemIdSchema,
  projectId: projectIdSchema,
  sceneId: sceneIdSchema,
  kind: z.enum(["brief", "script", "prompt", "direction_note"]),
  title: z.string().trim().max(200).default(""),
  body: z.string().max(100_000),
});

export const entitySchema = timestampsSchema.extend({
  id: entityIdSchema,
  projectId: projectIdSchema,
  kind: z.enum(["character", "location", "prop"]),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).default(""),
  referenceAssetIds: z.array(assetIdSchema).default([]),
});

export const assetSchema = timestampsSchema.extend({
  id: assetIdSchema,
  projectId: projectIdSchema,
  mediaType: z.enum(["image", "video", "audio"]),
  originalName: z.string().trim().min(1).max(512),
  mimeType: z.string().trim().min(1).max(200),
  byteSize: z.number().int().nonnegative(),
  sha256: sha256Schema,
  storagePath: relativeStoragePathSchema,
  proxyPath: relativeStoragePathSchema.nullable().default(null),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  durationSeconds: z.number().positive().nullable().optional(),
  frameRate: z.number().positive().nullable().optional(),
  metadataInspectedAt: isoTimestampSchema.nullable().optional(),
  metadataInspectionError: z.string().max(500).nullable().optional(),
  libraryKind: z.enum(["character", "location", "prop"]).nullable().optional(),
  customTags: z.array(z.string().trim().min(1).max(40)).max(24).default([]),
});

export const shotSchema = timestampsSchema.extend({
  id: shotIdSchema,
  projectId: projectIdSchema,
  sceneId: sceneIdSchema,
  label: z.string().trim().min(1).max(80),
  order: z.number().int().nonnegative(),
  intent: z.string().max(20_000),
  durationSeconds: z.number().positive().max(300),
  aspectRatio: aspectRatioSchema,
  workflowPath: z.string().trim().min(1).max(1_000).nullable().default(null),
  status: z.enum(["draft", "generating", "review", "approved"]),
  approvedTakeId: takeIdSchema.nullable().default(null),
});

export type Project = z.infer<typeof projectSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type TextItem = z.infer<typeof textItemSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Shot = z.infer<typeof shotSchema>;
