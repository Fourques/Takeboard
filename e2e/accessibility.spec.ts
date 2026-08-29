import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "显示大小：清晰" }).click();
  await page.getByRole("button", { name: /大字/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-display-scale", "1-24");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-display-scale", "1-24");
});
