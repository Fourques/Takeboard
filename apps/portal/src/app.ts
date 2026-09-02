import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import { tokenDigest } from "@takeboard/identity";
import Fastify, { type FastifyRequest } from "fastify";
import { WebSocketServer } from "ws";
import { PortalRelay } from "./portal-relay.js";
import { PortalStore } from "./portal-store.js";

const portalCookie = "takeboard_portal_session";
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type PortalOptions = {
  databasePath: string;
  hostname: string;
  publicOrigin: string;
  webRoot?: string | null;
  secureCookies?: boolean;
  allowRegistration?: boolean;
  masterKey?: string;
  bootstrapToken?: string;
  auditRetentionDays?: number;
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function bodyObject(request: FastifyRequest) {
  return typeof request.body === "object" && request.body !== null && !Buffer.isBuffer(request.body)
    ? (request.body as Record<string, unknown>)
    : {};
}

function cookies(value: string | undefined) {
  const result = new Map<string, string>();
  for (const part of (value ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    try {
      result.set(
        part.slice(0, separator).trim(),
        decodeURIComponent(part.slice(separator + 1).trim()),
      );
    } catch {
      // Ignore malformed cookies.
    }
  }
  return result;
}

function sessionCookie(token: string, options: PortalOptions, maxAge = 7 * 24 * 60 * 60) {
  const shareAcrossSubdomains =
    options.hostname !== "localhost" &&
    isIP(options.hostname) === 0 &&
    options.hostname.includes(".");
  return [
    `${portalCookie}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(options.secureCookies ? ["Secure"] : []),
    ...(shareAcrossSubdomains ? [`Domain=.${options.hostname}`] : []),
  ].join("; ");
}

function requestHostname(request: FastifyRequest) {
  return (request.headers.host ?? "").split(":", 1)[0]?.toLowerCase() ?? "";
}

function deviceSlug(request: FastifyRequest, hostname: string) {
  const requested = requestHostname(request);
  const suffix = `.${hostname.toLowerCase()}`;
  if (!requested.endsWith(suffix)) return null;
  const slug = requested.slice(0, -suffix.length);
  return /^[a-z0-9]{6,32}$/.test(slug) ? slug : null;
}

function remoteOrigin(publicOrigin: string, hostname: string, slug: string) {
  const url = new URL(publicOrigin);
  url.hostname = `${slug}.${hostname}`;
  return url.origin;
}

export function buildPortal(options: PortalOptions) {
  const configuredOrigin = new URL(options.publicOrigin);
  if (
    configuredOrigin.hostname !== options.hostname.toLowerCase() ||
    configuredOrigin.username ||
    configuredOrigin.password ||
    configuredOrigin.pathname !== "/" ||
    configuredOrigin.search ||
    configuredOrigin.hash
  ) {
    throw new Error("TAKEBOARD_PORTAL_ORIGIN 必须是不含路径或凭据且与 HOSTNAME 一致的 Origin");
  }
  const loopbackPortal = ["localhost", "127.0.0.1", "::1"].includes(options.hostname);
  if (configuredOrigin.protocol !== "https:" && !loopbackPortal) {
    throw new Error("公网门户必须使用 HTTPS");
  }
  if (configuredOrigin.protocol === "https:" && options.secureCookies !== true) {
    throw new Error("HTTPS 门户必须启用 TAKEBOARD_PORTAL_SECURE_COOKIES");
  }
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    bodyLimit: 110 * 1024 * 1024,
    trustProxy: ["127.0.0.1", "::1"],
  });
  const store = new PortalStore(
    options.databasePath,
    options.masterKey,
    options.auditRetentionDays ?? 180,
  );
  if (!loopbackPortal && !store.configured() && (options.bootstrapToken?.length ?? 0) < 24) {
    store.close();
    throw new Error("公网门户首次启动必须设置至少 24 字符的 TAKEBOARD_PORTAL_BOOTSTRAP_TOKEN");
  }
  const relay = new PortalRelay(store);
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addHook("onRequest", async (request, reply) => {
    const requested = requestHostname(request);
    const allowed =
      requested === options.hostname.toLowerCase() ||
      requested.endsWith(`.${options.hostname.toLowerCase()}`);
    if (!allowed) return await reply.code(421).send({ error: "门户主机名不受信任" });
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (requested === options.hostname.toLowerCase()) {
      reply.header(
        "content-security-policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    }
  });

  const sessionFor = (request: FastifyRequest) => {
    const token = cookies(request.headers.cookie).get(portalCookie);
    return token ? store.resolveSession(token) : null;
  };

  function requireSession(request: FastifyRequest) {
    const session = sessionFor(request);
    if (!session) return null;
    if (unsafeMethods.has(request.method)) {
      const csrf = request.headers["x-takeboard-portal-csrf"];
      if (typeof csrf !== "string" || csrf !== session.csrfToken) return null;
    }
    return session;
  }

  app.get("/__portal/api/health", async () => ({
    service: "takeboard-portal",
    status: "ok",
    registration: options.allowRegistration === true,
  }));

  app.get("/__portal/api/auth/status", async (request) => {
    const session = sessionFor(request);
    return {
      configured: store.configured(),
      bootstrapRequired: !store.configured() && !loopbackPortal,
      registration: options.allowRegistration === true,
      user: session?.user ?? null,
      csrfToken: session?.csrfToken ?? null,
    };
  });

  app.post("/__portal/api/auth/register", async (request, reply) => {
    const body = bodyObject(request);
    if (
      !store.configured() &&
      !loopbackPortal &&
      tokenDigest(typeof body.setupToken === "string" ? body.setupToken : "") !==
        tokenDigest(options.bootstrapToken ?? "")
    ) {
      return await reply.code(403).send({ error: "首次设置密钥不正确" });
    }
    try {
      const user = store.register(
        {
          email: cleanText(body.email, 254),
          name: cleanText(body.name, 120),
          password: typeof body.password === "string" ? body.password : "",
        },
        options.allowRegistration === true,
      );
      const session = store.createSession(
        user.id,
        request.ip ?? null,
        request.headers["user-agent"] ?? null,
      );
      reply.header("set-cookie", sessionCookie(session.token, options));
      return await reply.code(201).send({ user, csrfToken: session.csrfToken });
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法注册门户账号" });
    }
  });

  app.post("/__portal/api/auth/login", async (request, reply) => {
    const body = bodyObject(request);
    const result = store.authenticate(
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
    const session = store.createSession(
      result.user.id,
      request.ip ?? null,
      request.headers["user-agent"] ?? null,
    );
    reply.header("set-cookie", sessionCookie(session.token, options));
    return { user: result.user, csrfToken: session.csrfToken };
  });

  app.post("/__portal/api/auth/logout", async (request, reply) => {
    const session = requireSession(request);
    if (!session) return await reply.code(403).send({ error: "登录或安全令牌已失效" });
    store.revokeSession(session.sessionId, session.user.id);
    store.audit(
      session.user.id,
      "portal.logout",
      "portal_session",
      session.sessionId,
      {},
      request.ip,
    );
    reply.header("set-cookie", sessionCookie("", options, 0));
    return { loggedOut: true };
  });

  app.post("/__portal/connect/pairings", async (request, reply) => {
    const body = bodyObject(request);
    try {
      return await reply.code(201).send(
        store.startPairing(
          {
            instanceId: cleanText(body.instanceId, 100),
            instanceName: cleanText(body.instanceName, 120),
            applicationVersion: cleanText(body.applicationVersion, 64),
          },
          request.ip ?? null,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法创建配对";
      return await reply.code(message.includes("过多") ? 429 : 400).send({ error: message });
    }
  });

  app.get<{ Params: { pairingId: string } }>(
    "/__portal/connect/pairings/:pairingId",
    async (request, reply) => {
      const authorization = request.headers.authorization;
      const secret = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      const status = store.pairingStatus(request.params.pairingId, secret);
      if (!status) return await reply.code(404).send({ error: "配对不存在" });
      return status.state === "paired"
        ? {
            ...status,
            remoteUrl: remoteOrigin(options.publicOrigin, options.hostname, status.slug),
          }
        : status;
    },
  );

  app.post("/__portal/connect/revoke", async (request, reply) => {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const instanceId = cleanText(bodyObject(request).instanceId, 100);
    const device = store.authenticateDevice(instanceId, token);
    if (!device) return await reply.code(401).send({ error: "设备凭据无效或已经撤销" });
    store.revokeDeviceSelf(device.id);
    relay.revoke(device.id);
    return { revoked: true };
  });

  app.post("/__portal/api/pairings/claim", async (request, reply) => {
    const session = requireSession(request);
    if (!session) return await reply.code(403).send({ error: "登录或安全令牌已失效" });
    try {
      return {
        device: store.claimPairing(
          cleanText(bodyObject(request).code, 32),
          session.user.id,
          request.ip,
        ),
      };
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法认领工作站" });
    }
  });

  app.get("/__portal/api/devices", async (request, reply) => {
    const session = requireSession(request);
    if (!session) return await reply.code(401).send({ error: "请先登录" });
    return {
      devices: store.listDevices(session.user.id, relay.onlineDeviceIds()).map((device) => ({
        ...device,
        remoteUrl: remoteOrigin(options.publicOrigin, options.hostname, device.slug),
      })),
    };
  });

  app.delete<{ Params: { deviceId: string } }>(
    "/__portal/api/devices/:deviceId",
    async (request, reply) => {
      const session = requireSession(request);
      if (!session) return await reply.code(403).send({ error: "登录或安全令牌已失效" });
      if (!store.revokeDevice(request.params.deviceId, session.user.id, request.ip)) {
        return await reply.code(404).send({ error: "设备不存在或已经撤销" });
      }
      relay.revoke(request.params.deviceId);
      return { revoked: true };
    },
  );

  app.get<{ Querystring: { limit?: string } }>("/__portal/api/activity", async (request, reply) => {
    const session = requireSession(request);
    if (!session) return await reply.code(401).send({ error: "请先登录" });
    const limit = Number.parseInt(request.query.limit ?? "100", 10);
    return { entries: store.listAudit(session.user.id, Number.isFinite(limit) ? limit : 100) };
  });

  const upgrade = (
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    const url = new URL(request.url ?? "/", options.publicOrigin);
    if (url.pathname !== "/__portal/connect/socket") return;
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    const instanceId = url.searchParams.get("instanceId") ?? "";
    const device = store.authenticateDevice(instanceId, token);
    if (!device) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) =>
      relay.attach(websocket, device),
    );
  };
  app.server.on("upgrade", upgrade);

  const webRoot = options.webRoot ? resolve(options.webRoot) : null;
  const portalIndexPath = webRoot ? resolve(webRoot, "index.html") : null;
  const portalIndex =
    portalIndexPath && existsSync(portalIndexPath) ? readFileSync(portalIndexPath) : null;
  if (webRoot && portalIndex) {
    void app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/__portal/assets/",
    });
  }

  const proxyOrPortal = async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    const slug = deviceSlug(request, options.hostname);
    if (slug) {
      const session = sessionFor(request);
      if (!session) {
        if (request.method === "GET" && (request.headers.accept ?? "").includes("text/html")) {
          return await reply.redirect(
            `${options.publicOrigin}/?device=${encodeURIComponent(slug)}`,
          );
        }
        return await reply.code(401).send({ error: "门户登录已过期，请重新登录" });
      }
      const device = store.deviceBySlug(slug, session.user.id);
      if (!device) return await reply.code(404).send({ error: "工作站不存在或无权访问" });
      if (request.method === "GET" && request.url === "/") {
        store.audit(
          session.user.id,
          "device.remote_opened",
          "portal_device",
          device.id,
          {},
          request.ip,
        );
      }
      return await relay.forward(device, session, request, reply);
    }
    if (request.url.startsWith("/__portal/"))
      return await reply.code(404).send({ error: "Not Found" });
    if (portalIndex) return await reply.type("text/html; charset=utf-8").send(portalIndex);
    return await reply.code(404).send({ error: "Portal UI is not configured" });
  };
  app.get("/", proxyOrPortal);
  app.all("/*", proxyOrPortal);

  app.addHook("onClose", async () => {
    app.server.off("upgrade", upgrade);
    relay.close();
    websocketServer.close();
    store.close();
  });

  return app;
}
