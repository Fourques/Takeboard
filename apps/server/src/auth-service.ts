import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  Account,
  AccountInvitation,
  AccountSession,
  InstanceRole,
  ProjectMember,
  ProjectRole,
  RecoveryCodeStatus,
} from "@takeboard/contracts";
import BetterSqlite3 from "better-sqlite3";

export type AuthMode = "required" | "trusted_local" | "off";

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  instance_role: InstanceRole;
  status: "active" | "disabled";
  must_change_password: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  idle_expires_at: string;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
};

type InvitationRow = {
  id: string;
  token_hash: string;
  email: string;
  name: string;
  instance_role: InstanceRole;
  status: "pending" | "accepted" | "revoked";
  created_at: string;
  expires_at: string;
  created_by: string;
  accepted_at: string | null;
  accepted_by: string | null;
};

type RecoveryCodeRow = {
  id: string;
  user_id: string;
  code_hash: string;
  created_at: string;
  used_at: string | null;
};

const scryptParameters = { N: 2 ** 15, r: 8, p: 3, maxmem: 160 * 1024 * 1024 } as const;
const absoluteSessionMilliseconds = 7 * 24 * 60 * 60 * 1000;
const idleSessionMilliseconds = 24 * 60 * 60 * 1000;
const roleWeight: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };
const commonPasswords = new Set([
  "123456789012",
  "password1234",
  "qwerty123456",
  "takeboard123",
  "admin123456",
  "iloveyou1234",
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLocaleLowerCase("en-US");
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeRecoveryCode(code: string) {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function createRecoveryCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(16);
  let value = "";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return `TB-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`;
}

function toInvitation(row: InvitationRow): AccountInvitation {
  const expired = row.status === "pending" && Date.parse(row.expires_at) <= Date.now();
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    instanceRole: row.instance_role,
    status: expired ? "expired" : row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}

export function csrfForSessionToken(token: string) {
  return createHash("sha256").update("takeboard-csrf\0").update(token).digest("base64url");
}

export function validatePassword(password: string) {
  if (password.length < 12) return "密码至少需要 12 个字符，推荐使用便于记忆的长口令";
  if (password.length > 256 || Buffer.byteLength(password, "utf8") > 1_024) {
    return "密码不能超过 256 个字符";
  }
  if (commonPasswords.has(password.toLocaleLowerCase("en-US")))
    return "这个密码过于常见，请换一个长口令";
  return null;
}

export function hashPassword(password: string) {
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32, scryptParameters);
  return `scrypt$${scryptParameters.N}$${scryptParameters.r}$${scryptParameters.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, encoded: string) {
  if (password.length > 256 || Buffer.byteLength(password, "utf8") > 1_024) return false;
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !nValue || !rValue || !pValue || !saltValue || !hashValue)
    return false;
  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (N < 2 ** 14 || N > 2 ** 18 || r < 1 || r > 16 || p < 1 || p > 10) return false;
  try {
    const expected = Buffer.from(hashValue, "base64url");
    const actual = scryptSync(password, Buffer.from(saltValue, "base64url"), expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const dummyPasswordHash = hashPassword("takeboard constant-time sentinel");

function toAccount(row: UserRow): Account {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    instanceRole: row.instance_role,
    status: row.status,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export class AuthService {
  private readonly client: BetterSqlite3.Database;
  private readonly databasePath: string;
  readonly mode: AuthMode;

  constructor(databasePath: string, mode: AuthMode) {
    const resolved = databasePath === ":memory:" ? databasePath : resolve(databasePath);
    this.databasePath = resolved;
    if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
    this.client = new BetterSqlite3(resolved);
    this.mode = mode;
    this.client.pragma("journal_mode = WAL");
    this.client.pragma("foreign_keys = ON");
    this.client.pragma("busy_timeout = 5000");
    this.migrate();
  }

  private migrate() {
    this.client.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        instance_role TEXT NOT NULL CHECK (instance_role IN ('admin', 'member')),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        idle_expires_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT,
        ip_address TEXT
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, last_seen_at DESC);
      CREATE TABLE IF NOT EXISTS project_members (
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
        created_at TEXT NOT NULL,
        created_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
        PRIMARY KEY (project_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(user_id, project_id);
      CREATE TABLE IF NOT EXISTS auth_login_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_login_failures_lookup_idx ON auth_login_failures(email, ip_address, created_at);
      CREATE TABLE IF NOT EXISTS auth_audit_log (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        metadata_json TEXT NOT NULL,
        ip_address TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_audit_created_idx ON auth_audit_log(created_at DESC);
      CREATE TABLE IF NOT EXISTS auth_invitations (
        id TEXT PRIMARY KEY NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL COLLATE NOCASE,
        name TEXT NOT NULL,
        instance_role TEXT NOT NULL CHECK (instance_role IN ('admin', 'member')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        accepted_at TEXT,
        accepted_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS auth_invitations_email_idx
        ON auth_invitations(email, created_at DESC);
      CREATE TABLE IF NOT EXISTS auth_recovery_codes (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS auth_recovery_codes_user_idx
        ON auth_recovery_codes(user_id, used_at);
    `);
  }

  close() {
    this.client.close();
  }

  backupDatabase(destination: string) {
    if (this.databasePath === ":memory:") throw new Error("内存身份数据库不能创建实例备份");
    this.client.pragma("wal_checkpoint(PASSIVE)");
    this.client.prepare("VACUUM INTO ?").run(resolve(destination));
  }

  verifyCurrentPassword(userId: string, password: string) {
    const row = this.client
      .prepare("SELECT password_hash FROM auth_users WHERE id = ?")
      .get(userId) as { password_hash: string } | undefined;
    return Boolean(row && verifyPassword(password, row.password_hash));
  }

  configured() {
    return (this.client.prepare("SELECT COUNT(*) FROM auth_users").pluck().get() as number) > 0;
  }

  listUsers() {
    return (
      this.client
        .prepare("SELECT * FROM auth_users ORDER BY name COLLATE NOCASE, email")
        .all() as UserRow[]
    ).map(toAccount);
  }

  getUser(userId: string) {
    const row = this.client.prepare("SELECT * FROM auth_users WHERE id = ?").get(userId) as
      | UserRow
      | undefined;
    return row ? toAccount(row) : null;
  }

  private requireUser(userId: string) {
    const user = this.getUser(userId);
    if (!user) throw new Error("账号写入后无法读取");
    return user;
  }

  private userRowByEmail(email: string) {
    return this.client
      .prepare("SELECT * FROM auth_users WHERE email = ?")
      .get(normalizeEmail(email)) as UserRow | undefined;
  }

  createBootstrap(input: { email: string; name: string; password: string }, projectIds: string[]) {
    const timestamp = nowIso();
    const userId = randomUUID();
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error("请输入有效邮箱地址");
    if (!name || name.length > 120) throw new Error("姓名需要为 1–120 个字符");
    const passwordHash = hashPassword(input.password);
    this.client.transaction(() => {
      if (this.configured()) throw new Error("TakeBoard 已完成初始设置");
      this.client
        .prepare(`INSERT INTO auth_users
        (id, email, name, password_hash, instance_role, status, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'admin', 'active', 0, ?, ?)`)
        .run(userId, email, name, passwordHash, timestamp, timestamp);
      const grant = this.client.prepare(`INSERT OR IGNORE INTO project_members
        (project_id, user_id, role, created_at, created_by) VALUES (?, ?, 'owner', ?, ?)`);
      for (const projectId of projectIds) grant.run(projectId, userId, timestamp, userId);
      this.audit(
        userId,
        "auth.bootstrap",
        "instance",
        null,
        { adoptedProjects: projectIds.length },
        null,
      );
    })();
    return this.requireUser(userId);
  }

  createUser(
    input: { email: string; name: string; password: string; instanceRole: InstanceRole },
    actorId: string,
    ip: string | null,
  ) {
    const timestamp = nowIso();
    const id = randomUUID();
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error("请输入有效邮箱地址");
    if (!name || name.length > 120) throw new Error("姓名需要为 1–120 个字符");
    this.client
      .prepare(`INSERT INTO auth_users
      (id, email, name, password_hash, instance_role, status, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
      .run(id, email, name, hashPassword(input.password), input.instanceRole, timestamp, timestamp);
    this.audit(
      actorId,
      "user.created",
      "user",
      id,
      { email, instanceRole: input.instanceRole },
      ip,
    );
    return this.requireUser(id);
  }

  createInvitation(
    input: { email: string; name: string; instanceRole: InstanceRole; expiresHours?: number },
    actorId: string,
    ip: string | null,
  ) {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error("请输入有效邮箱地址");
    if (!name || name.length > 120) throw new Error("姓名需要为 1–120 个字符");
    if (this.userRowByEmail(email)) throw new Error("这个邮箱已经存在");
    const expiresHours = Math.max(1, Math.min(168, Math.trunc(input.expiresHours ?? 72)));
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString();
    this.client.transaction(() => {
      this.client
        .prepare(
          "UPDATE auth_invitations SET status = 'revoked' WHERE email = ? AND status = 'pending'",
        )
        .run(email);
      this.client
        .prepare(`INSERT INTO auth_invitations
          (id, token_hash, email, name, instance_role, status, created_at, expires_at, created_by)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
        .run(
          id,
          tokenDigest(token),
          email,
          name,
          input.instanceRole,
          createdAt,
          expiresAt,
          actorId,
        );
      this.audit(
        actorId,
        "invitation.created",
        "invitation",
        id,
        { email, instanceRole: input.instanceRole, expiresAt },
        ip,
      );
    })();
    const row = this.client
      .prepare("SELECT * FROM auth_invitations WHERE id = ?")
      .get(id) as InvitationRow;
    return { invitation: toInvitation(row), token };
  }

  listInvitations() {
    return (
      this.client
        .prepare("SELECT * FROM auth_invitations ORDER BY created_at DESC LIMIT 100")
        .all() as InvitationRow[]
    ).map(toInvitation);
  }

  invitationForToken(token: string) {
    if (!token || token.length > 200) return null;
    const row = this.client
      .prepare("SELECT * FROM auth_invitations WHERE token_hash = ?")
      .get(tokenDigest(token)) as InvitationRow | undefined;
    if (!row) return null;
    const invitation = toInvitation(row);
    return invitation.status === "pending" ? invitation : null;
  }

  revokeInvitation(invitationId: string, actorId: string, ip: string | null) {
    const changed =
      this.client
        .prepare(
          "UPDATE auth_invitations SET status = 'revoked' WHERE id = ? AND status = 'pending'",
        )
        .run(invitationId).changes > 0;
    if (changed) this.audit(actorId, "invitation.revoked", "invitation", invitationId, {}, ip);
    return changed;
  }

  acceptInvitation(token: string, password: string, ip: string | null) {
    const invitation = this.invitationForToken(token);
    if (!invitation) return null;
    const passwordHash = hashPassword(password);
    const userId = randomUUID();
    const timestamp = nowIso();
    this.client.transaction(() => {
      const current = this.client
        .prepare("SELECT * FROM auth_invitations WHERE id = ?")
        .get(invitation.id) as InvitationRow | undefined;
      if (!current || toInvitation(current).status !== "pending") throw new Error("邀请已经失效");
      if (this.userRowByEmail(current.email)) throw new Error("这个邮箱已经注册");
      this.client
        .prepare(`INSERT INTO auth_users
          (id, email, name, password_hash, instance_role, status, must_change_password, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`)
        .run(
          userId,
          current.email,
          current.name,
          passwordHash,
          current.instance_role,
          timestamp,
          timestamp,
        );
      const accepted = this.client
        .prepare(`UPDATE auth_invitations SET status = 'accepted', accepted_at = ?, accepted_by = ?
          WHERE id = ? AND status = 'pending'`)
        .run(timestamp, userId, invitation.id);
      if (accepted.changes !== 1) throw new Error("邀请已经失效");
      this.audit(
        userId,
        "invitation.accepted",
        "invitation",
        invitation.id,
        { email: current.email },
        ip,
      );
    })();
    return this.requireUser(userId);
  }

  recoveryCodeStatus(userId: string): RecoveryCodeStatus {
    const row = this.client
      .prepare(`SELECT COUNT(*) AS available, MAX(created_at) AS generated_at
        FROM auth_recovery_codes WHERE user_id = ? AND used_at IS NULL`)
      .get(userId) as { available: number; generated_at: string | null };
    return { available: row.available, generatedAt: row.generated_at };
  }

  generateRecoveryCodes(
    userId: string,
    currentPassword: string,
    ip: string | null,
  ): { codes: string[]; status: RecoveryCodeStatus } | null {
    const row = this.client.prepare("SELECT * FROM auth_users WHERE id = ?").get(userId) as
      | UserRow
      | undefined;
    if (!row || !verifyPassword(currentPassword, row.password_hash)) return null;
    const codes = Array.from({ length: 10 }, createRecoveryCode);
    const createdAt = nowIso();
    this.client.transaction(() => {
      this.client.prepare("DELETE FROM auth_recovery_codes WHERE user_id = ?").run(userId);
      const insert = this.client.prepare(`INSERT INTO auth_recovery_codes
        (id, user_id, code_hash, created_at, used_at) VALUES (?, ?, ?, ?, NULL)`);
      for (const code of codes) {
        insert.run(randomUUID(), userId, tokenDigest(normalizeRecoveryCode(code)), createdAt);
      }
      this.audit(
        userId,
        "auth.recovery_codes_rotated",
        "user",
        userId,
        { count: codes.length },
        ip,
      );
    })();
    return { codes, status: this.recoveryCodeStatus(userId) };
  }

  recoverPassword(email: string, code: string, nextPassword: string, ip: string | null) {
    const normalizedEmail = normalizeEmail(email);
    const address = ip ?? "unknown";
    if (!this.loginAllowed(normalizedEmail, address).allowed) {
      return { recovered: false, rateLimited: true } as const;
    }
    const user = this.userRowByEmail(normalizedEmail);
    const normalizedCode = normalizeRecoveryCode(code);
    const codeRow =
      user && normalizedCode.length >= 16
        ? (this.client
            .prepare(`SELECT * FROM auth_recovery_codes
          WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`)
            .get(user.id, tokenDigest(normalizedCode)) as RecoveryCodeRow | undefined)
        : undefined;
    if (user?.status !== "active" || !codeRow) {
      this.client
        .prepare("INSERT INTO auth_login_failures (email, ip_address, created_at) VALUES (?, ?, ?)")
        .run(normalizedEmail, address, nowIso());
      this.audit(user?.id ?? null, "auth.recovery_failed", "user", user?.id ?? null, {}, ip);
      return { recovered: false, rateLimited: false } as const;
    }
    const passwordHash = hashPassword(nextPassword);
    const timestamp = nowIso();
    this.client.transaction(() => {
      const consumed = this.client
        .prepare("UPDATE auth_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
        .run(timestamp, codeRow.id);
      if (consumed.changes !== 1) throw new Error("恢复码已经使用");
      this.client
        .prepare(
          "UPDATE auth_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
        )
        .run(passwordHash, timestamp, user.id);
      this.revokeAllSessions(user.id);
      this.client
        .prepare("DELETE FROM auth_login_failures WHERE email = ? AND ip_address = ?")
        .run(normalizedEmail, address);
      this.audit(
        user.id,
        "auth.password_recovered",
        "user",
        user.id,
        { recoveryCodeId: codeRow.id },
        ip,
      );
    })();
    return { recovered: true, rateLimited: false } as const;
  }

  loginAllowed(email: string, ip: string) {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    this.client.prepare("DELETE FROM auth_login_failures WHERE created_at < ?").run(since);
    const count = this.client
      .prepare(
        "SELECT COUNT(*) FROM auth_login_failures WHERE (email = ? OR ip_address = ?) AND created_at >= ?",
      )
      .pluck()
      .get(normalizeEmail(email), ip, since) as number;
    return { allowed: count < 8, retryAfterSeconds: count < 8 ? 0 : 60 };
  }

  authenticate(email: string, password: string, ip: string | null) {
    const normalized = normalizeEmail(email);
    const address = ip ?? "unknown";
    const limit = this.loginAllowed(normalized, address);
    if (!limit.allowed) return { user: null, rateLimited: true } as const;
    const row = this.userRowByEmail(normalized);
    const valid = verifyPassword(password, row?.password_hash ?? dummyPasswordHash);
    if (!row || !valid || row.status !== "active") {
      this.client
        .prepare("INSERT INTO auth_login_failures (email, ip_address, created_at) VALUES (?, ?, ?)")
        .run(normalized, address, nowIso());
      this.audit(
        row?.id ?? null,
        "auth.login_failed",
        "user",
        row?.id ?? null,
        { email: normalized },
        ip,
      );
      return { user: null, rateLimited: false } as const;
    }
    const timestamp = nowIso();
    this.client
      .prepare("UPDATE auth_users SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, timestamp, row.id);
    this.client
      .prepare("DELETE FROM auth_login_failures WHERE email = ? AND ip_address = ?")
      .run(normalized, address);
    this.audit(row.id, "auth.login", "session", null, {}, ip);
    return { user: this.getUser(row.id), rateLimited: false } as const;
  }

  createSession(userId: string, userAgent: string | null, ip: string | null) {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const idleExpiresAt = new Date(now + idleSessionMilliseconds).toISOString();
    const expiresAt = new Date(now + absoluteSessionMilliseconds).toISOString();
    this.client
      .prepare(`INSERT INTO auth_sessions
      (id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, expires_at, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        userId,
        tokenDigest(token),
        createdAt,
        createdAt,
        idleExpiresAt,
        expiresAt,
        userAgent?.slice(0, 500) ?? null,
        ip,
      );
    return { id, token, csrfToken: csrfForSessionToken(token), expiresAt };
  }

  resolveSession(token: string) {
    if (!token || token.length > 200) return null;
    const row = this.client
      .prepare(`SELECT s.* FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND u.status = 'active'`)
      .get(tokenDigest(token)) as SessionRow | undefined;
    if (!row) return null;
    const now = Date.now();
    if (Date.parse(row.expires_at) <= now || Date.parse(row.idle_expires_at) <= now) {
      this.client.prepare("DELETE FROM auth_sessions WHERE id = ?").run(row.id);
      return null;
    }
    if (now - Date.parse(row.last_seen_at) > 5 * 60 * 1000) {
      const timestamp = new Date(now).toISOString();
      const idle = new Date(
        Math.min(now + idleSessionMilliseconds, Date.parse(row.expires_at)),
      ).toISOString();
      this.client
        .prepare("UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?")
        .run(timestamp, idle, row.id);
    }
    const user = this.getUser(row.user_id);
    return user ? { sessionId: row.id, token, csrfToken: csrfForSessionToken(token), user } : null;
  }

  listSessions(userId: string, currentSessionId: string): AccountSession[] {
    return (
      this.client
        .prepare("SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY last_seen_at DESC")
        .all(userId) as SessionRow[]
    ).map((row) => ({
      id: row.id,
      current: row.id === currentSessionId,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
    }));
  }

  revokeSession(userId: string, sessionId: string) {
    return (
      this.client
        .prepare("DELETE FROM auth_sessions WHERE id = ? AND user_id = ?")
        .run(sessionId, userId).changes > 0
    );
  }

  revokeAllSessions(userId: string, exceptSessionId?: string) {
    if (exceptSessionId)
      return this.client
        .prepare("DELETE FROM auth_sessions WHERE user_id = ? AND id <> ?")
        .run(userId, exceptSessionId).changes;
    return this.client.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId).changes;
  }

  changePassword(
    userId: string,
    currentPassword: string,
    nextPassword: string,
    sessionId: string,
    ip: string | null,
  ) {
    const row = this.client.prepare("SELECT * FROM auth_users WHERE id = ?").get(userId) as
      | UserRow
      | undefined;
    if (!row || !verifyPassword(currentPassword, row.password_hash)) return false;
    const timestamp = nowIso();
    this.client
      .prepare(
        "UPDATE auth_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?",
      )
      .run(hashPassword(nextPassword), timestamp, userId);
    this.revokeAllSessions(userId, sessionId);
    this.audit(userId, "auth.password_changed", "user", userId, {}, ip);
    return true;
  }

  updateProfile(userId: string, name: string) {
    const clean = name.trim();
    if (!clean || clean.length > 120) throw new Error("姓名需要为 1–120 个字符");
    this.client
      .prepare("UPDATE auth_users SET name = ?, updated_at = ? WHERE id = ?")
      .run(clean, nowIso(), userId);
    return this.requireUser(userId);
  }

  updateUser(
    actorId: string,
    userId: string,
    input: { status?: "active" | "disabled"; instanceRole?: InstanceRole },
    ip: string | null,
  ) {
    this.client.transaction(() => {
      const current = this.getUser(userId);
      if (!current) throw new Error("成员不存在");
      if (actorId === userId && input.status === "disabled") {
        throw new Error("不能停用自己的账号");
      }
      if (
        current.instanceRole === "admin" &&
        (input.status === "disabled" || input.instanceRole === "member")
      ) {
        const otherAdmins = this.client
          .prepare(`SELECT COUNT(*) FROM auth_users
            WHERE id <> ? AND instance_role = 'admin' AND status = 'active'`)
          .pluck()
          .get(userId) as number;
        if (otherAdmins === 0) throw new Error("至少需要保留一位可用管理员");
      }
      const nextStatus = input.status ?? current.status;
      const nextRole = input.instanceRole ?? current.instanceRole;
      this.client
        .prepare("UPDATE auth_users SET status = ?, instance_role = ?, updated_at = ? WHERE id = ?")
        .run(nextStatus, nextRole, nowIso(), userId);
      if (nextStatus === "disabled") this.revokeAllSessions(userId);
      this.audit(
        actorId,
        "user.updated",
        "user",
        userId,
        { status: nextStatus, instanceRole: nextRole },
        ip,
      );
    })();
    return this.requireUser(userId);
  }

  projectRole(projectId: string, userId: string) {
    return (
      (this.client
        .prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
        .pluck()
        .get(projectId, userId) as ProjectRole | undefined) ?? null
    );
  }

  hasProjectRole(
    projectId: string,
    userId: string,
    minimum: ProjectRole,
    instanceRole?: InstanceRole,
  ) {
    if (instanceRole === "admin") return true;
    const role = this.projectRole(projectId, userId);
    return role !== null && roleWeight[role] >= roleWeight[minimum];
  }

  accessibleProjectIds(userId: string, instanceRole: InstanceRole) {
    if (instanceRole === "admin") return null;
    return new Set(
      this.client
        .prepare("SELECT project_id FROM project_members WHERE user_id = ?")
        .pluck()
        .all(userId) as string[],
    );
  }

  grantProjectOwner(projectId: string, userId: string) {
    this.client
      .prepare(`INSERT INTO project_members (project_id, user_id, role, created_at, created_by)
      VALUES (?, ?, 'owner', ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET role = 'owner'`)
      .run(projectId, userId, nowIso(), userId);
  }

  listProjectMembers(projectId: string): ProjectMember[] {
    const rows = this.client
      .prepare(`SELECT u.*, pm.role AS project_role, pm.created_at AS member_created_at
      FROM project_members pm JOIN auth_users u ON u.id = pm.user_id
      WHERE pm.project_id = ? ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`)
      .all(projectId) as Array<UserRow & { project_role: ProjectRole; member_created_at: string }>;
    return rows.map((row) => ({
      user: toAccount(row),
      role: row.project_role,
      createdAt: row.member_created_at,
    }));
  }

  setProjectMember(
    projectId: string,
    userId: string,
    role: ProjectRole,
    actorId: string,
    ip: string | null,
  ) {
    const user = this.getUser(userId);
    if (!user) throw new Error("成员不存在");
    if (user.status !== "active") throw new Error("不能把已停用账号加入项目");
    this.client.transaction(() => {
      const currentRole = this.projectRole(projectId, userId);
      if (currentRole === "owner" && role !== "owner") {
        const owners = this.client
          .prepare("SELECT COUNT(*) FROM project_members WHERE project_id = ? AND role = 'owner'")
          .pluck()
          .get(projectId) as number;
        if (owners <= 1) throw new Error("项目至少需要保留一位 Owner");
      }
      this.client
        .prepare(`INSERT INTO project_members (project_id, user_id, role, created_at, created_by)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`)
        .run(projectId, userId, role, nowIso(), actorId);
      this.audit(actorId, "project.member_set", "project", projectId, { userId, role }, ip);
    })();
    return this.listProjectMembers(projectId);
  }

  removeProjectMember(projectId: string, userId: string, actorId: string, ip: string | null) {
    return this.client.transaction(() => {
      const role = this.projectRole(projectId, userId);
      if (!role) return false;
      if (role === "owner") {
        const owners = this.client
          .prepare("SELECT COUNT(*) FROM project_members WHERE project_id = ? AND role = 'owner'")
          .pluck()
          .get(projectId) as number;
        if (owners <= 1) throw new Error("项目至少需要保留一位 Owner");
      }
      const changed =
        this.client
          .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
          .run(projectId, userId).changes > 0;
      if (changed)
        this.audit(actorId, "project.member_removed", "project", projectId, { userId }, ip);
      return changed;
    })();
  }

  audit(
    actorUserId: string | null,
    action: string,
    targetType: string,
    targetId: string | null,
    metadata: Record<string, unknown>,
    ip: string | null,
  ) {
    this.client
      .prepare(`INSERT INTO auth_audit_log
      (actor_user_id, action, target_type, target_id, metadata_json, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(actorUserId, action, targetType, targetId, JSON.stringify(metadata), ip, nowIso());
  }

  listAudit(limit = 100) {
    const bounded = Math.max(1, Math.min(250, Math.trunc(limit)));
    const rows = this.client
      .prepare(`SELECT a.*, u.name AS actor_name, u.email AS actor_email
        FROM auth_audit_log a LEFT JOIN auth_users u ON u.id = a.actor_user_id
        ORDER BY a.sequence DESC LIMIT ?`)
      .all(bounded) as Array<{
      sequence: number;
      actor_user_id: string | null;
      actor_name: string | null;
      actor_email: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      metadata_json: string;
      ip_address: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      sequence: row.sequence,
      actor:
        row.actor_user_id && row.actor_name && row.actor_email
          ? { id: row.actor_user_id, name: row.actor_name, email: row.actor_email }
          : null,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    }));
  }
}
