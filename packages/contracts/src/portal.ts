import { z } from "zod";

export const portalConnectorStatusSchema = z.object({
  available: z.literal(true),
  state: z.enum(["not_configured", "pairing", "connecting", "connected", "offline", "revoked"]),
  portalUrl: z.string().url().nullable(),
  pairing: z
    .object({
      userCode: z.string().min(1),
      expiresAt: z.string().datetime(),
    })
    .nullable(),
  remoteUrl: z.string().url().nullable(),
  lastError: z.string().nullable(),
  canManage: z.boolean(),
});

export type PortalConnectorStatus = z.infer<typeof portalConnectorStatusSchema>;
