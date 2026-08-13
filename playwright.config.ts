import { defineConfig } from "@playwright/test";

const localEnvironment = {
  ...process.env,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.TAKEBOARD_E2E_BASE_URL ?? "http://127.0.0.1:48110",
    viewport: { width: 1600, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: process.env.TAKEBOARD_E2E_REMOTE
    ? undefined
    : [
        {
          command: "node apps/server/dist/index.js",
          url: "http://127.0.0.1:48120/api/health",
          env: localEnvironment,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
        {
          command: "./node_modules/.bin/vite --config vite.config.ts",
          cwd: "apps/web",
          url: "http://127.0.0.1:48110",
          env: localEnvironment,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      ],
});
