import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ProjectService } from "../apps/server/dist/project-service.js";
import { ProjectStore } from "../apps/server/dist/storage/project-store.js";
import { createTakeBoardId, toIsoTimestamp } from "../packages/domain/dist/index.js";
import { expect, test } from "./fixtures";

test("@performance a 500-node production board remains loadable and interactive", async ({
  page,
}) => {
  const loadBudgetMilliseconds = Number(process.env.TAKEBOARD_CANVAS_LOAD_BUDGET_MS ?? "8000");
  if (!Number.isFinite(loadBudgetMilliseconds) || loadBudgetMilliseconds <= 0) {
    throw new Error("TAKEBOARD_CANVAS_LOAD_BUDGET_MS 必须是正数");
  }
  const dataRoot = process.env.TAKEBOARD_E2E_DATA_ROOT ?? resolve("test-results/e2e-data");
  const key = `large-canvas-${Date.now().toString(36)}.takeboard`;
  const directory = resolve(dataRoot, key);
  try {
    await new ProjectService().create({ projectDirectory: directory, title: "500 节点性能验收" });
    const store = ProjectStore.openExisting(directory);
    if (!store) throw new Error("Unable to create large-canvas fixture");
    try {
      const current = store.loadCurrent();
      const scene = current?.snapshot.scenes[0];
      if (!current || !scene) throw new Error("Large-canvas fixture has no scene");
      const timestamp = toIsoTimestamp();
      for (let index = 0; index < 500; index += 1) {
        const textId = createTakeBoardId("text");
        current.snapshot.textItems.push({
          id: textId,
          projectId: current.snapshot.project.id,
          sceneId: scene.id,
          kind: "direction_note",
          title: `制作笔记 ${String(index + 1).padStart(3, "0")}`,
          body: "500 节点发布门槛",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        current.snapshot.canvasItems.push({
          id: createTakeBoardId("canvas_item"),
          sceneId: scene.id,
          refType: "text",
          refId: textId,
          x: (index % 25) * 340,
          y: Math.floor(index / 25) * 230,
          width: 300,
          height: 190,
          zIndex: index + 1,
          parentGroupId: null,
          collapsed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      current.snapshot.project.updatedAt = timestamp;
      current.snapshot.exportedAt = timestamp;
      await store.save(current.snapshot, { type: "release_gate.large_canvas_created" });
    } finally {
      store.close();
    }

    await page.goto("/");
    const startedAt = await page.evaluate(() => performance.now());
    const card = page.locator(".project-card").filter({ hasText: "500 节点性能验收" });
    await card.getByRole("button", { name: /打开画板/ }).click();
    await expect(page.locator(".canvas-status")).toContainText("500 节点", {
      timeout: loadBudgetMilliseconds,
    });
    const renderedNodes = page.locator(".react-flow__node");
    await expect
      .poll(() => renderedNodes.count(), { timeout: loadBudgetMilliseconds })
      .toBeGreaterThan(0);
    const renderedNodeCount = await renderedNodes.count();
    // React Flow still owns all 500 nodes (the status above is sourced from the complete model),
    // while the DOM only carries the current viewport. This is the production behaviour we want:
    // large boards remain complete without paying layout/paint cost for off-screen cards.
    expect(renderedNodeCount).toBeLessThan(500);
    const loadMilliseconds = (await page.evaluate(() => performance.now())) - startedAt;
    expect(loadMilliseconds).toBeLessThan(loadBudgetMilliseconds);

    const frameP95 = await page.evaluate(async () => {
      const deltas: number[] = [];
      let previous = performance.now();
      for (let frame = 0; frame < 60; frame += 1) {
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        const current = performance.now();
        deltas.push(current - previous);
        previous = current;
      }
      return deltas.sort((left, right) => left - right)[Math.floor(deltas.length * 0.95)] ?? 0;
    });
    expect(frameP95).toBeLessThan(100);
    console.log(
      `500-node gate: load=${Math.round(loadMilliseconds)}ms/${loadBudgetMilliseconds}ms, rendered=${renderedNodeCount}/500, animation-frame-p95=${frameP95.toFixed(1)}ms`,
    );
    await page.locator(".react-flow__pane").click({ position: { x: 400, y: 260 } });
    await expect(page.locator(".canvas-status")).toContainText("500 节点");
  } finally {
    await page.goto("/").catch(() => undefined);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
