// Native responses are stubbed; this checks the real Settings UI, not SSH reachability.
import { expect, test } from "./fixtures";

test("remote projects stay in settings, preserve failed drafts and require confirmation", async ({
  page,
}) => {
  let status: Record<string, unknown> = { state: "idle", recent: [] };
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI__: {},
      __takeboardNativeActions: 2,
      __takeboardRemoteProjects: true,
    });
  });
  await page.route("https://takeboard-desktop.invalid/remote-project?**", async (route) => {
    const url = new URL(route.request().url());
    const operation = url.searchParams.get("operation") as string;
    const input = JSON.parse(url.searchParams.get("input") ?? "{}");
    calls.push({ operation, input });
    if (operation === "connect") status = { ...status, state: "connecting" };
    if (operation === "disconnect") status = { ...status, state: "idle" };
    if (operation === "forget") status = { ...status, recent: [] };
    await route.fulfill({ status: 204 });
    await page.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent("takeboard:desktop-action", { detail })),
      { actionId: url.searchParams.get("actionId"), data: status },
    );
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "打开工作区选项" })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("takeboard:open-settings", { detail: "remote-projects" })),
  );
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(settings).toBeVisible();
  const panel = settings.getByRole("region", { name: "远程项目连接" });
  await panel.getByLabel("SSH 主机", { exact: true }).fill("user@server");
  await panel.getByLabel("设备名称", { exact: true }).fill("工作站");
  const connect = panel.getByRole("button", { name: "连接并打开", exact: true });
  await connect.click();
  await expect(panel.getByRole("button", { name: "连接中…" })).toBeDisabled();
  status = { state: "failed", recent: [], code: "START_REQUIRED", message: "远端已安装但未启动" };
  await expect(panel.getByText("远端已安装但未启动", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("SSH 主机", { exact: true })).toHaveValue("user@server");
  await panel.getByLabel("允许启动远端已安装的 TakeBoard").check();
  await connect.click();
  expect(calls.filter((call) => call.operation === "connect").at(-1)?.input.allowStart).toBe(true);
  const target = {
    kind: "ssh",
    address: "user@server",
    name: "工作站",
    port: null,
    instanceId: "verified-instance",
    allowStart: true,
  };
  status = { state: "ready", target, recent: [target] };
  await expect.poll(() => calls.some((call) => call.operation === "open")).toBe(true);
  const recent = panel.getByRole("list", { name: "已保存的项目设备" });
  await expect(recent).toContainText("工作站");
  await panel.getByRole("button", { name: "断开连接", exact: true }).click();
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  expect(calls.some((call) => call.operation === "disconnect")).toBe(false);
  await panel.getByRole("button", { name: "断开连接", exact: true }).click();
  await panel.getByRole("button", { name: "确认", exact: true }).click();
  await expect(panel.getByText("尚未连接", { exact: true })).toBeVisible();
  await recent.getByRole("button", { name: "移除", exact: true }).click();
  await panel.getByRole("button", { name: "确认", exact: true }).click();
  await expect(recent).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/remote-project-settings-narrow.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/remote-project-settings-desktop.png" });
  await settings.getByRole("button", { name: "关闭设置" }).click();
  expect(page.context().pages()).toHaveLength(1);
});

test("an early native menu request survives startup and is consumed once", async ({ page }) => {
  await page.addInitScript(() =>
    Object.assign(window, { __takeboardPendingSettings: "remote-projects" }),
  );
  await page.goto("/");
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("button", { name: "远程项目", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    settings.getByText("请在此电脑的新版桌面 App 设置中管理连接。", { exact: true }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "关闭设置" }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __takeboardPendingSettings?: string }).__takeboardPendingSettings,
    ),
  ).toBeUndefined();
});
