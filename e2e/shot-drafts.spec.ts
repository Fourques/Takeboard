import { expect, test } from "./fixtures";

test("shot drafts survive selection changes without leaking across workflow families", async ({
  page,
  request,
}) => {
  const title = `镜头草稿隔离 ${Date.now()}`;
  const created = await request.post("/api/projects", { data: { title } });
  expect(created.ok()).toBeTruthy();
  const { key } = await created.json();
  try {
    for (const [label, workflowPath] of [
      ["视频草稿", "Kino/Kino_Wan22_FLF2V.json"],
      ["图片草稿", "Kino/Kino_QwenImage2512_T2I.json"],
    ]) {
      const shot = await request.post(`/api/projects/${key}/commands`, {
        data: { requestId: crypto.randomUUID(), command: { type: "canvas.create_shot", label } },
      });
      expect(shot.ok()).toBeTruthy();
      const { itemId } = await shot.json();
      const edit = await request.post(`/api/projects/${key}/commands`, {
        data: {
          requestId: crypto.randomUUID(),
          command: { type: "canvas.edit_item", itemId, workflowPath },
        },
      });
      expect(edit.ok()).toBeTruthy();
    }
    await page.route("**/api/workflows", (route) =>
      route.fulfill({ json: { workflows: [], editorUrl: "http://127.0.0.1:8188" } }),
    );
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.locator(".shot-list > button").filter({ hasText: "视频草稿" }).click();
    await page.getByRole("button", { name: "收起检查器" }).click();
    await page.getByLabel("画布提示词", { exact: true }).fill("视频的未提交草稿");
    await page.getByLabel("画布宽度", { exact: true }).fill("960");
    await page.locator(".shot-list > button").filter({ hasText: "图片草稿" }).click();
    await page.getByRole("button", { name: "收起检查器" }).click();
    await expect(page.getByLabel("画布提示词", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("画布宽度", { exact: true })).not.toHaveValue("960");
    await page.getByLabel("画布提示词", { exact: true }).fill("图片的未提交草稿");
    await page.locator(".shot-list > button").filter({ hasText: "视频草稿" }).click();
    await page.getByRole("button", { name: "收起检查器" }).click();
    await expect(page.getByLabel("画布提示词", { exact: true })).toHaveValue("视频的未提交草稿");
    await expect(page.getByLabel("画布宽度", { exact: true })).toHaveValue("960");
    await page.locator(".shot-list > button").filter({ hasText: "图片草稿" }).click();
    await page.getByRole("button", { name: "收起检查器" }).click();
    await expect(page.getByLabel("画布提示词", { exact: true })).toHaveValue("图片的未提交草稿");
    await page.getByLabel("画布提示词", { exact: true }).blur();
    await page.keyboard.press("Escape");
    await expect(page.locator(".shot-inline-console")).toHaveCount(0);
    const externalEdit = await request.post(`/api/projects/${key}/commands`, {
      data: {
        requestId: crypto.randomUUID(),
        command: { type: "canvas.create_shot", label: "后台新增" },
      },
    });
    expect(externalEdit.ok()).toBeTruthy();
    await expect(page.locator(".shot-list > button")).toHaveCount(3, { timeout: 8000 });
    await expect(page.locator(".shot-inline-console")).toHaveCount(0);
    await expect(page.getByLabel("镜头候选检查器")).toHaveCount(0);
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
