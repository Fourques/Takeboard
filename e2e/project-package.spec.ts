import { expect, test } from "@playwright/test";

test("a complete project package can leave and return through the homepage", async ({
  page,
  request,
}) => {
  const title = `项目包验收 ${Date.now().toString(36)}`;
  const created = await request.post("/api/projects", { data: { title } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const key = (await created.json()).key as string;

  await page.goto("/");
  const exportLink = page.getByRole("link", { name: `导出 ${title}` });
  const downloadPromise = page.waitForEvent("download");
  await exportLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.takeboard\.tgz$/);
  const packagePath = await download.path();
  if (!packagePath) throw new Error("浏览器没有保存项目包");

  const removed = await request.delete(`/api/projects/${key}`);
  expect(removed.ok(), await removed.text()).toBeTruthy();
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);

  await page.getByLabel("选择 TakeBoard 项目包").setInputFiles(packagePath);
  await expect(page.getByText(`✓ “${title}”已完成校验并导入`)).toBeVisible();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();

  const importedCatalog = (await (await request.get("/api/projects")).json()).projects as Array<{
    key: string;
    title: string;
  }>;
  const imported = importedCatalog.find((project) => project.title === title);
  expect(imported).toBeTruthy();
  if (imported) await request.delete(`/api/projects/${imported.key}`);
});
