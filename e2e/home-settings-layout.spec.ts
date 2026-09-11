import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("a disabled base device can be re-enabled in settings and media authorization is explicit", async ({
  page,
  request,
}) => {
  const pool = await (await request.get("/api/workers")).json();
  let worker = { ...pool.workers[0].worker, enabled: false, allowSensitiveInputs: false };
  const updates: unknown[] = [];
  await page.route("**/api/generation/connection", (route) =>
    route.fulfill({
      json: {
        workerId: worker.id,
        localWorkerId: worker.id,
        kind: "existing",
        name: worker.name,
        address: worker.endpoint,
        state: "configured",
        profiles: [],
        error: null,
      },
    }),
  );
  await page.route("**/api/workers", (route) =>
    route.fulfill({ json: { ...pool, workers: [{ worker, status: "offline" }] } }),
  );
  await page.route("**/api/generation/connection/*", (route) => {
    const patch = route.request().postDataJSON();
    updates.push(patch);
    worker = { ...worker, ...patch, updatedAt: new Date().toISOString() };
    return route.fulfill({ json: { worker } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "选择生成设备", exact: true }).click();
  await page.getByRole("button", { name: "管理设备" }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(settings.getByText("调度偏好", { exact: true })).toHaveCount(0);
  await expect(settings.getByText(/估算费用/)).toHaveCount(0);
  await settings.getByRole("button", { name: "编辑", exact: true }).click();
  await settings.getByRole("checkbox", { name: "启用设备", exact: true }).check();
  await settings.getByRole("checkbox", { name: "允许向此设备发送素材", exact: true }).check();
  await settings.getByRole("button", { name: "保存设备设置" }).click();
  await expect(settings.getByRole("button", { name: "确认授权并保存" })).toBeVisible();
  expect(updates).toEqual([]);
  await settings.getByRole("button", { name: "确认授权并保存" }).click();
  await expect(settings.getByRole("status")).toHaveText("设备设置已保存");
  expect(updates).toMatchObject([{ enabled: true, allowSensitiveInputs: true }]);
});

test("Aa opens one responsive settings dialog, with readable themes and navigable sections", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开工作区选项" }).click();
  await page.getByRole("button", { name: "显示大小：112%" }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await dialog.getByRole("slider", { name: "字体大小", exact: true }).fill("124");
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 560 },
    { width: 390, height: 620 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(dialog.getByRole("button", { name: "柔彩主题" })).toBeVisible();
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error("Missing settings bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await dialog
      .getByRole("button", { name: "节能 始终使用清晰静态封面" })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole("button", { name: "节能 始终使用清晰静态封面" }),
    ).toBeInViewport();
    await dialog.getByRole("heading", { name: "外观", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/settings-appearance-${viewport.width}.png` });
  }
  const audit = await new AxeBuilder({ page })
    .include(".settings-center")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    audit.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
  ).toEqual([]);
  await dialog.getByRole("button", { name: "关闭设置" }).click();
  await expect(dialog).toHaveCount(0);
});

test("font scale supports one-percent adjustments and the workspace menu remains readable at maximum size", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开工作区选项" }).click();
  await page.getByRole("button", { name: "显示大小：112%" }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  const slider = dialog.getByRole("slider", { name: "字体大小", exact: true });
  await slider.fill("117");
  await dialog.getByRole("button", { name: "放大字体" }).click();
  await expect(slider).toHaveValue("118");
  await dialog.getByRole("button", { name: "缩小字体" }).click();
  await expect(slider).toHaveValue("117");
  await slider.fill("90");
  await expect(dialog.getByRole("button", { name: "缩小字体" })).toBeDisabled();
  await slider.fill("140");
  await expect(dialog.getByRole("button", { name: "放大字体" })).toBeDisabled();
  await dialog.getByRole("button", { name: "关闭设置" }).click();
  await page.setViewportSize({ width: 390, height: 620 });
  await page.getByRole("button", { name: "打开工作区选项" }).click();
  const menu = page.getByRole("dialog", { name: "工作区选项", exact: true });
  for (const name of ["黑曜主题", "明亮主题", "柔彩主题", "显示大小：140%", "设置"]) {
    const button = menu.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    expect(
      await button.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(14);
  }
  for (const span of await menu.locator(".theme-switcher span").all())
    await expect(span).toBeVisible();
  const sizeButton = menu.getByRole("button", { name: "显示大小：140%" });
  const settingsButton = menu.getByRole("button", { name: "设置", exact: true });
  const sizeBounds = await sizeButton.boundingBox();
  const settingsBounds = await settingsButton.boundingBox();
  if (!sizeBounds || !settingsBounds) throw new Error("Missing appearance actions");
  expect(Math.abs(sizeBounds.width - settingsBounds.width)).toBeLessThan(2);
  expect(await sizeButton.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(
    true,
  );
  expect(await menu.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/workspace-menu-large-font.png" });
  await page.setViewportSize({ width: 390, height: 360 });
  await menu.evaluate((element) => {
    element.scrollTop = 0;
  });
  const backgroundScroll = await page
    .locator(".hub-shell")
    .evaluate((element) => element.scrollTop);
  await menu.getByText("工作区选项", { exact: true }).hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator(".hub-shell").evaluate((element) => element.scrollTop)).toBe(
    backgroundScroll,
  );
});

test("optional account entry opens a usable login dialog instead of a collapsed arrow popup", async ({
  page,
}) => {
  // Only optional-auth presentation is mocked; real login/session tests live in auth.spec.ts.
  await page.route("**/api/auth/status", async (route) => {
    await route.fulfill({
      json: {
        enabled: true,
        configured: true,
        user: null,
        access: "local",
        localAvailable: true,
        csrfToken: null,
      },
    });
  });
  await page.goto("/");
  const entry = page.getByRole("button", { name: "登录", exact: true });
  await expect(entry.locator("svg")).toBeVisible();
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "账号登录" });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 620 },
  ]) {
    await page.setViewportSize(viewport);
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error("Missing account bounds");
    expect(bounds.height).toBeGreaterThan(350);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await dialog.getByLabel("邮箱").fill("creator@example.com");
    await dialog.getByLabel("密码", { exact: true }).fill("example password");
    await dialog.getByRole("button", { name: "进入 TakeBoard" }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "进入 TakeBoard" })).toBeInViewport();
    await page.screenshot({ path: `test-results/login-dialog-${viewport.width}.png` });
  }
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("device quick list hides an unavailable default and never calls an unprobed SSH device online", async ({
  page,
}) => {
  const now = new Date().toISOString();
  await page.route("**/api/generation/connection", (route) =>
    route.fulfill({
      json: {
        workerId: "base",
        localWorkerId: "base",
        kind: "existing",
        name: "默认 ComfyUI",
        address: "http://127.0.0.1:8188",
        state: "configured",
        error: null,
        profiles: [
          {
            workerId: "saved",
            target: { kind: "ssh", name: "剪辑室", host: "user@studio", port: 8188 },
          },
        ],
      },
    }),
  );
  await page.route("**/api/workers", (route) =>
    route.fulfill({
      json: {
        defaultWorkerId: "base",
        workers: [
          {
            worker: {
              id: "base",
              name: "默认 ComfyUI",
              endpoint: "http://127.0.0.1:8188",
              enabled: true,
              updatedAt: now,
            },
            status: "offline",
          },
          {
            worker: {
              id: "saved",
              name: "剪辑室",
              endpoint: "http://127.0.0.1:1/ssh/saved",
              enabled: true,
              updatedAt: now,
            },
            status: "offline",
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "选择生成设备", exact: true }).click();
  const list = page.getByRole("complementary", { name: "选择生成设备" });
  await expect(list.getByRole("button", { name: "剪辑室 user@studio 未连接" })).toBeVisible();
  await expect(list.getByText("默认 ComfyUI")).toHaveCount(0);
  await expect(list.getByText("可连接", { exact: true })).toHaveCount(0);
  await expect(list.locator("input")).toHaveCount(0);
});
