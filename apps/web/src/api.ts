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
};

export type WorkerStatus = {
  status: "ready" | "offline";
  engine: string;
  version?: string;
  device?: string;
  vramTotal?: number | null;
  vramFree?: number | null;
  error?: string;
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
  models: string[];
  nodeCount: number;
  source: "comfyui";
  editorUrl: string;
  execution: "native" | "comfy_only";
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
  if (options?.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "TakeBoard request failed");
  return payload;
}

export const projectApi = {
  list: () => jsonRequest<{ projects: ProjectCatalogItem[] }>("/api/projects"),
  open: (key: string) =>
    jsonRequest<DemoPayload & { key: string }>(`/api/projects/${encodeURIComponent(key)}`),
  create: (input: {
    title: string;
    aspectRatio: string;
    sceneTitle: string;
    firstShotIntent: string;
  }) =>
    jsonRequest<DemoPayload & { key: string }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
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
    metadata?: { kind?: "character" | "location" | "prop"; name?: string },
  ) => {
    const body = new FormData();
    body.set("file", file);
    const query = new URLSearchParams();
    if (metadata?.kind) query.set("kind", metadata.kind);
    if (metadata?.name) query.set("name", metadata.name);
    return await jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/assets${query.size ? `?${query}` : ""}`,
      { method: "POST", body },
    );
  },
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
