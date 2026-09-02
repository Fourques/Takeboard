import { z } from "zod";

export const remoteAccessCheckSchema = z.object({
  id: z.enum(["identity", "accounts", "binding", "https", "cookies", "allowlist"]),
  label: z.string(),
  status: z.enum(["pass", "warning", "blocked"]),
  detail: z.string(),
});

export const remoteAccessStatusSchema = z.object({
  instance: z.object({
    id: z.string().nullable(),
    name: z.string(),
  }),
  currentAccess: z.object({
    kind: z.enum(["local_or_ssh", "https_proxy", "private_network"]),
    origin: z.string(),
    protection: z.enum(["loopback", "tls", "network"]),
  }),
  ssh: z.object({
    state: z.enum(["ready", "attention"]),
    remotePort: z.number().int().min(1).max(65_535),
    suggestedLocalPort: z.number().int().min(1).max(65_535),
    command: z.string(),
    detail: z.string(),
  }),
  https: z.object({
    state: z.enum(["ready", "not_configured", "blocked"]),
    publicUrl: z.string().nullable(),
    detail: z.string(),
  }),
  managedPortal: z.object({
    state: z.enum(["available", "not_available"]),
    detail: z.string(),
  }),
  checks: z.array(remoteAccessCheckSchema),
});

export type RemoteAccessCheck = z.infer<typeof remoteAccessCheckSchema>;
export type RemoteAccessStatus = z.infer<typeof remoteAccessStatusSchema>;
