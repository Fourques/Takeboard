import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("default project location is explicit, survives reopening and fits narrow settings dialogs", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/device/settings")).json();
  const folder = `设置验收-${Date.now()}`;
  expect(
    (
      await request.post("/api/storage/folders", {
        data: { rootId: "instance", folder: "", name: folder },
      })
    ).ok(),
  ).toBeTruthy();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "打开工作区选项" }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "设置", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "保存默认位置" })).toBeDisabled();
    await dialog.getByRole("button", { name: "选择文件夹" }).click();
    await dialog.getByRole("button", { name: `▸ ${folder}`, exact: true }).click();
    await expect(dialog.getByRole("button", { name: "保存默认位置" })).toBeEnabled();
    // Merely browsing a folder does not change the default.
    expect((await (await request.get("/api/device/settings")).json()).revision).toBe(
      original.revision,
    );
    await dialog.getByRole("button", { name: "保存默认位置" }).click();
    await expect(dialog.getByRole("status")).toContainText("默认位置已保存");
    await page.setViewportSize({ width: 390, height: 620 });
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error("Settings dialog has no visible bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(bounds.height).toBeLessThanOrEqual(620);
    await expect(dialog.getByRole("link", { name: /查看官方发布/ })).toBeAttached();
    await dialog.getByRole("link", { name: /查看官方发布/ }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("link", { name: /查看官方发布/ })).toBeInViewport();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      axe.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
    ).toEqual([]);
    await page.screenshot({ path: "test-results/settings-narrow.png" });
    await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "打开工作区选项" }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.press("Escape");
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.reload();
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await expect(page.locator(".project-location-summary code")).toContainText(folder);
  } finally {
    const current = await (await request.get("/api/device/settings")).json();
    expect(
      (
        await request.put("/api/device/settings", {
          data: { revision: current.revision, projectLocation: original.projectLocation },
        })
      ).ok(),
    ).toBeTruthy();
  }
});

test("display controls remain synchronized when storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开工作区选项" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("button", { name: "显示大小：清晰" }).click();
  await dialog.getByRole("button", { name: /大字/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-display-scale", "1-24");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-display-scale", "1-24");
});
