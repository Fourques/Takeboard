import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type ConnectorToPortalMessage,
  portalChunkBytes,
  portalMaximumBodyBytes,
  portalProtocolVersion,
  portalToConnectorSchema,
  relayHeaders,
} from "@takeboard/portal-protocol";
import WebSocket from "ws";
import type { AuthService } from "./auth-service.js";

type PairingConfig = {
  id: string;
  secret: string;
  userCode: string;
  expiresAt: string;
};

type DeviceConfig = {
  id: string;
  token: string;
  portalSubject: string;
  remoteUrl: string | null;
};

type ConnectorConfig = {
  version: 1;
  portalUrl: string;
  localUserId: string;
  pairing?: PairingConfig;
  device?: DeviceConfig;
};

type PendingRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  chunks: Buffer[];
  bytes: number;
  nextSequence: number;
  abort: AbortController;
};

export type PortalConnectorStatus = {
  available: true;
  state: "not_configured" | "pairing" | "connecting" | "connected" | "offline" | "revoked";
  portalUrl: string | null;
  pairing: { userCode: string; expiresAt: string } | null;
  remoteUrl: string | null;
  lastError: string | null;
};

function validatePortalUrl(value: string) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  const loopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("门户必须使用 HTTPS；只有本机 localhost 开发门户可以使用 HTTP");
  }
  if (url.username || url.password) throw new Error("门户地址不能包含账号或密码");
  return url.origin;
}

function wait(milliseconds: number) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export class PortalConnector {
  private config: ConnectorConfig | null = null;
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private pollTask: Promise<void> | null = null;
  private localSession: ReturnType<AuthService["createSession"]> | null = null;
  private disconnecting = false;
  private readonly requests = new Map<string, PendingRequest>();
  private currentState: PortalConnectorStatus["state"] = "not_configured";
  private lastError: string | null = null;

  constructor(
    private readonly options: {
      configPath: string;
      instanceId: string;
      instanceName: string;
      applicationVersion: string;
      localOrigin: string;
      auth: AuthService;
    },
  ) {}

  async start() {
    this.stopped = false;
    this.config = await this.readConfig();
    if (this.config?.pairing) this.pollTask = this.pollPairing();
    else if (this.config?.device) this.connect();
  }

  async stop() {
    this.stopped = true;
    this.clearConnection();
    await this.pollTask?.catch(() => undefined);
    this.pollTask = null;
  }

  status(): PortalConnectorStatus {
    return {
      available: true,
      state: this.currentState,
      portalUrl: this.config?.portalUrl ?? null,
      pairing: this.config?.pairing
        ? { userCode: this.config.pairing.userCode, expiresAt: this.config.pairing.expiresAt }
        : null,
      remoteUrl: this.config?.device?.remoteUrl ?? null,
      lastError: this.lastError,
    };
  }

  authMode() {
    return this.options.auth.mode;
  }

  async beginPairing(portalUrlValue: string, localUserId: string) {
    if (this.config?.device) throw new Error("此工作站已连接门户；请先撤销现有连接");
    const portalUrl = validatePortalUrl(portalUrlValue);
    const response = await fetch(`${portalUrl}/__portal/connect/pairings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instanceId: this.options.instanceId,
        instanceName: this.options.instanceName,
        applicationVersion: this.options.applicationVersion,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(typeof payload.error === "string" ? payload.error : "门户拒绝配对请求");
    if (
      typeof payload.pairingId !== "string" ||
      typeof payload.connectorSecret !== "string" ||
      typeof payload.userCode !== "string" ||
      typeof payload.expiresAt !== "string"
    ) {
      throw new Error("门户返回了无效的配对信息");
    }
    this.config = {
      version: 1,
      portalUrl,
      localUserId,
      pairing: {
        id: payload.pairingId,
        secret: payload.connectorSecret,
        userCode: payload.userCode,
        expiresAt: payload.expiresAt,
      },
    };
    await this.writeConfig(this.config);
    this.currentState = "pairing";
    this.lastError = null;
    this.options.auth.audit(
      localUserId,
      "portal.pairing_started",
      "portal",
      null,
      { portalUrl },
      null,
    );
    this.pollTask = this.pollPairing();
    return this.status();
  }

  async disconnect(actorUserId: string) {
    this.disconnecting = true;
    try {
      let portalConfirmed = false;
      const config = this.config;
      if (config?.device) {
        try {
          const response = await fetch(`${config.portalUrl}/__portal/connect/revoke`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.device.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ instanceId: this.options.instanceId }),
            signal: AbortSignal.timeout(10_000),
          });
          portalConfirmed = response.ok || response.status === 401;
        } catch {
          // The authenticated WebSocket below is the bounded fallback.
        }
        if (!portalConfirmed && this.socket?.readyState === WebSocket.OPEN) {
          await this.send({ type: "revoke_self" }).catch(() => undefined);
          await wait(100);
        }
      }
      this.clearConnection();
      this.config = null;
      this.currentState = "not_configured";
      this.lastError =
        config?.device && !portalConfirmed
          ? "本机连接已清除；门户当时不可用，请登录门户删除离线设备记录"
          : null;
      await rm(this.options.configPath, { force: true });
      this.options.auth.audit(
        actorUserId,
        "portal.device_unlinked",
        "portal",
        null,
        { portalConfirmed },
        null,
      );
      return this.status();
    } finally {
      this.disconnecting = false;
    }
  }

  private async pollPairing() {
    while (!this.stopped && this.config?.pairing) {
      const pairing = this.config.pairing;
      if (Date.parse(pairing.expiresAt) <= Date.now()) {
        this.currentState = "offline";
        this.lastError = "配对码已过期，请重新发起";
        return;
      }
      try {
        const response = await fetch(
          `${this.config.portalUrl}/__portal/connect/pairings/${encodeURIComponent(pairing.id)}`,
          {
            headers: { authorization: `Bearer ${pairing.secret}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok)
          throw new Error(typeof payload.error === "string" ? payload.error : "配对状态不可用");
        if (payload.state === "paired") {
          if (
            typeof payload.deviceId !== "string" ||
            typeof payload.deviceToken !== "string" ||
            typeof payload.portalSubject !== "string"
          ) {
            throw new Error("门户返回了无效的设备凭据");
          }
          const localUserId = this.config.localUserId;
          this.config = {
            version: 1,
            portalUrl: this.config.portalUrl,
            localUserId,
            device: {
              id: payload.deviceId,
              token: payload.deviceToken,
              portalSubject: payload.portalSubject,
              remoteUrl: typeof payload.remoteUrl === "string" ? payload.remoteUrl : null,
            },
          };
          await this.writeConfig(this.config);
          this.options.auth.audit(
            localUserId,
            "portal.device_paired",
            "portal_device",
            payload.deviceId,
            { portalSubject: payload.portalSubject },
            null,
          );
          this.connect();
          return;
        }
        if (payload.state === "expired") {
          this.currentState = "offline";
          this.lastError = "配对码已过期，请重新发起";
          return;
        }
        this.currentState = "pairing";
        this.lastError = null;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "无法查询配对状态";
      }
      await wait(2_000);
    }
  }

  private connect() {
    const config = this.config;
    const device = config?.device;
    if (this.stopped || !config || !device || this.socket) return;
    this.currentState = "connecting";
    const url = new URL("/__portal/connect/socket", config.portalUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("instanceId", this.options.instanceId);
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${device.token}` } });
    this.socket = socket;
    socket.on("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.currentState = "connected";
      this.createLocalSession(config.localUserId);
      void this.send({
        type: "hello",
        protocol: portalProtocolVersion,
        instanceId: this.options.instanceId,
        instanceName: this.options.instanceName,
        applicationVersion: this.options.applicationVersion,
      });
      this.heartbeat = setInterval(() => {
        void this.send({ type: "heartbeat", sentAt: new Date().toISOString() });
      }, 15_000);
      this.heartbeat.unref();
    });
    socket.on("message", (data, binary) => {
      if (binary) return socket.close(1003, "JSON frames required");
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        return socket.close(1007, "Invalid JSON");
      }
      const parsed = portalToConnectorSchema.safeParse(value);
      if (!parsed.success) return socket.close(1008, "Invalid protocol frame");
      void this.onPortalMessage(parsed.data);
    });
    socket.on("close", (code) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.abortRequests();
      this.revokeLocalSession();
      if (code === 4003) {
        if (this.disconnecting) return;
        this.currentState = "revoked";
        this.lastError = "门户已撤销这台工作站";
        if (this.config) {
          delete this.config.device;
          void this.writeConfig(this.config);
        }
        return;
      }
      if (!this.stopped && this.config?.device) {
        this.currentState = "offline";
        this.lastError = "门户连接中断，正在自动重连";
        const delays = [1_000, 2_000, 5_000, 15_000, 30_000];
        const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)] ?? 30_000;
        this.reconnectAttempt += 1;
        setTimeout(() => this.connect(), delay).unref();
      }
    });
    socket.on("error", (error) => {
      this.lastError = error.message;
    });
  }

  private async onPortalMessage(message: ReturnType<typeof portalToConnectorSchema.parse>) {
    if (message.type === "welcome") return;
    if (message.type === "device_revoked") {
      this.lastError = message.reason;
      this.socket?.close(4003, "Device revoked");
      return;
    }
    if (message.type === "request_start") {
      if (!this.config?.device || message.portalSubject !== this.config.device.portalSubject) {
        await this.send({
          type: "response_error",
          id: message.id,
          code: "BAD_REQUEST",
          message: "门户身份与本机映射不一致",
        });
        return;
      }
      if (this.requests.has(message.id)) return;
      this.requests.set(message.id, {
        method: message.method,
        path: message.path,
        headers: message.headers,
        chunks: [],
        bytes: 0,
        nextSequence: 0,
        abort: new AbortController(),
      });
      return;
    }
    const pending = this.requests.get(message.id);
    if (!pending) return;
    if (message.type === "request_cancel") {
      pending.abort.abort();
      this.requests.delete(message.id);
      return;
    }
    if (message.type === "request_chunk") {
      if (message.sequence !== pending.nextSequence) {
        this.requests.delete(message.id);
        await this.send({
          type: "response_error",
          id: message.id,
          code: "BAD_REQUEST",
          message: "请求分片顺序无效",
        });
        return;
      }
      const chunk = Buffer.from(message.data, "base64");
      pending.bytes += chunk.length;
      if (pending.bytes > portalMaximumBodyBytes) {
        this.requests.delete(message.id);
        await this.send({
          type: "response_error",
          id: message.id,
          code: "BODY_TOO_LARGE",
          message: "请求超过 110 MB",
        });
        return;
      }
      pending.nextSequence += 1;
      pending.chunks.push(chunk);
      return;
    }
    if (message.type === "request_end") {
      this.requests.delete(message.id);
      await this.executeRequest(message.id, pending);
    }
  }

  private async executeRequest(id: string, request: PendingRequest) {
    if (!this.localSession) {
      await this.send({
        type: "response_error",
        id,
        code: "LOCAL_UNAVAILABLE",
        message: "本机授权会话不可用",
      });
      return;
    }
    try {
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      headers.set("accept-encoding", "identity");
      headers.set("cookie", `takeboard_session=${encodeURIComponent(this.localSession.token)}`);
      headers.set("origin", this.options.localOrigin);
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        headers.set("x-takeboard-csrf", this.localSession.csrfToken);
      }
      const body = Buffer.concat(request.chunks);
      const localUrl = new URL(request.path, this.options.localOrigin);
      if (localUrl.origin !== this.options.localOrigin) {
        throw new Error("门户请求不能离开本机 TakeBoard 地址");
      }
      const response = await fetch(localUrl, {
        method: request.method,
        headers,
        ...(request.method === "GET" || request.method === "HEAD" ? {} : { body }),
        redirect: "manual",
        signal: request.abort.signal,
      });
      await this.send({
        type: "response_start",
        id,
        status: response.status,
        headers: relayHeaders(response.headers.entries(), "response"),
      });
      let sequence = 0;
      if (response.body) {
        for await (const value of response.body) {
          const buffer = Buffer.from(value);
          for (let offset = 0; offset < buffer.length; offset += portalChunkBytes) {
            await this.send({
              type: "response_chunk",
              id,
              sequence,
              data: buffer.subarray(offset, offset + portalChunkBytes).toString("base64"),
            });
            sequence += 1;
          }
        }
      }
      await this.send({ type: "response_end", id });
    } catch (error) {
      if (request.abort.signal.aborted) return;
      await this.send({
        type: "response_error",
        id,
        code:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "TIMEOUT"
            : "LOCAL_UNAVAILABLE",
        message: "本机 TakeBoard 无法完成远程请求",
      }).catch(() => undefined);
    }
  }

  private createLocalSession(localUserId: string) {
    this.revokeLocalSession();
    this.localSession = this.options.auth.createSession(
      localUserId,
      "TakeBoard Portal Connector",
      "portal",
    );
  }

  private revokeLocalSession() {
    if (!this.localSession || !this.config) return;
    this.options.auth.revokeSession(this.config.localUserId, this.localSession.id);
    this.localSession = null;
  }

  private clearConnection() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.abortRequests();
    this.revokeLocalSession();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "Connector stopping");
  }

  private abortRequests() {
    for (const request of this.requests.values()) request.abort.abort();
    this.requests.clear();
  }

  private async send(message: ConnectorToPortalMessage) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("门户连接不可用");
    while (socket.bufferedAmount > 4 * 1024 * 1024) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error("门户连接不可用");
      await wait(10);
    }
    await new Promise<void>((resolveSend, rejectSend) =>
      socket.send(JSON.stringify(message), (error) => (error ? rejectSend(error) : resolveSend())),
    );
  }

  private async readConfig() {
    try {
      const value = JSON.parse(await readFile(this.options.configPath, "utf8")) as ConnectorConfig;
      if (
        value.version !== 1 ||
        typeof value.portalUrl !== "string" ||
        typeof value.localUserId !== "string"
      ) {
        throw new Error("invalid connector config");
      }
      validatePortalUrl(value.portalUrl);
      this.currentState = value.pairing
        ? "pairing"
        : value.device
          ? "connecting"
          : "not_configured";
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      this.currentState = "offline";
      this.lastError = "门户连接配置损坏，请撤销后重新配对";
      return null;
    }
  }

  private async writeConfig(config: ConnectorConfig) {
    await mkdir(dirname(this.options.configPath), { recursive: true, mode: 0o700 });
    const temporary = `${this.options.configPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, this.options.configPath);
    await chmod(this.options.configPath, 0o600);
  }
}
