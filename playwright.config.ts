import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const localEnvironment = {
  ...process.env,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
};
const e2eServerPort = process.env.TAKEBOARD_E2E_SERVER_PORT ?? "48121";
const e2eServerUrl = `http://127.0.0.1:${e2eServerPort}`;
const e2eDataRoot = process.env.TAKEBOARD_E2E_DATA_ROOT ?? resolve("test-results/e2e-data");
const e2eDemoDirectory =
  process.env.TAKEBOARD_E2E_DEMO_DIRECTORY ?? resolve(e2eDataRoot, "demo.takeboard");
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const e2eAuthState = resolve("test-results/e2e-auth-state.json");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Browser journeys share one local project store. Serial execution makes stateful
  // create/delete/import flows deterministic on both developer machines and CI.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.TAKEBOARD_E2E_BASE_URL ?? e2eServerUrl,
    viewport: { width: 1600, height: 900 },
    trace: "retain-on-failure",
    storageState: e2eAuthState,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
      },
    },
  ],
  webServer: process.env.TAKEBOARD_E2E_REMOTE
    ? undefined
    : {
        command: "node apps/server/dist/index.js",
        url: `${e2eServerUrl}/api/health`,
        env: {
          ...localEnvironment,
          TAKEBOARD_DATA_ROOT: e2eDataRoot,
          TAKEBOARD_AUTH_DATABASE: resolve(e2eDataRoot, "system", "auth.db"),
          TAKEBOARD_AUTH_MODE: "required",
          TAKEBOARD_DEMO_DIRECTORY: e2eDemoDirectory,
          TAKEBOARD_WEB_ROOT: resolve("apps/web/dist"),
          TAKEBOARD_PORT: e2eServerPort,
          COMFY_START_SERVICE: "takeboard-e2e-disabled.service",
        },
        reuseExistingServer: false,
        timeout: 30_000,
      },
});
