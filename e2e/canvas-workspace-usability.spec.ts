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
        code: "COMFY_MODELS_MISSING",
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
    const workflowEntry = page.getByRole("button", { name: "管理工作流", exact: true });
    await expect(workflowEntry.locator("..")).toHaveClass("model-picker-heading");
    await page.screenshot({
      path: "test-results/generation-model-entry.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "管理工作流", exact: true }).click();
    await expect.poll(() => checks).toBeGreaterThan(before);
    await page.getByRole("button", { name: "可添加", exact: true }).click();
    await page.getByRole("button", { name: "解决问题", exact: true }).click();
    await expect(
      page.locator(".binding-editor").getByText("需要补齐模型", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".binding-editor").getByText("missing.safetensors", { exact: true }),
    ).not.toBeVisible();
    await page.locator(".workflow-check-details summary").click();
    await expect(
      page.locator(".binding-editor").getByText("missing.safetensors", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "信任此工作流并启用" })).toHaveCount(0);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});

test("new shots use the visible viewport and legacy manual sizing cannot distort their layout", async ({
  page,
  request,
}) => {
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
    await expect(shot.locator(".react-flow__resize-control")).toHaveCount(0);
    const original = (await (await request.get(`/api/projects/${key}`)).json()).snapshot
      .canvasItems[0];
    // Simulate a legacy project, including dimensions that previously broke the controls.
    expect(
      (
        await request.post(`/api/projects/${key}/commands`, {
          data: {
            requestId: crypto.randomUUID(),
            command: {
              type: "canvas.resize_item",
              itemId: original.id,
              x: original.x,
              y: original.y,
              width: 180,
              height: 100,
            },
          },
        })
      ).ok(),
    ).toBeTruthy();
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
    await expect(shot).not.toHaveClass(/manually-sized/);
    await expect(shot).toHaveCSS("width", "470px");
    expect(await shot.evaluate((node) => node.style.height)).toBe("");
    await expect(shot.locator(".shot-planning-surface")).toBeVisible();
    expect(
      (await (await request.get(`/api/projects/${key}`)).json()).snapshot.canvasItems[0].width,
    ).toBe(180);
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
    await expect(asset.locator(".react-flow__resize-control")).toHaveCount(0);
    const state = (await (await request.get(`/api/projects/${key}`)).json()).snapshot;
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
      if (width < 1120) await expect(page.locator(".sidebar")).toHaveCSS("display", "none");
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
    const batchRun = initial.snapshot.runs[0];
    if (!batchRun) throw new Error("Missing completed run fixture");
    batchRun.parameters = {
      ...batchRun.parameters,
      candidateBatchId: "inspector-batch",
      candidateIndex: 1,
      candidateCount: 4,
    };
    for (let index = 2; index <= 4; index++) {
      initial.snapshot.runs.push(
        runSchema.parse({
          ...batchRun,
          id: createTakeBoardId("run"),
          status: "cancelled",
          parameters: { ...batchRun.parameters, seed: 4200 + index, candidateIndex: index },
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
    const inspector = page.getByLabel("镜头候选检查器");
    await expect(inspector.getByRole("tab", { name: /结果/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(inspector).toContainText("3 个已停止");
    await expect(inspector).not.toContainText("需要处理");
    await expect(inspector).not.toContainText("LATEST BATCH");
    await expect(inspector).not.toContainText("调度依据可追溯");
    await expect(inspector.getByRole("button", { name: "重试", exact: true })).toHaveCount(3);
    await inspector.getByRole("tab", { name: "生成", exact: true }).click();
    await expect(inspector.locator(".candidate-batch-status")).toBeHidden();
    await expect(inspector.getByLabel("镜头备注")).toBeVisible();
    await inspector.getByLabel("镜头备注").fill("保留这段尚未提交的编辑");
    await inspector.getByRole("tab", { name: /结果/ }).click();
    await inspector.getByRole("tab", { name: /结果/ }).press("ArrowLeft");
    await expect(inspector.getByLabel("镜头备注")).toHaveValue("保留这段尚未提交的编辑");
    await inspector.getByRole("tab", { name: "生成", exact: true }).press("ArrowRight");
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 800 });
      // Explicitly opening details must keep it reachable, including narrow windows.
      await expect(async () => {
        if (!(await inspector.isVisible()))
          await page.getByRole("button", { name: "显示检查器", exact: true }).click();
        // Resize can finish after the visibility probe. Retry the whole open-and-measure
        // sequence instead of spending the outer retry budget waiting on a closed panel.
        expect(await inspector.isVisible()).toBe(true);
        const box = await inspector.boundingBox();
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      }).toPass({ timeout: 5000 });
      expect(await inspector.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
        true,
      );
      await page.screenshot({ path: `test-results/inspector-results-${width}.png` });
    }
    await page.setViewportSize({ width: 1600, height: 900 });
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
    await expect(page.getByRole("region", { name: "生成记录" })).toBeVisible();
    await expect(page.locator(".inspector")).toContainText("4200");
    await expect(page.locator(".inspector")).toContainText("fixture-model.safetensors");
    await expect(page.locator(".run-prompt")).toContainText("柔和的晨光");
    await page.locator(".run-record").scrollIntoViewIfNeeded();
    await expect(page.locator(".run-identity h3")).toHaveText("fixture-model");
    await expect(page.locator(".run-settings")).toContainText("4200");
    await expect(page.locator(".run-settings")).not.toContainText("帧率");
    await page.locator(".run-raw summary").click();
    await expect(page.locator(".run-model-files")).toBeVisible();
    await expect(page.locator(".run-model-files")).toContainText("fixture-model.safetensors");
    await page.locator(".run-raw summary").click();
    await page.screenshot({
      path: "test-results/generation-record-details.png",
      animations: "disabled",
    });
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
