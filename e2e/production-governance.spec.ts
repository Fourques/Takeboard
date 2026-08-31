import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { ProjectStore } from "../apps/server/dist/storage/project-store.js";
import { createTakeBoardId, toIsoTimestamp } from "../packages/domain/dist/index.js";
import { expect, test } from "./fixtures";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("declarative extensions require review, start disabled and remain keyboard-contained", async ({
  page,
  request,
}) => {
  const extensionId = `studio.e2e.review-${Date.now()}`;
  const manifest = {
    format: "takeboard.extension",
    manifestVersion: 1,
    id: extensionId,
    name: "E2E 审片工具",
    version: "1.0.0",
    description: "验证声明式扩展的安装、授权、启用和移除闭环。",
    author: "TakeBoard E2E",
    homepage: null,
    permissions: ["project.read", "network.open"],
    contributions: {
      links: [
        {
          id: "review-room",
          title: "打开审片室",
          description: "在新窗口打开外部审片入口。",
          url: "https://example.invalid/review",
          category: "review",
        },
      ],
      qcRules: [
        {
          id: "candidate-coverage",
          title: "镜头候选覆盖",
          description: "检查尚无候选的镜头。",
          check: "shots_without_candidates",
          severity: "warning",
        },
      ],
    },
  };

  try {
    await page.addInitScript(() => window.sessionStorage.setItem("takeboard.resumeDemo", "1"));
    await page.goto("/");
    const extensionButton = page.getByRole("button", { name: "扩展", exact: true });
    await extensionButton.click();
    const dialog = page.getByRole("dialog", { name: "TakeBoard 扩展库" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("第三方代码执行已关闭");
    await expect(dialog).toContainText("成片完整性质检");
    const roughCutCard = dialog.locator(".extension-card").filter({ hasText: "粗剪预览" });
    const stopRoughCut = roughCutCard.getByRole("button", { name: "停用", exact: true });
    if ((await stopRoughCut.count()) > 0) await stopRoughCut.click();
    await expect(roughCutCard).toContainText("已停用");
    await roughCutCard.getByRole("button", { name: "启用", exact: true }).click();
    await expect(roughCutCard).toContainText("已启用");

    await dialog.locator('input[type="file"]').setInputFiles({
      name: "e2e-extension.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(manifest)),
    });
    const review = dialog.locator(".extension-install-review");
    await expect(review).toContainText("E2E 审片工具");
    await expect(review).toContainText("读取项目状态");
    await expect(review).toContainText("打开外部链接");
    await expect(review).toContainText("内容指纹");
    await review.getByRole("button", { name: "信任并安装（默认停用）" }).click();

    const card = dialog.locator(".extension-card").filter({ hasText: "E2E 审片工具" });
    await expect(card).toContainText("已停用");
    await expect(card.getByRole("link", { name: "打开审片室" })).toHaveCount(0);
    await card.getByRole("button", { name: "启用", exact: true }).click();
    await expect(card).toContainText("已启用");
    await expect(card.getByRole("link", { name: "打开审片室" })).toHaveAttribute(
      "href",
      "https://example.invalid/review",
    );

    const results = await new AxeBuilder({ page })
      .include(".extension-shell")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter(
        (violation) => violation.impact === "critical" || violation.impact === "serious",
      ),
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);

    await page.screenshot({
      path: "test-results/takeboard-extension-library.png",
      animations: "disabled",
    });
    await card.getByRole("button", { name: "移除", exact: true }).click();
    await card.getByRole("button", { name: "确认移除", exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(extensionButton).toBeFocused();
    await page.getByRole("button", { name: "打开分镜墙" }).click();
    const storyboard = page.getByRole("dialog", { name: "项目分镜墙" });
    await expect(storyboard.getByRole("tab", { name: "粗剪预览" })).toBeVisible();
    await storyboard.getByRole("button", { name: "关闭分镜墙" }).click();
  } finally {
    await request.delete(`/api/admin/extensions/${extensionId}`).catch(() => undefined);
  }
});

test("cost ledger and cross-shot approval preview apply as one visible decision", async ({
  page,
  request,
}) => {
  for (const extensionId of ["studio.takeboard.cost-insights", "studio.takeboard.batch-review"]) {
    const enabled = await request.patch(`/api/admin/extensions/${extensionId}`, {
      data: { enabled: true },
    });
    expect(enabled.ok(), await enabled.text()).toBeTruthy();
  }
  const title = `成本审批验收 ${Date.now()}`;
  const createdResponse = await request.post("/api/projects", {
    data: { title, aspectRatio: "16:9" },
  });
  expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
  const created = (await createdResponse.json()) as {
    key: string;
    snapshot: { shots: Array<{ id: string }> };
  };
  const key = created.key;
  const firstShotId = created.snapshot.shots[0]?.id;
  if (!firstShotId) throw new Error("E2E project did not create its starter shot");
  const secondShotResponse = await request.post(`/api/projects/${key}/shots`, {
    data: { label: "SH-02", durationSeconds: 6, aspectRatio: "16:9" },
  });
  expect(secondShotResponse.ok(), await secondShotResponse.text()).toBeTruthy();

  const dataRoot = process.env.TAKEBOARD_E2E_DATA_ROOT ?? resolve("test-results/e2e-data");
  const directory = resolve(dataRoot, key);
  const store = ProjectStore.openExisting(directory);
  if (!store) throw new Error("Unable to open E2E cost project");
  let firstReplacementTakeId = "";
  let secondTakeId = "";
  try {
    const current = store.loadCurrent();
    const firstShot = current?.snapshot.shots.find((shot) => shot.id === firstShotId);
    const secondShot = current?.snapshot.shots.find((shot) => shot.id !== firstShotId);
    if (!current || !firstShot || !secondShot) throw new Error("E2E shots are incomplete");
    const timestamp = toIsoTimestamp();
    const workerId = createTakeBoardId("worker");
    const recipeId = createTakeBoardId("recipe");
    const workflowSha256 = "f".repeat(64);
    await mkdir(resolve(directory, "renders", "governance"), { recursive: true });

    const definitions = [
      {
        shot: firstShot,
        amount: 2,
        accuracy: "exact" as const,
        source: "provider_reported" as const,
      },
      {
        shot: firstShot,
        amount: 1,
        accuracy: "estimated" as const,
        source: "worker_rate" as const,
      },
      {
        shot: secondShot,
        amount: null,
        accuracy: "unknown" as const,
        source: "unavailable" as const,
      },
    ];
    const takeIds: string[] = [];
    for (const [index, definition] of definitions.entries()) {
      const runId = createTakeBoardId("run");
      const takeId = createTakeBoardId("take");
      const assetId = createTakeBoardId("asset");
      takeIds.push(takeId);
      const storagePath = `renders/governance/${assetId}.png`;
      await writeFile(resolve(directory, storagePath), onePixelPng, { mode: 0o600 });
      current.snapshot.assets.push({
        id: assetId,
        projectId: current.snapshot.project.id,
        mediaType: "image",
        originalName: `candidate-${index + 1}.png`,
        mimeType: "image/png",
        byteSize: onePixelPng.byteLength,
        sha256: String(index + 1).repeat(64),
        storagePath,
        proxyPath: null,
        width: 1,
        height: 1,
        customTags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      current.snapshot.runs.push({
        id: runId,
        shotId: definition.shot.id,
        recipeId,
        recipeVersion: "e2e@1",
        workflowSha256,
        workerId,
        promptId: `e2e-${index + 1}`,
        status: "completed",
        inputs: [],
        parameters: { seed: index + 1 },
        execution: null,
        estimatedCost:
          definition.accuracy === "estimated"
            ? {
                amount: definition.amount,
                currency: "CNY",
                accuracy: definition.accuracy,
                source: definition.source,
                computeSeconds: 300,
                unitRatePerHour: 12,
                recordedAt: timestamp,
              }
            : {
                amount: null,
                currency: "CNY",
                accuracy: "unknown",
                source: "unavailable",
                computeSeconds: null,
                unitRatePerHour: null,
                recordedAt: null,
              },
        actualCost:
          definition.accuracy === "exact"
            ? {
                amount: definition.amount,
                currency: "CNY",
                accuracy: definition.accuracy,
                source: definition.source,
                computeSeconds: 280,
                unitRatePerHour: null,
                recordedAt: timestamp,
              }
            : {
                amount: null,
                currency: "CNY",
                accuracy: "unknown",
                source: "unavailable",
                computeSeconds: null,
                unitRatePerHour: null,
                recordedAt: null,
              },
        errorCode: null,
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      current.snapshot.takes.push({
        id: takeId,
        runId,
        shotId: definition.shot.id,
        assetId,
        status: index === 0 ? "approved" : "candidate",
        rejectionReasons: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    const initiallyApprovedTakeId = takeIds[0];
    firstReplacementTakeId = takeIds[1] ?? "";
    secondTakeId = takeIds[2] ?? "";
    if (!initiallyApprovedTakeId || !firstReplacementTakeId || !secondTakeId) {
      throw new Error("E2E approval fixture IDs are incomplete");
    }
    firstShot.status = "approved";
    firstShot.approvedTakeId = initiallyApprovedTakeId;
    secondShot.status = "review";
    current.snapshot.approvals.push({
      id: createTakeBoardId("approval"),
      shotId: firstShot.id,
      takeId: initiallyApprovedTakeId,
      status: "active",
      reason: "初始采用",
      actorUserId: null,
      actorName: "E2E",
      createdAt: timestamp,
      revokedAt: null,
    });
    current.snapshot.project.updatedAt = timestamp;
    current.snapshot.exportedAt = timestamp;
    await store.save(current.snapshot, { type: "e2e.cost_approval_fixture" });
  } finally {
    store.close();
  }

  try {
    await page.goto("/");
    const card = page.locator(".project-card").filter({ hasText: title });
    await card.getByRole("button", { name: /打开画板/ }).click();
    await page.getByRole("button", { name: "打开分镜墙" }).click();
    const storyboard = page.getByRole("dialog", { name: "项目分镜墙" });
    await storyboard.getByRole("tab", { name: "批量审片与成本" }).click();
    await expect(storyboard.getByRole("heading", { name: "成本与采用决策" })).toBeVisible();
    await expect(storyboard).toContainText("CNY 已知支出");
    await expect(storyboard).toContainText("3.00");
    await expect(storyboard).toContainText("1 次未知");
    await expect(storyboard).toContainText("不可可靠计算");

    const firstRow = storyboard.locator(".approval-shot-row").filter({ hasText: "SH-01" });
    const secondRow = storyboard.locator(".approval-shot-row").filter({ hasText: "SH-02" });
    await firstRow.getByRole("button").filter({ hasText: "Take 2" }).click();
    await secondRow.getByRole("button").filter({ hasText: "Take 1" }).click();
    await expect(storyboard).toContainText("2 个镜头待提交");
    await storyboard.getByRole("button", { name: "预览批量批准" }).click();
    const confirmation = storyboard.getByRole("alertdialog", { name: "确认批量批准" });
    await expect(confirmation).toContainText("确认采用 2 个候选");
    await expect(confirmation).toContainText("其中 1 个镜头会替换当前采用版本");
    await page.screenshot({
      path: "test-results/takeboard-cost-approval.png",
      animations: "disabled",
    });
    await confirmation.getByRole("button", { name: "确认并保存全部决策" }).click();
    await expect(confirmation).toBeHidden();
    await expect(page.getByText("跨镜头审批已原子保存", { exact: true })).toBeVisible();

    const loaded = await request.get(`/api/projects/${key}`);
    expect(loaded.ok(), await loaded.text()).toBeTruthy();
    const payload = (await loaded.json()) as {
      snapshot: { shots: Array<{ id: string; approvedTakeId: string | null }> };
    };
    expect(payload.snapshot.shots.find((shot) => shot.id === firstShotId)?.approvedTakeId).toBe(
      firstReplacementTakeId,
    );
    expect(payload.snapshot.shots.find((shot) => shot.id !== firstShotId)?.approvedTakeId).toBe(
      secondTakeId,
    );
  } finally {
    await page.goto("/").catch(() => undefined);
    await request.delete(`/api/projects/${key}`);
  }
});
