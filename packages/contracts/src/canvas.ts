import { z } from "zod";
import { idSchema, timestampsSchema } from "./common.js";
import { sceneIdSchema } from "./project.js";
import { runIdSchema } from "./run.js";

export const canvasItemIdSchema = idSchema("canvas_item");
export const canvasEdgeIdSchema = idSchema("canvas_edge");

export const canvasRefTypeSchema = z.enum(["text", "entity", "asset", "shot", "take_stack"]);

export const canvasItemSchema = timestampsSchema.extend({
  id: canvasItemIdSchema,
  sceneId: sceneIdSchema,
  refType: canvasRefTypeSchema,
  refId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().max(10_000),
  height: z.number().positive().max(10_000),
  zIndex: z.number().int(),
  parentGroupId: canvasItemIdSchema.nullable().default(null),
  collapsed: z.boolean().default(false),
});

export const canvasEdgeSchema = timestampsSchema
  .extend({
    id: canvasEdgeIdSchema,
    sceneId: sceneIdSchema,
    sourceItemId: canvasItemIdSchema,
    targetItemId: canvasItemIdSchema,
    relation: z.enum(["reference", "generated_from", "approved_for"]),
    targetSlot: z
      .enum(["first_frame", "last_frame", "reference", "reference_video"])
      .nullable()
      .default(null),
    targetSlotIndex: z.number().int().nonnegative().max(99).default(0),
    runId: runIdSchema.nullable().default(null),
    immutable: z.boolean(),
  })
  .superRefine((edge, context) => {
    if (edge.sourceItemId === edge.targetItemId) {
      context.addIssue({
        code: "custom",
        message: "Canvas edges cannot connect an item to itself",
        path: ["targetItemId"],
      });
    }

    const generatedRelation = edge.relation === "generated_from";
    if (generatedRelation && (!edge.immutable || edge.runId === null)) {
      context.addIssue({
        code: "custom",
        message: "generated_from edges must be immutable and reference a run",
        path: ["relation"],
      });
    }
  });

export type CanvasItem = z.infer<typeof canvasItemSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
