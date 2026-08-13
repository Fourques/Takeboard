import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDemoRoutes } from "./demo/routes.js";

export type AppOptions = {
  demoDirectory?: string;
  webRoot?: string | null;
};

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
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
