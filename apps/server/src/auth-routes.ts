import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Account, AuthStatus, InstanceRole, ProjectRole } from "@takeboard/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type AuthMode, AuthService } from "./auth-service.js";
import {
  applyStagedProjectRestore,
  createInstanceBackup,
  InstanceBackupError,
  instanceBackupPath,
  listInstanceBackups,
  removeStagedRestore,
  stageInstanceRestore,
} from "./instance-backup.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";

const sessionCookieName = "takeboard_session";
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const authContexts = new WeakMap<FastifyRequest, AuthRequestContext>();

export type AuthRequestContext = {
  user: Account;
  sessionId: string;
  csrfToken: string;
};

export type AuthOptions = {
  mode: AuthMode;
  databasePath: string;
  projectsRoot: string;
  secureCookies?: boolean;
};

export function authContext(request: FastifyRequest) {
  return authContexts.get(request) ?? null;
}

export function requireAuthContext(request: FastifyRequest) {
  const context = authContext(request);
  if (!context) throw new Error("Authenticated request context is unavailable");
  return context;
}

function cookies(value: string | undefined) {
  const parsed = new Map<string, string>();
  for (const part of (value ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    try {
      parsed.set(name, decodeURIComponent(raw));
    } catch {
      // Ignore malformed cookies instead of accepting a partially decoded token.
    }
  }
  return parsed;
}

function sessionCookie(token: string, secure: boolean, maxAgeSeconds = 7 * 24 * 60 * 60) {
  return [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function clearSessionCookie(secure: boolean) {
  return sessionCookie("", secure, 0);
}

function bodyObject(request: FastifyRequest) {
  return typeof request.body === "object" && request.body !== null
    ? (request.body as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function resolveProject(root: string, keyValue: unknown) {
  const key = projectKey(keyValue);
  if (!key) return null;
  const store = ProjectStore.openExisting(join(root, key));
  if (!store) return null;
  try {
    const current = store.loadCurrent();
    return current ? { key, projectId: current.snapshot.project.id } : null;
  } finally {
    store.close();
  }
}

async function existingProjectIds(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !projectKey(entry.name)) continue;
    const project = resolveProject(root, entry.name);
    if (project) ids.push(project.projectId);
  }
  return ids;
}

function publicAuthRoute(route: string, method: string) {
  if (route === "/api/health") return true;
  if (route === "/api/auth/status" && method === "GET") return true;
  if (route === "/api/auth/invitations/:token" && (method === "GET" || method === "POST"))
    return true;
  if (route === "/api/auth/recover" && method === "POST") return true;
  return (route === "/api/auth/bootstrap" || route === "/api/auth/login") && method === "POST";
}

function adminOnly(route: string, method: string) {
  if (route.startsWith("/api/admin/")) return true;
  if (route === "/api/workers/comfy/start") return true;
  if (
    route === "/api/workflows/raw" ||
    route === "/api/workflows/recipe-package" ||
    route === "/api/workflows/archive-preview" ||
    route === "/api/workflows/archives"
  ) {
    return true;
  }
  if (route.startsWith("/api/workflows/") && method !== "GET") return true;
  return false;
}

function minimumProjectRole(route: string, method: string): ProjectRole {
  if (route.includes("/members")) return "owner";
  if (route === "/api/projects/:key/export") return "owner";
  if (route === "/api/projects/:key" && method === "DELETE") return "owner";
  return method === "GET" || method === "HEAD" ? "viewer" : "editor";
}

function safeAccountPayload(user: Account) {
  return user;
}

export function registerAuth(app: FastifyInstance, options: AuthOptions) {
  const root = resolve(options.projectsRoot);
  const auth = new AuthService(
    options.mode === "off" ? ":memory:" : options.databasePath,
    options.mode,
  );
  const secureCookies = options.secureCookies ?? process.env.TAKEBOARD_SECURE_COOKIES === "1";
  app.addHook("onClose", async () => auth.close());

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const route = request.routeOptions.url ?? request.url.split("?", 1)[0] ?? request.url;
    if (options.mode !== "required" || publicAuthRoute(route, request.method)) return;
    if (!auth.configured()) {
      return await reply
        .code(428)
        .send({ error: "请先完成 TakeBoard 管理员设置", code: "SETUP_REQUIRED" });
    }
    const token = cookies(request.headers.cookie).get(sessionCookieName);
    const session = token ? auth.resolveSession(token) : null;
    if (!session) {
      if (token) reply.header("set-cookie", clearSessionCookie(secureCookies));
      return await reply.code(401).send({ error: "登录已过期，请重新登录", code: "AUTH_REQUIRED" });
    }
    const context: AuthRequestContext = {
      user: session.user,
      sessionId: session.sessionId,
      csrfToken: session.csrfToken,
    };
    authContexts.set(request, context);
    if (unsafeMethods.has(request.method)) {
      const supplied = request.headers["x-takeboard-csrf"];
      if (typeof supplied !== "string" || supplied !== session.csrfToken) {
        auth.audit(
          session.user.id,
          "auth.csrf_rejected",
          "route",
          route,
          { method: request.method },
          request.ip ?? null,
        );
        return await reply
          .code(403)
          .send({ error: "安全令牌无效，请刷新页面后重试", code: "CSRF_INVALID" });
      }
    }
    if (
      session.user.mustChangePassword &&
      route !== "/api/auth/change-password" &&
      route !== "/api/auth/logout" &&
      !route.startsWith("/api/auth/sessions")
    ) {
      return await reply.code(403).send({
        error: "请先更换管理员提供的初始密码",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }
    if (adminOnly(route, request.method) && session.user.instanceRole !== "admin") {
      auth.audit(
        session.user.id,
        "authorization.denied",
        "route",
        route,
        { method: request.method, requiredRole: "admin" },
        request.ip ?? null,
      );
      return await reply
        .code(403)
        .send({ error: "此操作仅限 TakeBoard 管理员", code: "ADMIN_REQUIRED" });
    }
    const key = (request.params as { key?: unknown } | null)?.key;
    if (route.startsWith("/api/projects/:key") && key !== undefined) {
      const project = resolveProject(root, key);
      if (!project) return;
      const minimum = minimumProjectRole(route, request.method);
      if (
        !auth.hasProjectRole(project.projectId, session.user.id, minimum, session.user.instanceRole)
      ) {
        auth.audit(
          session.user.id,
          "authorization.denied",
          "project",
          project.projectId,
          { method: request.method, route, requiredRole: minimum },
          request.ip ?? null,
        );
        return await reply.code(403).send({
          error: minimum === "owner" ? "只有项目 Owner 可以执行此操作" : "你没有访问这个项目的权限",
          code: "PROJECT_ACCESS_DENIED",
        });
      }
    }
  });

  app.get("/api/auth/status", async (request): Promise<AuthStatus> => {
    if (options.mode !== "required") {
      return {
        enabled: false,
        configured: auth.configured(),
        mode: options.mode,
        user: null,
        csrfToken: null,
      };
    }
    const token = cookies(request.headers.cookie).get(sessionCookieName);
    const session = token ? auth.resolveSession(token) : null;
    return {
      enabled: true,
      configured: auth.configured(),
      mode: options.mode,
      user: session?.user ?? null,
      csrfToken: session?.csrfToken ?? null,
    };
  });

  async function establishSession(user: Account, request: FastifyRequest, reply: FastifyReply) {
    const session = auth.createSession(
      user.id,
      request.headers["user-agent"] ?? null,
      request.ip ?? null,
    );
    reply.header("set-cookie", sessionCookie(session.token, secureCookies));
    return { user: safeAccountPayload(user), csrfToken: session.csrfToken };
  }

  app.post("/api/auth/bootstrap", async (request, reply) => {
    if (options.mode !== "required")
      return await reply.code(409).send({ error: "当前未启用账号模式" });
    const body = bodyObject(request);
    try {
      const user = auth.createBootstrap(
        {
          email: cleanText(body.email, 254),
          name: cleanText(body.name, 120),
          password: typeof body.password === "string" ? body.password : "",
        },
        await existingProjectIds(root),
      );
      return await reply.code(201).send(await establishSession(user, request, reply));
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法完成初始设置";
      return await reply.code(message.includes("已完成") ? 409 : 400).send({ error: message });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    if (options.mode !== "required")
      return await reply.code(409).send({ error: "当前未启用账号模式" });
    const body = bodyObject(request);
    const result = auth.authenticate(
      cleanText(body.email, 254),
      typeof body.password === "string" ? body.password : "",
      request.ip ?? null,
    );
    if (result.rateLimited) {
      return await reply
        .header("retry-after", "60")
        .code(429)
        .send({ error: "尝试次数过多，请稍后再试" });
    }
    if (!result.user) return await reply.code(401).send({ error: "邮箱或密码不正确" });
    return await establishSession(result.user, request, reply);
  });

  app.get<{ Params: { token: string } }>("/api/auth/invitations/:token", async (request, reply) => {
    if (options.mode !== "required")
      return await reply.code(409).send({ error: "当前未启用账号模式" });
    const invitation = auth.invitationForToken(request.params.token);
    if (!invitation) return await reply.code(404).send({ error: "邀请不存在、已使用或已经过期" });
    return {
      invitation: {
        email: invitation.email,
        name: invitation.name,
        instanceRole: invitation.instanceRole,
        expiresAt: invitation.expiresAt,
      },
    };
  });

  app.post<{ Params: { token: string } }>(
    "/api/auth/invitations/:token",
    async (request, reply) => {
      if (options.mode !== "required")
        return await reply.code(409).send({ error: "当前未启用账号模式" });
      try {
        const user = auth.acceptInvitation(
          request.params.token,
          typeof bodyObject(request).password === "string"
            ? String(bodyObject(request).password)
            : "",
          request.ip ?? null,
        );
        if (!user) return await reply.code(404).send({ error: "邀请不存在、已使用或已经过期" });
        return await reply.code(201).send(await establishSession(user, request, reply));
      } catch (error) {
        const message = error instanceof Error ? error.message : "无法接受邀请";
        return await reply.code(message.includes("失效") ? 409 : 400).send({ error: message });
      }
    },
  );

  app.post("/api/auth/recover", async (request, reply) => {
    if (options.mode !== "required")
      return await reply.code(409).send({ error: "当前未启用账号模式" });
    const body = bodyObject(request);
    try {
      const result = auth.recoverPassword(
        cleanText(body.email, 254),
        cleanText(body.code, 128),
        typeof body.newPassword === "string" ? body.newPassword : "",
        request.ip ?? null,
      );
      if (result.rateLimited) {
        return await reply
          .header("retry-after", "60")
          .code(429)
          .send({ error: "尝试次数过多，请稍后再试" });
      }
      if (!result.recovered) return await reply.code(400).send({ error: "邮箱或恢复码不正确" });
      return { recovered: true, revokedSessions: true };
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法恢复账号" });
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const context = requireAuthContext(request);
    auth.revokeSession(context.user.id, context.sessionId);
    auth.audit(
      context.user.id,
      "auth.logout",
      "session",
      context.sessionId,
      {},
      request.ip ?? null,
    );
    return await reply
      .header("set-cookie", clearSessionCookie(secureCookies))
      .send({ loggedOut: true });
  });

  app.get("/api/auth/sessions", async (request) => {
    const context = requireAuthContext(request);
    return { sessions: auth.listSessions(context.user.id, context.sessionId) };
  });

  app.delete<{ Params: { sessionId: string } }>(
    "/api/auth/sessions/:sessionId",
    async (request, reply) => {
      const context = requireAuthContext(request);
      const revoked = auth.revokeSession(context.user.id, request.params.sessionId);
      if (!revoked) return await reply.code(404).send({ error: "会话不存在" });
      const current = request.params.sessionId === context.sessionId;
      if (current) reply.header("set-cookie", clearSessionCookie(secureCookies));
      return await reply.send({ revoked: true, current });
    },
  );

  app.patch("/api/auth/me", async (request, reply) => {
    const context = requireAuthContext(request);
    try {
      return {
        user: auth.updateProfile(context.user.id, cleanText(bodyObject(request).name, 120)),
      };
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法更新账号" });
    }
  });

  app.post("/api/auth/change-password", async (request, reply) => {
    const context = requireAuthContext(request);
    const body = bodyObject(request);
    try {
      const changed = auth.changePassword(
        context.user.id,
        typeof body.currentPassword === "string" ? body.currentPassword : "",
        typeof body.newPassword === "string" ? body.newPassword : "",
        context.sessionId,
        request.ip ?? null,
      );
      if (!changed) return await reply.code(400).send({ error: "当前密码不正确" });
      return { changed: true, revokedOtherSessions: true };
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法修改密码" });
    }
  });

  app.get("/api/auth/recovery-codes", async (request) => {
    const context = requireAuthContext(request);
    return { status: auth.recoveryCodeStatus(context.user.id) };
  });

  app.post("/api/auth/recovery-codes", async (request, reply) => {
    const context = requireAuthContext(request);
    const result = auth.generateRecoveryCodes(
      context.user.id,
      typeof bodyObject(request).currentPassword === "string"
        ? String(bodyObject(request).currentPassword)
        : "",
      request.ip ?? null,
    );
    if (!result) return await reply.code(400).send({ error: "当前密码不正确" });
    return result;
  });

  app.get("/api/admin/users", async () => ({ users: auth.listUsers() }));

  app.get("/api/admin/invitations", async () => ({ invitations: auth.listInvitations() }));

  app.post("/api/admin/invitations", async (request, reply) => {
    const context = requireAuthContext(request);
    const body = bodyObject(request);
    try {
      return await reply.code(201).send(
        auth.createInvitation(
          {
            email: cleanText(body.email, 254),
            name: cleanText(body.name, 120),
            instanceRole: body.instanceRole === "admin" ? "admin" : "member",
            ...(typeof body.expiresHours === "number" ? { expiresHours: body.expiresHours } : {}),
          },
          context.user.id,
          request.ip ?? null,
        ),
      );
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法创建邀请" });
    }
  });

  app.delete<{ Params: { invitationId: string } }>(
    "/api/admin/invitations/:invitationId",
    async (request, reply) => {
      const context = requireAuthContext(request);
      return auth.revokeInvitation(request.params.invitationId, context.user.id, request.ip ?? null)
        ? { revoked: true }
        : await reply.code(404).send({ error: "待处理邀请不存在" });
    },
  );

  app.get<{ Querystring: { limit?: string } }>("/api/admin/audit", async (request) => {
    const requested = Number.parseInt(request.query.limit ?? "100", 10);
    return { entries: auth.listAudit(Number.isFinite(requested) ? requested : 100) };
  });

  app.get("/api/admin/backups", async () => ({ backups: await listInstanceBackups(root) }));

  app.post("/api/admin/backups", async (request, reply) => {
    const context = requireAuthContext(request);
    try {
      const backup = await createInstanceBackup(root, auth);
      auth.audit(
        context.user.id,
        "backup.created",
        "instance_backup",
        backup.id,
        { projects: backup.projectCount, users: backup.userCount, size: backup.size },
        request.ip ?? null,
      );
      return await reply.code(201).send({ backup });
    } catch (error) {
      if (error instanceof InstanceBackupError)
        return await reply.code(error.statusCode).send({ error: error.message });
      request.log.error({ error }, "instance backup failed");
      return await reply
        .code(500)
        .send({ error: "无法创建实例备份，请检查可用磁盘空间和服务日志" });
    }
  });

  app.get<{ Params: { backupId: string } }>(
    "/api/admin/backups/:backupId/download",
    async (request, reply) => {
      const path = instanceBackupPath(root, request.params.backupId);
      if (!path) return await reply.code(400).send({ error: "备份标识无效" });
      try {
        const info = await stat(path);
        if (!info.isFile()) throw new Error("not a file");
      } catch {
        return await reply.code(404).send({ error: "备份不存在" });
      }
      return await reply
        .header("content-type", "application/gzip")
        .header("cache-control", "no-store")
        .header(
          "content-disposition",
          `attachment; filename="${request.params.backupId}.takeboard-instance.tgz"`,
        )
        .send(createReadStream(path));
    },
  );

  app.post("/api/admin/backups/inspect", async (request, reply) => {
    const uploadRoot = join(root, ".system", "restore-uploads");
    await mkdir(uploadRoot, { recursive: true, mode: 0o700 });
    const uploadPath = join(uploadRoot, `${randomUUID()}.tgz`);
    try {
      const part = await request.file({
        limits: { fileSize: 2 * 1024 * 1024 * 1024 * 1024, files: 1 },
      });
      if (!part) return await reply.code(400).send({ error: "请选择 TakeBoard 实例备份" });
      await pipeline(part.file, createWriteStream(uploadPath, { flags: "wx", mode: 0o600 }));
      if (part.file.truncated)
        return await reply.code(413).send({ error: "实例备份超过安全容量上限" });
      return { restore: await stageInstanceRestore(root, uploadPath) };
    } catch (error) {
      if (error instanceof InstanceBackupError)
        return await reply.code(error.statusCode).send({ error: error.message });
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法检查实例备份" });
    } finally {
      await rm(uploadPath, { force: true });
    }
  });

  app.post<{ Params: { restoreId: string } }>(
    "/api/admin/backups/restores/:restoreId/apply",
    async (request, reply) => {
      const context = requireAuthContext(request);
      const body = bodyObject(request);
      if (body.confirmation !== "RESTORE")
        return await reply.code(400).send({ error: "请输入 RESTORE 确认恢复" });
      if (
        !auth.verifyCurrentPassword(
          context.user.id,
          typeof body.currentPassword === "string" ? body.currentPassword : "",
        )
      )
        return await reply.code(400).send({ error: "当前密码不正确" });
      try {
        return await applyStagedProjectRestore(
          root,
          request.params.restoreId,
          auth,
          context.user.id,
        );
      } catch (error) {
        if (error instanceof InstanceBackupError)
          return await reply.code(error.statusCode).send({ error: error.message });
        return await reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : "无法恢复项目" });
      }
    },
  );

  app.delete<{ Params: { restoreId: string } }>(
    "/api/admin/backups/restores/:restoreId",
    async (request, reply) =>
      (await removeStagedRestore(root, request.params.restoreId))
        ? { removed: true }
        : await reply.code(404).send({ error: "恢复会话不存在" }),
  );

  app.post("/api/admin/users", async (request, reply) => {
    const context = requireAuthContext(request);
    const body = bodyObject(request);
    try {
      const user = auth.createUser(
        {
          email: cleanText(body.email, 254),
          name: cleanText(body.name, 120),
          password: typeof body.password === "string" ? body.password : "",
          instanceRole: body.instanceRole === "admin" ? "admin" : "member",
        },
        context.user.id,
        request.ip ?? null,
      );
      return await reply.code(201).send({ user });
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法创建成员";
      return await reply
        .code(message.includes("UNIQUE") ? 409 : 400)
        .send({ error: message.includes("UNIQUE") ? "这个邮箱已经存在" : message });
    }
  });

  app.patch<{ Params: { userId: string } }>("/api/admin/users/:userId", async (request, reply) => {
    const context = requireAuthContext(request);
    const body = bodyObject(request);
    const status = body.status === "active" || body.status === "disabled" ? body.status : undefined;
    const instanceRole: InstanceRole | undefined =
      body.instanceRole === "admin" || body.instanceRole === "member"
        ? body.instanceRole
        : undefined;
    try {
      return {
        user: auth.updateUser(
          context.user.id,
          request.params.userId,
          {
            ...(status === undefined ? {} : { status }),
            ...(instanceRole === undefined ? {} : { instanceRole }),
          },
          request.ip ?? null,
        ),
      };
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法更新成员" });
    }
  });

  app.get<{ Params: { key: string } }>("/api/projects/:key/members", async (request, reply) => {
    const project = resolveProject(root, request.params.key);
    if (!project) return await reply.code(404).send({ error: "项目不存在" });
    return {
      members: auth.listProjectMembers(project.projectId),
      directory: auth.listUsers().filter((user) => user.status === "active"),
    };
  });

  app.put<{ Params: { key: string; userId: string } }>(
    "/api/projects/:key/members/:userId",
    async (request, reply) => {
      const context = requireAuthContext(request);
      const project = resolveProject(root, request.params.key);
      if (!project) return await reply.code(404).send({ error: "项目不存在" });
      const role = bodyObject(request).role;
      if (role !== "owner" && role !== "editor" && role !== "viewer")
        return await reply.code(400).send({ error: "项目角色无效" });
      try {
        return {
          members: auth.setProjectMember(
            project.projectId,
            request.params.userId,
            role,
            context.user.id,
            request.ip ?? null,
          ),
        };
      } catch (error) {
        return await reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : "无法更新项目成员" });
      }
    },
  );

  app.delete<{ Params: { key: string; userId: string } }>(
    "/api/projects/:key/members/:userId",
    async (request, reply) => {
      const context = requireAuthContext(request);
      const project = resolveProject(root, request.params.key);
      if (!project) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const removed = auth.removeProjectMember(
          project.projectId,
          request.params.userId,
          context.user.id,
          request.ip ?? null,
        );
        return removed
          ? { removed: true, members: auth.listProjectMembers(project.projectId) }
          : await reply.code(404).send({ error: "项目成员不存在" });
      } catch (error) {
        return await reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : "无法移除项目成员" });
      }
    },
  );

  return auth;
}
