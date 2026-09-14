import { expect, test } from "./fixtures";

test("recommended templates are checked and explicitly added without changing a shot", async ({
  page,
  request,
}) => {
  const path = "Kino/TakeBoard/test/Kino_MinimaxH3_T2V.json";
  let added = false;
  let online = true;
  let installs = 0;
  const diagnostic = {
    path,
    workflowHash: "a".repeat(64),
    health: "ready",
    executable: true,
    nodeCount: 12,
    capability: "text_to_video",
    outputMediaType: "video",
    bindingStatus: "built_in",
    modelStatus: "ready",
    models: [],
    missingModels: [],
    missingNodeTypes: [],
    checks: [],
  };
  await page.route("**/api/workflows/templates", (route) =>
    route.fulfill({
      json: {
        templates: [
          {
            id: "h3-t2v",
            capability: "text_to_video",
            path,
            name: "MiniMax H3 · 文生视频",
            version: "1.test",
            bytes: 8000,
            installation: online ? (added ? "installed" : "absent") : "unknown",
            included: added,
            diagnostic: online ? diagnostic : null,
            confirmationToken: online ? "checked-device" : null,
            problem: online ? null : "请先连接生成设备，再检查模板是否可用。",
          },
          {
            id: "wan-i2v",
            capability: "image_to_video",
            path: "Kino/Wan.json",
            name: "Wan 2.2 · 图生视频",
            version: "1.test",
            bytes: 10000,
            installation: "absent",
            included: false,
            confirmationToken: null,
            problem: null,
            diagnostic: {
              ...diagnostic,
              health: "blocked",
              executable: false,
              checks: [
                {
                  id: "nodes.available",
                  category: "nodes",
                  status: "blocked",
                  code: "COMFY_NODE_TYPES_MISSING",
                  title: "缺少节点",
                  detail: "SomeCustomNode",
                  remediation: "install",
                  nodeIds: [],
                },
              ],
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/workflows/templates/h3-t2v/install", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ confirmationToken: "checked-device" });
    added = true;
    installs++;
    await route.fulfill({ json: { path, installed: true, version: "1.test" } });
  });
  await page.route("**/api/workflows", (route) =>
    route.fulfill({
      json: {
        warnings: [],
        editorUrl: "http://127.0.0.1:8188",
        workflows: added
          ? [
              {
                id: path,
                path,
                name: "MiniMax H3",
                library: { included: true },
                capability: "text_to_video",
                capabilityLabel: "文生视频",
                inputs: ["prompt", "seed"],
                models: [],
                modelStatus: "ready",
                source: "comfyui",
                origin: "built_in",
                execution: "native",
                bindingStatus: "built_in",
                editorUrl: "http://127.0.0.1:8188",
                diagnostic,
              },
            ]
          : [],
      },
    }),
  );
  const title = `推荐模板 ${Date.now()}`;
  const created = await request.post("/api/projects", {
    data: { title, firstShotIntent: "安装不改变镜头" },
  });
  const { key, snapshot } = await created.json();
  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.locator(".react-flow__node-shot").dblclick();
    await page.getByRole("button", { name: "管理模型与工作流" }).click();
    await page.getByRole("button", { name: "可添加", exact: true }).click();
    const catalog = page.getByRole("region", { name: "TakeBoard 推荐模板" });
    const h3 = catalog.locator("article").filter({ hasText: "MiniMax H3" });
    const wan = catalog.locator("article").filter({ hasText: "Wan 2.2" });
    await expect(h3.getByRole("button", { name: "添加模板" })).toBeEnabled();
    await expect(wan.getByRole("button", { name: "添加模板" })).toBeDisabled();
    await expect(wan).not.toContainText("SomeCustomNode");
    expect(installs).toBe(0);
    online = false;
    await catalog.getByRole("button", { name: "检查推荐模板" }).click();
    await expect(h3).toContainText("请先连接生成设备");
    await page.getByRole("button", { name: "文生视频", exact: true }).click();
    await expect(h3).toBeVisible();
    await expect(wan).toHaveCount(0);
    await page
      .getByRole("dialog", { name: "选择工作流", exact: true })
      .getByRole("button", { name: "全部", exact: true })
      .click();
    await expect(h3.getByRole("button", { name: "添加模板" })).toBeDisabled();
    await expect(h3.getByRole("link", { name: "下载 JSON" })).toHaveAttribute(
      "href",
      /\/templates\/h3-t2v\/download$/,
    );
    online = true;
    await catalog.getByRole("button", { name: "检查推荐模板" }).click();
    await h3.getByRole("button", { name: "添加模板" }).click();
    await expect(h3.getByRole("button", { name: "已添加" })).toBeDisabled();
    expect(installs).toBe(1);
    for (const width of [1440, 720, 390]) {
      await page.setViewportSize({ width, height: 820 });
      await expect(async () => {
        const bounds = await h3.boundingBox();
        expect(bounds?.width).toBeGreaterThan(200);
        expect(bounds?.x).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      }).toPass();
      await page.screenshot({ path: `test-results/recommended-templates-${width}.png` });
    }
    await page.getByRole("button", { name: "我的工作流", exact: true }).click();
    await expect(page.locator(".recipe-card")).toContainText("MiniMax H3");
    const current = (await (await request.get(`/api/projects/${key}`)).json()).snapshot;
    expect(current.shots[0].workflowPath).toBe(snapshot.shots[0].workflowPath);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
