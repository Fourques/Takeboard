import { z } from "zod";

export const portalProtocolVersion = 1 as const;
export const portalChunkBytes = 192 * 1024;
export const portalMaximumBodyBytes = 110 * 1024 * 1024;

const identifier = z.string().min(1).max(128);
const headerRecord = z
  .record(z.string().min(1).max(128), z.string().max(16_384))
  .refine((headers) => Object.keys(headers).length <= 96, "too many headers");
const base64Chunk = z
  .string()
  .max(Math.ceil((portalChunkBytes * 4) / 3))
  .regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    "invalid base64 chunk",
  );
const relayPath = z
  .string()
  .startsWith("/")
  .max(8_192)
  .refine(
    (path) =>
      !path.startsWith("//") &&
      !path.includes("\\") &&
      ![...path].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127;
      }),
    "path must be local to the TakeBoard instance",
  );

export const portalToConnectorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    protocol: z.literal(portalProtocolVersion),
    deviceId: identifier,
    heartbeatSeconds: z.number().int().min(5).max(120),
  }),
  z.object({
    type: z.literal("request_start"),
    id: identifier,
    method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    path: relayPath,
    headers: headerRecord,
    portalSubject: identifier,
    portalSessionId: identifier,
  }),
  z.object({
    type: z.literal("request_chunk"),
    id: identifier,
    sequence: z.number().int().nonnegative(),
    data: base64Chunk,
  }),
  z.object({ type: z.literal("request_end"), id: identifier }),
  z.object({ type: z.literal("request_cancel"), id: identifier }),
  z.object({ type: z.literal("device_revoked"), reason: z.string().max(500) }),
]);

export const connectorToPortalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocol: z.literal(portalProtocolVersion),
    instanceId: identifier,
    instanceName: z.string().min(1).max(120),
    applicationVersion: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal("heartbeat"), sentAt: z.string().datetime() }),
  z.object({
    type: z.literal("response_start"),
    id: identifier,
    status: z.number().int().min(100).max(599),
    headers: headerRecord,
  }),
  z.object({
    type: z.literal("response_chunk"),
    id: identifier,
    sequence: z.number().int().nonnegative(),
    data: base64Chunk,
  }),
  z.object({ type: z.literal("response_end"), id: identifier }),
  z.object({
    type: z.literal("response_error"),
    id: identifier,
    code: z.enum(["BAD_REQUEST", "BODY_TOO_LARGE", "LOCAL_UNAVAILABLE", "TIMEOUT"]),
    message: z.string().min(1).max(500),
  }),
  z.object({ type: z.literal("revoke_self") }),
]);

export type PortalToConnectorMessage = z.infer<typeof portalToConnectorSchema>;
export type ConnectorToPortalMessage = z.infer<typeof connectorToPortalSchema>;

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function relayHeaders(
  entries: Iterable<[string, string | string[] | undefined]>,
  direction: "request" | "response",
) {
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (!rawValue || hopByHopHeaders.has(name) || name === "host") continue;
    if (direction === "request" && (name === "cookie" || name === "authorization")) continue;
    if (direction === "response" && name === "set-cookie") continue;
    if (Object.keys(result).length >= 96) break;
    result[name] = (Array.isArray(rawValue) ? rawValue.join(", ") : rawValue).slice(0, 16_384);
  }
  return result;
}
