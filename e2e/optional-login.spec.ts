import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { buildApp } from "../apps/server/src/app";

test("device creation needs no signup; optional login can close, switch identity and return safely", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), "takeboard-optional-browser-"));
  const app = buildApp({
    projectsRoot: join(root, "projects"),
    webRoot: resolve("apps/web/dist"),
    auth: { mode: "optional", databasePath: join(root, "auth.db") },
    backupAutomation: false,
    runReconciliation: false,
  });
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  const context = await browser.newContext({
    baseURL: url,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "创建 TakeBoard 账号" })).toHaveCount(0);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "账号登录" })).toBeVisible();
    await page.getByRole("button", { name: "关闭登录" }).click();
    await expect(page.getByRole("dialog", { name: "账号登录" })).toHaveCount(0);
    const name = page.getByLabel("项目名称");
    if (!(await name.isVisible()))
      await page
        .getByRole("button", { name: /新建项目/ })
        .first()
        .click();
    await name.fill("Device without signup");
    // Fail the real submit request, not a synthetic connection-status event.
    await page.route("**/api/projects", (route) => route.abort("connectionrefused"));
    await page.getByRole("button", { name: "进入画布 →" }).click();
    await expect(page.getByRole("button", { name: "检查连接", exact: true })).toBeVisible();
    await expect(name).toHaveValue("Device without signup");
    await page.unroute("**/api/projects");
    await page.getByRole("button", { name: "检查连接", exact: true }).click();
    await expect(page.getByRole("button", { name: "检查连接", exact: true })).toHaveCount(0);
    await expect(name).toHaveValue("Device without signup");
    await page.getByRole("button", { name: "进入画布 →" }).click();
    await expect(page.getByText("Device without signup", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByLabel("你的名字").fill("Browser Owner");
    await page.getByLabel("邮箱", { exact: true }).fill("optional@example.com");
    await page.getByLabel("管理员密码", { exact: true }).fill("correct horse battery staple");
    await page.getByLabel("再次输入密码").fill("correct horse battery staple");
    await page.getByRole("button", { name: "创建账号", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "账号登录" })).toHaveCount(0);
    await expect(page.locator(".account-button").first()).toHaveAttribute("title", "账号与权限");
    await page.locator(".account-button").first().click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "回到你的创作空间" })).toHaveCount(0);
    const status = await context.request.get(`${url}/api/auth/status`);
    expect(await status.json()).toMatchObject({ access: "local", user: null });
    await page.screenshot({ path: "test-results/optional-login-home.png", fullPage: false });
  } finally {
    await context.close();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
