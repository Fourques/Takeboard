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

  const panel = page.getByRole("complementary", { name: "生成任务、存储与诊断中心" });
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
