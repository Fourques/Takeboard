import { expect, test } from "./fixtures";

test("generation task filters models, persists the chosen workflow and keeps parameter inputs editable", async ({
  page,
  request,
}) => {
  const presets = [
    {
      path: "Kino/Kino_MinimaxH3_T2V.json",
      name: "MiniMax H3",
      capability: "text_to_video",
      capabilityLabel: "文生视频",
      inputs: ["prompt", "resolution", "duration", "seed", "steps"],
    },
    {
      path: "Kino/Kino_QwenImage2512_I2I.json",
      name: "Qwen Image",
      capability: "image_to_image",
      capabilityLabel: "图生图",
      inputs: ["prompt", "first_frame", "resolution", "seed", "steps"],
    },
  ];
  await page.route("**/api/workflows", (route) =>
    route.fulfill({
      json: {
        editorUrl: "http://127.0.0.1:8188",
        warnings: [],
        workflows: presets.map((item, index) => ({
          ...item,
          id: String(index),
          models: [],
          modelStatus: "ready",
          nodeCount: 1,
          source: "comfyui",
          execution: "native",
          origin: "built_in",
          library: { included: true },
          diagnostic: { health: "ready", executable: true, checks: [] },
        })),
      },
    }),
  );
  const title = `生成选择 ${Date.now()}`;
  const { key } = await (
    await request.post("/api/projects", { data: { title, firstShotIntent: "test" } })
  ).json();
  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.locator(".react-flow__node-shot").dblclick();
    const task = page.getByLabel("生成类型", { exact: true });
    const model = page.getByLabel("生成模型", { exact: true });
    await task.selectOption("image_to_image");
    await expect(model).toHaveValue(presets[1].path);
    await expect(model.locator("option")).toHaveText(["Qwen Image"]);
    await expect(page.locator(".model-driven-slots")).toContainText("源图");
    const width = page.locator("#generation-width");
    await width.fill("");
    await expect(width).toHaveValue("");
    await width.fill("768");
    await width.press("Tab");
    await expect(width).toHaveValue("768");
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/projects/${key}`)).json()).snapshot.shots[0].workflowPath,
      )
      .toBe(presets[1].path);
    await task.selectOption("text_to_video");
    await expect(model.locator("option")).toHaveText(["MiniMax H3"]);
    await page.screenshot({ path: "test-results/workspace-generation-panel.png" });
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});

test("canvas group clipboard, undo, redo, removal and input shortcuts use real project commands", async ({
  page,
  request,
}) => {
  const title = `桌面操作 ${Date.now()}`;
  const created = await request.post("/api/projects", { data: { title, firstShotIntent: "test" } });
  const { key } = await created.json();
  try {
    const added = await request.post(`/api/projects/${key}/commands`, {
      data: {
        command: { type: "canvas.create_text", body: "note", x: 680, y: 120 },
        requestId: crypto.randomUUID(),
      },
    });
    expect(added.ok()).toBeTruthy();
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+z");
    expect(
      (await (await request.get(`/api/projects/${key}`)).json()).snapshot.canvasItems,
    ).toHaveLength(4);
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "从画布移除", exact: true }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Escape");
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
    await page.locator(".react-flow__node-shot").last().dblclick();
    const prompt = page.locator(".shot-inspector .prompt-field textarea");
    await prompt.fill("只选择这段文字");
    await prompt.press("ControlOrMeta+a");
    await prompt.press("Backspace");
    await expect(prompt).toHaveValue("");
    const saved = await (await request.get(`/api/projects/${key}`)).json();
    expect(saved.snapshot.canvasItems).toHaveLength(4);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(saved.snapshot.runs).toHaveLength(0);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});

test("asset drawer stays attached to the left, dismisses outside and contains keyboard focus", async ({
  page,
  request,
}) => {
  const title = `侧层布局 ${Date.now()}`;
  const { key } = await (
    await request.post("/api/projects", { data: { title, firstShotIntent: "test" } })
  ).json();
  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.getByRole("button", { name: "资产库", exact: false }).first().click();
    const panel = page.getByRole("dialog", { name: "项目资产库" });
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds?.x).toBe(0);
    await page.getByLabel("搜索资产").fill("找素材");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await expect(page.getByLabel("搜索资产")).toHaveValue("");
    await page.locator(".asset-backdrop > .layer-dismiss").click({ position: { x: 1550, y: 400 } });
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await page.getByRole("button", { name: "资产库", exact: false }).first().click();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
