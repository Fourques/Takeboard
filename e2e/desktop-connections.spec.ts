// Isolated DOM tests for the bundled form. IPC is explicitly stubbed here;
// actual native window/transport coverage lives in the Linux smoke and SSH tests.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("connection form keeps pending state, saves verified targets and confirms disconnect", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      __TAURI__: unknown;
      testEvents: (value: unknown) => void;
      testInvocations: { command: string; args: unknown }[];
    };
    state.testInvocations = [];
    state.__TAURI__ = {
      event: {
        listen: async (_name: string, handler: (event: unknown) => void) => {
          state.testEvents = (value) => handler({ payload: value });
        },
      },
      core: {
        invoke: async (command: string, args: unknown) => {
          state.testInvocations.push({ command, args });
          if (command === "connection_status") return { state: "idle" };
          if (command === "connect_remote") {
            state.testEvents({ state: "idle" });
            // The real process is asynchronous; test that an intermediate idle
            // event cannot enable a duplicate submission or cancel automatic open.
          }
          if (command === "disconnect_remote") state.testEvents({ state: "idle" });
        },
      },
    };
  });
  await page.route("https://desktop.test/**", async (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (!["connections.html", "connections.js", "connections.css"].includes(file))
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
  await page.goto("https://desktop.test/connections.html");
  await page.getByLabel("SSH 主机", { exact: true }).fill("user@server");
  const connect = page.getByRole("button", { name: "连接并打开", exact: true });
  await connect.click();
  await expect(connect).toBeDisabled();
  await expect(page.locator("#status")).toContainText("正在验证");
  await page.evaluate(() => {
    const state = window as unknown as { testEvents: (value: unknown) => void };
    state.testEvents({
      state: "ready",
      target: { kind: "ssh", address: "user@server", port: null },
      instanceId: "verified-instance",
      localPort: 52000,
    });
  });
  await expect(connect).toBeEnabled();
  await expect(page.locator("#recent")).toContainText("user@server");
  const invocations = () =>
    page.evaluate(() =>
      (window as unknown as { testInvocations: { command: string }[] }).testInvocations.map(
        (item) => item.command,
      ),
    );
  await expect.poll(invocations).toContain("open_remote_workspace");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "断开连接", exact: true }).click();
  expect(await invocations()).not.toContain("disconnect_remote");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "断开连接", exact: true }).click();
  await expect.poll(invocations).toContain("disconnect_remote");
  await expect(page.getByRole("button", { name: "打开远程窗口" })).toBeHidden();
  await page.setViewportSize({ width: 380, height: 440 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
