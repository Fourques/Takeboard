import type { ProjectSnapshot } from "@takeboard/contracts";

export type DemoPayload = {
  revision: number;
  snapshot: ProjectSnapshot;
};

export type ProjectCatalogItem = {
  key: string;
  id: string;
  title: string;
  aspectRatio: string;
  sceneCount: number;
  shotCount: number;
  updatedAt: string;
  boards: ProjectBoardPreview[];
};

export type ProjectBoardPreview = {
  sceneId: string;
  label: string;
  title: string;
  itemCount: number;
  nodes: Array<{
    id: string;
    refType: "text" | "entity" | "asset" | "shot" | "take_stack";
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  edges: Array<{ sourceItemId: string; targetItemId: string }>;
};

export type WorkerStatus = {
  status: "ready" | "offline";
  engine: string;
  version?: string;
  device?: string;
  vramTotal?: number | null;
  vramFree?: number | null;
  error?: string;
  startup?: {
    state: "ready" | "available" | "blocked" | "starting";
    canStart: boolean;
    message: string;
    platform: string;
    launcher: "systemd" | "launchd" | "windows-service" | "process" | "unavailable";
    checks: Array<{
      id: "endpoint" | "launcher" | "memory" | "accelerator" | "vram" | "load";
      label: string;
      status: "pass" | "blocked";
      detail: string;
    }>;
  };
};

export type WorkflowCapability =
  | "text_to_image"
  | "image_to_image"
  | "text_to_video"
  | "image_to_video"
  | "first_last_video"
  | "reference_video";

export type WorkflowSummary = {
  id: string;
  path: string;
  name: string;
  capability: WorkflowCapability;
  capabilityLabel: string;
  inputs: string[];
  mediaInputs?: {
    first_frame: number;
    last_frame: number;
    reference: number;
    reference_video?: number;
  };
  models: string[];
  modelStatus?: "ready" | "missing" | "unknown";
  missingModels?: string[];
  nodeCount: number;
  source: "comfyui";
  editorUrl: string;
  execution: "native" | "comfy_only";
  origin?: "built_in" | "imported" | "comfyui";
};

async function request(path: string, options?: RequestInit): Promise<DemoPayload> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...options,
    headers,
  });
  const payload = (await response.json()) as DemoPayload | { error?: string };
  if (!response.ok || !("snapshot" in payload)) {
    throw new Error(
      "error" in payload && payload.error ? payload.error : "TakeBoard request failed",
    );
  }
  return payload;
}

export const demoApi = {
  get: () => request("/api/demo/project"),
  reset: () => request("/api/demo/reset", { method: "POST" }),
  move: (itemId: string, x: number, y: number) =>
    request("/api/demo/canvas-position", {
      method: "PATCH",
      body: JSON.stringify({ itemId, x, y }),
    }),
  generate: (shotId: string) =>
    request("/api/demo/generate", {
      method: "POST",
      body: JSON.stringify({ shotId }),
    }),
  reject: (takeId: string, reason: string) =>
    request("/api/demo/reject", {
      method: "POST",
      body: JSON.stringify({ takeId, reason }),
    }),
  approve: (takeId: string, reason: string | null) =>
    request("/api/demo/approve", {
      method: "POST",
      body: JSON.stringify({ takeId, reason }),
    }),
};

async function jsonRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined && !(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 413) throw new Error("文件超过 100 MB 上传上限");
    throw new Error(payload.error ?? `TakeBoard 请求失败（${response.status}）`);
  }
  return payload;
}

export const projectApi = {
  list: () => jsonRequest<{ projects: ProjectCatalogItem[] }>("/api/projects"),
  open: (key: string) =>
    jsonRequest<DemoPayload & { key: string }>(`/api/projects/${encodeURIComponent(key)}`),
  create: (input: { title: string }) =>
    jsonRequest<DemoPayload & { key: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createShot: (
    key: string,
    input: {
      aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5" | "2.35:1";
      x?: number;
      y?: number;
    } = {},
  ) =>
    jsonRequest<DemoPayload & { key: string; shotId: string; itemId: string }>(
      `/api/projects/${encodeURIComponent(key)}/shots`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  createTextNode: (
    key: string,
    input: { title?: string; body?: string; sceneId?: string; x?: number; y?: number },
  ) =>
    jsonRequest<DemoPayload & { key: string; textId: string; itemId: string }>(
      `/api/projects/${encodeURIComponent(key)}/text-nodes`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  rename: (key: string, title: string) =>
    jsonRequest<DemoPayload & { key: string }>(`/api/projects/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  delete: (key: string) =>
    jsonRequest<{ key: string; deleted: true; recoverable: true }>(
      `/api/projects/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    ),
  connect: (
    key: string,
    sourceItemId: string,
    targetItemId: string,
    targetSlot: "first_frame" | "last_frame" | "reference" | "reference_video",
  ) =>
    jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/canvas-connections`,
      {
        method: "POST",
        body: JSON.stringify({ sourceItemId, targetItemId, targetSlot }),
      },
    ),
  disconnect: (key: string, edgeId: string) =>
    jsonRequest<DemoPayload & { key: string; removedEdgeId: string }>(
      `/api/projects/${encodeURIComponent(key)}/canvas-connections/${encodeURIComponent(edgeId)}`,
      { method: "DELETE" },
    ),
  disconnectMatching: (
    key: string,
    connection: {
      sourceItemId: string;
      targetItemId: string;
      targetSlot: "first_frame" | "last_frame" | "reference" | "reference_video" | null;
    },
  ) =>
    jsonRequest<DemoPayload & { key: string; removedEdgeId: string }>(
      `/api/projects/${encodeURIComponent(key)}/canvas-connections`,
      { method: "DELETE", body: JSON.stringify(connection) },
    ),
  move: (key: string, itemId: string, x: number, y: number) =>
    jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/canvas-position`,
      {
        method: "PATCH",
        body: JSON.stringify({ itemId, x, y }),
      },
    ),
  uploadAsset: async (
    key: string,
    file: File,
    metadata?: {
      kind?: "character" | "location" | "prop";
      name?: string;
      x?: number;
      y?: number;
      addToCanvas?: boolean;
    },
  ) => {
    const body = new FormData();
    body.set("file", file);
    const query = new URLSearchParams();
    if (metadata?.kind) query.set("kind", metadata.kind);
    if (metadata?.name) query.set("name", metadata.name);
    if (metadata?.x !== undefined) query.set("x", String(metadata.x));
    if (metadata?.y !== undefined) query.set("y", String(metadata.y));
    if (metadata?.addToCanvas === false) query.set("canvas", "0");
    return await jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/assets${query.size ? `?${query}` : ""}`,
      { method: "POST", body },
    );
  },
  updateAsset: (
    key: string,
    assetId: string,
    input: {
      title?: string;
      customTags?: string[];
      libraryKind?: "character" | "location" | "prop" | null;
    },
  ) =>
    jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/assets/${encodeURIComponent(assetId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  generate: (
    key: string,
    shotId: string,
    settings: {
      recipePath: string;
      prompt: string;
      negativePrompt: string;
      firstFrameAssetId: string | null;
      lastFrameAssetId: string | null;
      width: number;
      height: number;
      durationSeconds: number;
      fps: number;
      seed: number;
      steps: number;
      denoise: number;
    },
  ) =>
    jsonRequest<DemoPayload & { key: string; runId: string; promptId: string }>(
      `/api/projects/${encodeURIComponent(key)}/shots/${encodeURIComponent(shotId)}/generate`,
      { method: "POST", body: JSON.stringify(settings) },
    ),
  run: (key: string, runId: string) =>
    jsonRequest<DemoPayload & { key: string; runId: string; status: string }>(
      `/api/projects/${encodeURIComponent(key)}/runs/${encodeURIComponent(runId)}`,
    ),
  cancelRun: (key: string, runId: string) =>
    jsonRequest<
      DemoPayload & {
        key: string;
        runId: string;
        status: string;
        cancelled: boolean;
        resourcesReleased: boolean;
        warning?: string;
      }
    >(`/api/projects/${encodeURIComponent(key)}/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    }),
  addCanvasItem: (
    key: string,
    input: {
      refType: "text" | "entity" | "asset" | "shot" | "take_stack";
      refId: string;
      sceneId?: string;
      x?: number;
      y?: number;
    },
  ) =>
    jsonRequest<DemoPayload & { key: string; itemId: string }>(
      `/api/projects/${encodeURIComponent(key)}/canvas-items`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  duplicateCanvasItem: (key: string, itemId: string, x?: number, y?: number) =>
    jsonRequest<DemoPayload & { key: string; itemId: string }>(
      `/api/projects/${encodeURIComponent(key)}/canvas-items/${encodeURIComponent(itemId)}/duplicate`,
      { method: "POST", body: JSON.stringify({ x, y }) },
    ),
  editCanvasItem: (
    key: string,
    itemId: string,
    input: {
      title?: string;
      body?: string;
      customTags?: string[];
      workflowPath?: string;
      durationSeconds?: number;
      aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5" | "2.35:1";
    },
  ) =>
    jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/canvas-items/${encodeURIComponent(itemId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  deleteCanvasItem: (key: string, itemId: string) =>
    jsonRequest<DemoPayload & { key: string; removedItemId: string }>(
      `/api/projects/${encodeURIComponent(key)}/canvas-items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    ),
  reject: (key: string, takeId: string, reason: string) =>
    jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/takes/${encodeURIComponent(takeId)}/reject`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  approve: (key: string, takeId: string, reason: string | null) =>
    jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/takes/${encodeURIComponent(takeId)}/approve`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  assetUrl: (key: string, assetId: string, proxy = false) =>
    `/api/projects/${encodeURIComponent(key)}/assets/${encodeURIComponent(assetId)}/content${proxy ? "?proxy=1" : ""}`,
  worker: () => jsonRequest<WorkerStatus>("/api/workers/comfy"),
  startWorker: async () => {
    const response = await fetch("/api/workers/comfy/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "safe-start" }),
    });
    const payload = (await response.json().catch(() => ({}))) as Partial<WorkerStatus> & {
      error?: string;
    };
    if (payload.status === "ready" || payload.status === "offline") {
      return payload as WorkerStatus;
    }
    throw new Error(payload.error ?? `ComfyUI 启动请求失败（${response.status}）`);
  },
};

export const workflowApi = {
  list: () =>
    jsonRequest<{
      editorUrl: string;
      workflows: WorkflowSummary[];
      warnings: string[];
      error?: string;
    }>("/api/workflows"),
  rawUrl: (path: string) => `/api/workflows/raw?path=${encodeURIComponent(path)}`,
  import: async (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return await jsonRequest<WorkflowSummary>("/api/workflows/import", {
      method: "POST",
      body,
    });
  },
};
