import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import {
  connectorToPortalSchema,
  type PortalToConnectorMessage,
  portalChunkBytes,
  portalMaximumBodyBytes,
  portalProtocolVersion,
  relayHeaders,
} from "@takeboard/portal-protocol";
import type { FastifyReply } from "fastify";
import WebSocket from "ws";
import type { PortalStore } from "./portal-store.js";

type Connection = {
  socket: WebSocket;
  deviceId: string;
  instanceId: string;
  ownerId: string;
  lastHeartbeat: number;
  ready: boolean;
};

type PendingResponse = {
  deviceId: string;
  reply: FastifyReply;
  started: boolean;
  nextSequence: number;
  timeout: NodeJS.Timeout;
  resolve: () => void;
};

const relayMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function headerEntries(headers: IncomingHttpHeaders) {
  return Object.entries(headers) as Array<[string, string | string[] | undefined]>;
}

export class PortalRelay {
  private readonly connections = new Map<string, Connection>();
  private readonly pending = new Map<string, PendingResponse>();
  private readonly staleTimer: NodeJS.Timeout;

  constructor(private readonly store: PortalStore) {
    this.staleTimer = setInterval(() => this.closeStaleConnections(), 15_000);
    this.staleTimer.unref();
  }

  onlineDeviceIds() {
    return new Set(
      [...this.connections.values()]
        .filter((connection) => connection.ready)
        .map(({ deviceId }) => deviceId),
    );
  }

  attach(socket: WebSocket, device: { id: string; instanceId: string; ownerId: string }) {
    const previous = this.connections.get(device.id);
    if (previous) previous.socket.close(4001, "A newer connector replaced this connection");
    const connection: Connection = {
      socket,
      deviceId: device.id,
      instanceId: device.instanceId,
      ownerId: device.ownerId,
      lastHeartbeat: Date.now(),
      ready: false,
    };
    this.connections.set(device.id, connection);
    void this.send(connection, {
      type: "welcome",
      protocol: portalProtocolVersion,
      deviceId: device.id,
      heartbeatSeconds: 15,
    });

    socket.on("message", (data, binary) => {
      if (binary) return socket.close(1003, "JSON frames required");
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        return socket.close(1007, "Invalid JSON");
      }
      const parsed = connectorToPortalSchema.safeParse(value);
      if (!parsed.success) return socket.close(1008, "Invalid protocol frame");
      void this.onConnectorMessage(connection, parsed.data);
    });
    socket.on("close", () => {
      if (this.connections.get(device.id) === connection) {
        this.connections.delete(device.id);
        this.failDeviceRequests(device.id, 503, "工作站连接已断开，请稍后重试");
      }
    });
    socket.on("error", () => undefined);
  }

  private async onConnectorMessage(
    connection: Connection,
    message: ReturnType<typeof connectorToPortalSchema.parse>,
  ) {
    connection.lastHeartbeat = Date.now();
    if (message.type === "hello") {
      if (message.instanceId !== connection.instanceId) {
        connection.socket.close(1008, "Instance mismatch");
        return;
      }
      connection.ready = true;
      this.store.markDeviceOnline(
        connection.deviceId,
        message.instanceName,
        message.applicationVersion,
      );
      return;
    }
    if (message.type === "heartbeat") {
      if (connection.ready) this.store.touchDevice(connection.deviceId);
      return;
    }
    if (message.type === "revoke_self") {
      this.store.revokeDeviceSelf(connection.deviceId);
      connection.socket.close(4003, "Device revoked");
      return;
    }
    const pending = "id" in message ? this.pending.get(message.id) : undefined;
    if (!pending || pending.deviceId !== connection.deviceId) return;
    if (message.type === "response_start") {
      if (pending.started) return this.failPending(message.id, 502, "工作站返回了重复响应");
      pending.started = true;
      pending.reply.raw.writeHead(
        message.status,
        relayHeaders(Object.entries(message.headers), "response"),
      );
      return;
    }
    if (message.type === "response_chunk") {
      if (!pending.started || message.sequence !== pending.nextSequence) {
        return this.failPending(message.id, 502, "工作站响应顺序无效");
      }
      pending.nextSequence += 1;
      const chunk = Buffer.from(message.data, "base64");
      if (!pending.reply.raw.write(chunk)) await once(pending.reply.raw, "drain");
      return;
    }
    if (message.type === "response_error") {
      return this.failPending(message.id, 502, message.message);
    }
    if (message.type === "response_end") {
      if (!pending.started) return this.failPending(message.id, 502, "工作站未返回响应状态");
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      pending.reply.raw.end();
      pending.resolve();
    }
  }

  async forward(
    device: { id: string; ownerId: string },
    session: { sessionId: string; user: { id: string } },
    request: { method: string; url: string; headers: IncomingHttpHeaders; body: unknown },
    reply: FastifyReply,
  ) {
    const connection = this.connections.get(device.id);
    if (!connection?.ready || connection.ownerId !== session.user.id) {
      return await reply.code(503).send({ error: "工作站当前离线，请确认 TakeBoard 正在运行" });
    }
    if (!relayMethods.has(request.method)) {
      return await reply.code(405).send({ error: "远程访问不支持此请求方法" });
    }
    if (
      !request.url.startsWith("/") ||
      request.url.startsWith("//") ||
      request.url.includes("\\")
    ) {
      return await reply.code(400).send({ error: "远程请求路径无效" });
    }
    const body = this.bodyBuffer(request.body);
    if (body.length > portalMaximumBodyBytes) {
      return await reply.code(413).send({ error: "单次远程请求不能超过 110 MB" });
    }
    const id = randomUUID();
    reply.hijack();
    return await new Promise<void>((resolveResponse) => {
      const timeout = setTimeout(() => this.failPending(id, 504, "工作站响应超时"), 10 * 60_000);
      timeout.unref();
      this.pending.set(id, {
        deviceId: device.id,
        reply,
        started: false,
        nextSequence: 0,
        timeout,
        resolve: resolveResponse,
      });
      reply.raw.once("close", () => {
        if (!this.pending.has(id)) return;
        void this.send(connection, { type: "request_cancel", id });
        this.completePending(id);
      });
      void (async () => {
        try {
          await this.send(connection, {
            type: "request_start",
            id,
            method: request.method as
              | "GET"
              | "HEAD"
              | "POST"
              | "PUT"
              | "PATCH"
              | "DELETE"
              | "OPTIONS",
            path: request.url,
            headers: relayHeaders(headerEntries(request.headers), "request"),
            portalSubject: session.user.id,
            portalSessionId: session.sessionId,
          });
          for (let offset = 0, sequence = 0; offset < body.length; offset += portalChunkBytes) {
            await this.send(connection, {
              type: "request_chunk",
              id,
              sequence,
              data: body.subarray(offset, offset + portalChunkBytes).toString("base64"),
            });
            sequence += 1;
          }
          await this.send(connection, { type: "request_end", id });
        } catch {
          this.failPending(id, 503, "无法把请求发送到工作站");
        }
      })();
    });
  }

  revoke(deviceId: string) {
    const connection = this.connections.get(deviceId);
    if (!connection) return;
    this.connections.delete(deviceId);
    this.failDeviceRequests(deviceId, 503, "工作站访问已撤销");
    void this.send(connection, { type: "device_revoked", reason: "设备访问已从门户撤销" }).finally(
      () => connection.socket.close(4003, "Device revoked"),
    );
  }

  close() {
    clearInterval(this.staleTimer);
    for (const connection of this.connections.values())
      connection.socket.close(1001, "Portal stopping");
    for (const id of this.pending.keys()) this.failPending(id, 503, "门户正在停止");
    this.connections.clear();
  }

  private bodyBuffer(body: unknown) {
    if (body === undefined || body === null) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;
    if (typeof body === "string") return Buffer.from(body);
    return Buffer.from(JSON.stringify(body));
  }

  private async send(connection: Connection, message: PortalToConnectorMessage) {
    while (connection.socket.bufferedAmount > 4 * 1024 * 1024) {
      if (connection.socket.readyState !== WebSocket.OPEN) throw new Error("connector closed");
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    if (connection.socket.readyState !== WebSocket.OPEN) throw new Error("connector closed");
    await new Promise<void>((resolveSend, rejectSend) =>
      connection.socket.send(JSON.stringify(message), (error) =>
        error ? rejectSend(error) : resolveSend(),
      ),
    );
  }

  private failPending(id: string, status: number, message: string) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    if (!pending.reply.raw.destroyed) {
      if (!pending.started) {
        const payload = Buffer.from(JSON.stringify({ error: message }));
        pending.reply.raw.writeHead(status, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(payload.length),
          "cache-control": "no-store",
        });
        pending.reply.raw.end(payload);
      } else {
        pending.reply.raw.destroy(new Error(message));
      }
    }
    pending.resolve();
  }

  private completePending(id: string) {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.resolve();
  }

  private failDeviceRequests(deviceId: string, status: number, message: string) {
    for (const [id, pending] of this.pending) {
      if (pending.deviceId === deviceId) this.failPending(id, status, message);
    }
  }

  private closeStaleConnections() {
    const cutoff = Date.now() - 45_000;
    for (const connection of this.connections.values()) {
      if (connection.lastHeartbeat < cutoff) connection.socket.terminate();
    }
  }
}
