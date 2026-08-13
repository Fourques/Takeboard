import { expect, test } from "@playwright/test";

test("fake generation and approval survive reload", async ({ page }) => {
  await page.goto("/");
  const closeCreate = page.getByRole("button", { name: "关闭新建项目" });
  if (await closeCreate.isVisible()) await closeCreate.click();
  await page.getByRole("button", { name: "打开功能示例" }).click();
  await expect(page.getByText("雾港来信", { exact: true }).first()).toBeVisible();

  const reset = page.getByRole("button", { name: "重置 Demo" });
  await reset.click();
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByText("这个镜头还没有 Take")).toBeVisible();

  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByRole("button", { name: "选择候选 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: /选择候选/ })).toHaveCount(4);

  await page.getByRole("button", { name: "选择候选 1" }).click();
  await page.getByLabel("淘汰原因").selectOption("角色漂移");
  await page.getByRole("button", { name: "淘汰" }).click();
  await expect(page.getByText("REJECTED")).toBeVisible();

  await page.getByRole("button", { name: "选择候选 2" }).click();
  await page.getByRole("button", { name: "批准此 Take" }).click();
  await expect(page.getByText("APPROVED").first()).toBeVisible();
  await expect(page.getByText("镜头完成度").locator("..").getByText("1/3")).toBeVisible();

  await page.reload();
  await expect(page.getByText("APPROVED").first()).toBeVisible();
  await expect(page.getByText("REJECTED")).toBeVisible();
  await expect(page.getByText(/已保存 · r/)).toBeVisible();
  await page.screenshot({ path: "test-results/takeboard-demo-approved.png", fullPage: true });
});

test("a user can create and reopen a real project", async ({ page }) => {
  const title = `TakeBoard 真实项目 ${Date.now()}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /把一次抽卡/ })).toBeVisible();

  const nameInput = page.getByLabel("项目名称");
  if (!(await nameInput.isVisible())) {
    await page.getByRole("button", { name: /新建项目/ }).click();
  }
  await nameInput.fill(title);
  await page.getByLabel("第一场名称").fill("潮汐站台");
  await page
    .getByLabel("第一个镜头意图")
    .fill("人物迎着海风回头，镜头缓慢推进。保持身份、服装和背景稳定。");
  await page.getByRole("button", { name: "创建并打开 →" }).click();

  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("SH-01", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "快速添加首帧" })).toBeVisible();
  await page.getByRole("button", { name: "彩色主题" }).click();
  await page.getByRole("button", { name: "工作流", exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "工作流与模型" })).toBeVisible();
  await page.screenshot({
    path: "test-results/takeboard-workflow-studio.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭工作流面板" }).click();
  await page.getByRole("button", { name: "资产库", exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "项目资产库" })).toBeVisible();
  await page.screenshot({
    path: "test-results/takeboard-asset-library.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭资产库" }).click();
  await page.screenshot({ path: "test-results/takeboard-real-project.png", fullPage: true });

  await page.getByRole("button", { name: "项目主页" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});
