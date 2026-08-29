import { resolve } from "node:path";
import { type APIRequestContext, test as base, expect } from "@playwright/test";

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
