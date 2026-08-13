import type { ProjectSnapshot } from "@takeboard/contracts";

export type DemoPayload = {
  revision: number;
  snapshot: ProjectSnapshot;
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
