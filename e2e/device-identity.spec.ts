import { expect, test } from "./fixtures";

test("an unavailable service can be saved, reselected and restored without a duplicate device", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择生成设备", exact: true }).click();
  await page.getByRole("button", { name: "管理设备", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "添加设备", exact: true }).click();
  await settings.getByRole("combobox", { name: "连接方式", exact: true }).selectOption("url");
  await settings.getByLabel("服务地址", { exact: true }).fill("http://127.0.0.1:1");
  await settings.getByLabel("设备名称（选填）", { exact: true }).fill("Offline studio");
  await settings.getByRole("button", { name: "保存设备", exact: true }).click();
  await expect(settings.getByText("设备已保存", { exact: true })).toBeVisible();
  const status = await (await request.get("/api/generation/connection")).json();
  const id = status.workerId;
  try {
    expect(
      status.profiles.filter((item: { workerId: string }) => item.workerId === id),
    ).toHaveLength(1);
    await expect(settings.getByRole("button", { name: /Offline studio.*已断开/ })).toBeVisible();
    await settings.getByRole("button", { name: /Offline studio.*已断开/ }).click();
    await expect(settings.getByText("设备已选择", { exact: true })).toBeVisible();
    const retry = await (await request.get("/api/generation/connection")).json();
    expect(retry.workerId).toBe(id);
    expect(retry.profiles).toHaveLength(status.profiles.length);
    await page.reload();
    await page.getByRole("button", { name: "选择生成设备", exact: true }).click();
    await expect(page.getByRole("button", { name: /Offline studio.*已断开/ })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "账号登录" })).toHaveCount(0);
  } finally {
    const removed = await request.delete(`/api/generation/connection/${id}`);
    expect(removed.ok()).toBe(true);
  }
});
