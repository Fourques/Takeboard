import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { type AuthOptions, registerAuth } from "./auth-routes.js";
import type { AuthMode } from "./auth-service.js";
import { type BackupAutomationConfig, registerBackupAutomation } from "./backup-automation.js";
import { registerDemoRoutes } from "./demo/routes.js";
import { registerExtensionRoutes } from "./extension-routes.js";
import { registerGenerationRoutes } from "./generation-routes.js";
import { registerOperationsRoutes } from "./operations-routes.js";
import { registerProjectCommandRoutes } from "./project-command-routes.js";
import { registerProjectRequestLock } from "./project-request-lock.js";
import { registerProjectRoutes } from "./project-routes.js";
import { type RequestSecurityOptions, registerRequestSecurity } from "./request-security.js";
import { WorkerPool } from "./worker-pool.js";
import { registerWorkerRoutes, type WorkerRouteOptions } from "./worker-routes.js";
import { registerWorkflowRoutes } from "./workflow-routes.js";

export const takeBoardVersion = "0.2.0-beta.1";

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
  auth?: Partial<AuthOptions> & { mode?: AuthMode };
  backupAutomation?: BackupAutomationConfig | false;
};

export function authModeFromEnvironment(): AuthMode {
  const configured = process.env.TAKEBOARD_AUTH_MODE;
  if (configured === "off" || configured === "trusted_local" || configured === "required") {
    return configured;
  }
  return process.env.NODE_ENV === "test" ? "off" : "required";
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    bodyLimit: 110 * 1024 * 1024,
  });
  void app.register(fastifyMultipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  });
  registerRequestSecurity(app, options.requestSecurity);

  const projectsRoot =
    options.projectsRoot ?? resolve(process.env.TAKEBOARD_DATA_ROOT ?? ".takeboard-data/projects");
  const auth = registerAuth(app, {
    mode: options.auth?.mode ?? authModeFromEnvironment(),
    databasePath:
      options.auth?.databasePath ??
      resolve(process.env.TAKEBOARD_AUTH_DATABASE ?? projectsRoot, ".system", "auth.db"),
    projectsRoot,
    ...(options.auth?.secureCookies === undefined
      ? {}
      : { secureCookies: options.auth.secureCookies }),
  });

  app.get("/api/health", async () => ({
    service: "takeboard-server",
    status: "ok",
    version: takeBoardVersion,
    instanceId: process.env.TAKEBOARD_INSTANCE_ID ?? null,
  }));

  const backupAutomation =
    options.backupAutomation === false ||
    (options.backupAutomation === undefined && process.env.NODE_ENV === "test")
      ? null
      : registerBackupAutomation(app, projectsRoot, auth, options.backupAutomation);

  registerProjectRequestLock(app, projectsRoot);

  registerDemoRoutes(
    app,
    options.demoDirectory ??
      resolve(process.env.TAKEBOARD_DEMO_DIRECTORY ?? ".takeboard-data/demo.takeboard"),
  );
  const comfyUrl = options.comfyUrl ?? process.env.COMFY_URL ?? "http://127.0.0.1:8188";
  const comfyInputRoot = options.comfyInputRoot ?? process.env.COMFY_INPUT_ROOT ?? null;
  const comfyOutputRoot = options.comfyOutputRoot ?? process.env.COMFY_OUTPUT_ROOT ?? null;
  const webRoot = options.webRoot ?? process.env.TAKEBOARD_WEB_ROOT ?? null;
  const workerPool = new WorkerPool(
    resolve(projectsRoot, ".system", "workers.json"),
    comfyUrl,
    options.workerOptions?.runtime?.fetch,
  );
  registerProjectRoutes(app, projectsRoot, {
    comfyUrl,
    comfyInputRoot,
    comfyOutputRoot,
    auth,
    workerPool,
  });
  registerOperationsRoutes(app, projectsRoot, auth, {
    version: takeBoardVersion,
    comfyUrl,
    webRoot,
    backupAutomation,
  });
  registerProjectCommandRoutes(app, projectsRoot);
  registerExtensionRoutes(app, projectsRoot);
  registerWorkerRoutes(app, comfyUrl, options.workerOptions, workerPool);
  registerGenerationRoutes(app, projectsRoot, workerPool, {
    inputRoot: comfyInputRoot,
    outputRoot: comfyOutputRoot,
  });
  registerWorkflowRoutes(
    app,
    comfyUrl,
    options.comfyEditorUrl ?? process.env.COMFY_EDITOR_URL ?? "http://127.0.0.1:48188",
    projectsRoot,
  );

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
