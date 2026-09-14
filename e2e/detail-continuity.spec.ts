import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("quick previews and open details retain their mode across shots and sources", async ({
  page,
  request,
}) => {
  const title = `连续查看 ${Date.now()}`;
  const { key } = await (await request.post("/api/projects", { data: { title } })).json();
  try {
    const ids: string[] = [];
    for (const [index, label] of ["森林", "海边"].entries()) {
      const response = await request.post(`/api/projects/${key}/commands`, {
        data: {
          requestId: crypto.randomUUID(),
          command: { type: "canvas.create_shot", label, x: index * 540, y: 0 },
        },
      });
      expect(response.ok()).toBeTruthy();
      ids.push((await response.json()).itemId);
    }
    expect(
      (
        await request.post(`/api/projects/${key}/assets?x=0&y=350`, {
          multipart: {
            file: {
              name: "portrait.webp",
              mimeType: "image/webp",
              buffer: await readFile("apps/web/public/scene/takeboard-crew-mascot.webp"),
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
    await page.locator(".react-flow__pane").click({ position: { x: 8, y: 8 } });
    for (const id of [ids[0], ids[1], ids[0]]) {
      const node = page.locator(`.react-flow__node[data-id="${id}"]`);
      await node.locator(".shot-planning-surface").click();
      await expect(node).toHaveClass(/selected/);
      await expect(node.locator(".shot-inline-console")).toBeVisible();
      await expect(page.locator(".inspector")).toBeHidden();
    }
    await page.locator(`.react-flow__node[data-id="${ids[0]}"] .shot-planning-surface`).dblclick();
    await expect(page.getByLabel("镜头候选检查器")).toBeVisible();
    await page.locator(".react-flow__controls-fitview").click();
    await page.locator(`.react-flow__node[data-id="${ids[1]}"] .shot-planning-surface`).click();
    await expect(page.getByLabel("镜头名称", { exact: true })).toHaveValue("海边");
    await expect(page.locator(".shot-inline-console")).toHaveCount(0);
    await page.locator(".react-flow__node-asset img").click();
    await expect(page.getByLabel("素材节点检查器")).toBeVisible();
    await expect(page.locator(".inspector .detail-media img")).toBeVisible();
    await page.locator(`.react-flow__node[data-id="${ids[0]}"] .shot-planning-surface`).click();
    await expect(page.getByLabel("镜头名称", { exact: true })).toHaveValue("森林");
    await page.locator(".react-flow__pane").click({ position: { x: 8, y: 8 } });
    await expect(page.locator(".inspector")).toBeHidden();
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});

test("asset details preserve natural image ratios and have no preview frame", async ({
  page,
  request,
}) => {
  const title = `媒体详情 ${Date.now()}`;
  const { key } = await (await request.post("/api/projects", { data: { title } })).json();
  try {
    for (const name of ["takeboard-crew-mascot.webp", "takeboard-storyboard-moth.webp"]) {
      expect(
        (
          await request.post(`/api/projects/${key}/assets?canvas=0`, {
            multipart: {
              file: {
                name,
                mimeType: "image/webp",
                buffer: await readFile(`apps/web/public/scene/${name}`),
              },
            },
          })
        ).ok(),
      ).toBeTruthy();
    }
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.getByRole("button", { name: /打开资产库/ }).click();
    const cards = page.locator(".asset-vault-card");
    await expect(cards).toHaveCount(2);
    for (const width of [1440, 1000]) {
      await page.setViewportSize({ width, height: 780 });
      for (let index = 0; index < 2; index++) {
        await cards.nth(index).click();
        const preview = page.locator(".asset-detail-panel .detail-media img");
        await expect
          .poll(() => preview.evaluate((node: HTMLImageElement) => node.naturalWidth))
          .toBeGreaterThan(0);
        const geometry = await preview.evaluate((node: HTMLImageElement) => {
          const rect = node.getBoundingClientRect();
          return {
            ratio: rect.width / rect.height,
            source: node.naturalWidth / node.naturalHeight,
            border: getComputedStyle(node).borderWidth,
            background: getComputedStyle(node).backgroundColor,
          };
        });
        expect(geometry.ratio).toBeCloseTo(geometry.source, 2);
        expect(geometry.border).toBe("0px");
        expect(geometry.background).toBe("rgba(0, 0, 0, 0)");
        await expect(page.locator(".detail-media")).toHaveCSS(
          "background-color",
          "rgba(0, 0, 0, 0)",
        );
      }
    }
    await page.screenshot({
      path: "test-results/detail-natural-media.png",
      animations: "disabled",
    });
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});

test("account details fit normal and small windows, dismiss outside and restore keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.locator(".account-button").first();
  for (const size of [
    { width: 1280, height: 720 },
    { width: 900, height: 620 },
    { width: 600, height: 650 },
  ]) {
    await page.setViewportSize(size);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "我的账号" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "个人资料", exact: true })).toHaveClass(
      "active",
    );
    const box = await dialog.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height + 1);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.screenshot({
      path: `test-results/account-${size.width}.png`,
      animations: "disabled",
    });
    if (size.width > 760) await page.mouse.click(4, 4);
    else await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});
