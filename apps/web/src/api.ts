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
  uploadAsset: async (key: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    return await jsonRequest<DemoPayload & { key: string }>(
      `/api/projects/${encodeURIComponent(key)}/assets`,
      { method: "POST", body },
    );
  },
  generate: (key: string, shotId: string) =>
    jsonRequest<DemoPayload & { key: string; runId: string; promptId: string }>(
      `/api/projects/${encodeURIComponent(key)}/shots/${encodeURIComponent(shotId)}/generate`,
      { method: "POST" },
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
  assetUrl: (key: string, assetId: string) =>
    `/api/projects/${encodeURIComponent(key)}/assets/${encodeURIComponent(assetId)}/content`,
  worker: () => jsonRequest<WorkerStatus>("/api/workers/comfy"),
};
