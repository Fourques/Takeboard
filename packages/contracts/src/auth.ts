import { z } from "zod";

export const instanceRoleSchema = z.enum(["admin", "member"]);
export const projectRoleSchema = z.enum(["owner", "editor", "viewer"]);

export const accountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  instanceRole: instanceRoleSchema,
  status: z.enum(["active", "disabled"]),
  mustChangePassword: z.boolean(),
  createdAt: z.string().datetime(),
  lastLoginAt: z.string().datetime().nullable(),
});

export const projectMemberSchema = z.object({
  user: accountSchema,
  role: projectRoleSchema,
  createdAt: z.string().datetime(),
});

export type Account = z.infer<typeof accountSchema>;
export type InstanceRole = z.infer<typeof instanceRoleSchema>;
export type ProjectRole = z.infer<typeof projectRoleSchema>;
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export type AuthStatus = {
  enabled: boolean;
  configured: boolean;
  mode: "required" | "trusted_local" | "off";
  user: Account | null;
  csrfToken: string | null;
};

export type AccountSession = {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
};

export type AuthAuditEntry = {
  sequence: number;
  actor: Pick<Account, "id" | "name" | "email"> | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
};
