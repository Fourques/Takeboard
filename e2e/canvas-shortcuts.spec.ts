import type { ProjectSnapshot } from "@takeboard/contracts";
import { expect, test } from "./fixtures";

test("canvas shortcuts preserve input composition, duplicate, undo, redo and cut without losing content", async ({
  page,
  request,
}) => {
  const title = `桌面操作 ${Date.now()}`;
  const { key } = await (await request.post("/api/projects", { data: { title } })).json();
  const current = async (): Promise<ProjectSnapshot> =>
    (await (await request.get(`/api/projects/${key}`)).json()).snapshot;
  try {
    const created = await request.post(`/api/projects/${key}/commands`, {
      data: {
        requestId: crypto.randomUUID(),
        command: { type: "canvas.create_shot", label: "操作原件", x: 0, y: 0 },
      },
    });
    expect(created.ok()).toBeTruthy();
    const { itemId } = await created.json();
    expect(
      (
        await request.post(`/api/projects/${key}/commands`, {
          data: {
            requestId: crypto.randomUUID(),
            command: {
              type: "canvas.edit_item",
              itemId,
              workflowPath: "Kino/Kino_QwenImage2512_T2I.json",
            },
          },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    const node = page.locator(".react-flow__node-shot").first();
    await node.locator(".shot-planning-surface").click();
    await expect(node.locator(".shot-inline-console")).toBeVisible();
    const width = page.getByLabel("画布宽度", { exact: true });
    await width.focus();
    await width.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
    await expect(width).toBeFocused();
    await width.press("ControlOrMeta+a");
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
    await width.blur();
    // IME candidate cancellation must not clear the canvas selection.
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
        }),
      ),
    );
    await expect(node.locator(".shot-inline-console")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+d");
    await expect.poll(async () => (await current()).canvasItems.length).toBe(2);
    await expect(page.getByText("已创建可独立编辑的副本；素材文件不会重复占用空间")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await current()).canvasItems.length).toBe(1);
    await expect(page.locator(".toast.success")).toContainText("已撤销");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(async () => (await current()).canvasItems.length).toBe(2);
    await expect(page.locator(".toast.success")).toContainText("已重做");
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");
    await expect.poll(async () => (await current()).canvasItems.length).toBe(4);
    await expect(page.locator(".toast.success")).toContainText("已复制 2 个节点");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await current()).canvasItems.length).toBe(2);
    await expect(page.locator(".toast.success")).toContainText("已撤销");
    await page.keyboard.press("ControlOrMeta+a");
    const before = (await current()).canvasItems;
    await page.keyboard.press("ControlOrMeta+x");
    expect((await current()).canvasItems).toEqual(before);
    await page.keyboard.press("ControlOrMeta+v");
    await expect
      .poll(async () => (await current()).canvasItems.map(({ x, y }) => ({ x, y })))
      .not.toEqual(before.map(({ x, y }) => ({ x, y })));
    expect((await current()).canvasItems.map((item) => item.id).sort()).toEqual(
      before.map((item) => item.id).sort(),
    );
    await expect(page.locator(".toast.success")).toContainText("节点已移动到新的位置");
    await page.keyboard.press("Escape");
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
