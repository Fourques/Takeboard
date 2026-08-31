import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("homepage has no serious WCAG A/AA violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从素材到成片，都在一张画布。" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const releaseBlocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(releaseBlocking, JSON.stringify(releaseBlocking, null, 2)).toEqual([]);
});

test("display scale is clear by default and remains a user choice", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-display-scale", "1-12");
  await page.getByRole("button", { name: "打开工作区选项" }).click();
  await page.getByRole("button", { name: "显示大小：清晰" }).click();
  await page.getByRole("button", { name: /大字/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-display-scale", "1-24");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-display-scale", "1-24");
});

test("workspace, operations and storyboard have no serious WCAG A/AA violations", async ({
  page,
  request,
}) => {
  for (const extensionId of [
    "studio.takeboard.rough-cut",
    "studio.takeboard.cost-insights",
    "studio.takeboard.batch-review",
    "studio.takeboard.production-qc",
  ]) {
    const disabled = await request.patch(`/api/admin/extensions/${extensionId}`, {
      data: { enabled: false },
    });
    expect(disabled.ok(), await disabled.text()).toBeTruthy();
  }
  const title = `无障碍验收 ${Date.now()}`;
  const created = await request.post("/api/projects", { data: { title } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { key } = (await created.json()) as { key: string };

  try {
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await expect(page.getByRole("region", { name: "TakeBoard 创作画布" })).toBeVisible();

    const workspaceResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      workspaceResults.violations.filter(
        (violation) => violation.impact === "critical" || violation.impact === "serious",
      ),
      JSON.stringify(workspaceResults.violations, null, 2),
    ).toEqual([]);

    await page.getByRole("button", { name: "打开生成任务、存储与诊断中心" }).click();
    await expect(page.getByRole("dialog", { name: "生成任务、存储与诊断中心" })).toBeVisible();
    const operationsResults = await new AxeBuilder({ page })
      .include(".operations-panel")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      operationsResults.violations.filter(
        (violation) => violation.impact === "critical" || violation.impact === "serious",
      ),
      JSON.stringify(operationsResults.violations, null, 2),
    ).toEqual([]);
    await page.getByRole("button", { name: "关闭任务中心" }).click();

    await page.getByRole("button", { name: "打开分镜墙" }).click();
    const storyboard = page.getByRole("dialog", { name: "项目分镜墙" });
    await expect(storyboard).toBeVisible();
    await expect(storyboard.getByRole("tablist", { name: "分镜查看方式" })).toHaveCount(0);
    await expect(storyboard.getByText("成本台账", { exact: true })).toHaveCount(0);
    const storyboardResults = await new AxeBuilder({ page })
      .include(".storyboard-shell")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      storyboardResults.violations.filter(
        (violation) => violation.impact === "critical" || violation.impact === "serious",
      ),
      JSON.stringify(storyboardResults.violations, null, 2),
    ).toEqual([]);
  } finally {
    await request.delete(`/api/projects/${key}`);
  }
});
