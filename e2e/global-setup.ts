import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { request } from "@playwright/test";

const port = process.env.TAKEBOARD_E2E_SERVER_PORT ?? "48121";
const baseURL = process.env.TAKEBOARD_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const statePath = resolve("test-results/e2e-auth-state.json");
const credentials = {
  name: "TakeBoard E2E",
  email: "e2e@takeboard.local",
  password: "takeboard e2e private passphrase",
};

export default async function globalSetup() {
  await mkdir(dirname(statePath), { recursive: true });
  const context = await request.newContext({ baseURL });
  try {
    const status = await context.get("/api/auth/status");
    if (!status.ok())
      throw new Error(`Auth status failed: ${status.status()} ${await status.text()}`);
    const configured = ((await status.json()) as { configured: boolean }).configured;
    const authenticated = configured
      ? await context.post("/api/auth/login", {
          data: { email: credentials.email, password: credentials.password },
        })
      : await context.post("/api/auth/bootstrap", { data: credentials });
    if (!authenticated.ok()) {
      throw new Error(
        `E2E authentication failed: ${authenticated.status()} ${await authenticated.text()}`,
      );
    }
    await context.storageState({ path: statePath });
  } finally {
    await context.dispose();
  }
}
