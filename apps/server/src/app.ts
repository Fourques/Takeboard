import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDemoRoutes } from "./demo/routes.js";
import { registerGenerationRoutes } from "./generation-routes.js";
import { registerProjectCommandRoutes } from "./project-command-routes.js";
import { registerProjectRequestLock } from "./project-request-lock.js";
import { registerProjectRoutes } from "./project-routes.js";
import { type RequestSecurityOptions, registerRequestSecurity } from "./request-security.js";
import { registerWorkerRoutes, type WorkerRouteOptions } from "./worker-routes.js";
import { registerWorkflowRoutes } from "./workflow-routes.js";

export const takeBoardVersion = "0.1.0";

export type AppOptions = {
  demoDirectory?: string;
  projectsRoot?: string;
  comfyUrl?: string;
  comfyEditorUrl?: string;
  comfyInputRoot?: string | null;
  comfyOutputRoot?: string | null;
  workerOptions?: WorkerRouteOptions;
  webRoot?: string | null;
  requestSecurity?: RequestSecurityOptions;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    bodyLimit: 110 * 1024 * 1024,
  });
  void app.register(fastifyMultipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  });
  registerRequestSecurity(app, options.requestSecurity);

  app.get("/api/health", async () => ({
    service: "takeboard-server",
    status: "ok",
    version: takeBoardVersion,
    instanceId: process.env.TAKEBOARD_INSTANCE_ID ?? null,
  }));

  registerProjectRequestLock(app);

  registerDemoRoutes(
    app,
    options.demoDirectory ??
      resolve(process.env.TAKEBOARD_DEMO_DIRECTORY ?? ".takeboard-data/demo.takeboard"),
  );
  const projectsRoot =
    options.projectsRoot ?? resolve(process.env.TAKEBOARD_DATA_ROOT ?? ".takeboard-data/projects");
  const comfyUrl = options.comfyUrl ?? process.env.COMFY_URL ?? "http://127.0.0.1:8188";
  const comfyInputRoot = options.comfyInputRoot ?? process.env.COMFY_INPUT_ROOT ?? null;
  const comfyOutputRoot = options.comfyOutputRoot ?? process.env.COMFY_OUTPUT_ROOT ?? null;
  registerProjectRoutes(app, projectsRoot, {
    comfyUrl,
    comfyInputRoot,
    comfyOutputRoot,
  });
  registerProjectCommandRoutes(app, projectsRoot);
  registerWorkerRoutes(app, comfyUrl, options.workerOptions);
  registerGenerationRoutes(app, projectsRoot, comfyUrl, {
    inputRoot: comfyInputRoot,
    outputRoot: comfyOutputRoot,
  });
  registerWorkflowRoutes(
    app,
    comfyUrl,
    options.comfyEditorUrl ?? process.env.COMFY_EDITOR_URL ?? "http://127.0.0.1:48188",
    projectsRoot,
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
