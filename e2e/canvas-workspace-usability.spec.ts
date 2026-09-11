import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ProjectStore } from "../apps/server/src/storage/project-store";
import { runSchema, takeSchema } from "../packages/contracts/src/index";
import { createTakeBoardId } from "../packages/domain/src/index";
import { expect, test } from "./fixtures";

test("opening workflows refreshes dependency checks and native recipes expose read-only diagnostics", async ({
  page,
  request,
}) => {
  let checks = 0;
  const path = "Kino/Kino_Wan22_I2V.json";
  const diagnostic = {
    path,
    workflowHash: "a".repeat(64),
    health: "blocked",
    executable: false,
    nodeCount: 1,
    capability: "image_to_video",
    outputMediaType: "video",
    bindingStatus: "built_in",
    modelStatus: "missing",
    models: ["missing.safetensors"],
    missingModels: ["missing.safetensors"],
    missingNodeTypes: [],
    checks: [
      {
        id: "models",
        category: "models",
        status: "blocked",
        code: "MISSING_MODEL",
        title: "缺少模型",
        detail: "missing.safetensors",
        remediation: "在生成设备安装此模型",
        nodeIds: [],
      },
    ],
  };
  await page.route("**/api/workflows", async (route) => {
    checks++;
    await route.fulfill({
      json: {
        editorUrl: "http://127.0.0.1:8188",
        warnings: [],
        workflows: [
          {
            id: "wan",
            path,
            name: "Wan22 I2V",
            capability: "image_to_video",
            capabilityLabel: "图生视频",
            inputs: ["prompt", "first_frame"],
            models: ["missing.safetensors"],
            modelStatus: "missing",
            nodeCount: 1,
            source: "comfyui",
            editorUrl: "http://127.0.0.1:8188",
            execution: "native",
            origin: "built_in",
            bindingStatus: "built_in",
            diagnostic,
          },
        ],
      },
    });
  });
  await page.route("**/api/workflows/inspect?*", (route) =>
    route.fulfill({ json: { path, status: "built_in", diagnostic } }),
  );
  const title = `工作流检查 ${Date.now()}`;
  const created = await request.post("/api/projects", {
    data: { title, aspectRatio: "16:9", firstShotIntent: "检查" },
  });
  const { key } = await created.json();
  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.locator(".react-flow__node-shot").dblclick();
    await expect.poll(() => checks).toBeGreaterThan(0);
    const before = checks;
    await page.locator(".recipe-selector").click();
    await expect.poll(() => checks).toBeGreaterThan(before);
    await page.getByRole("button", { name: "模板库", exact: true }).click();
    await page.getByRole("button", { name: "查看检查", exact: true }).click();
    await expect(page.locator(".binding-editor")).toContainText("缺少模型");
    await expect(page.locator(".binding-editor")).toContainText("missing.safetensors");
    await expect(page.getByRole("button", { name: "信任此工作流并启用" })).toHaveCount(0);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});

test("new shots use the visible viewport and node resizing persists", async ({ page, request }) => {
  const title = `视野与缩放 ${Date.now()}`;
  const created = await request.post("/api/projects", { data: { title } });
  expect(created.ok()).toBeTruthy();
  const { key } = await created.json();
  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    const canvas = page.locator(".canvas-wrap");
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Missing canvas");
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + 160);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 80, bounds.y + 320, { steps: 12 });
    await page.mouse.up();
    await page.getByRole("button", { name: "添加镜头", exact: true }).click();
    const shot = page.locator(".react-flow__node-shot");
    await expect(shot).toHaveCount(1);
    await expect(shot.locator(".shot-planning-surface")).toBeInViewport();
    const handle = shot.locator(".react-flow__resize-control.handle.bottom.right");
    await expect(handle).toBeVisible();
    const corner = await handle.boundingBox();
    if (!corner) throw new Error("Missing resize handle");
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x + 110, corner.y + 70, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/projects/${key}`)).json()).snapshot.canvasItems[0]
            .sizeMode,
      )
      .toBe("manual");
    const resized = (await (await request.get(`/api/projects/${key}`)).json()).snapshot
      .canvasItems[0];
    expect(resized.width).toBeGreaterThan(470);
    await page.getByRole("button", { name: "专注", exact: true }).click();
    await expect(page.locator(".inspector")).toBeHidden();
    const focused = await canvas.boundingBox();
    expect(focused?.width).toBeGreaterThan(bounds.width - 2);
    expect(await page.getByRole("button", { name: /切换为.*密度/ }).count()).toBe(0);
    await page.reload();
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await expect(page.locator(".react-flow__node-shot")).toHaveClass(/manually-sized/);
    expect(
      (await (await request.get(`/api/projects/${key}`)).json()).snapshot.canvasItems[0].width,
    ).toBe(resized.width);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});

test("project overview renders source media and asset management opens as a responsive side drawer", async ({
  page,
  request,
}) => {
  const title = `缩略画布 ${Date.now()}`;
  const created = await request.post("/api/projects", { data: { title } });
  const { key } = await created.json();
  try {
    const upload = await request.post(`/api/projects/${key}/assets?x=10&y=20`, {
      multipart: {
        file: {
          name: "portrait.webp",
          mimeType: "image/webp",
          buffer: await readFile("apps/web/public/scene/takeboard-crew-mascot.webp"),
        },
      },
    });
    expect(upload.ok()).toBeTruthy();
    await page.goto("/");
    const card = page.locator(".project-card").filter({ hasText: title });
    await expect(card.locator(".project-board-node img")).toHaveCount(1);
    await card.getByRole("button", { name: /打开画板/ }).click();
    const asset = page.locator(".react-flow__node-asset");
    await asset.click();
    const initial = await asset.boundingBox();
    const handle = await asset
      .locator(".react-flow__resize-control.handle.bottom.right")
      .boundingBox();
    if (!initial || !handle) throw new Error("Missing media resize geometry");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 75, handle.y + 35, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/projects/${key}`)).json()).snapshot.canvasItems[0]
            .sizeMode,
      )
      .toBe("manual");
    const state = (await (await request.get(`/api/projects/${key}`)).json()).snapshot;
    expect(state.canvasItems[0].width / state.canvasItems[0].height).toBeCloseTo(
      initial.width / initial.height,
      1,
    );
    expect(state.assets[0]).toMatchObject({
      width: 750,
      height: 900,
      sha256: (await upload.json()).snapshot.assets[0].sha256,
    });
    await page.getByRole("button", { name: /打开资产库/ }).click();
    const drawer = page.getByLabel("项目资产库", { exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveCSS("transform", "none");
    for (const width of [1600, 900, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const rect = await drawer.boundingBox();
      expect(rect?.x).toBeGreaterThanOrEqual(0);
      expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      expect(await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".sidebar")).toHaveCSS("display", "none");
    await page.screenshot({ path: "test-results/workspace-asset-drawer.png" });
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});

test("real project results can be revoked and individually dragged or added without losing provenance", async ({
  page,
  request,
}) => {
  test.skip(Boolean(process.env.TAKEBOARD_E2E_REMOTE), "Local isolated storage fixture only");
  const title = `结果复用 ${Date.now()}`;
  const created = await request.post("/api/projects", {
    data: { title, aspectRatio: "16:9", firstShotIntent: "候选复用" },
  });
  const { key } = await created.json();
  try {
    for (const file of ["takeboard-crew-mascot.webp", "takeboard-storyboard-moth.webp"]) {
      expect(
        (
          await request.post(`/api/projects/${key}/assets?canvas=0`, {
            multipart: {
              file: {
                name: file,
                mimeType: "image/webp",
                buffer: await readFile(`apps/web/public/scene/${file}`),
              },
            },
          })
        ).ok(),
      ).toBeTruthy();
    }
    // Seed completed results, not a fabricated GPU execution. All review and canvas operations below use real APIs.
    const store = ProjectStore.openExisting(
      resolve(process.env.TAKEBOARD_E2E_DATA_ROOT ?? "test-results/e2e-data", key),
    );
    if (!store) throw new Error("Missing isolated project store");
    const initial = store.loadCurrent();
    if (!initial) throw new Error("Missing snapshot");
    const shot = initial.snapshot.shots[0];
    if (!shot) throw new Error("Missing shot");
    const at = new Date().toISOString();
    for (const [index, asset] of initial.snapshot.assets.entries()) {
      const run = runSchema.parse({
        id: createTakeBoardId("run"),
        shotId: shot.id,
        recipeId: createTakeBoardId("recipe"),
        recipeVersion: "fixture@1",
        workflowSha256: "a".repeat(64),
        workerId: createTakeBoardId("worker"),
        status: "completed",
        createdAt: at,
        updatedAt: at,
        parameters: {
          seed: 4200 + index,
          prompt: "柔和的晨光",
          models: ["fixture-model.safetensors"],
          width: asset.width,
          height: asset.height,
        },
      });
      initial.snapshot.runs.push(run);
      initial.snapshot.takes.push(
        takeSchema.parse({
          id: createTakeBoardId("take"),
          shotId: shot.id,
          runId: run.id,
          assetId: asset.id,
          status: "candidate",
          createdAt: at,
          updatedAt: at,
        }),
      );
    }
    shot.status = "review";
    try {
      await store.save(initial.snapshot, { type: "test.completed_results_fixture" });
    } finally {
      store.close();
    }
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    const shotNode = page.locator(".react-flow__node-shot");
    await shotNode.dblclick();
    await page.getByRole("button", { name: "选择候选 1" }).click();
    await page.getByRole("button", { name: "采用此结果" }).click();
    await page.getByRole("button", { name: "不采用", exact: true }).click();
    await page.getByRole("button", { name: "确认不采用" }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/projects/${key}`)).json()).snapshot.shots[0]
            .approvedTakeId,
      )
      .toBeNull();
    await page.getByRole("button", { name: "采用此结果" }).click();
    await page.getByText("生成记录", { exact: true }).click();
    await expect(page.locator(".inspector")).toContainText("4200");
    await expect(page.locator(".inspector")).toContainText("fixture-model.safetensors");
    await expect(page.locator(".run-prompt")).toContainText("柔和的晨光");
    await page.getByRole("button", { name: "加入画布", exact: true }).click();
    await expect(page.locator(".react-flow__node-asset")).toHaveCount(1);
    await shotNode.dblclick();
    const candidate = page.getByRole("button", { name: "选择候选 2" });
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await candidate.dispatchEvent("dragstart", { dataTransfer: transfer });
    expect(await transfer.evaluate((data) => data.getData("application/x-takeboard-asset"))).toBe(
      initial.snapshot.takes[1]?.assetId,
    );
    const canvas = page.locator(".canvas-wrap");
    const rect = await canvas.boundingBox();
    if (!rect) throw new Error("Missing canvas");
    await canvas.dispatchEvent("drop", {
      dataTransfer: transfer,
      clientX: rect.x + 100,
      clientY: rect.y + 160,
    });
    await transfer.dispose();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/projects/${key}`)).json()).snapshot.canvasItems.filter(
            (item: { refType: string }) => item.refType === "asset",
          ).length,
      )
      .toBe(2);
    const final = (await (await request.get(`/api/projects/${key}`)).json()).snapshot;
    expect(final.takes).toHaveLength(2);
    expect(final.runs.map((run: { parameters: unknown }) => run.parameters)).toEqual(
      initial.snapshot.runs.map((run) => run.parameters),
    );
    expect(final.approvals.map((approval: { status: string }) => approval.status)).toEqual([
      "revoked",
      "active",
    ]);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
