import type { FastifyInstance } from "fastify";
import { DemoService } from "./demo-service.js";

function recordBody(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
}

function nonEmptyString(value: unknown, maxLength = 10_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function registerDemoRoutes(app: FastifyInstance, projectDirectory: string) {
  const service = new DemoService(projectDirectory);

  app.get("/api/demo/project", async () => await service.get());
  app.post("/api/demo/reset", async () => await service.reset());

  app.patch("/api/demo/canvas-position", async (request, reply) => {
    const input = recordBody(request.body);
    if (
      !input ||
      !nonEmptyString(input.itemId) ||
      typeof input.x !== "number" ||
      !Number.isFinite(input.x) ||
      typeof input.y !== "number" ||
      !Number.isFinite(input.y)
    ) {
      return await reply.code(400).send({ error: "Invalid canvas position" });
    }
    return await service.moveCanvasItem(input.itemId, { x: input.x, y: input.y });
  });

  app.post("/api/demo/generate", async (request, reply) => {
    const input = recordBody(request.body);
    if (!input || !nonEmptyString(input.shotId)) {
      return await reply.code(400).send({ error: "Invalid shot" });
    }
    try {
      return await service.generate(input.shotId);
    } catch (error) {
      return await reply.code(404).send({
        error: error instanceof Error ? error.message : "Generation failed",
      });
    }
  });

  app.post("/api/demo/reject", async (request, reply) => {
    const input = recordBody(request.body);
    if (!input || !nonEmptyString(input.takeId) || !nonEmptyString(input.reason, 200)) {
      return await reply.code(400).send({ error: "Invalid rejection" });
    }
    try {
      return await service.rejectTake(input.takeId, input.reason.trim());
    } catch (error) {
      return await reply.code(409).send({
        error: error instanceof Error ? error.message : "Rejection failed",
      });
    }
  });

  app.post("/api/demo/approve", async (request, reply) => {
    const input = recordBody(request.body);
    const reasonValid =
      input?.reason === null || input?.reason === undefined || typeof input.reason === "string";
    if (!input || !nonEmptyString(input.takeId) || !reasonValid) {
      return await reply.code(400).send({ error: "Invalid approval" });
    }
    try {
      const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 2_000) : null;
      return await service.approve(input.takeId, reason || null);
    } catch (error) {
      return await reply.code(409).send({
        error: error instanceof Error ? error.message : "Approval failed",
      });
    }
  });
}
