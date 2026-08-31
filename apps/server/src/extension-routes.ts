import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { ExtensionRegistry } from "./extension-registry.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";

export function registerExtensionRoutes(app: FastifyInstance, projectsRoot: string) {
  const root = resolve(projectsRoot);
  const registry = new ExtensionRegistry(join(root, ".system", "extensions.json"));

  app.get("/api/extensions", async () => ({
    runtime: "declarative-v1" as const,
    codeExecutionAllowed: false as const,
    extensions: registry.list(),
  }));

  app.post("/api/extensions/inspect", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    try {
      return registry.inspect(body.manifest);
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "扩展清单无效" });
    }
  });

  app.post("/api/admin/extensions", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    try {
      const extension = await registry.install(
        body.manifest,
        typeof body.confirmationToken === "string" ? body.confirmationToken : "",
      );
      return await reply.code(201).send({ extension });
    } catch (error) {
      return await reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : "无法安装扩展" });
    }
  });

  app.patch<{ Params: { extensionId: string } }>(
    "/api/admin/extensions/:extensionId",
    async (request, reply) => {
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      if (typeof body.enabled !== "boolean") {
        return await reply.code(400).send({ error: "扩展启用状态无效" });
      }
      try {
        return { extension: await registry.setEnabled(request.params.extensionId, body.enabled) };
      } catch (error) {
        return await reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : "无法更新扩展" });
      }
    },
  );

  app.delete<{ Params: { extensionId: string } }>(
    "/api/admin/extensions/:extensionId",
    async (request, reply) => {
      const removed = await registry.remove(request.params.extensionId);
      return removed ? { removed: true } : await reply.code(404).send({ error: "扩展不存在" });
    },
  );

  app.get<{ Params: { key: string } }>(
    "/api/projects/:key/extensions/qc",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        return { key, revision: current.revision, checks: registry.evaluate(current.snapshot) };
      } finally {
        store.close();
      }
    },
  );
}
