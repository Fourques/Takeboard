// Bundled DOM behavior only. IPC is stubbed; release matching and persistence are
// tested against the real helper separately, and native compilation is a distinct gate.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("desktop update UI saves channels, skips releases and never invents a download URL", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let skippedVersion: string | null = null;
    const host = window as unknown as { __TAURI__: unknown; calls: string[] };
    host.calls = [];
    host.__TAURI__ = {
      core: {
        invoke: async (
          _command: string,
          args: {
            operation: string;
            input?: { channel: string; autoCheck: boolean; skippedVersion: string | null };
          },
        ) => {
          host.calls.push(args.operation);
          const base = {
            currentVersion: "0.2.0-beta.2",
            platform: "darwin",
            arch: "arm64",
            channel: "beta",
            autoCheck: true,
            skippedVersion,
            status: "idle",
            release: null,
          };
          if (args.operation === "save") {
            skippedVersion = args.input?.skippedVersion ?? null;
            return { ...base, ...args.input };
          }
          if (args.operation === "download") return { opened: true };
          if (args.operation === "check")
            return {
              ...base,
              status: "update",
              release: {
                version: "0.3.0",
                filename: "TakeBoard-v0.3.0-macos-arm64.dmg",
                downloadUrl:
                  "https://github.com/Fourques/Takeboard/releases/download/v0.3.0/TakeBoard-v0.3.0-macos-arm64.dmg",
                notes: "<script>not executable</script>",
              },
            };
          return base;
        },
      },
    };
  });
  await page.route("https://desktop.test/**", async (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (!["updates.html", "updates.js", "connections.css", "appearance.js"].includes(file))
      return route.abort();
    await route.fulfill({
      body: await readFile(resolve("apps/desktop/ui", file)),
      contentType: file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    });
  });
  await page.goto("https://desktop.test/updates.html");
  await expect(page.locator("#installed")).toContainText("macOS · arm64");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.locator("#filename")).toContainText("macos-arm64.dmg");
  await page.getByRole("button", { name: "下载此电脑的安装包" }).click();
  await expect(page.getByRole("status")).toContainText("系统浏览器");
  await page.getByRole("button", { name: "跳过这个版本的启动提醒" }).click();
  await expect(page.getByRole("button", { name: "恢复已跳过版本的提醒" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toEqual([
    "status",
    "save",
    "check",
    "download",
    "save",
  ]);
  await page.setViewportSize({ width: 390, height: 620 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
