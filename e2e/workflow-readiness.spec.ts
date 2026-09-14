import { expect, test } from "./fixtures";

test("model picker excludes blockers; template remediation hides raw fields and rechecks before use", async ({
  page,
  request,
}) => {
  let compatible = false;
  const readyPath = "Kino/Kino_MinimaxH3_T2V.json";
  const customPath = "TakeBoard/CustomVideo.json";
  const required = {
    id: "nodes.required_inputs",
    category: "nodes",
    status: "blocked",
    code: "COMFY_REQUIRED_INPUTS_MISSING",
    title: "节点必需输入不完整",
    detail: "92：缺少必需输入 codec；131：缺少 values；136：缺少 ref_image_size",
    remediation: "检查节点版本",
    nodeIds: ["92", "131", "136"],
  };
  const diagnostic = (blocked: boolean) => ({
    path: customPath,
    workflowHash: "a".repeat(64),
    health: blocked ? "blocked" : "attention",
    executable: !blocked,
    nodeCount: 3,
    capability: "text_to_video",
    outputMediaType: "video",
    bindingStatus: "ready",
    modelStatus: "ready",
    models: [],
    missingModels: [],
    missingNodeTypes: [],
    checks: blocked
      ? [required]
      : [
          {
            ...required,
            status: "warning",
            code: "SOURCE_WORKFLOW_INPUTS_DIFFER",
            detail: "源文件的提醒不影响生成",
          },
        ],
  });
  const workflow = (path: string, name: string, blocked: boolean) => ({
    id: path,
    path,
    name,
    capability: "text_to_video",
    capabilityLabel: "文生视频",
    inputs: ["prompt", "resolution", "duration", "seed", "steps"],
    models: [],
    modelStatus: "ready",
    nodeCount: 3,
    source: "comfyui",
    origin: "imported",
    execution: "bound",
    bindingStatus: "ready",
    editorUrl: "http://127.0.0.1:8188",
    library: { included: true, favorite: false },
    diagnostic: diagnostic(blocked),
  });
  await page.route("**/api/workflows", (route) =>
    route.fulfill({
      json: {
        editorUrl: "http://127.0.0.1:8188",
        warnings: [],
        workflows: [
          workflow(readyPath, "常用视频", false),
          workflow(customPath, "我的自定义模板", !compatible),
        ],
      },
    }),
  );
  await page.route("**/api/workflows/inspect?*", (route) =>
    route.fulfill({
      json: {
        path: customPath,
        status: "ready",
        diagnostic: diagnostic(!compatible),
        binding: {
          capability: "text_to_video",
          outputMediaType: "video",
          parameters: { prompt: [{ nodeId: "1", input: "text" }] },
          media: {},
        },
        candidates: { parameters: {}, media: {} },
      },
    }),
  );
  const created = await request.post("/api/projects", {
    data: { title: `模板兼容测试 ${Date.now()}`, firstShotIntent: "测试选择" },
  });
  const { key, snapshot } = await created.json();
  try {
    await page.goto(`/`);
    await page
      .locator(".project-card")
      .filter({ hasText: snapshot.project.title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.locator(".react-flow__node-shot").dblclick();
    const picker = page.getByLabel("生成模型", { exact: true });
    await expect(picker).toBeVisible();
    await expect(picker.locator("option:not([disabled])")).toHaveCount(1);
    await expect(picker).not.toContainText("我的自定义模板");
    await page.getByRole("button", { name: "管理工作流", exact: true }).click();
    await expect(page.getByRole("button", { name: "高级", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "全部发现", exact: true })).toHaveCount(0);
    const card = page.locator(".recipe-card-wrap").filter({ hasText: "我的自定义模板" });
    await expect(card).toContainText("需要更新");
    await card.getByRole("button", { name: "解决问题" }).click();
    const panel = page.locator(".binding-editor");
    await expect(panel.getByText("模板与生成设备不兼容", { exact: true })).toBeVisible();
    await expect(panel.getByText(required.detail, { exact: true })).not.toBeVisible();
    await expect(panel.getByRole("button", { name: "使用此工作流" })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "在 ComfyUI 编辑 ↗" })).toHaveAttribute(
      "href",
      /takeboard_workflow=TakeBoard%2FCustomVideo.json/,
    );
    await expect(panel.getByRole("link", { name: "下载 JSON" })).toHaveAttribute(
      "href",
      /\/api\/workflows\/raw\?path=/,
    );
    await panel.locator(".workflow-check-details summary").click();
    await expect(panel.getByText(required.detail, { exact: true })).toBeVisible();
    await panel.locator(".workflow-check-details summary").click();
    for (const width of [1440, 720, 390]) {
      await page.setViewportSize({ width, height: 820 });
      await expect(async () => {
        const bounds = await panel.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds?.x).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width + 1);
        const explanation = await panel.locator(".workflow-diagnostic-grid p").boundingBox();
        expect(explanation?.width).toBeGreaterThan(180);
      }).toPass();
      await page.screenshot({ path: `test-results/workflow-remediation-${width}.png` });
    }
    await panel.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "选择工作流", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "解决问题" }).click();
    await expect(panel.getByText("模板与生成设备不兼容", { exact: true })).toBeVisible();
    compatible = true;
    await panel.getByRole("button", { name: "重新检查", exact: true }).click();
    await expect(panel.getByRole("button", { name: "使用此工作流" })).toBeVisible();
    await panel.getByRole("button", { name: "使用此工作流" }).click();
    await expect(page.locator(".recipe-studio")).toHaveCount(0);
    const updated = await (await request.get(`/api/projects/${key}`)).json();
    expect(updated.snapshot.shots[0].workflowPath).toBe(customPath);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
