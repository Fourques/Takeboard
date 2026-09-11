import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("a render failure can download and expose a diagnostic without project contents", async ({
  page,
  request,
}) => {
  const title = `恢复验收 ${Date.now()}`;
  const created = await request.post("/api/projects", { data: { title } });
  const { key } = await created.json();
  try {
    const response = await request.get(`/api/projects/${key}`);
    const payload = await response.json();
    // Deliberately invalid render data, intercepted only in this test browser.
    // The saved project on disk is left valid and is never sent to the report.
    payload.snapshot.project.title = { invalidReactChild: true };
    await page.route(`**/api/projects/${key}`, (route) => route.fulfill({ json: payload }));
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await expect(page.locator(".fatal-error-shell")).toBeVisible();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载异常报告" }).click();
    const download = await pending;
    const path = await download.path();
    expect(path).toBeTruthy();
    const text = await readFile(path as string, "utf8");
    const report = JSON.parse(text);
    expect(report.format).toBe("takeboard.client-crash-report");
    expect(report.error.componentStack).toBeTruthy();
    expect(text).not.toContain(title);
    await expect(page.getByLabel("异常报告文本")).toHaveValue(text);
    await expect(page.getByRole("button", { name: "复制报告" })).toBeEnabled();
  } finally {
    await request.delete(`/api/projects/${key}`);
  }
});
