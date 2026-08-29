import { expect, test } from "@playwright/test";

test("project hub presents a complete project overview", async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const projectFixtures = [
    { title: "潮汐来信", aspectRatio: "9:16", sceneTitle: "雾港", firstShotIntent: "穿过雾气" },
    { title: "纸月旅馆", aspectRatio: "16:9", sceneTitle: "前厅", firstShotIntent: "推门进入" },
    { title: "黑曜计划", aspectRatio: "4:5", sceneTitle: "控制室", firstShotIntent: "信号亮起" },
  ];
  const fixtureTitles = new Set(projectFixtures.map((project) => project.title));
  const existingProjects = (await (await request.get("/api/projects")).json()).projects as Array<{
    key: string;
    title: string;
  }>;
  for (const project of existingProjects.filter((candidate) =>
    fixtureTitles.has(candidate.title),
  )) {
    const deleted = await request.delete(`/api/projects/${project.key}`);
    expect(deleted.ok()).toBeTruthy();
  }
  for (const project of projectFixtures) {
    const response = await request.post("/api/projects", { data: project });
    expect(response.ok()).toBeTruthy();
  }

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从素材到成片，都在一张画布。" })).toBeVisible();
  await expect(page.locator(".project-card-managed")).toHaveCount(3);
  const projectShelf = page.locator(".hub-projects");
  const shelfBox = await projectShelf.boundingBox();
  expect(shelfBox?.y).toBeGreaterThanOrEqual(1100);
  const projectBackdropTop = await projectShelf.evaluate((element) =>
    Number.parseFloat(window.getComputedStyle(element, "::before").top),
  );
  expect(projectBackdropTop).toBe(0);
  await expect(projectShelf).not.toHaveClass(/is-visible/);
  await page.screenshot({
    path: "test-results/takeboard-home.png",
    fullPage: true,
    animations: "disabled",
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1365, height: 1600 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const responsiveShelfBox = await projectShelf.boundingBox();
    expect(responsiveShelfBox?.y).toBeGreaterThanOrEqual(viewport.height);
    const responsiveBackdropWidth = await projectShelf.evaluate((element) =>
      Number.parseFloat(window.getComputedStyle(element, "::before").width),
    );
    expect(responsiveBackdropWidth).toBeGreaterThanOrEqual(viewport.width - 0.1);
    await expect(projectShelf).not.toHaveClass(/is-visible/);
    if (viewport.width === 390) {
      await page.screenshot({
        path: "test-results/takeboard-home-mobile.png",
        animations: "disabled",
      });
    }
  }

  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/");
  const measuredTerminalTop = await projectShelf.evaluate((section) => {
    const shell = section.closest(".hub-shell");
    const header = shell?.querySelector<HTMLElement>(".hub-header");
    return section.offsetTop - (header?.offsetHeight ?? 72);
  });
  const stageHeaderBottom = Math.round(
    (await page.locator(".hub-header").boundingBox())?.height ?? 0,
  );
  expect(measuredTerminalTop).toBeGreaterThan(900);
  const crewCompanion = page.getByRole("button", { name: "触发场记 · 这一条保留" });
  await crewCompanion.click();
  await expect(crewCompanion).toHaveClass(/is-active/);
  await page.locator(".hub-artifact-background").hover({ position: { x: 800, y: 470 } });
  await page.mouse.wheel(0, 160);
  await expect
    .poll(async () => page.locator(".hub-shell").evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const firstWheelTop = await page.locator(".hub-shell").evaluate((element) => element.scrollTop);
  expect(firstWheelTop).toBeLessThan(1028);
  const firstWheelShelfY = (await projectShelf.boundingBox())?.y ?? 0;
  expect(firstWheelShelfY).toBeGreaterThan(stageHeaderBottom);
  expect(firstWheelShelfY).toBeLessThan(1100);
  await page.mouse.wheel(0, measuredTerminalTop - firstWheelTop);
  await expect(projectShelf).toHaveClass(/is-visible/);
  await expect(page.locator(".hub-shell")).toHaveClass(/project-stage-active/);
  await expect
    .poll(async () => Math.round((await projectShelf.boundingBox())?.y ?? -1))
    .toBe(stageHeaderBottom);
  const fittedLibraryTop = await page
    .locator(".hub-shell")
    .evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 1200);
  await expect
    .poll(async () => page.locator(".hub-shell").evaluate((element) => element.scrollTop))
    .toBe(fittedLibraryTop);
  await expect
    .poll(async () => (await page.getByRole("heading", { name: "继续创作" }).boundingBox())?.y)
    .toBeLessThanOrEqual(138);
  expect((await page.getByRole("heading", { name: "继续创作" }).boundingBox())?.y).toBeGreaterThan(
    stageHeaderBottom,
  );
  await expect(page.getByRole("searchbox", { name: "搜索项目" })).toBeVisible();
  await expect(page.locator(".project-curiosities")).toBeVisible();
  const curiositiesBox = await page.locator(".project-curiosities").boundingBox();
  expect((curiositiesBox?.y ?? 0) + (curiositiesBox?.height ?? 0)).toBeLessThanOrEqual(1100);
  const rhythmTool = page.getByRole("button", { name: /剪辑节拍预演/ });
  await expect(rhythmTool).toHaveAccessibleName(/96 BPM/);
  await rhythmTool.click();
  await expect(rhythmTool).toHaveAccessibleName(/120 BPM/);
  const framingTool = page.getByRole("button", { name: /画幅试镜/ });
  await expect(framingTool).toHaveAccessibleName(/16:9/);
  await framingTool.click();
  await expect(framingTool).toHaveAccessibleName(/9:16/);
  const axisTool = page.getByRole("button", { name: /轴线检查/ });
  await expect(axisTool).toHaveAccessibleName(/当前守轴/);
  await axisTool.click();
  await expect(axisTool).toHaveAccessibleName(/当前越轴/);
  const projectBackdropWidth = await projectShelf.evaluate((element) =>
    Number.parseFloat(window.getComputedStyle(element, "::before").width),
  );
  expect(projectBackdropWidth).toBeGreaterThanOrEqual(1600);
  await page.screenshot({
    path: "test-results/takeboard-project-shelf.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "柔彩主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "chroma");
  await page.screenshot({
    path: "test-results/takeboard-project-shelf-chroma.png",
    animations: "disabled",
  });
  await page.locator(".project-card-managed").first().hover();
  await page.mouse.wheel(0, -1600);
  await expect(page.locator(".hub-shell")).not.toHaveClass(/project-stage-active/);
  await expect
    .poll(async () => page.locator(".hub-shell").evaluate((element) => element.scrollTop))
    .toBe(0);
  await page.screenshot({
    path: "test-results/takeboard-home-chroma.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "ComfyUI 连接与安全启动" }).click();
  const workerPanel = page.getByLabel("ComfyUI 连接与安全启动面板");
  await expect(workerPanel).toBeVisible();
  const safeStart = workerPanel.getByRole("button", { name: "安全启动", exact: true });
  if (await safeStart.count()) await expect(safeStart).toBeDisabled();
  else await expect(workerPanel.getByText("执行端已连接")).toBeVisible();
  await page.screenshot({
    path: "test-results/takeboard-worker-panel.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭 ComfyUI 面板" }).click();
});

test("a larger project library keeps scrolling below its sticky heading", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  for (let index = 0; index < 9; index += 1) {
    const response = await request.post("/api/projects", {
      data: {
        title: `扩展项目 ${String(index + 1).padStart(2, "0")}`,
        aspectRatio: index % 2 ? "16:9" : "9:16",
      },
    });
    expect(response.ok()).toBeTruthy();
  }

  await page.goto("/");
  const shell = page.locator(".hub-shell");
  const shelf = page.locator(".hub-projects");
  const heading = page.locator(".hub-section-heading");
  const chapterTop = await shelf.evaluate((section) => {
    const header = section.closest(".hub-shell")?.querySelector<HTMLElement>(".hub-header");
    return section.offsetTop - (header?.offsetHeight ?? 72);
  });
  const headerBottom = Math.round((await page.locator(".hub-header").boundingBox())?.height ?? 0);

  await page.locator(".hub-artifact-background").hover({ position: { x: 800, y: 380 } });
  await page.mouse.wheel(0, chapterTop);
  await expect
    .poll(async () => Math.round((await shelf.boundingBox())?.y ?? -1))
    .toBe(headerBottom);
  const settledTop = await shell.evaluate((element) => element.scrollTop);

  await page.mouse.wheel(0, 420);
  await expect
    .poll(async () => shell.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(settledTop);
  await expect
    .poll(async () => Math.round((await heading.boundingBox())?.y ?? -1))
    .toBe(headerBottom);
  await page.screenshot({
    path: "test-results/takeboard-project-library-scrolling.png",
    animations: "disabled",
  });
});

test("canvas nodes reveal their own contextual inspector", async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem("takeboard.resumeDemo", "1"));
  await page.goto("/");
  const closeCreate = page.getByRole("button", { name: "关闭新建项目" });
  if (await closeCreate.isVisible()) await closeCreate.click();

  for (const nodeType of ["text", "entity", "asset", "shot"]) {
    await expect(
      page.locator(`.react-flow__node-${nodeType}`).first().locator(".board-output-handle"),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(
    page.locator(".react-flow__node-take_stack").first().locator(".board-output-handle"),
  ).toBeVisible();

  const scriptNode = page.locator(".react-flow__node-text");
  await scriptNode.click();
  await expect(page.getByLabel("剧本节点检查器")).toBeVisible();
  await expect(
    page.getByLabel("剧本节点检查器").getByRole("heading", { name: "场景剧本" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("剧本节点检查器").getByRole("button", { name: "＋ 追加到镜头提示词" }),
  ).toBeEnabled();
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
  await expect(page.getByRole("heading", { name: "连接用途" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "自定义标签" })).toBeVisible();
  await page.screenshot({
    path: "test-results/takeboard-context-inspector.png",
    fullPage: true,
    animations: "disabled",
  });

  const secondShot = page.locator(".react-flow__node-shot").nth(1);
  await secondShot.click();
  await expect(page.getByLabel("镜头候选检查器").getByLabel("镜头名称")).toHaveValue("S002");
  await expect(secondShot).toHaveClass(/selected/);
  const canvasWidthWithInspector = (await page.locator(".canvas-wrap").boundingBox())?.width ?? 0;
  await page.locator(".react-flow__pane").click({ position: { x: 40, y: 620 } });
  await expect(page.getByLabel("镜头候选检查器")).toBeHidden();
  await expect(page.locator(".app-shell")).toHaveClass(/inspector-collapsed/);
  await expect
    .poll(async () => (await page.locator(".canvas-wrap").boundingBox())?.width ?? 0)
    .toBeGreaterThan(canvasWidthWithInspector + 300);
  await page.screenshot({
    path: "test-results/takeboard-canvas-expanded.png",
    animations: "disabled",
  });
  await secondShot.click();
  await expect(page.getByLabel("镜头候选检查器")).toBeVisible();
  await page.getByRole("button", { name: "收起检查器" }).click();
  await expect(page.getByLabel("镜头候选检查器")).toBeHidden();
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
  await page.locator(".react-flow__node-shot").first().click();
  await expect(page.locator(".shot-inline-console")).toBeVisible();
  await page.getByRole("button", { name: "批准此 Take" }).click();
  await expect(page.getByText("APPROVED").first()).toBeVisible();
  await expect(page.getByText("镜头完成度").locator("..").getByText("1/3")).toBeVisible();
  await expect(page.locator(".shot-inline-console")).toHaveCount(0);

  await page.locator(".react-flow__node-shot").first().click();
  await expect(page.locator(".shot-inline-console")).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("已有采用结果");
    await dialog.dismiss();
  });
  await page.locator(".shot-inline-generate").click();
  await expect(page.getByRole("button", { name: /选择候选/ })).toHaveCount(4);

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
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.fulfill({
      json: { key, runId, status: "completed", revision: 3, snapshot: completedSnapshot },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `打开 ${title} 的SC-01` }).click();
  await expect(page.getByText("SH-01", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".shot-inline-progress-track")).toBeVisible();
  await expect(page.locator(".shot-inline-generate")).toContainText("已恢复后台生成任务");
  await page.screenshot({
    path: "test-results/takeboard-canvas-generation-progress.png",
    animations: "disabled",
  });
  await expect.poll(() => pollCount).toBeGreaterThan(0);
  await expect(page.getByText("已保存 · r3")).toBeVisible();
});

test("a generated shot becomes the full visual node on canvas", async ({ page, request }) => {
  const title = `TakeBoard 画面节点 ${Date.now()}`;
  const created = await request.post("/api/projects", {
    data: { title, aspectRatio: "16:9", firstShotIntent: "雨中的霓虹街道" },
  });
  expect(created.ok()).toBeTruthy();
  const payload = await created.json();
  const snapshot = structuredClone(payload.snapshot);
  const shot = snapshot.shots[0];
  const timestamp = new Date().toISOString();
  const assetId = "asset_018f4f52-9d8b-8abc-8def-0123456789d1";
  const takeId = "take_018f4f52-9d8b-8abc-8def-0123456789d2";
  const runId = "run_018f4f52-9d8b-8abc-8def-0123456789d3";
  snapshot.assets.push({
    id: assetId,
    projectId: snapshot.project.id,
    mediaType: "image",
    originalName: "generated-frame.png",
    mimeType: "image/png",
    byteSize: 68,
    sha256: "d".repeat(64),
    storagePath: "renders/generated-frame.png",
    proxyPath: null,
    width: 1,
    height: 1,
    customTags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  snapshot.takes.push({
    id: takeId,
    runId,
    shotId: shot.id,
    assetId,
    status: "approved",
    rejectionReasons: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  shot.approvedTakeId = takeId;
  shot.status = "approved";
  shot.workflowPath = "Kino/Kino_QwenImage2512_T2I.json";
  snapshot.runs.push({
    id: runId,
    shotId: shot.id,
    recipeId: "recipe_018f4f52-9d8b-8abc-8def-0123456789d4",
    recipeVersion: "qwen-image-2512-t2i@1",
    workflowSha256: "e".repeat(64),
    workerId: "worker_018f4f52-9d8b-8abc-8def-0123456789d5",
    promptId: "prompt-generated-frame",
    status: "completed",
    inputs: [],
    parameters: { recipePath: "Kino/Kino_QwenImage2512_T2I.json" },
    errorCode: null,
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await page.route(`**/api/projects/${payload.key}`, async (route) => {
    await route.fulfill({ json: { key: payload.key, revision: 2, snapshot } });
  });
  await page.route(`**/api/projects/${payload.key}/assets/${assetId}/content*`, async (route) => {
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `打开 ${title} 的SC-01` }).click();
  const generatedNode = page.locator(".react-flow__node-shot .shot-generated-media");
  await expect(generatedNode).toBeVisible();
  await expect(generatedNode.locator("img")).toHaveAttribute("src", /\/content$/);
  await expect(page.locator(".shot-list .shot-thumb img")).toHaveAttribute(
    "src",
    /\/content\?proxy=1$/,
  );
  await expect(page.locator(".react-flow__node-shot .board-output-handle")).toBeVisible();
  await expect(generatedNode.locator(".approved-stamp")).toHaveCount(0);
  await expect(generatedNode.locator(".shot-generated-overlay")).toContainText(
    /Qwen\s*Image\s*2512 T2I/,
  );
  await expect(generatedNode.locator(".shot-generated-overlay")).toContainText("5 秒");
  await expect(generatedNode.locator(".shot-generated-overlay")).not.toContainText("已批准");
  await expect(page.locator(".react-flow__node-shot")).not.toContainText("未选择模型");
  await page.locator(".react-flow__node-shot").click();
  await expect(page.locator(".recipe-selector")).toBeDisabled();
  await expect(page.locator(".recipe-selector")).toContainText("已随镜头锁定");
  await page.screenshot({
    path: "test-results/takeboard-generated-shot-node.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("a generated video loads and remains controllable on canvas", async ({ page, request }) => {
  const title = `TakeBoard 视频节点 ${Date.now()}`;
  const created = await request.post("/api/projects", {
    data: { title, aspectRatio: "16:9", firstShotIntent: "人物在夜色中回头" },
  });
  expect(created.ok()).toBeTruthy();
  const payload = await created.json();
  const snapshot = structuredClone(payload.snapshot);
  const shot = snapshot.shots[0];
  const timestamp = new Date().toISOString();
  const assetId = "asset_018f4f52-9d8b-8abc-8def-0123456789e1";
  const takeId = "take_018f4f52-9d8b-8abc-8def-0123456789e2";
  const runId = "run_018f4f52-9d8b-8abc-8def-0123456789e3";
  snapshot.assets.push({
    id: assetId,
    projectId: snapshot.project.id,
    mediaType: "video",
    originalName: "generated-shot.mp4",
    mimeType: "video/mp4",
    byteSize: 1844,
    sha256: "f".repeat(64),
    storagePath: "renders/generated-shot.mp4",
    proxyPath: null,
    width: 64,
    height: 36,
    customTags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  snapshot.takes.push({
    id: takeId,
    runId,
    shotId: shot.id,
    assetId,
    status: "approved",
    rejectionReasons: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  shot.approvedTakeId = takeId;
  shot.status = "approved";
  shot.workflowPath = "Kino/Kino_Wan22_I2V.json";
  snapshot.runs.push({
    id: runId,
    shotId: shot.id,
    recipeId: "recipe_018f4f52-9d8b-8abc-8def-0123456789e4",
    recipeVersion: "wan22-i2v-turbo@1",
    workflowSha256: "a".repeat(64),
    workerId: "worker_018f4f52-9d8b-8abc-8def-0123456789e5",
    promptId: "prompt-generated-video",
    status: "completed",
    inputs: [],
    parameters: { recipePath: "Kino/Kino_Wan22_I2V.json" },
    errorCode: null,
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const mp4 = Buffer.from(
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAOzbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAZAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAt10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAZAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAAAkAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAGQAAAEAAABAAAAAAJVbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAFABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACAG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAcBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAJABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2UR/nwEQAAADABAAAAMDIPEiWWABAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAQlQAAEJUAAAAGHN0dHMAAAAAAAAAAQAAAAoAAAIAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAABgY3R0cwAAAAAAAAAKAAAAAQAABAAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAABAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAoAAAABAAAAPHN0c3oAAAAAAAAAAAAAAAoAAALTAAAADgAAAAwAAAAMAAAADAAAABMAAAAOAAAADAAAAAwAAAATAAAAFHN0Y28AAAAAAAAAAQAAA+MAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjU4Ljc2LjEwMAAAAAhmcmVlAAADWW1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTYzIHIzMDYwIDVkYjZhYTYgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIxIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAdZYiEADf//vbw/gU2VgRQlxHN6Hz9AAVXa9rh5JkAAAAKQZokbEN//qfuQAAAAAhBnkJ4hf8RMQAAAAgBnmF0Qr8UsAAAAAgBnmNqQr8UsQAAAA9BmmhJqEFomUwIX//+jcMAAAAKQZ6GRREsL/8RMQAAAAgBnqV0Qr8UsQAAAAgBnqdqQr8UsAAAAA9BmqlJqEFsmUwIV//+OlI=",
    "base64",
  );

  await page.route(`**/api/projects/${payload.key}`, async (route) => {
    await route.fulfill({ json: { key: payload.key, revision: 2, snapshot } });
  });
  await page.route(`**/api/projects/${payload.key}/assets/${assetId}/content*`, async (route) => {
    await route.fulfill({ contentType: "video/mp4", body: mp4 });
  });

  await page.goto("/");
  await page.getByRole("button", { name: `打开 ${title} 的SC-01` }).click();
  const video = page.getByLabel("SH-01 生成视频");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("controls", "");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator(".shot-video-fallback")).toHaveCount(0);
  await expect(page.locator(".shot-generated-overlay")).toContainText("视频");
  await page.screenshot({
    path: "test-results/takeboard-generated-video-node.png",
    animations: "disabled",
  });
});

test("a user can create and reopen a real project", async ({ page }) => {
  test.setTimeout(60_000);
  const title = `TakeBoard 真实项目 ${Date.now()}`;
  const workflowFixture = (input: {
    path: string;
    name: string;
    capability: string;
    capabilityLabel: string;
    inputs: string[];
    mediaInputs: {
      first_frame: number;
      last_frame: number;
      reference: number;
      reference_video?: number;
    };
    origin?: "built_in" | "imported" | "comfyui";
  }) => ({
    id: Buffer.from(input.path).toString("base64url"),
    ...input,
    models: [],
    nodeCount: 12,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
    origin: input.origin ?? "built_in",
  });
  await page.route("**/api/workflows", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        editorUrl: "http://127.0.0.1:48188",
        warnings: [],
        workflows: [
          workflowFixture({
            path: "Kino/Kino_Wan22_I2V.json",
            name: "Wan22 I2V",
            capability: "image_to_video",
            capabilityLabel: "图生视频",
            inputs: [
              "prompt",
              "negative_prompt",
              "first_frame",
              "resolution",
              "duration",
              "fps",
              "seed",
            ],
            mediaInputs: { first_frame: 1, last_frame: 0, reference: 0 },
          }),
          workflowFixture({
            path: "Kino/Kino_Wan22_FLF2V.json",
            name: "Wan22 FLF2V",
            capability: "first_last_video",
            capabilityLabel: "首尾帧视频",
            inputs: [
              "prompt",
              "negative_prompt",
              "first_frame",
              "last_frame",
              "resolution",
              "duration",
              "fps",
              "seed",
            ],
            mediaInputs: { first_frame: 1, last_frame: 1, reference: 0 },
          }),
          workflowFixture({
            path: "Kino/Kino_QwenImage2512_T2I.json",
            name: "Qwen Image 2512 T2I",
            capability: "text_to_image",
            capabilityLabel: "文生图",
            inputs: ["prompt", "negative_prompt", "resolution", "seed", "steps"],
            mediaInputs: { first_frame: 0, last_frame: 0, reference: 0 },
          }),
          workflowFixture({
            path: "Kino/Kino_MiniMaxH3_R2V.json",
            name: "MiniMax H3 R2V",
            capability: "reference_video",
            capabilityLabel: "参考图生视频",
            inputs: [
              "prompt",
              "reference_images",
              "reference_videos",
              "resolution",
              "duration",
              "seed",
            ],
            mediaInputs: {
              first_frame: 0,
              last_frame: 0,
              reference: 9,
              reference_video: 3,
            },
          }),
        ],
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从素材到成片，都在一张画布。" })).toBeVisible();

  const nameInput = page.getByLabel("项目名称");
  if (!(await nameInput.isVisible())) {
    await page.getByRole("button", { name: /新建项目/ }).click();
  }
  await nameInput.fill(title);
  await expect(page.getByLabel("默认画幅")).toHaveCount(0);
  await expect(page.getByLabel("第一场名称")).toHaveCount(0);
  await expect(page.getByLabel("第一个镜头意图")).toHaveCount(0);
  await expect(page.locator(".project-start-card")).toContainText("不预设镜头");
  await page.screenshot({
    path: "test-results/takeboard-new-project.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "进入画布 →" }).click();

  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("空白工作画板")).toBeVisible();
  await expect(page.locator(".react-flow__node-shot")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/takeboard-blank-workspace.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "添加第一个镜头" }).click();
  await expect(page.getByText("SH-01", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".react-flow__node-shot .shot-planning-surface")).toBeVisible();
  await expect(page.locator(".react-flow__node-shot .shot-generated-media")).toHaveCount(0);
  await expect(page.locator(".shot-list .shot-thumb img")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导入参考素材" })).toBeVisible();
  const canvasToolbar = page.locator(".canvas-toolbar");
  await expect(canvasToolbar.locator(".canvas-primary-actions")).toHaveCount(0);
  await expect(canvasToolbar).not.toContainText("工作流");
  await expect(canvasToolbar).not.toContainText("资产库");
  await canvasToolbar.getByRole("button", { name: "查看画布操作" }).click();
  await expect(page.getByRole("complementary", { name: "画布操作说明" })).toContainText(
    "双击或右键空白处",
  );
  await page.getByRole("button", { name: "关闭画布操作说明" }).click();
  await page.getByRole("button", { name: "柔彩主题" }).click();
  await page.locator(".recipe-selector").click();
  await expect(page.getByRole("heading", { name: "工作流与模型" })).toBeVisible();
  await expect(page.getByText("TakeBoard 内置")).toBeVisible();
  await expect(page.getByRole("button", { name: /Wan22 FLF2V/ })).toContainText("2 个画面位置");
  await expect(page.getByRole("button", { name: /MiniMax H3 R2V/ })).toContainText("12 个画面位置");
  await page.getByRole("button", { name: /MiniMax H3 R2V/ }).click();
  await expect(page.locator(".react-flow__node-shot")).toContainText("参考 0/9");
  await expect(page.locator(".react-flow__node-shot")).toContainText("参考视频 0/3");
  await expect(page.getByLabel("画布工作流")).toHaveValue("Kino/Kino_MiniMaxH3_R2V.json");
  await expect(page.getByLabel("画布提示词")).toBeVisible();
  await page.locator(".recipe-selector").click();
  await page.getByRole("button", { name: /Qwen Image 2512 T2I/ }).click();
  await expect(page.getByText("无需图片输入")).toBeVisible();
  await expect(page.locator(".react-flow__node-shot .shot-input")).toHaveCount(0);
  await expect(page.getByLabel("宽度", { exact: true })).toHaveValue("1664");
  await page.screenshot({
    path: "test-results/takeboard-qwen-text-page.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /Qwen Image 2512 T2I/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Wan22 FLF2V/ }).click();
  await expect(page.locator(".react-flow__node-shot .shot-input")).toHaveCount(2);
  await expect(page.locator(".react-flow__node-shot")).toContainText("首帧 0/1");
  await expect(page.locator(".react-flow__node-shot")).toContainText("尾帧 0/1");
  await expect(page.locator(".react-flow__node-shot")).toContainText("Wan22 FLF2V");
  const canvasWidth = page.getByLabel("画布宽度");
  await canvasWidth.fill("");
  await expect(canvasWidth).toHaveValue("");
  await canvasWidth.fill("832");
  await canvasWidth.press("Enter");
  await expect(canvasWidth).toHaveValue("832");
  const canvasDuration = page.getByLabel("画布时长");
  await canvasDuration.fill("");
  await expect(canvasDuration).toHaveValue("");
  await canvasDuration.fill("3.5");
  await canvasDuration.press("Enter");
  await expect(canvasDuration).toHaveValue("3.5");
  await page.locator(".advanced-generation-settings summary").click();
  const inspectorWidth = page.getByLabel("宽度", { exact: true });
  await inspectorWidth.fill("");
  await expect(inspectorWidth).toHaveValue("");
  await inspectorWidth.fill("1024");
  await inspectorWidth.press("Tab");
  await expect(inspectorWidth).toHaveValue("1024");
  await page
    .getByRole("button", { name: /Wan22 FLF2V/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Qwen Image 2512 T2I/ }).click();
  await expect(page.getByLabel("宽度", { exact: true })).toHaveValue("1664");
  await page
    .getByRole("button", { name: /Qwen Image 2512 T2I/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Wan22 FLF2V/ }).click();
  await expect(page.getByLabel("宽度", { exact: true })).toHaveValue("1024");
  await page.screenshot({
    path: "test-results/takeboard-workflow-studio.png",
    fullPage: true,
    animations: "disabled",
  });
  const canvasNodeCountBeforeLibraryImport = await page.locator(".react-flow__node").count();
  await page.getByRole("button", { name: "资产库", exact: false }).first().click();
  await expect(page.getByRole("heading", { name: "项目资产库" })).toBeVisible();
  await expect(page.locator(".asset-library-nav")).toBeVisible();
  await expect(page.getByLabel("素材详情")).toBeVisible();
  await page.getByRole("button", { name: "导入素材" }).first().click();
  await expect(page.getByText("导入不会自动添加到画布")).toBeVisible();
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
  await page.locator(".asset-vault-card").filter({ hasText: "two-megabyte-reference" }).click();
  await expect(page.locator("#asset-detail-name")).toHaveValue("two-megabyte-reference.png");
  await page.getByLabel("新增资产标签").fill("氛围参考");
  await page.getByLabel("新增资产标签").press("Enter");
  await expect(page.getByRole("button", { name: "移除标签 氛围参考" })).toBeVisible();
  await page.locator("#asset-detail-name").fill("雾港氛围参考.png");
  await page.locator(".asset-rename").getByRole("button", { name: "保存" }).click();
  await expect(page.locator("#asset-detail-name")).toHaveValue("雾港氛围参考.png");
  const renamedAssetCard = page.locator(".asset-vault-card").filter({ hasText: "雾港氛围参考" });
  await renamedAssetCard.click({ button: "right" });
  await expect(page.locator(".asset-context-menu")).toBeVisible();
  await expect(page.locator(".asset-context-menu")).toContainText("连接到");
  await page.screenshot({
    path: "test-results/takeboard-asset-context-menu.png",
    animations: "disabled",
  });
  await page.locator(".asset-context-kinds").getByRole("button", { name: "场景" }).click();
  await expect(page.getByLabel("整理分类")).toHaveValue("location");
  await page.getByRole("button", { name: "整理方法" }).click();
  await expect(page.getByText("一套够用的整理方式")).toBeVisible();
  await page.getByRole("button", { name: "整理方法" }).click();
  await page.getByRole("button", { name: "列表视图" }).click();
  await expect(page.locator(".asset-results-list")).toBeVisible();
  await page.getByLabel("搜索资产").fill("氛围参考");
  await expect(page.locator(".asset-vault-card")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/takeboard-asset-library.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭资产库" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(canvasNodeCountBeforeLibraryImport);
  await page
    .locator(".asset-import input[type=file]")
    .setInputFiles("apps/web/public/scene/takeboard-crew-mascot.webp");
  await expect(page.getByText("已导入参考素材：takeboard-crew-mascot.webp")).toBeVisible();
  const originalAssetNode = page.locator(".react-flow__node-asset").last();
  await expect(originalAssetNode).toContainText("SOURCE");
  await expect(originalAssetNode).not.toContainText("takeboard-crew-mascot.webp");
  const originalImage = originalAssetNode.locator("img");
  await expect(originalImage).toHaveAttribute("src", /\/content$/);
  expect(await originalImage.evaluate((image) => getComputedStyle(image).objectFit)).toBe(
    "contain",
  );
  await originalAssetNode.click();
  await expect(page.getByText("原始文件只读保存")).toBeVisible();
  await expect(page.getByText("尚未连接到模型输入")).toBeVisible();
  const customTagInput = page.getByLabel("新增自定义标签");
  await customTagInput.fill("夜景");
  await customTagInput.press("Enter");
  await expect(page.getByRole("button", { name: "移除标签 夜景" })).toBeVisible();
  await page.getByRole("button", { name: "移除标签 夜景" }).click();
  await expect(page.getByRole("button", { name: "移除标签 夜景" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "查看原图 ↗" })).toHaveAttribute(
    "href",
    /\/content$/,
  );
  await page.screenshot({
    path: "test-results/takeboard-original-asset-node.png",
    fullPage: true,
    animations: "disabled",
  });

  const sourceHandle = originalAssetNode.locator(".board-output-handle");
  const targetHandle = page.locator(".react-flow__node-shot .slot-first_frame").first();
  await expect(sourceHandle).toBeVisible();
  await expect(targetHandle).toBeVisible();
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetHandle.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("画布连接端口未渲染");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(page.getByText("已连接为首帧")).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  const shotNodes = page.locator(".react-flow__node-shot");
  await shotNodes.first().click();
  const inlinePrompt = page.getByLabel("画布提示词");
  await inlinePrompt.click();
  await inlinePrompt.pressSequentially("镜头内中文输入正常");
  await expect(inlinePrompt).toHaveValue("镜头内中文输入正常");
  await expect(inlinePrompt).toBeFocused();
  await expect(page.getByLabel("画布生成方式")).toHaveValue("first_last_video");
  await expect(page.getByLabel("画布生成方式")).toContainText("文生图");
  const blankCanvasPoint = await page.locator(".react-flow__pane").evaluate((pane) => {
    const bounds = pane.getBoundingClientRect();
    for (let y = bounds.top + 24; y < bounds.bottom - 24; y += 32) {
      for (let x = bounds.left + 24; x < bounds.right - 24; x += 32) {
        if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane"))
          return { x, y };
      }
    }
    return null;
  });
  if (!blankCanvasPoint) throw new Error("没有找到可点击的画布空白区域");
  await page.mouse.click(blankCanvasPoint.x, blankCanvasPoint.y);
  await expect(page.locator(".shot-inline-console")).toHaveCount(0);
  await shotNodes.first().click();
  await expect(
    page.locator(".prompt-mention-chips").getByText("@takeboard-crew-mascot"),
  ).toBeVisible();
  await expect(page.locator(".shot-inline-mentions")).toContainText("@takeboard-crew-mascot");
  const prompt = page.locator(".prompt-with-mentions textarea");
  await prompt.fill("让 ");
  await prompt.press("@");
  await page
    .locator(".prompt-mention-menu")
    .getByRole("button", { name: /@takeboard-crew-mascot/ })
    .click();
  await expect(prompt).toHaveValue("让 @takeboard-crew-mascot");
  await originalAssetNode.click();
  await expect(
    page.locator(".connection-role-badges").getByText("首帧", { exact: true }),
  ).toBeVisible();

  const originalShotCount = await shotNodes.count();
  await shotNodes.first().click();
  const inspector = page.getByLabel("镜头候选检查器");
  await inspector.getByLabel("镜头名称").fill("SH-01A");
  await inspector.getByLabel("镜头画幅").selectOption("9:16");
  await inspector.getByRole("button", { name: "保存镜头" }).click();
  await expect(page.getByText("SH-01A", { exact: true }).first()).toBeVisible();

  await page.locator(".react-flow__edge").click({ button: "right", force: true });
  await expect(page.getByRole("menu")).toContainText("CONNECTION");
  await page.getByRole("menuitem", { name: /断开连接/ }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(page.getByText("连线已删除")).toBeVisible();

  await page.locator(".asset-import input[type=file]").setInputFiles({
    name: "camera-motion-reference.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("00000018667479706d70343200000000", "hex"),
  });
  await expect(page.getByText("已导入参考素材：camera-motion-reference.mp4")).toBeVisible();
  const videoNode = page.locator(".react-flow__node-asset").filter({ has: page.locator("video") });
  await expect(videoNode).toBeVisible();
  await shotNodes.first().click();
  await page.locator(".recipe-selector").click();
  await page.getByRole("button", { name: /MiniMax H3 R2V/ }).click();
  const videoSourceHandle = videoNode.locator(".board-output-handle");
  const videoTargetHandle = page.locator(".react-flow__node-shot .slot-reference_video").first();
  const videoSourceBox = await videoSourceHandle.boundingBox();
  const videoTargetBox = await videoTargetHandle.boundingBox();
  if (!videoSourceBox || !videoTargetBox) throw new Error("参考视频连接端口未渲染");
  await page.mouse.move(
    videoSourceBox.x + videoSourceBox.width / 2,
    videoSourceBox.y + videoSourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    videoTargetBox.x + videoTargetBox.width / 2,
    videoTargetBox.y + videoTargetBox.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(page.getByText("已连接为参考视频")).toBeVisible();
  await expect(page.locator(".react-flow__node-shot")).toContainText("参考视频 1/3");
  await expect(page.locator(".shot-inline-mentions")).toContainText("@camera-motion-reference");
  await page.locator(".react-flow__edge").click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: /断开连接/ }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);

  const textNodes = page.locator(".react-flow__node-text");
  const originalTextCount = await textNodes.count();
  const pane = page.locator(".react-flow__pane");
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("画布未渲染");
  await page.mouse.dblclick(paneBox.x + 340, paneBox.y + paneBox.height - 90);
  await expect(page.getByRole("menu")).toContainText("ADD TO CANVAS");
  await page.getByRole("menuitem", { name: /添加文字笔记/ }).click();
  await expect(textNodes).toHaveCount(originalTextCount + 1);

  await shotNodes.first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: /复制/ }).click();
  await page.keyboard.press("Meta+V");
  await expect(shotNodes).toHaveCount(originalShotCount + 1);

  await shotNodes.last().click({ button: "right" });
  await page.getByRole("menuitem", { name: /删除镜头/ }).click();
  const deleteShotDialog = page.getByRole("alertdialog", { name: /删除/ });
  await expect(deleteShotDialog).toContainText("镜头会同时从画布和左侧镜头列表删除");
  await deleteShotDialog.getByRole("button", { name: "删除镜头" }).click();
  await expect(shotNodes).toHaveCount(originalShotCount);
  await page.screenshot({ path: "test-results/takeboard-real-project.png", fullPage: true });

  await page.getByRole("button", { name: "切换项目" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});
