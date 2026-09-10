import { resolve } from "node:path";
import {
  projectCommandEnvelopeSchema,
  projectCommandPreviewRequestSchema,
} from "@takeboard/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ProjectCommandError, ProjectCommandService } from "./project-command-service.js";
import { projectDirectory } from "./project-locations.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";

function sendCommandError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProjectCommandError) {
    return reply.code(error.statusCode).send({ error: error.message, ...error.details });
  }
  throw error;
}

export function registerProjectCommandRoutes(app: FastifyInstance, projectsRoot: string) {
  const root = resolve(projectsRoot);
  const commands = new ProjectCommandService();

  // Released Web clients already use /commands. Keep only an explicit migration
  // response for external scripts; never silently translate destructive writes.
  const retiredRoutes = [
    ["POST", "shots"],
    ["DELETE", "shots/:shotId"],
    ["POST", "text-nodes"],
    ["POST", "canvas-connections"],
    ["DELETE", "canvas-connections"],
    ["DELETE", "canvas-connections/:edgeId"],
    ["PATCH", "canvas-position"],
    ["POST", "canvas-items"],
    ["POST", "canvas-items/:itemId/duplicate"],
    ["PATCH", "canvas-items/:itemId"],
    ["DELETE", "canvas-items/:itemId"],
  ] as const;
  for (const [method, path] of retiredRoutes) {
    app.route({
      method,
      url: `/api/projects/:key/${path}`,
      handler: async (_request, reply) =>
        reply.code(410).send({
          code: "LEGACY_CANVAS_API_RETIRED",
          error: "旧画布接口已停用，请使用项目 commands 接口；需要确认的操作请先预览。",
          replacement: "/api/projects/:key/commands",
          preview: "/api/projects/:key/commands/preview",
        }),
    });
  }

  app.post<{ Params: { key: string } }>(
    "/api/projects/:key/commands/preview",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const parsed = projectCommandPreviewRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return await reply.code(400).send({
          error: "操作参数无效",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        });
      }
      const store = ProjectStore.openExisting(projectDirectory(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        return { key, preview: commands.preview(store, parsed.data) };
      } catch (error) {
        return await sendCommandError(reply, error);
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string } }>("/api/projects/:key/commands", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const parsed = projectCommandEnvelopeSchema.safeParse(request.body);
    if (!parsed.success) {
      return await reply.code(400).send({
        error: "操作参数无效",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      });
    }
    const store = ProjectStore.openExisting(projectDirectory(root, key));
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    try {
      const execution = await commands.execute(store, parsed.data);
      return {
        key,
        ...execution,
        ...execution.result,
      };
    } catch (error) {
      return await sendCommandError(reply, error);
    } finally {
      store.close();
    }
  });

  app.get<{ Params: { key: string }; Querystring: { limit?: string } }>(
    "/api/projects/:key/audit",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const store = ProjectStore.openExisting(projectDirectory(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        const parsedLimit = Number.parseInt(request.query.limit ?? "50", 10);
        const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
        return {
          key,
          revision: current.revision,
          entries: store.listCommands(current.snapshot.project.id, limit),
        };
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string; commandId: string } }>(
    "/api/projects/:key/commands/:commandId/undo",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const store = ProjectStore.openExisting(projectDirectory(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const execution = await commands.undo(store, request.params.commandId);
        return { key, ...execution, ...execution.result };
      } catch (error) {
        return await sendCommandError(reply, error);
      } finally {
        store.close();
      }
    },
  );
}
