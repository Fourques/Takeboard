import { expect, test } from "./fixtures";

test("a late mutation response cannot replace a different open project", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const createdA = await request.post("/api/projects", { data: { title: `迟到响应 A ${suffix}` } });
  const createdB = await request.post("/api/projects", { data: { title: `当前项目 B ${suffix}` } });
  expect(createdA.ok()).toBeTruthy();
  expect(createdB.ok()).toBeTruthy();
  const a = await createdA.json();
  const b = await createdB.json();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let serverApplied = false;
  await page.route(`**/api/projects/${a.key}/commands`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    serverApplied = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: `迟到响应 A ${suffix}` })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.getByRole("button", { name: "添加镜头", exact: true }).click();
    await expect.poll(() => serverApplied).toBe(true);
    await page.getByRole("button", { name: "切换项目", exact: true }).click();
    await page
      .locator(".project-card")
      .filter({ hasText: `当前项目 B ${suffix}` })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await expect(page.locator(".shot-list > button")).toHaveCount(0);
    const completed = page.waitForResponse((response) =>
      response.url().endsWith(`/api/projects/${a.key}/commands`),
    );
    release();
    await completed;
    await expect(page.locator(".topbar")).toContainText(`当前项目 B ${suffix}`);
    await expect(page.locator(".shot-list > button")).toHaveCount(0);
    await expect(page.locator(".react-flow__node-shot")).toHaveCount(0);
    // The already-submitted action belongs to A; changing UI context does not undo it.
    const savedA = await (await request.get(`/api/projects/${a.key}`)).json();
    expect(savedA.snapshot.shots).toHaveLength(1);
  } finally {
    release();
    await request.delete(`/api/projects/${a.key}`);
    await request.delete(`/api/projects/${b.key}`);
  }
});

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
