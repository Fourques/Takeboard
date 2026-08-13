import { expect, test } from "@playwright/test";

test("fake generation and approval survive reload", async ({ page }) => {
  await page.goto("/");
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
