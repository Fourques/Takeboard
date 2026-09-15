import { Readable } from "node:stream";
import multipart from "@fastify/multipart";
import type { ComfyPrompt } from "@takeboard/executor-comfy";
import Fastify from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import type { SameGpuPool } from "./same-gpu-pool.js";

/** Loopback Comfy-compatible entrance. Remote clients use the existing SSH tunnel UI. */
export function createGpuGateway(pool: SameGpuPool) {
  const app = Fastify({ bodyLimit: 110 * 1024 * 1024 });
  void app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
      return reply.code(403).send({ error: "这个入口仅供 TakeBoard 服务端连接" });
    const host = request.headers.host?.split(":")[0];
    if (host !== "127.0.0.1" && host !== "localhost")
      return reply.code(403).send({ error: "Invalid Host" });
  });
  app.get("/takeboard/pool", async () => ({
    service: "takeboard-gpu-pool",
    configured: true,
    ...pool.status(),
  }));
  app.post("/takeboard/pool/start", async () => {
    await pool.start();
    return { started: true };
  });
  app.post("/takeboard/pool/stop", async () => {
    await pool.stop();
    return { stopped: true };
  });
  app.post("/upload/image", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Missing input file" });
    const name = await pool.upload(await file.toBuffer(), file.filename);
    return { name, subfolder: "", type: "input" };
  });
  app.post("/prompt", async (request, reply) => {
    const body = request.body as { prompt?: ComfyPrompt; client_id?: string };
    if (
      !body?.prompt ||
      typeof body.prompt !== "object" ||
      Array.isArray(body.prompt) ||
      !Object.values(body.prompt).every(
        (node) =>
          node &&
          typeof node.class_type === "string" &&
          node.inputs &&
          typeof node.inputs === "object",
      )
    )
      return reply.code(400).send({ error: "Invalid API prompt" });
    const prompt_id = await pool.enqueue(
      body.prompt,
      typeof body.client_id === "string" ? body.client_id : "",
    );
    return { prompt_id, number: pool.status().queued, node_errors: {} };
  });
  app.get("/queue", async () => pool.queueEntries());
  app.get<{ Params: { id: string } }>("/history/:id", async (request) => {
    const history = await pool.history(request.params.id);
    return history ? { [request.params.id]: history } : {};
  });
  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (request) => ({
    cancelled: await pool.cancel(request.params.id),
  }));
  app.post("/interrupt", async (request, reply) => {
    const id = (request.body as { prompt_id?: string })?.prompt_id;
    if (!id) return reply.code(400).send({ error: "需要明确任务编号，不支持广播停止" });
    return { cancelled: await pool.cancel(id) };
  });
  app.post("/queue", async (request, reply) => {
    const ids = (request.body as { delete?: unknown })?.delete;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
      return reply.code(400).send({ error: "需要明确删除的任务，不支持清空整个队列" });
    for (const id of ids) await pool.cancel(id);
    return {};
  });
  // Local outputs stay available for retries. Retain their durable instance mapping.
  app.post("/history", async () => ({}));
  app.post("/free", async () => {
    await pool.freeIdle();
    return {};
  });
  app.get<{ Querystring: { filename: string; subfolder: string; type: string } }>(
    "/view",
    async (request, reply) => {
      const response = await pool.download(request.query);
      if (!response.body) return reply.code(502).send({ error: "Output is empty" });
      reply.header(
        "content-type",
        response.headers.get("content-type") ?? "application/octet-stream",
      );
      return reply.send(
        Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      );
    },
  );
  const primary = `http://127.0.0.1:${pool.config.ports[0]}`;
  // Only discovery and workflow files are forwarded. No endpoint may bypass admission.
  app.route({
    method: ["GET", "POST", "PUT", "DELETE"],
    url: "/*",
    handler: async (request, reply) => {
      const path = request.url.split("?")[0] ?? "";
      const discovery = request.method === "GET" && !path.startsWith("/takeboard/");
      const workflow = /^\/api\/userdata(?:\?|\/|$)/.test(path);
      if (!discovery && !workflow)
        return reply
          .code(404)
          .send({ error: "这是 TakeBoard 受管执行入口；编辑工作流请使用原 ComfyUI 编辑器" });
      await pool.verifyLane(0);
      const response = await fetch(`${primary}${request.url}`, {
        method: request.method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        ...(request.method === "GET"
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(request.body),
            }),
      });
      reply.code(response.status);
      reply.header("content-type", response.headers.get("content-type") ?? "application/json");
      return reply.send(Buffer.from(await response.arrayBuffer()));
    },
  });

  // Relay genuine execution events, not timers or estimated percentages.
  const sockets = new WebSocketServer({ noServer: true });
  app.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const clientId = url.searchParams.get("clientId");
    if (
      (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) ||
      !["127.0.0.1", "localhost"].includes(request.headers.host?.split(":")[0] ?? "") ||
      url.pathname !== "/ws" ||
      !clientId ||
      clientId.length > 256
    ) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (frontend) => {
      const peers = new Map<number, WebSocket>();
      let connecting = false;
      const connect = async () => {
        if (connecting || frontend.readyState !== WebSocket.OPEN) return;
        connecting = true;
        try {
          const queue = pool.queueEntries();
          frontend.send(
            JSON.stringify({
              type: "status",
              data: {
                sid: clientId,
                status: {
                  exec_info: {
                    queue_remaining: queue.queue_running.length + queue.queue_pending.length,
                  },
                },
              },
            }),
          );
          for (const [index, port] of pool.config.ports.entries()) {
            if ((peers.get(port)?.readyState ?? WebSocket.CLOSED) < WebSocket.CLOSING) continue;
            try {
              await pool.verifyLane(index);
            } catch {
              continue;
            }
            if (frontend.readyState !== WebSocket.OPEN) return;
            const peer = new WebSocket(
              `ws://127.0.0.1:${port}/ws?clientId=${encodeURIComponent(clientId)}`,
            );
            peers.set(port, peer);
            peer.on("error", () => peer.close());
            peer.on("message", (data, binary) => {
              if (binary || frontend.readyState !== WebSocket.OPEN) return;
              try {
                const event = JSON.parse(data.toString()) as { data?: { prompt_id?: string } };
                if (event.data?.prompt_id && pool.ownsClient(event.data.prompt_id, clientId))
                  frontend.send(data.toString());
              } catch {
                /* third-party messages are not progress evidence */
              }
            });
          }
        } finally {
          connecting = false;
        }
      };
      void connect();
      const reconnect = setInterval(() => void connect(), 3000);
      reconnect.unref();
      frontend.on("close", () => {
        clearInterval(reconnect);
        for (const peer of peers.values()) peer.close();
      });
    });
  });
  app.addHook("preClose", async () => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
  });
  return app;
}
