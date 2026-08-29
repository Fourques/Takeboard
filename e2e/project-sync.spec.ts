import { expect, test } from "./fixtures";

test("stale edits are blocked and the second workspace recovers to the latest revision", async ({
  browser,
  page,
  baseURL,
  request,
}) => {
  const title = `同步冲突验收 ${Date.now().toString(36)}`;
  const created = await request.post("/api/projects", { data: { title } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const key = ((await created.json()) as { key: string }).key;
  const secondContext = await browser.newContext({
    baseURL,
    storageState: "test-results/e2e-auth-state.json",
  });
  const secondPage = await secondContext.newPage();
  try {
    await secondPage.route(`**/api/projects/${key}/sync`, async (route) => route.abort());
    for (const workspace of [page, secondPage]) {
      await workspace.goto("/");
      const card = workspace.locator(".project-card").filter({ hasText: title });
      await card.getByRole("button", { name: /打开画板/ }).click();
      await expect(workspace.getByRole("button", { name: "添加镜头" })).toBeVisible();
    }

    await page.getByRole("button", { name: "添加镜头" }).click();
    await expect(page.locator(".shot-list > button")).toHaveCount(1);

    await secondPage.getByRole("button", { name: "添加镜头" }).click();
    await expect(
      secondPage.getByText(
        "项目刚刚在其他设备发生变化；已载入最新版本，请确认后再次执行刚才的操作。",
      ),
    ).toBeVisible();
    await expect(secondPage.locator(".shot-list > button")).toHaveCount(1);
    await expect(secondPage.locator(".save-status")).toContainText("r2");

    await secondPage.unroute(`**/api/projects/${key}/sync`);
    await page.getByRole("button", { name: "添加镜头" }).click();
    await expect(page.locator(".shot-list > button")).toHaveCount(2);
    await expect(secondPage.locator(".shot-list > button")).toHaveCount(2, { timeout: 8_000 });
    await expect(secondPage.locator(".save-status")).toContainText("r3");
  } finally {
    await secondContext.close();
    await request.delete(`/api/projects/${key}`);
  }
});
