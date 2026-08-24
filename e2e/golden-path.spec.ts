import { expect, test } from "@playwright/test";

test("project hub presents a complete project overview", async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  for (const project of [
    { title: "潮汐来信", aspectRatio: "9:16", sceneTitle: "雾港", firstShotIntent: "穿过雾气" },
    { title: "纸月旅馆", aspectRatio: "16:9", sceneTitle: "前厅", firstShotIntent: "推门进入" },
    { title: "黑曜计划", aspectRatio: "4:5", sceneTitle: "控制室", firstShotIntent: "信号亮起" },
  ]) {
    const response = await request.post("/api/projects", { data: project });
    expect(response.ok()).toBeTruthy();
  }

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从素材到成片，都在一张画布。" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "搜索项目" })).toBeVisible();
  await expect(page.locator(".project-card-managed")).toHaveCount(3);
  await page.screenshot({
    path: "test-results/takeboard-home.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("canvas nodes reveal their own contextual inspector", async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem("takeboard.resumeDemo", "1"));
  await page.goto("/");
  const closeCreate = page.getByRole("button", { name: "关闭新建项目" });
  if (await closeCreate.isVisible()) await closeCreate.click();

  const scriptNode = page.locator(".react-flow__node-text");
  await scriptNode.click();
  await expect(page.getByLabel("剧本节点检查器")).toBeVisible();
  await expect(
    page.getByLabel("剧本节点检查器").getByRole("heading", { name: "场景剧本" }),
  ).toBeVisible();
  await expect(scriptNode).toHaveClass(/selected/);

  const entityNode = page.locator(".react-flow__node-entity");
  await entityNode.click();
  await expect(page.getByLabel("实体节点检查器")).toBeVisible();
  await expect(
    page.getByLabel("实体节点检查器").getByRole("heading", { name: "林夏" }),
  ).toBeVisible();
  await expect(entityNode).toHaveClass(/selected/);
  await expect(scriptNode).not.toHaveClass(/selected/);

  const assetNode = page.locator(".react-flow__node-asset");
  await assetNode.click();
  await expect(page.getByLabel("素材节点检查器")).toBeVisible();
  await expect(page.getByRole("heading", { name: "作为镜头输入" })).toBeVisible();
  await page.screenshot({
    path: "test-results/takeboard-context-inspector.png",
    fullPage: true,
    animations: "disabled",
  });

  const secondShot = page.locator(".react-flow__node-shot").nth(1);
  await secondShot.click();
  await expect(
    page.getByLabel("镜头候选检查器").getByRole("heading", { name: "S002" }),
  ).toBeVisible();
  await expect(secondShot).toHaveClass(/selected/);
});

test("fake generation and approval survive reload", async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem("takeboard.resumeDemo", "1"));
  await page.goto("/");
  const closeCreate = page.getByRole("button", { name: "关闭新建项目" });
  if (await closeCreate.isVisible()) await closeCreate.click();
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

test("reopening a project resumes and reconciles an active generation", async ({
  page,
  request,
}) => {
  const title = `TakeBoard 恢复任务 ${Date.now()}`;
  const created = await request.post("/api/projects", {
    data: { title, aspectRatio: "16:9" },
  });
  expect(created.ok()).toBeTruthy();
  const createdPayload = await created.json();
  const key = createdPayload.key as string;
  const runningSnapshot = structuredClone(createdPayload.snapshot);
  const shot = runningSnapshot.shots[0];
  const timestamp = new Date().toISOString();
  const runId = "run_018f4f52-9d8b-8abc-8def-0123456789ab";
  shot.status = "generating";
  runningSnapshot.runs.push({
    id: runId,
    shotId: shot.id,
    recipeId: "recipe_018f4f52-9d8b-8abc-8def-0123456789ac",
    recipeVersion: "wan22-i2v-turbo@1",
    workflowSha256: "a".repeat(64),
    workerId: "worker_018f4f52-9d8b-8abc-8def-0123456789ad",
    promptId: "prompt-recovery",
    status: "running",
    inputs: [],
    parameters: {},
    errorCode: null,
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const completedSnapshot = structuredClone(runningSnapshot);
  completedSnapshot.runs[0].status = "completed";
  completedSnapshot.shots[0].status = "draft";
  let pollCount = 0;

  await page.route(`**/api/projects/${key}`, async (route) => {
    await route.fulfill({ json: { key, revision: 2, snapshot: runningSnapshot } });
  });
  await page.route(`**/api/projects/${key}/runs/${runId}`, async (route) => {
    pollCount += 1;
    await route.fulfill({
      json: { key, runId, status: "completed", revision: 3, snapshot: completedSnapshot },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `打开 ${title} 的SC-01` }).click();
  await expect(page.getByText("SH-01", { exact: true }).first()).toBeVisible();
  await expect.poll(() => pollCount).toBeGreaterThan(0);
  await expect(page.getByText("已保存 · r3")).toBeVisible();
});

test("a user can create and reopen a real project", async ({ page }) => {
  const title = `TakeBoard 真实项目 ${Date.now()}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从素材到成片，都在一张画布。" })).toBeVisible();

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
  const paddedPng = Buffer.alloc(2 * 1024 * 1024);
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ).copy(paddedPng);
  await page.locator(".asset-library input[type=file]").setInputFiles({
    name: "two-megabyte-reference.png",
    mimeType: "image/png",
    buffer: paddedPng,
  });
  await expect(page.getByText("two-megabyte-reference.png 已加入项目资产库")).toBeVisible();
  await page.screenshot({
    path: "test-results/takeboard-asset-library.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭资产库" }).click();

  const shotNodes = page.locator(".react-flow__node-shot");
  const originalShotCount = await shotNodes.count();
  await shotNodes.first().dblclick();
  const nodeEditor = page.locator(".node-editor-modal");
  await expect(nodeEditor.getByRole("heading", { name: "编辑镜头" })).toBeVisible();
  await nodeEditor.getByRole("textbox").first().fill("SH-01A");
  await nodeEditor.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("SH-01A", { exact: true }).first()).toBeVisible();

  await shotNodes.first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: /复制/ }).click();
  const pane = page.locator(".react-flow__pane");
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("画布未渲染");
  await page.mouse.click(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height - 70, {
    button: "right",
  });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: /粘贴节点/ }).click();
  await expect(shotNodes).toHaveCount(originalShotCount + 1);

  page.once("dialog", (dialog) => dialog.accept());
  await shotNodes.last().click({ button: "right" });
  await page.getByRole("menuitem", { name: /从画布移除/ }).click();
  await expect(shotNodes).toHaveCount(originalShotCount);
  await page.screenshot({ path: "test-results/takeboard-real-project.png", fullPage: true });

  await page.getByRole("button", { name: "切换项目" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});
