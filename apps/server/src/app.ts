import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDemoRoutes } from "./demo/routes.js";
import { registerGenerationRoutes } from "./generation-routes.js";
import { registerProjectRoutes } from "./project-routes.js";
import { registerWorkerRoutes } from "./worker-routes.js";
import { registerWorkflowRoutes } from "./workflow-routes.js";

export type AppOptions = {
  demoDirectory?: string;
  projectsRoot?: string;
  comfyUrl?: string;
  comfyEditorUrl?: string;
  webRoot?: string | null;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });
  void app.register(fastifyMultipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  });

  app.get("/api/health", async () => ({
    service: "takeboard-server",
    status: "ok",
    version: "0.0.0",
  }));

  registerDemoRoutes(
    app,
    options.demoDirectory ??
      resolve(process.env.TAKEBOARD_DEMO_DIRECTORY ?? ".takeboard-data/demo.takeboard"),
  );
  const projectsRoot =
    options.projectsRoot ?? resolve(process.env.TAKEBOARD_DATA_ROOT ?? ".takeboard-data/projects");
  const comfyUrl = options.comfyUrl ?? process.env.COMFY_URL ?? "http://127.0.0.1:8188";
  registerProjectRoutes(app, projectsRoot);
  registerWorkerRoutes(app, comfyUrl);
  registerGenerationRoutes(app, projectsRoot, comfyUrl);
  registerWorkflowRoutes(
    app,
    comfyUrl,
    options.comfyEditorUrl ?? process.env.COMFY_EDITOR_URL ?? "http://127.0.0.1:48188",
  );

  const webRoot = options.webRoot ?? process.env.TAKEBOARD_WEB_ROOT ?? null;
  if (webRoot && existsSync(resolve(webRoot, "index.html"))) {
    void app.register(fastifyStatic, {
      root: resolve(webRoot),
      wildcard: false,
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return await reply.sendFile("index.html");
      }
      return await reply.code(404).send({ error: "Not Found" });
    });
  }

  return app;
}
