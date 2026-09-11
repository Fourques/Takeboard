import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("device identity, folder creation and original downloads share the selected server", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const suffix = Date.now().toString(36);
  const folder = `验收文件夹-${suffix}`;
  const title = `位置验收-${suffix}`;
  await page.addInitScript(() => localStorage.setItem("takeboard.blankCanvasGuideSeen", "1"));
  const display = new URLSearchParams({
    "tb-device": JSON.stringify({ kind: "ssh", address: "render-server", name: "剪辑主机" }),
  });
  await page.goto(`/#${display}`);
  await expect(page.getByLabel("当前设备：剪辑主机")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 650 });
  await page.getByLabel("当前设备：剪辑主机").click();
  await expect(page.locator(".device-indicator-panel")).toContainText("render-server");
  const panel = await page.locator(".device-indicator-panel").boundingBox();
  if (!panel) throw new Error("Device menu has no visible bounds");
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(390);
  await page.getByLabel("当前设备：剪辑主机").press("Escape");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建项目" });
  await dialog.getByLabel("项目名称", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "选择文件夹" }).click();
  await dialog.getByLabel("新建子文件夹", { exact: true }).fill(folder);
  await dialog.getByRole("button", { name: "创建文件夹", exact: true }).click();
  await expect(dialog.locator(".project-location-summary code")).toContainText(folder);
  await page.setViewportSize({ width: 720, height: 620 });
  await dialog.getByRole("button", { name: "进入画布 →" }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "进入画布 →" })).toBeInViewport();
  await page.screenshot({ path: "test-results/project-folder-small-window.png" });
  const creating = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/projects") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "进入画布 →" }).click();
  const created = await creating;
  expect(created.status()).toBe(201);
  const key = (await created.json()).key as string;
  try {
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.getByLabel("当前设备：剪辑主机").click();
    await expect(page.locator(".device-indicator-panel")).toContainText(folder);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 720, height: 620 },
      { width: 390, height: 500 },
    ]) {
      await page.setViewportSize(viewport);
      const files = page.getByRole("dialog", { name: "项目文件位置" });
      await expect(files).toBeVisible();
      const bounds = await files.boundingBox();
      if (!bounds) throw new Error("Missing project files menu");
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      await files.getByRole("button", { name: "复制文件夹路径" }).scrollIntoViewIfNeeded();
      await expect(files.getByRole("button", { name: "复制文件夹路径" })).toBeInViewport();
      expect(
        await page
          .locator(".topbar")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      expect(
        await page
          .locator(".topbar .settings-entry")
          .evaluate((element) => getComputedStyle(element).whiteSpace),
      ).toBe("nowrap");
    }
    await page.screenshot({ path: "test-results/project-files-popover-narrow.png" });
    const location = await (await request.get(`/api/projects/${key}/location`)).json();
    expect(location.directory).toContain(folder);
    expect(location.directory).toContain(title);
    const original = await readFile("apps/web/public/scene/takeboard-crew-mascot.webp");
    const imported = await request.post(`/api/projects/${key}/assets`, {
      multipart: { file: { name: "原始参考.webp", mimeType: "image/webp", buffer: original } },
    });
    expect(imported.status()).toBe(201);
    const snapshot = (await imported.json()).snapshot;
    const asset = snapshot.assets.find(
      (item: { originalName: string }) => item.originalName === "原始参考.webp",
    );
    expect(asset).toBeTruthy();
    const download = await request.get(
      `/api/projects/${key}/assets/${asset.id}/content?download=1`,
    );
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment;");
    expect(await download.body()).toEqual(original);
    await page.reload();
    await expect(page.getByLabel("当前设备：剪辑主机")).toBeVisible();
  } finally {
    const removed = await request.delete(`/api/projects/${key}`);
    expect(removed.ok()).toBeTruthy();
  }
});
