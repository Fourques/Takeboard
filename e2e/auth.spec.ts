import { expect, test } from "./fixtures";

test("unauthenticated visitors see the login boundary and can sign in", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "回到你的创作空间" })).toBeVisible();
    await page.getByLabel("邮箱").fill("e2e@takeboard.local");
    await page.getByLabel("密码").fill("takeboard e2e private passphrase");
    await page.getByRole("button", { name: "进入 TakeBoard" }).click();
    await expect(page.getByText("FILMMAKING WORKSPACE")).toBeVisible();
    await expect(page.getByRole("button", { name: /TakeBoard E2E/ })).toBeVisible();
  } finally {
    await context.close();
  }
});
