import { expect, test } from "./fixtures";

test("templates are opt-in, editable names survive reopening, removal preserves the selected shot", async ({
  page,
  request,
}) => {
  const path = "Kino/Kino_MinimaxH3_T2V.json";
  let library = { included: false, favorite: false, name: "MiniMax H3" };
  await page.route("**/api/workflows", (route) =>
    route.fulfill({
      json: {
        editorUrl: "http://127.0.0.1:8188",
        warnings: [],
        workflows: [
          {
            id: "h3",
            path,
            name: library.name,
            library,
            capability: "text_to_video",
            capabilityLabel: "文生视频",
            inputs: ["prompt", "resolution", "duration", "seed", "steps"],
            models: ["minimax.safetensors"],
            modelStatus: "installed",
            nodeCount: 1,
            source: "comfyui",
            editorUrl: "http://127.0.0.1:8188",
            execution: "native",
            origin: "built_in",
            diagnostic: { health: "ready", executable: true, checks: [] },
          },
        ],
      },
    }),
  );
  await page.route("**/api/workflows/library?*", (route) => {
    library = { ...library, ...route.request().postDataJSON() };
    return route.fulfill({ json: { path, library } });
  });
  const title = `工作流列表 ${Date.now()}`;
  const response = await request.post("/api/projects", {
    data: { title, firstShotIntent: "测试列表" },
  });
  const { key } = await response.json();
  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.locator(".react-flow__node-shot").dblclick();
    await page.locator(".recipe-selector").click();
    await expect(page.locator(".recipe-card")).toHaveCount(0);
    await page.getByRole("button", { name: "模板库", exact: true }).click();
    await expect(page.locator(".recipe-card")).toBeDisabled();
    await page.getByRole("button", { name: "添加到我的工作流" }).click();
    await expect(page.locator(".recipe-card")).toBeEnabled();
    await page.getByRole("button", { name: "我的工作流", exact: true }).click();
    await page.locator(".recipe-library-actions summary").click();
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    await page.getByRole("button", { name: "重命名", exact: true }).click();
    await page.getByRole("textbox", { name: "工作流名称" }).fill("人物短片");
    await page.locator(".recipe-rename").getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".recipe-card")).toContainText("★ 人物短片");
    for (const viewport of [
      { width: 1024, height: 720 },
      { width: 720, height: 820 },
    ]) {
      await page.setViewportSize(viewport);
      const bounds = await page.locator(".recipe-studio").boundingBox();
      if (!bounds) throw new Error("Missing workflow panel");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await page.screenshot({ path: "test-results/workflow-library-720.png" });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.locator(".recipe-card").click();
    await page.getByRole("button", { name: "显示检查器", exact: true }).click();
    await expect(page.locator(".recipe-selector")).toContainText("人物短片");
    await page.locator(".recipe-selector").click();
    await page.locator(".recipe-library-actions summary").click();
    await page.getByRole("button", { name: "从列表移除" }).click();
    await expect(page.locator(".recipe-card")).toHaveCount(0);
    await page.getByRole("button", { name: "全部发现", exact: true }).click();
    await expect(page.locator(".recipe-card")).toContainText("人物短片");
    await expect(page.locator(".recipe-card")).toBeDisabled();
    expect((await (await request.get(`/api/projects/${key}`)).json()).snapshot.shots).toHaveLength(
      1,
    );
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
