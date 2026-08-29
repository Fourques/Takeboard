import { z } from "zod";
import { canvasEdgeIdSchema, canvasItemIdSchema, canvasRefTypeSchema } from "./canvas.js";
import { aspectRatioSchema } from "./common.js";
import { sceneIdSchema, shotIdSchema } from "./project.js";

export const commandRequestIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(120)
  .regex(/^[a-zA-Z0-9._:-]+$/);

export const canvasTargetSlotSchema = z.enum([
  "first_frame",
  "last_frame",
  "reference",
  "reference_video",
  "reference_audio",
]);

export const projectCommandTypeSchema = z.enum([
  "canvas.create_shot",
  "canvas.create_text",
  "canvas.add_item",
  "canvas.duplicate_item",
  "canvas.edit_item",
  "canvas.connect_items",
  "canvas.disconnect",
  "canvas.move_item",
  "canvas.arrange_scene",
  "canvas.remove_item",
  "shot.delete",
]);

const finiteCoordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000);

export const projectCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("canvas.create_shot"),
    sceneId: sceneIdSchema.optional(),
    label: z.string().trim().min(1).max(80).optional(),
    intent: z.string().max(20_000).optional(),
    durationSeconds: z.number().positive().max(300).optional(),
    aspectRatio: aspectRatioSchema.optional(),
    x: finiteCoordinateSchema.optional(),
    y: finiteCoordinateSchema.optional(),
  }),
  z.object({
    type: z.literal("canvas.add_item"),
    refType: canvasRefTypeSchema,
    refId: z.string().min(1).max(200),
    sceneId: sceneIdSchema.optional(),
    x: finiteCoordinateSchema.optional(),
    y: finiteCoordinateSchema.optional(),
    width: z.number().min(180).max(1_000).optional(),
  }),
  z.object({
    type: z.literal("canvas.create_text"),
    sceneId: sceneIdSchema.optional(),
    title: z.string().trim().max(200).optional(),
    body: z.string().max(100_000).optional(),
    x: finiteCoordinateSchema.optional(),
    y: finiteCoordinateSchema.optional(),
  }),
  z.object({
    type: z.literal("canvas.duplicate_item"),
    itemId: canvasItemIdSchema,
    x: finiteCoordinateSchema.optional(),
    y: finiteCoordinateSchema.optional(),
  }),
  z.object({
    type: z.literal("canvas.edit_item"),
    itemId: canvasItemIdSchema,
    title: z.string().max(512).optional(),
    body: z.string().max(100_000).optional(),
    customTags: z.array(z.string().trim().min(1).max(40)).max(24).optional(),
    workflowPath: z.string().trim().min(1).max(1_000).optional(),
    durationSeconds: z.number().positive().max(300).optional(),
    aspectRatio: aspectRatioSchema.optional(),
  }),
  z.object({
    type: z.literal("canvas.connect_items"),
    sourceItemId: canvasItemIdSchema,
    targetItemId: canvasItemIdSchema,
    targetSlot: canvasTargetSlotSchema,
  }),
  z.object({
    type: z.literal("canvas.disconnect"),
    edgeId: canvasEdgeIdSchema,
  }),
  z.object({
    type: z.literal("canvas.move_item"),
    itemId: canvasItemIdSchema,
    x: finiteCoordinateSchema,
    y: finiteCoordinateSchema,
  }),
  z.object({
    type: z.literal("canvas.arrange_scene"),
    sceneId: sceneIdSchema.optional(),
  }),
  z.object({
    type: z.literal("canvas.remove_item"),
    itemId: canvasItemIdSchema,
  }),
  z.object({
    type: z.literal("shot.delete"),
    shotId: shotIdSchema,
  }),
]);

export const projectCommandEnvelopeSchema = z.object({
  command: projectCommandSchema,
  requestId: commandRequestIdSchema,
  expectedRevision: z.number().int().nonnegative().optional(),
  confirmationToken: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export const projectCommandPreviewRequestSchema = z.object({
  command: projectCommandSchema,
  expectedRevision: z.number().int().nonnegative().optional(),
});

export const commandEffectSchema = z.object({
  action: z.enum(["create", "update", "remove", "connect", "disconnect"]),
  entityType: z.enum(["shot", "text", "entity", "asset", "canvas_item", "canvas_edge"]),
  entityId: z.string().min(1).nullable(),
  label: z.string().min(1).max(200),
  detail: z.string().max(500).nullable().default(null),
});

export const projectCommandPreviewSchema = z.object({
  commandType: projectCommandTypeSchema,
  summary: z.string().min(1).max(500),
  currentRevision: z.number().int().nonnegative(),
  effects: z.array(commandEffectSchema),
  warnings: z.array(z.string().min(1).max(1_000)),
  requiresConfirmation: z.boolean(),
  undoable: z.boolean(),
  confirmationToken: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});

export const commandAuditEntrySchema = z.object({
  id: z.string().min(1),
  commandType: z.string().min(1),
  requestId: z.string().nullable(),
  summary: z.string().min(1),
  status: z.enum(["applied", "undone"]),
  appliedRevision: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  undoneAt: z.string().datetime({ offset: true }).nullable(),
  undoable: z.boolean(),
  effects: z.array(commandEffectSchema),
});

export type ProjectCommand = z.infer<typeof projectCommandSchema>;
export type ProjectCommandEnvelope = z.infer<typeof projectCommandEnvelopeSchema>;
export type ProjectCommandPreview = z.infer<typeof projectCommandPreviewSchema>;
export type CommandEffect = z.infer<typeof commandEffectSchema>;
export type CommandAuditEntry = z.infer<typeof commandAuditEntrySchema>;
