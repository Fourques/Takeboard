import type { FastifyInstance } from "fastify";

export function registerWorkerRoutes(app: FastifyInstance, comfyUrl: string) {
  app.get("/api/workers/comfy", async (_request, reply) => {
    try {
      const response = await fetch(`${comfyUrl}/system_stats`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new Error(`ComfyUI returned ${response.status}`);
      const payload = (await response.json()) as {
        system?: { comfyui_version?: string };
        devices?: Array<{ name?: string; vram_total?: number; vram_free?: number }>;
      };
      const device = payload.devices?.[0];
      return {
        status: "ready",
        engine: "ComfyUI",
        version: payload.system?.comfyui_version ?? "unknown",
        device: device?.name ?? "GPU",
        vramTotal: device?.vram_total ?? null,
        vramFree: device?.vram_free ?? null,
      };
    } catch (error) {
      return await reply.code(503).send({
        status: "offline",
        engine: "ComfyUI",
        error: error instanceof Error ? error.message : "Worker unavailable",
      });
    }
  });
}
