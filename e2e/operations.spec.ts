import { expect, test } from "./fixtures";

test("global operations center exposes real task and storage state", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "打开生成任务与存储中心" });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const panel = page.getByRole("complementary", { name: "生成任务与存储中心" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("任务与存储", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "存储空间" }).click();
  await expect(panel.getByText("当前磁盘可用")).toBeVisible();
  await expect(panel.getByText("项目占用")).toBeVisible();
  await expect(panel.getByText(/安全余量/)).toBeVisible();
});
