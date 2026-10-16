import { resolve } from "node:path";
import { type APIRequestContext, test as base, expect } from "@playwright/test";
import type { WorkerDefinition } from "@takeboard/contracts";

/** Explicit UI fixture; never depends on discovered hardware or earlier test mutations. */
export function workerFixture(): WorkerDefinition {
  const at = new Date().toISOString();
  return {
    id: "worker_00000000-0000-4000-8000-000000000001",
    name: "测试生成设备",
    endpoint: "http://127.0.0.1:1",
    kind: "local",
    transport: "loopback",
    enabled: true,
    allowSensitiveInputs: false,
    qualityTier: "balanced",
    priority: 50,
    hourlyRate: null,
    currency: "CNY",
    estimatedJobSeconds: 300,
    retiredAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

const authState = resolve("test-results/e2e-auth-state.json");

export const test = base.extend<{ request: APIRequestContext }>({
  request: async ({ baseURL, playwright }, use) => {
    const discovery = await playwright.request.newContext({ baseURL, storageState: authState });
    const status = await discovery.get("/api/auth/status");
    const csrfToken = ((await status.json()) as { csrfToken: string | null }).csrfToken;
    await discovery.dispose();
    if (!status.ok() || !csrfToken) throw new Error("E2E session is missing its CSRF token");
    const authenticated = await playwright.request.newContext({
      baseURL,
      storageState: authState,
      extraHTTPHeaders: { "x-takeboard-csrf": csrfToken },
    });
    await use(authenticated);
    await authenticated.dispose();
  },
});

export { expect };
