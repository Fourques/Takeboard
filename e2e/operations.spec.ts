import { resolve } from "node:path";
import { expect, test } from "./fixtures";

test("global operations center exposes real task and storage state", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "打开生成任务与存储空间" });
  await expect(trigger).toBeVisible();
  expect(
    await trigger
      .locator("strong")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(12);
  await trigger.click();

  const panel = page.getByRole("dialog", { name: "生成任务与存储空间" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("运行中心", { exact: true })).toBeVisible();
  await panel.getByRole("tab", { name: "存储空间" }).click();
  await expect(panel.getByText("当前磁盘可用")).toBeVisible();
  await expect(panel.getByText("项目占用")).toBeVisible();
  const breakdown = await panel.locator(".storage-breakdown").boundingBox();
  const refresh = await panel.getByRole("button", { name: "刷新空间" }).boundingBox();
  if (!breakdown || !refresh) throw new Error("Storage summary is missing");
  expect(refresh.y - (breakdown.y + breakdown.height)).toBeGreaterThanOrEqual(24);
  await expect(panel.getByRole("tab", { name: "运行诊断" })).toHaveCount(0);

  await page.getByRole("button", { name: "关闭任务中心" }).click();
  let inspections = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/operations/diagnostics") inspections++;
  });
  await page.getByRole("button", { name: "打开工作区选项" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "运行诊断", exact: true }).click();
  await expect(settings.getByRole("button", { name: "开始检测" })).toBeVisible();
  expect(inspections).toBe(0);
  await settings.getByRole("button", { name: "开始检测" }).click();
  await expect(settings.getByRole("button", { name: "下载报告" })).toBeVisible();
  expect(inspections).toBe(1);
  await expect(settings.locator(".diagnostic-results article").first()).toBeVisible();
  await page.screenshot({ path: "test-results/takeboard-diagnostics.png", animations: "disabled" });
  const downloadPromise = page.waitForEvent("download");
  await settings.getByRole("button", { name: "下载报告" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^takeboard-support-\d{4}-\d{2}-\d{2}\.json$/);
});

test("homepage chrome and operations center adapt to a short viewport", async ({
  baseURL,
  browser,
}) => {
  // DPR is a browser/device property, not a promise made by a shared CI host. Exercise the crisp
  // rendering contract in an explicit high-density context so this test cannot randomly become a
  // DPR=1 test when GitHub changes runner hardware or software rendering.
  const context = await browser.newContext({
    baseURL,
    deviceScaleFactor: 2,
    storageState: resolve("test-results/e2e-auth-state.json"),
    viewport: { width: 1024, height: 560 },
  });
  const page = await context.newPage();
  try {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "启用可旋转的三维导演板" })).toHaveCount(0);
    await expect(page.locator(".scene-companion")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "新建项目" })).toBeVisible();
    await expect(page.getByRole("button", { name: "打开工作区选项" })).toBeVisible();
    await expect(page.locator(".hub-header")).toHaveCSS("overflow", "visible");

    const header = await page.locator(".hub-header-inner").boundingBox();
    if (!header) throw new Error("首页顶栏没有可测量的布局边界");
    expect(header.x + header.width).toBeLessThanOrEqual(1024);
    const accountButton = await page.locator(".hub-header .account-button.compact").boundingBox();
    const accountAvatar = await page
      .locator(".hub-header .account-button.compact > span")
      .boundingBox();
    if (!accountButton || !accountAvatar) throw new Error("账号头像没有可测量的布局边界");
    const buttonCenter = accountButton.y + accountButton.height / 2;
    const avatarCenter = accountAvatar.y + accountAvatar.height / 2;
    expect(Math.abs(buttonCenter - avatarCenter)).toBeLessThanOrEqual(0.5);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
    await expect
      .poll(
        () =>
          page.locator(".universe-webgl canvas").evaluate((canvas) => {
            const element = canvas as HTMLCanvasElement;
            return element.width / Math.max(1, element.clientWidth);
          }),
        { message: "三维导演板应在高密度屏幕上使用高于 CSS 像素的渲染密度" },
      )
      .toBeGreaterThanOrEqual(1.5);
    await page.screenshot({
      path: "test-results/takeboard-home-short.png",
      animations: "disabled",
    });
    const stageOpacity = await page
      .locator(".hub-artifact-background")
      .evaluate((element) => getComputedStyle(element).opacity);
    await page.locator(".hub-shell").evaluate((element) => {
      const projectSection = element.querySelector<HTMLElement>(".hub-projects");
      const header = element.querySelector<HTMLElement>(".hub-header");
      element.scrollTo({ top: (projectSection?.offsetTop ?? 0) - (header?.offsetHeight ?? 0) });
    });
    await page.waitForTimeout(350);
    await expect(page.locator(".hub-projects")).toBeVisible();
    await expect(page.locator(".hub-artifact-background")).toHaveCSS("opacity", stageOpacity);
    await page.screenshot({
      path: "test-results/takeboard-home-scrolled.png",
      animations: "disabled",
    });

    await page.getByRole("button", { name: "打开生成任务与存储空间" }).click();
    const panel = page.getByRole("dialog", { name: "生成任务与存储空间" });
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    if (!bounds) throw new Error("任务中心没有可测量的布局边界");
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(560);

    await panel.getByRole("tab", { name: "存储空间" }).click();
    await expect(panel.getByText("项目占用", { exact: true })).toBeVisible();
    await page.screenshot({
      path: "test-results/takeboard-operations-short.png",
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
});

test("homepage production dock remains usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const header = page.locator(".hub-header");
  await expect(header).toBeVisible();
  const overflow = await header.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  await expect(page.getByRole("button", { name: "打开生成任务与存储空间" })).toBeVisible();
  await expect(page.getByRole("button", { name: "选择生成设备" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建项目" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开工作区选项" })).toBeVisible();

  await page.getByRole("button", { name: "打开工作区选项" }).click();
  const options = page.getByRole("dialog", { name: "工作区选项" });
  await expect(options).toBeVisible();
  const bounds = await options.boundingBox();
  if (!bounds) throw new Error("工作区选项没有可测量的布局边界");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: "test-results/takeboard-home-mobile.png",
    animations: "disabled",
  });
});
