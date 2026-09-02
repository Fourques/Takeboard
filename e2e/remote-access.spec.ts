import { expect, test } from "@playwright/test";

test("account center explains real access and the optional self-hosted portal", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  await expect(manifest.json()).resolves.toMatchObject({
    name: "TakeBoard 创作工作台",
    display: "standalone",
  });

  await page.locator(".account-button").first().click();
  const center = page.locator(".account-center");
  await expect(center).toBeVisible();
  await center.getByRole("button", { name: "访问与安装" }).click();

  await expect(center.getByRole("heading", { name: "访问与安装" })).toBeVisible();
  await expect(center.getByText("本机或 SSH 隧道", { exact: true })).toBeVisible();
  await expect(center.getByRole("button", { name: "复制连接命令" })).toBeVisible();
  await expect(center.getByText("TakeBoard 账号门户", { exact: true })).toBeVisible();
  await expect(center.getByText(/登录自托管门户即可/)).toBeVisible();
  await expect(center.getByLabel("TakeBoard 门户地址")).toHaveAttribute(
    "placeholder",
    "https://portal.example.com",
  );
  await expect(center.getByText(/已连接云端/)).toHaveCount(0);
  await expect(center.getByRole("region", { name: "远程访问安全检查" })).toBeVisible();
});
