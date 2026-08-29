import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Account, AuthStatus, InstanceRole, ProjectRole } from "@takeboard/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type AuthMode, AuthService } from "./auth-service.js";
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
  return (route === "/api/auth/bootstrap" || route === "/api/auth/login") && method === "POST";
}

function adminOnly(route: string, method: string) {
  if (route.startsWith("/api/admin/")) return true;
  if (route === "/api/workers/comfy/start") return true;
  if (route.startsWith("/api/workflows/") && method !== "GET") return true;
  return false;
}

function minimumProjectRole(route: string, method: string): ProjectRole {
  if (route.includes("/members")) return "owner";
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

  app.get("/api/admin/users", async () => ({ users: auth.listUsers() }));

  app.get<{ Querystring: { limit?: string } }>("/api/admin/audit", async (request) => {
    const requested = Number.parseInt(request.query.limit ?? "100", 10);
    return { entries: auth.listAudit(Number.isFinite(requested) ? requested : 100) };
  });

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
