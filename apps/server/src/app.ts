import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDemoRoutes } from "./demo/routes.js";

export type AppOptions = {
  demoDirectory?: string;
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

  return app;
}
