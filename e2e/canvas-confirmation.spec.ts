import { readFile } from "node:fs/promises";
import type { ProjectCommand, ProjectSnapshot } from "@takeboard/contracts";
import { expect, test } from "./fixtures";

test("gentle arrangement uses rendered bounds, confirms changes and preserves the viewport", async ({
  page,
  request,
}) => {
  const title = `轻量对齐 ${Date.now()}`;
  const created = await request.post("/api/projects", { data: { title } });
  expect(created.ok()).toBeTruthy();
  const { key } = await created.json();
  const current = async () =>
    (await (await request.get(`/api/projects/${key}`)).json()).snapshot as ProjectSnapshot;
  try {
    for (const offset of [0, 12]) {
      const response = await request.post(`/api/projects/${key}/assets?x=${offset}&y=${offset}`, {
        multipart: {
          file: {
            name: `portrait-${offset}.webp`,
            mimeType: "image/webp",
            buffer: await readFile("apps/web/public/scene/takeboard-crew-mascot.webp"),
          },
        },
      });
      expect(response.ok()).toBeTruthy();
    }
    const before = await current();
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    const nodes = page.locator(".react-flow__node-asset");
    await expect(nodes).toHaveCount(2);
    const viewport = page.locator(".react-flow__viewport");
    // React Flow mounts nodes before its initial fitView has measured them.
    // Wait for that initial fit before recording the view that arrangement must preserve.
    await expect(viewport).not.toHaveAttribute(
      "style",
      "transform: translate(60px, 30px) scale(0.78);",
    );
    const originalTransform = await viewport.getAttribute("style");
    const previewRequest = page.waitForRequest((request) =>
      request.url().endsWith("/commands/preview"),
    );
    await page.getByRole("button", { name: "轻量对齐当前画布" }).click();
    const command = (await previewRequest).postDataJSON().command;
    expect(command.nodeSizes).toHaveLength(2);
    for (const size of command.nodeSizes) {
      const bounds = await page
        .locator(`.react-flow__node[data-id="${size.itemId}"]`)
        .evaluate((element) => ({
          width: (element as HTMLElement).offsetWidth,
          height: (element as HTMLElement).offsetHeight,
        }));
      expect(Math.abs(size.width - bounds.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(size.height - bounds.height)).toBeLessThanOrEqual(1);
    }
    const dialog = page.getByRole("alertdialog", { name: "整理当前画布？" });
    await expect(dialog).toBeVisible();
    expect((await current()).canvasItems).toEqual(before.canvasItems);
    await dialog.getByRole("button", { name: "保持现状" }).click();
    expect((await current()).canvasItems).toEqual(before.canvasItems);
    await page.getByRole("button", { name: "轻量对齐当前画布" }).click();
    await dialog.getByRole("button", { name: "应用对齐" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => {
        const a = await nodes.nth(0).boundingBox();
        const b = await nodes.nth(1).boundingBox();
        return (
          !!a &&
          !!b &&
          (a.x + a.width < b.x ||
            b.x + b.width < a.x ||
            a.y + a.height < b.y ||
            b.y + b.height < a.y)
        );
      })
      .toBe(true);
    expect(await viewport.getAttribute("style")).toBe(originalTransform);
    expect((await current()).canvasItems[0]?.x).toBe(before.canvasItems[0]?.x);
    expect((await current()).canvasItems[0]?.y).toBe(before.canvasItems[0]?.y);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});

test("replacing a canvas input requires approval and can be undone", async ({ page, request }) => {
  test.setTimeout(60_000);
  const title = `连线确认 ${Date.now()}`;
  const created = await request.post("/api/projects", { data: { title } });
  expect(created.ok()).toBeTruthy();
  const { key } = await created.json();
  const execute = async (command: ProjectCommand) => {
    const response = await request.post(`/api/projects/${key}/commands`, {
      data: { command, requestId: `e2e:${crypto.randomUUID()}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  try {
    const shot = await execute({ type: "canvas.create_shot", x: 450, y: 120 });
    await execute({
      type: "canvas.edit_item",
      itemId: shot.itemId,
      workflowPath: "Kino/Kino_Wan22_FLF2V.json",
    });
    const sources: string[] = [];
    for (const [name, y] of [
      ["original.webp", 0],
      ["replacement.webp", 330],
    ] as const) {
      const uploaded = await request.post(`/api/projects/${key}/assets?x=0&y=${y}`, {
        multipart: {
          file: {
            name,
            mimeType: "image/webp",
            buffer: await readFile("apps/web/public/scene/takeboard-crew-mascot.webp"),
          },
        },
      });
      expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
      const { snapshot } = (await uploaded.json()) as { snapshot: ProjectSnapshot };
      const source = snapshot.canvasItems.filter((item) => item.refType === "asset").at(-1);
      if (!source) throw new Error("Uploaded asset has no canvas projection");
      sources.push(source.id);
    }
    const [original, replacement] = sources;
    if (!original || !replacement) throw new Error("Missing connection sources");
    await execute({
      type: "canvas.connect_items",
      sourceItemId: original,
      targetItemId: shot.itemId,
      targetSlot: "first_frame",
    });
    // No GPU required: use the existing offline preset for handle presentation.
    await page.route("**/api/workflows", (route) =>
      route.fulfill({ json: { workflows: [], warnings: [], editorUrl: "http://127.0.0.1:8188" } }),
    );
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    const drag = async () => {
      const source = page.locator(
        `.react-flow__node[data-id="${replacement}"] .board-output-handle`,
      );
      const target = page.locator(`.react-flow__node[data-id="${shot.itemId}"] .slot-first_frame`);
      await expect(source).toBeVisible();
      await expect(target).toBeVisible();
      const a = await source.boundingBox();
      const b = await target.boundingBox();
      if (!a || !b) throw new Error("Missing canvas handles");
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
      await page.mouse.up();
    };
    const current = async () =>
      (await (await request.get(`/api/projects/${key}`)).json()) as {
        revision: number;
        snapshot: ProjectSnapshot;
      };
    const before = await current();
    await drag();
    const dialog = page.getByRole("dialog", { name: "替换已有输入？" });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: "test-results/canvas-connection-confirmation.png" });
    await dialog.getByRole("button", { name: "保留原输入" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await current()).toEqual(before);
    await drag();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "替换并连接" }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await current()).snapshot.canvasEdges.find((edge) => edge.targetSlot === "first_frame")
            ?.sourceItemId,
      )
      .toBe(replacement);
    await page.getByRole("button", { name: "查看项目操作记录" }).click();
    await page
      .getByLabel("项目操作记录")
      .getByRole("button", { name: "撤销此操作" })
      .first()
      .click();
    await expect
      .poll(
        async () =>
          (await current()).snapshot.canvasEdges.find((edge) => edge.targetSlot === "first_frame")
            ?.sourceItemId,
      )
      .toBe(original);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
