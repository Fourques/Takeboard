import type { ComfyPrompt } from "./index.js";

export type ComfyExecutionProgress = {
  phase: "queued" | "running" | "collecting";
  label: string;
  detail: string;
  percent: number | null;
  nodeId: string | null;
  queueRemaining: number | null;
  source: "comfy_websocket";
  updatedAt: string;
};

type ProgressEntry = ComfyExecutionProgress & {
  clientId: string;
  nodeLabels: Map<string, string>;
};

type ComfyMessage = {
  type?: string;
  data?: Record<string, unknown>;
};

function promptId(data: Record<string, unknown>) {
  return typeof data.prompt_id === "string" ? data.prompt_id : null;
}

function nodeLabels(prompt: ComfyPrompt | undefined) {
  return new Map(
    Object.entries(prompt ?? {}).map(([id, node]) => [
      id,
      node._meta?.title?.trim() || node.class_type,
    ]),
  );
}

function websocketUrl(baseUrl: string, clientId: string) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
  url.search = new URLSearchParams({ clientId }).toString();
  return url.toString();
}

export class ComfyProgressTracker {
  private readonly entries = new Map<string, ProgressEntry>();
  private readonly pending = new Map<string, Map<string, string>>();
  private readonly buffered = new Map<string, Array<{ clientId: string; message: ComfyMessage }>>();
  private readonly sockets = new Map<string, WebSocket>();

  constructor(
    private readonly baseUrl: string,
    private readonly enabled = true,
  ) {}

  connect(clientId: string, prompt?: ComfyPrompt) {
    if (prompt) this.pending.set(clientId, nodeLabels(prompt));
    if (!this.enabled || typeof WebSocket === "undefined") return;
    const current = this.sockets.get(clientId);
    if (current && current.readyState <= WebSocket.OPEN) return;
    try {
      const socket = new WebSocket(websocketUrl(this.baseUrl, clientId));
      this.sockets.set(clientId, socket);
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        try {
          this.ingest(clientId, JSON.parse(event.data) as ComfyMessage);
        } catch {
          // Binary previews and third-party messages are intentionally ignored.
        }
      });
      socket.addEventListener("close", () => {
        if (this.sockets.get(clientId) === socket) this.sockets.delete(clientId);
      });
      socket.addEventListener("error", () => socket.close());
    } catch {
      // Generation remains available when live progress cannot connect.
    }
  }

  register(promptIdValue: string, clientId: string, executionNumber?: number | null) {
    const labels = this.pending.get(clientId) ?? new Map<string, string>();
    this.entries.set(promptIdValue, {
      phase: "queued",
      label: "已进入 ComfyUI 队列",
      detail:
        typeof executionNumber === "number"
          ? `执行序号 ${executionNumber} · 等待开始`
          : "等待执行端开始任务",
      percent: null,
      nodeId: null,
      queueRemaining: null,
      source: "comfy_websocket",
      updatedAt: new Date().toISOString(),
      clientId,
      nodeLabels: labels,
    });
    const messages = this.buffered.get(promptIdValue) ?? [];
    this.buffered.delete(promptIdValue);
    for (const buffered of messages) this.ingest(buffered.clientId, buffered.message);
  }

  watch(promptIdValue: string, clientId: string) {
    if (!this.entries.has(promptIdValue)) this.register(promptIdValue, clientId);
    this.connect(clientId);
  }

  get(promptIdValue: string) {
    const entry = this.entries.get(promptIdValue);
    if (!entry) return null;
    const { clientId: _clientId, nodeLabels: _nodeLabels, ...progress } = entry;
    return progress;
  }

  forget(promptIdValue: string) {
    const entry = this.entries.get(promptIdValue);
    this.entries.delete(promptIdValue);
    if (!entry) return;
    const hasOtherPrompts = [...this.entries.values()].some(
      (candidate) => candidate.clientId === entry.clientId,
    );
    if (hasOtherPrompts) return;
    this.pending.delete(entry.clientId);
    this.sockets.get(entry.clientId)?.close();
    this.sockets.delete(entry.clientId);
  }

  abandon(clientId: string) {
    const promptIds = [...this.entries.entries()]
      .filter(([, entry]) => entry.clientId === clientId)
      .map(([id]) => id);
    for (const id of promptIds) this.entries.delete(id);
    this.pending.delete(clientId);
    for (const [id, messages] of this.buffered) {
      const remaining = messages.filter((message) => message.clientId !== clientId);
      if (remaining.length === 0) this.buffered.delete(id);
      else this.buffered.set(id, remaining);
    }
    this.sockets.get(clientId)?.close();
    this.sockets.delete(clientId);
  }

  ingest(clientId: string, message: ComfyMessage) {
    const data = message.data ?? {};
    if (message.type === "status") {
      const execInfo =
        data.status && typeof data.status === "object"
          ? (data.status as Record<string, unknown>).exec_info
          : data.exec_info;
      const queueRemaining =
        execInfo && typeof execInfo === "object"
          ? (execInfo as Record<string, unknown>).queue_remaining
          : null;
      if (typeof queueRemaining === "number") {
        for (const entry of this.entries.values()) {
          if (entry.clientId !== clientId) continue;
          entry.queueRemaining = queueRemaining;
          entry.updatedAt = new Date().toISOString();
        }
      }
      return;
    }
    const id = promptId(data);
    if (!id) return;
    const entry = this.entries.get(id);
    if (!entry) {
      const messages = this.buffered.get(id) ?? [];
      if (messages.length < 24) messages.push({ clientId, message });
      this.buffered.set(id, messages);
      return;
    }
    if (entry.clientId !== clientId) return;
    const updatedAt = new Date().toISOString();
    if (message.type === "execution_start") {
      Object.assign(entry, {
        phase: "running",
        label: "ComfyUI 已开始执行",
        detail: "正在载入工作流节点",
        percent: null,
        updatedAt,
      });
      return;
    }
    if (message.type === "executing") {
      const nodeId = typeof data.node === "string" ? data.node : null;
      if (!nodeId) {
        Object.assign(entry, {
          phase: "collecting",
          label: "工作流执行完成",
          detail: "正在回收生成文件",
          percent: 100,
          nodeId: null,
          updatedAt,
        });
        return;
      }
      const label = entry.nodeLabels.get(nodeId) ?? `节点 ${nodeId}`;
      Object.assign(entry, {
        phase: "running",
        label: `正在执行：${label}`,
        detail: "此节点没有提供步进百分比",
        percent: null,
        nodeId,
        updatedAt,
      });
      return;
    }
    if (message.type === "progress") {
      const value = typeof data.value === "number" ? data.value : 0;
      const max = typeof data.max === "number" && data.max > 0 ? data.max : 0;
      const nodeId = typeof data.node === "string" ? data.node : entry.nodeId;
      const label = nodeId ? (entry.nodeLabels.get(nodeId) ?? `节点 ${nodeId}`) : "当前节点";
      Object.assign(entry, {
        phase: "running",
        label: `正在生成：${label}`,
        detail: max > 0 ? `真实步进 ${Math.min(value, max)} / ${max}` : "执行端正在计算",
        percent: max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : null,
        nodeId,
        updatedAt,
      });
      return;
    }
    if (message.type === "execution_success") {
      Object.assign(entry, {
        phase: "collecting",
        label: "生成完成",
        detail: "正在将结果保存到项目",
        percent: 100,
        nodeId: null,
        updatedAt,
      });
      return;
    }
    if (message.type === "execution_error" || message.type === "execution_interrupted") {
      Object.assign(entry, {
        detail: message.type === "execution_interrupted" ? "执行已停止" : "ComfyUI 执行失败",
        percent: null,
        updatedAt,
      });
    }
  }
}
