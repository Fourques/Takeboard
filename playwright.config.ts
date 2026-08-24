import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const localEnvironment = {
  ...process.env,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
};
const e2eServerPort = process.env.TAKEBOARD_E2E_SERVER_PORT ?? "48121";
const e2eWebPort = process.env.TAKEBOARD_E2E_WEB_PORT ?? "48111";
const e2eServerUrl = `http://127.0.0.1:${e2eServerPort}`;
const e2eWebUrl = `http://127.0.0.1:${e2eWebPort}`;
const e2eDataRoot = process.env.TAKEBOARD_E2E_DATA_ROOT ?? resolve("test-results/e2e-data");
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.TAKEBOARD_E2E_BASE_URL ?? e2eWebUrl,
    viewport: { width: 1600, height: 900 },
    trace: "retain-on-failure",
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
    : [
        {
          command: "node apps/server/dist/index.js",
          url: `${e2eServerUrl}/api/health`,
          env: {
            ...localEnvironment,
            TAKEBOARD_DATA_ROOT: e2eDataRoot,
            TAKEBOARD_PORT: e2eServerPort,
          },
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: `./node_modules/.bin/vite --config vite.config.ts --port ${e2eWebPort}`,
          cwd: "apps/web",
          url: e2eWebUrl,
          env: { ...localEnvironment, TAKEBOARD_API_URL: e2eServerUrl },
          reuseExistingServer: false,
          timeout: 30_000,
        },
      ],
});
