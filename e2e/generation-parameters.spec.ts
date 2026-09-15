import { expect, test } from "./fixtures";

test("image/video controls submit the chosen dimensions and keep shot intent above both views", async ({
  page,
  request,
}) => {
  const title = `参数一致性 ${Date.now()}`;
  const created = await request.post("/api/projects", {
    data: { title, firstShotIntent: "清晨的海面" },
  });
  const { key } = await created.json();
  const workflows = [
    {
      path: "Kino/Kino_QwenImage2512_T2I.json",
      name: "Qwen Image",
      capability: "text_to_image",
      capabilityLabel: "文生图",
      inputs: ["prompt", "resolution", "seed", "steps"],
    },
    {
      path: "Kino/Kino_MinimaxH3_T2V.json",
      name: "MiniMax H3",
      capability: "text_to_video",
      capabilityLabel: "文生视频",
      inputs: ["prompt", "resolution", "duration", "seed", "steps"],
    },
  ].map((item) => ({
    ...item,
    id: item.path,
    models: [],
    nodeCount: 10,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:1",
    execution: "native",
    origin: "built_in",
    library: { included: true, favorite: false },
    diagnostic: { health: "ready", executable: true },
    mediaInputs: { first_frame: 0, last_frame: 0, reference: 0 },
  }));
  // Inventory only. Submissions are intercepted below; this test never claims GPU generation.
  await page.route("**/api/workflows", (route) =>
    route.fulfill({ json: { workflows, warnings: [], editorUrl: "http://127.0.0.1:1" } }),
  );
  const submitted: Array<Record<string, unknown>> = [];
  await page.route("**/shots/*/generate", async (route) => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ status: 422, json: { error: "测试已捕获提交参数，未执行 GPU 任务" } });
  });
  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    const node = page.locator(".react-flow__node-shot").first();
    await node.click();
    await page.getByLabel("画布生成方式").selectOption("text_to_image");
    await expect(page.getByLabel("画布工作流")).toHaveValue("Kino/Kino_QwenImage2512_T2I.json");
    await page.getByLabel("画布生成比例").selectOption("9:16");
    const width = Number(await page.getByLabel("画布宽度").inputValue());
    const height = Number(await page.getByLabel("画布高度").inputValue());
    expect(width).toBeLessThan(height);
    await expect(page.getByLabel("画布时长")).toHaveCount(0);
    await page.getByRole("button", { name: "详细设置", exact: true }).click();
    const inspector = page.getByLabel("镜头候选检查器");
    await expect(inspector.getByLabel("生成比例")).toHaveValue("9:16");
    await expect(inspector.getByLabel("生成时长")).toHaveCount(0);
    await expect(inspector.getByLabel("镜头画幅")).toHaveCount(0);
    const intent = await inspector.getByLabel("镜头备注").boundingBox();
    const tabs = await inspector.getByRole("tablist").boundingBox();
    if (!intent || !tabs) throw new Error("Missing intent or tab layout");
    expect(intent.y + intent.height).toBeLessThan(tabs.y);
    await inspector.locator("#generation-width").fill("1024");
    await inspector.locator("#generation-height").fill("768");
    await inspector.getByRole("button", { name: "生成 1 个", exact: true }).click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toMatchObject({
      width: 1024,
      height: 768,
      recipePath: "Kino/Kino_QwenImage2512_T2I.json",
    });
    await inspector.getByLabel("生成类型").selectOption("text_to_video");
    await inspector.getByLabel("生成比例").selectOption("16:9");
    await inspector.getByLabel("生成时长").fill("7");
    await inspector.getByRole("button", { name: "生成 1 个", exact: true }).click();
    await expect.poll(() => submitted.length).toBe(2);
    expect(submitted[1]).toMatchObject({
      durationSeconds: 7,
      recipePath: "Kino/Kino_MinimaxH3_T2V.json",
    });
    expect(Number(submitted[1]?.width)).toBeGreaterThan(Number(submitted[1]?.height));
    await page.screenshot({
      path: "test-results/generation-parameters.png",
      animations: "disabled",
    });
  } finally {
    await request.delete(`/api/projects/${key}`);
  }
});

test("memory monitor shows measured usage and explicitly unavailable telemetry", async ({
  page,
}) => {
  let available = true;
  await page.route("**/api/workers", (route) =>
    route.fulfill({
      json: {
        defaultWorkerId: "gpu",
        policies: [],
        workers: [
          {
            worker: { id: "gpu", name: "测试生成设备", enabled: true },
            status: "ready",
            device: "Test GPU",
            vramTotal: available ? 24 * 1024 ** 3 : null,
            vramFree: available ? 6 * 1024 ** 3 : null,
            queueRunning: 1,
            queuePending: 2,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "打开运行中心" }).click();
  const panel = page.getByRole("dialog", { name: "运行中心" });
  await panel.getByRole("tab", { name: "设备显存" }).click();
  await expect(panel.getByRole("meter")).toHaveAttribute("value", String(18 * 1024 ** 3));
  await expect(panel).toContainText("1 执行中");
  await expect(panel).toContainText("2 排队中");
  await page.screenshot({ path: "test-results/device-memory.png", animations: "disabled" });
  available = false;
  await expect(panel.getByText("设备未提供显存数据")).toBeVisible();
  await expect(panel.getByRole("meter")).toHaveCount(0);
  await panel.getByRole("tab", { name: "存储空间" }).click();
  await expect(panel.getByText("当前磁盘可用")).toBeVisible();
});
