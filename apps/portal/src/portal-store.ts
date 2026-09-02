import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hashPassword, normalizeEmail, tokenDigest, verifyPassword } from "@takeboard/identity";
import BetterSqlite3 from "better-sqlite3";

type PortalUserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: "admin" | "member";
  status: "active" | "disabled";
  created_at: string;
  last_login_at: string | null;
};

type PortalSessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  ip_address: string | null;
  user_agent: string | null;
};

type PairingRow = {
  id: string;
  instance_id: string;
  instance_name: string;
  application_version: string;
  connector_secret_hash: string;
  code_hash: string;
  created_at: string;
  expires_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  device_id: string | null;
  token_encrypted: string | null;
};

type DeviceRow = {
  id: string;
  slug: string;
  instance_id: string;
  instance_name: string;
  application_version: string;
  owner_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

const sessionMilliseconds = 7 * 24 * 60 * 60 * 1000;
const pairingMilliseconds = 10 * 60 * 1000;
const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const dummyPasswordHash = hashPassword(randomBytes(32).toString("base64url"));

function nowIso() {
  return new Date().toISOString();
}

function cleanName(value: string, fallback: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120) || fallback;
}

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function pairingCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += codeAlphabet[byte % codeAlphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function deviceSlug() {
  return randomBytes(8).toString("hex").slice(0, 12);
}

function safeUser(row: PortalUserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function safeDevice(row: DeviceRow, online = false) {
  return {
    id: row.id,
    slug: row.slug,
    instanceId: row.instance_id,
    name: row.instance_name,
    applicationVersion: row.application_version,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    online,
  };
}

function loadMasterKey(databasePath: string, configured?: string) {
  if (configured) {
    const value = Buffer.from(configured, "base64url");
    if (value.length !== 32)
      throw new Error("TAKEBOARD_PORTAL_MASTER_KEY 必须是 32 字节 base64url");
    return value;
  }
  if (databasePath === ":memory:") return randomBytes(32);
  const path = `${databasePath}.key`;
  try {
    const value = Buffer.from(readFileSync(path, "utf8").trim(), "base64url");
    if (value.length !== 32) throw new Error("invalid key length");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`门户主密钥无法读取：${path}`);
    }
    const value = randomBytes(32);
    writeFileSync(path, `${value.toString("base64url")}\n`, { flag: "wx", mode: 0o600 });
    return value;
  }
}

export class PortalStore {
  private readonly client: BetterSqlite3.Database;
  private readonly masterKey: Buffer;

  constructor(databasePath: string, masterKey?: string, auditRetentionDays = 180) {
    if (
      !Number.isInteger(auditRetentionDays) ||
      auditRetentionDays < 7 ||
      auditRetentionDays > 3_650
    ) {
      throw new Error("门户审计保留天数必须是 7–3650 的整数");
    }
    const resolved = databasePath === ":memory:" ? databasePath : resolve(databasePath);
    if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });
    this.masterKey = loadMasterKey(resolved, masterKey);
    this.client = new BetterSqlite3(resolved);
    this.client.pragma("journal_mode = WAL");
    this.client.pragma("foreign_keys = ON");
    this.client.pragma("busy_timeout = 5000");
    this.migrate();
    this.pruneExpiredData(auditRetentionDays);
  }

  private migrate() {
    this.client.exec(`
      CREATE TABLE IF NOT EXISTS portal_users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        created_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS portal_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS portal_sessions_user_idx ON portal_sessions(user_id, last_seen_at DESC);
      CREATE TABLE IF NOT EXISTS portal_login_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS portal_login_failures_idx ON portal_login_failures(email, ip_address, created_at);
      CREATE TABLE IF NOT EXISTS portal_pairings (
        id TEXT PRIMARY KEY NOT NULL,
        instance_id TEXT NOT NULL,
        instance_name TEXT NOT NULL,
        application_version TEXT NOT NULL,
        connector_secret_hash TEXT NOT NULL UNIQUE,
        code_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        source_ip TEXT,
        claimed_at TEXT,
        claimed_by TEXT REFERENCES portal_users(id) ON DELETE SET NULL,
        device_id TEXT,
        token_encrypted TEXT
      );
      CREATE INDEX IF NOT EXISTS portal_pairings_instance_idx ON portal_pairings(instance_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS portal_devices (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        instance_id TEXT NOT NULL,
        instance_name TEXT NOT NULL,
        application_version TEXT NOT NULL,
        owner_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT,
        UNIQUE(instance_id, owner_id)
      );
      CREATE INDEX IF NOT EXISTS portal_devices_owner_idx ON portal_devices(owner_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS portal_audit_log (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        metadata_json TEXT NOT NULL,
        ip_address TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS portal_audit_created_idx ON portal_audit_log(created_at DESC);
    `);
  }

  private pruneExpiredData(auditRetentionDays: number) {
    const now = nowIso();
    const failureCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pairingCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const auditCutoff = new Date(
      Date.now() - auditRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.client.transaction(() => {
      this.client.prepare("DELETE FROM portal_sessions WHERE expires_at <= ?").run(now);
      this.client
        .prepare("DELETE FROM portal_login_failures WHERE created_at < ?")
        .run(failureCutoff);
      this.client.prepare("DELETE FROM portal_pairings WHERE expires_at < ?").run(pairingCutoff);
      this.client.prepare("DELETE FROM portal_audit_log WHERE created_at < ?").run(auditCutoff);
    })();
  }

  close() {
    this.client.close();
  }

  configured() {
    return (this.client.prepare("SELECT COUNT(*) FROM portal_users").pluck().get() as number) > 0;
  }

  register(input: { email: string; name: string; password: string }, allowRegistration: boolean) {
    const first = !this.configured();
    if (!first && !allowRegistration) throw new Error("此门户没有开放自主注册");
    const email = normalizeEmail(input.email);
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error("请输入有效邮箱");
    const name = cleanName(input.name, email.split("@")[0] ?? "Creator");
    const timestamp = nowIso();
    const id = randomUUID();
    try {
      this.client
        .prepare(`INSERT INTO portal_users
          (id, email, name, password_hash, role, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?)`)
        .run(id, email, name, hashPassword(input.password), first ? "admin" : "member", timestamp);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new Error("这个邮箱已经注册");
      throw error;
    }
    this.audit(id, "portal.account_registered", "portal_user", id, {}, null);
    return safeUser(this.userRow(id) as PortalUserRow);
  }

  private userRow(id: string) {
    return this.client.prepare("SELECT * FROM portal_users WHERE id = ?").get(id) as
      | PortalUserRow
      | undefined;
  }

  authenticate(email: string, password: string, ip: string | null) {
    const normalized = normalizeEmail(email);
    const address = ip ?? "unknown";
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const attempts = this.client
      .prepare(
        "SELECT COUNT(*) FROM portal_login_failures WHERE email = ? AND ip_address = ? AND created_at >= ?",
      )
      .pluck()
      .get(normalized, address, since) as number;
    if (attempts >= 10) return { user: null, rateLimited: true };
    const row = this.client.prepare("SELECT * FROM portal_users WHERE email = ?").get(normalized) as
      | PortalUserRow
      | undefined;
    const passwordValid = verifyPassword(password, row?.password_hash ?? dummyPasswordHash);
    const valid = row?.status === "active" && passwordValid;
    if (!valid) {
      this.client
        .prepare(
          "INSERT INTO portal_login_failures (email, ip_address, created_at) VALUES (?, ?, ?)",
        )
        .run(normalized, address, nowIso());
      this.audit(row?.id ?? null, "portal.login_failed", "portal_user", row?.id ?? null, {}, ip);
      return { user: null, rateLimited: false };
    }
    const timestamp = nowIso();
    this.client
      .prepare("UPDATE portal_users SET last_login_at = ? WHERE id = ?")
      .run(timestamp, row.id);
    this.client.prepare("DELETE FROM portal_login_failures WHERE email = ?").run(normalized);
    this.audit(row.id, "portal.login", "portal_user", row.id, {}, ip);
    return { user: safeUser({ ...row, last_login_at: timestamp }), rateLimited: false };
  }

  createSession(userId: string, ip: string | null, userAgent: string | null) {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(24).toString("base64url");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + sessionMilliseconds).toISOString();
    this.client
      .prepare(`INSERT INTO portal_sessions
        (id, user_id, token_hash, csrf_token, created_at, expires_at, last_seen_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        userId,
        tokenDigest(token),
        csrfToken,
        createdAt,
        expiresAt,
        createdAt,
        ip,
        userAgent,
      );
    return { id, token, csrfToken, expiresAt };
  }

  resolveSession(token: string) {
    const row = this.client
      .prepare("SELECT * FROM portal_sessions WHERE token_hash = ?")
      .get(tokenDigest(token)) as PortalSessionRow | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.client.prepare("DELETE FROM portal_sessions WHERE id = ?").run(row.id);
      return null;
    }
    const user = this.userRow(row.user_id);
    if (user?.status !== "active") return null;
    this.client
      .prepare("UPDATE portal_sessions SET last_seen_at = ? WHERE id = ?")
      .run(nowIso(), row.id);
    return { sessionId: row.id, csrfToken: row.csrf_token, user: safeUser(user) };
  }

  revokeSession(sessionId: string, userId: string) {
    return (
      this.client
        .prepare("DELETE FROM portal_sessions WHERE id = ? AND user_id = ?")
        .run(sessionId, userId).changes > 0
    );
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
  }

  private decrypt(value: string) {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) throw new Error("invalid encrypted token");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.masterKey,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  startPairing(
    input: { instanceId: string; instanceName: string; applicationVersion: string },
    ip: string | null,
  ) {
    if (!/^[A-Za-z0-9-]{10,100}$/.test(input.instanceId)) throw new Error("实例标识无效");
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = this.client
      .prepare("SELECT COUNT(*) FROM portal_pairings WHERE source_ip = ? AND created_at >= ?")
      .pluck()
      .get(ip ?? "unknown", since) as number;
    if (recent >= 8) throw new Error("配对请求过多，请稍后再试");
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + pairingMilliseconds).toISOString();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const userCode = pairingCode();
      try {
        this.client
          .prepare(`INSERT INTO portal_pairings
            (id, instance_id, instance_name, application_version, connector_secret_hash,
             code_hash, created_at, expires_at, source_ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            id,
            input.instanceId,
            cleanName(input.instanceName, "TakeBoard Workstation"),
            input.applicationVersion.slice(0, 64),
            tokenDigest(secret),
            tokenDigest(normalizeCode(userCode)),
            createdAt,
            expiresAt,
            ip ?? "unknown",
          );
        return { pairingId: id, connectorSecret: secret, userCode, expiresAt };
      } catch (error) {
        if (!String(error).includes("portal_pairings.code_hash")) throw error;
      }
    }
    throw new Error("无法生成唯一配对码，请重试");
  }

  claimPairing(code: string, userId: string, ip: string | null) {
    const row = this.client
      .prepare("SELECT * FROM portal_pairings WHERE code_hash = ?")
      .get(tokenDigest(normalizeCode(code))) as PairingRow | undefined;
    if (!row || row.claimed_at || Date.parse(row.expires_at) <= Date.now()) {
      throw new Error("配对码不存在、已使用或已过期");
    }
    const deviceToken = randomBytes(32).toString("base64url");
    const timestamp = nowIso();
    const existing = this.client
      .prepare("SELECT * FROM portal_devices WHERE instance_id = ? AND owner_id = ?")
      .get(row.instance_id, userId) as DeviceRow | undefined;
    const deviceId = existing?.id ?? randomUUID();
    const slug = existing?.slug ?? deviceSlug();
    this.client.transaction(() => {
      if (existing) {
        this.client
          .prepare(`UPDATE portal_devices SET instance_name = ?, application_version = ?,
            token_hash = ?, last_seen_at = NULL, revoked_at = NULL WHERE id = ?`)
          .run(row.instance_name, row.application_version, tokenDigest(deviceToken), deviceId);
      } else {
        this.client
          .prepare(`INSERT INTO portal_devices
            (id, slug, instance_id, instance_name, application_version, owner_id, token_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            deviceId,
            slug,
            row.instance_id,
            row.instance_name,
            row.application_version,
            userId,
            tokenDigest(deviceToken),
            timestamp,
          );
      }
      const claimed = this.client
        .prepare(`UPDATE portal_pairings SET claimed_at = ?, claimed_by = ?, device_id = ?,
          token_encrypted = ? WHERE id = ? AND claimed_at IS NULL`)
        .run(timestamp, userId, deviceId, this.encrypt(deviceToken), row.id).changes;
      if (claimed !== 1) throw new Error("配对码已经被使用");
    })();
    this.audit(
      userId,
      "device.paired",
      "portal_device",
      deviceId,
      { instanceId: row.instance_id },
      ip,
    );
    return safeDevice(
      this.client.prepare("SELECT * FROM portal_devices WHERE id = ?").get(deviceId) as DeviceRow,
    );
  }

  pairingStatus(pairingId: string, connectorSecret: string) {
    const row = this.client
      .prepare("SELECT * FROM portal_pairings WHERE id = ? AND connector_secret_hash = ?")
      .get(pairingId, tokenDigest(connectorSecret)) as PairingRow | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.now()) return { state: "expired" as const };
    if (!row.claimed_at || !row.claimed_by || !row.device_id || !row.token_encrypted) {
      return { state: "pending" as const, expiresAt: row.expires_at };
    }
    return {
      state: "paired" as const,
      deviceId: row.device_id,
      portalSubject: row.claimed_by,
      deviceToken: this.decrypt(row.token_encrypted),
      slug: (
        this.client.prepare("SELECT slug FROM portal_devices WHERE id = ?").get(row.device_id) as {
          slug: string;
        }
      ).slug,
    };
  }

  authenticateDevice(instanceId: string, token: string) {
    const row = this.client
      .prepare(`SELECT * FROM portal_devices
        WHERE instance_id = ? AND token_hash = ? AND revoked_at IS NULL`)
      .get(instanceId, tokenDigest(token)) as DeviceRow | undefined;
    return row ? { ...safeDevice(row), ownerId: row.owner_id } : null;
  }

  deviceBySlug(slug: string, userId: string) {
    const row = this.client
      .prepare(
        "SELECT * FROM portal_devices WHERE slug = ? AND owner_id = ? AND revoked_at IS NULL",
      )
      .get(slug, userId) as DeviceRow | undefined;
    return row ? { ...safeDevice(row), ownerId: row.owner_id } : null;
  }

  listDevices(userId: string, online: ReadonlySet<string>) {
    return (
      this.client
        .prepare("SELECT * FROM portal_devices WHERE owner_id = ? ORDER BY created_at DESC")
        .all(userId) as DeviceRow[]
    ).map((row) => safeDevice(row, online.has(row.id)));
  }

  markDeviceOnline(deviceId: string, instanceName: string, applicationVersion: string) {
    this.client
      .prepare(`UPDATE portal_devices SET instance_name = ?, application_version = ?, last_seen_at = ?
        WHERE id = ? AND revoked_at IS NULL`)
      .run(
        cleanName(instanceName, "TakeBoard Workstation"),
        applicationVersion.slice(0, 64),
        nowIso(),
        deviceId,
      );
  }

  touchDevice(deviceId: string) {
    this.client
      .prepare("UPDATE portal_devices SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(nowIso(), deviceId);
  }

  revokeDevice(deviceId: string, userId: string, ip: string | null) {
    const changed = this.client
      .prepare(
        "UPDATE portal_devices SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL",
      )
      .run(nowIso(), deviceId, userId).changes;
    if (changed) this.audit(userId, "device.revoked", "portal_device", deviceId, {}, ip);
    return changed > 0;
  }

  revokeDeviceSelf(deviceId: string) {
    const row = this.client
      .prepare("SELECT owner_id FROM portal_devices WHERE id = ?")
      .get(deviceId) as { owner_id: string } | undefined;
    if (!row) return false;
    return this.revokeDevice(deviceId, row.owner_id, null);
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
      .prepare(`INSERT INTO portal_audit_log
        (actor_user_id, action, target_type, target_id, metadata_json, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(actorUserId, action, targetType, targetId, JSON.stringify(metadata), ip, nowIso());
  }

  listAudit(userId: string, limit = 100) {
    return this.client
      .prepare(`SELECT sequence, action, target_type AS targetType, target_id AS targetId,
        metadata_json AS metadataJson, ip_address AS ipAddress, created_at AS createdAt
        FROM portal_audit_log WHERE actor_user_id = ? ORDER BY sequence DESC LIMIT ?`)
      .all(userId, Math.max(1, Math.min(200, limit))) as Array<Record<string, unknown>>;
  }
}
