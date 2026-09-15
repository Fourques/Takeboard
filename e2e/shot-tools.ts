import type { Page } from "@playwright/test";

export async function openShotTools(page: Page) {
  await page.getByRole("button", { name: "扩展", exact: true }).click();
  await page
    .getByRole("dialog", { name: "TakeBoard 扩展库" })
    .getByRole("button", { name: "打开镜头编排" })
    .first()
    .click();
}
