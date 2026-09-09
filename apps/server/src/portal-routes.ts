import type { FastifyInstance, FastifyRequest } from "fastify";
import { authContext, requireAuthContext } from "./auth-routes.js";
import type { PortalConnector } from "./portal-connector.js";

function bodyObject(request: FastifyRequest) {
  return typeof request.body === "object" && request.body !== null
    ? (request.body as Record<string, unknown>)
    : {};
}

export function registerPortalRoutes(app: FastifyInstance, connector: PortalConnector) {
  app.get("/api/portal/status", async (request) => {
    const context = authContext(request);
    return {
      ...connector.status(),
      canManage: context?.user.instanceRole === "admin",
    };
  });

  app.post("/api/admin/portal/pairing", async (request, reply) => {
    if (!["required", "optional"].includes(connector.authMode())) {
      return await reply
        .code(409)
        .send({ error: "账号门户需要启用账号功能，并由管理员登录后配对" });
    }
    const context = requireAuthContext(request);
    const portalUrl = bodyObject(request).portalUrl;
    if (typeof portalUrl !== "string" || portalUrl.length > 2_048) {
      return await reply.code(400).send({ error: "请输入有效的门户地址" });
    }
    try {
      return await reply
        .code(201)
        .send({ ...(await connector.beginPairing(portalUrl, context.user.id)), canManage: true });
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法发起门户配对" });
    }
  });

  app.delete("/api/admin/portal", async (request, reply) => {
    if (!["required", "optional"].includes(connector.authMode())) {
      return await reply
        .code(409)
        .send({ error: "账号门户需要启用账号功能，并由管理员登录后操作" });
    }
    const context = requireAuthContext(request);
    return { ...(await connector.disconnect(context.user.id)), canManage: true };
  });
}
