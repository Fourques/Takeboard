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
  await page.route("**/api/admin/workers/*", (route) => {
    const patch = route.request().postDataJSON();
    updates.push(patch);
    worker = { ...worker, ...patch, updatedAt: new Date().toISOString() };
    return route.fulfill({ json: { worker } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "选择生成设备", exact: true }).click();
  await page.getByRole("button", { name: "管理设备" }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByText("调度偏好", { exact: true }).click();
  await settings.locator("summary").filter({ hasText: worker.name }).click();
  await settings.getByRole("combobox", { name: "参与调度", exact: true }).selectOption("true");
  await settings.getByRole("combobox", { name: "素材发送权限", exact: true }).selectOption("true");
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
  await page.getByRole("button", { name: "显示大小：清晰" }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await dialog.getByRole("button", { name: /大字/ }).click();
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
