import { z } from "zod";

export const schemaVersion = "0.1.0" as const;
export const schemaVersionSchema = z.literal(schemaVersion);

const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

export const isoTimestampSchema = z
  .string()
  .regex(isoTimestampPattern, "Expected an ISO 8601 timestamp with a timezone")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Timestamp is not a real date");

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 hash");

export const relativeStoragePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(value), {
    message: "Storage paths must be relative to the project root",
  })
  .refine(
    (value) =>
      !value
        .replaceAll("\\", "/")
        .split("/")
        .some((segment) => segment === ".." || segment === "."),
    { message: "Storage paths cannot traverse outside the project root" },
  );

const idPattern =
  /^[a-z][a-z0-9_]*_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const takeBoardIdSchema = z.string().regex(idPattern, "Expected a prefixed TakeBoard UUID");

export function idSchema<const Prefix extends string>(prefix: Prefix) {
  return takeBoardIdSchema.refine((value) => value.startsWith(`${prefix}_`), {
    message: `Expected an ID with prefix ${prefix}_`,
  });
}

export const aspectRatioSchema = z.enum(["9:16", "16:9", "1:1", "4:5", "2.35:1"]);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const timestampsSchema = z.object({
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
