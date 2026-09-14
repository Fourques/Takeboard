import { expect, test } from "./fixtures";

test("failed edits keep drafts and offer a real recovery destination without automatic retry", async ({
  page,
  request,
}) => {
  const title = `错误恢复 ${Date.now()}`;
  const created = await request.post("/api/projects", {
    data: { title, firstShotIntent: "反馈验收" },
  });
  const { key } = await created.json();
  let failedEdits = 0;
  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.locator(".react-flow__node-shot").dblclick();
    const inspector = page.getByLabel("镜头候选检查器");
    await inspector.getByLabel("镜头名称").fill("保留未保存的名称");
    await page.route(`**/api/projects/${key}/commands`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      failedEdits++;
      await route.fulfill({
        status: 503,
        json: { error: "无法连接 TakeBoard 服务（ECONNREFUSED）" },
      });
    });
    await inspector.getByRole("button", { name: "保存镜头" }).click();
    const notice = page.locator(".recovery-toast");
    await expect(notice).toContainText("暂时无法连接服务");
    await expect(notice.locator("pre")).toBeHidden();
    await expect(inspector.getByLabel("镜头名称")).toHaveValue("保留未保存的名称");
    await notice.getByRole("button", { name: "检查连接" }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("button", { name: "设备连接", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await settings.getByRole("button", { name: "关闭设置" }).click();
    await notice.getByText("技术详情", { exact: true }).click();
    await expect(notice.locator("pre")).toContainText("ECONNREFUSED");
    expect(failedEdits).toBe(1);
    await notice.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect(inspector.getByLabel("镜头名称")).toHaveValue("保留未保存的名称");
  } finally {
    await request.delete(`/api/projects/${key}`);
  }
});
