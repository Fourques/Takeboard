import { expect, test } from "./fixtures";

test("global operations center exposes real task and storage state", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "打开生成任务、存储与诊断中心" });
  await expect(trigger).toBeVisible();
  expect(
    await trigger
      .locator("strong")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(12);
  await trigger.click();

  const panel = page.getByRole("dialog", { name: "生成任务、存储与诊断中心" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("运行中心", { exact: true })).toBeVisible();
  await panel.getByRole("tab", { name: "存储空间" }).click();
  await expect(panel.getByText("当前磁盘可用")).toBeVisible();
  await expect(panel.getByText("项目占用")).toBeVisible();
  await expect(panel.getByText(/安全余量/)).toBeVisible();

  await panel.getByRole("tab", { name: "运行诊断" }).click();
  await expect(panel.getByText(/当前基础环境正常|项建议处理|项会阻止正常使用/)).toBeVisible();
  await expect(panel.getByText(/不包含项目名称、账号、素材内容/)).toBeVisible();
  await page.screenshot({
    path: "test-results/takeboard-diagnostics.png",
    animations: "disabled",
  });
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载报告" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^takeboard-support-\d{4}-\d{2}-\d{2}\.json$/);
});

test("homepage chrome and operations center adapt to a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 560 });
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
  const canvasDensity = await page.locator(".universe-webgl canvas").evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    return element.width / Math.max(1, element.clientWidth);
  });
  expect(canvasDensity).toBeGreaterThanOrEqual(1.2);
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

  await page.getByRole("button", { name: "打开生成任务、存储与诊断中心" }).click();
  const panel = page.getByRole("dialog", { name: "生成任务、存储与诊断中心" });
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  if (!bounds) throw new Error("任务中心没有可测量的布局边界");
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(560);

  await panel.getByRole("tab", { name: "运行诊断" }).click();
  await expect(panel.getByText(/当前基础环境正常|项建议处理|项会阻止正常使用/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "下载报告" })).toBeVisible();
  await page.screenshot({
    path: "test-results/takeboard-operations-short.png",
    animations: "disabled",
  });
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
  await expect(page.getByRole("button", { name: "打开生成任务、存储与诊断中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ComfyUI 连接与安全启动" })).toBeVisible();
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
