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

test("viewer and editor see coherent project actions for their roles", async ({
  browser,
  baseURL,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const title = `只读验收 ${suffix}`;
  const email = `viewer-${suffix}@takeboard.local`;
  const initialPassword = `viewer initial passphrase ${suffix}`;
  const privatePassword = `viewer private passphrase ${suffix}`;
  const created = await request.post("/api/projects", { data: { title } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const key = (await created.json()).key as string;
  const shot = await request.post(`/api/projects/${key}/commands`, {
    data: {
      command: { type: "canvas.create_shot", label: "权限检查镜头" },
      requestId: `e2e:auth-shot:${suffix}`,
    },
  });
  expect(shot.ok(), await shot.text()).toBeTruthy();
  const account = await request.post("/api/admin/users", {
    data: { name: "Viewer E2E", email, password: initialPassword, instanceRole: "member" },
  });
  expect(account.ok(), await account.text()).toBeTruthy();
  const userId = ((await account.json()) as { user: { id: string } }).user.id;
  const shared = await request.put(`/api/projects/${key}/members/${userId}`, {
    data: { role: "viewer" },
  });
  expect(shared.ok(), await shared.text()).toBeTruthy();

  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(initialPassword);
    await page.getByRole("button", { name: "进入 TakeBoard" }).click();
    await expect(page.getByRole("heading", { name: "先更换初始密码" })).toBeVisible();
    await page.getByLabel("当前密码").fill(initialPassword);
    await page.getByLabel("新密码", { exact: true }).fill(privatePassword);
    await page.getByLabel("确认新密码").fill(privatePassword);
    await page.getByRole("button", { name: "更新密码" }).click();

    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    const card = page.locator(".project-card").filter({ hasText: title });
    await expect(card.getByText("VIEWER", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: `重命名 ${title}` })).toHaveCount(0);
    await expect(card.getByRole("link", { name: `导出 ${title}` })).toHaveCount(0);
    await expect(card.getByRole("button", { name: `删除 ${title}` })).toHaveCount(0);

    await card.getByRole("button", { name: /打开画板/ }).click();
    await expect(page.getByText("VIEW ONLY", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "添加镜头" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /导入参考素材/ })).toHaveCount(0);
    await page.getByRole("button", { name: /打开资产库/ }).click();
    const library = page.getByLabel("项目资产库");
    await expect(library.getByText("VIEW ONLY", { exact: true })).toBeVisible();
    await expect(library.getByRole("button", { name: "导入素材" })).toHaveCount(0);
    await page.getByRole("button", { name: "关闭资产库" }).click();
    await page.getByRole("button", { name: "打开分镜墙" }).click();
    const viewerStoryboard = page.getByRole("dialog", { name: "项目分镜墙" });
    await expect(viewerStoryboard.getByText("VIEW ONLY", { exact: true })).toBeVisible();
    await expect(viewerStoryboard.locator(".storyboard-order-actions")).toHaveCount(0);
    await viewerStoryboard.getByRole("button", { name: "关闭分镜墙" }).click();

    const promoted = await request.put(`/api/projects/${key}/members/${userId}`, {
      data: { role: "editor" },
    });
    expect(promoted.ok(), await promoted.text()).toBeTruthy();
    await page.goto("/");
    const editorCard = page.locator(".project-card").filter({ hasText: title });
    await expect(editorCard.getByText("EDITOR", { exact: true })).toBeVisible();
    await expect(editorCard.getByRole("button", { name: `重命名 ${title}` })).toBeVisible();
    await expect(editorCard.getByRole("link", { name: `导出 ${title}` })).toHaveCount(0);
    await expect(editorCard.getByRole("button", { name: `删除 ${title}` })).toHaveCount(0);
    await editorCard.getByRole("button", { name: /打开画板/ }).click();
    await expect(page.getByText("VIEW ONLY", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "添加镜头" })).toBeVisible();
    await page.locator(".recipe-selector").click();
    await expect(page.getByRole("heading", { name: "工作流与模型" })).toBeVisible();
    await expect(page.getByText("工作流由实例管理员管理")).toBeVisible();
    await expect(page.getByRole("link", { name: "导出包" })).toHaveCount(0);
  } finally {
    await context.close();
    await request.delete(`/api/projects/${key}`);
    await request.patch(`/api/admin/users/${userId}`, { data: { status: "disabled" } });
  }
});

test("a teammate can accept an invitation and recover the account with a one-time code", async ({
  browser,
  baseURL,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const email = `invited-${suffix}@takeboard.local`;
  const password = `invited private passphrase ${suffix}`;
  const replacement = `recovered private passphrase ${suffix}`;
  const invitationResponse = await request.post("/api/admin/invitations", {
    data: { name: "Invited E2E", email, instanceRole: "member", expiresHours: 24 },
  });
  expect(invitationResponse.ok(), await invitationResponse.text()).toBeTruthy();
  const token = ((await invitationResponse.json()) as { token: string }).token;

  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto(`/?invite=${encodeURIComponent(token)}`);
    await expect(page.getByRole("heading", { name: "加入 TakeBoard 工作室" })).toBeVisible();
    await page.getByLabel("设置密码").fill(password);
    await page.getByLabel("确认密码").fill(password);
    await page.getByRole("button", { name: "加入工作室" }).click();
    await expect(page.getByText("FILMMAKING WORKSPACE")).toBeVisible();

    await page.getByRole("button", { name: /Invited E2E/ }).click();
    await page.getByRole("button", { name: "密码与设备" }).click();
    await page.getByRole("button", { name: "生成恢复码" }).click();
    await page.locator(".recovery-codes-panel").getByLabel("当前密码").fill(password);
    await page.getByRole("button", { name: "确认生成 10 个" }).click();
    const code = await page.locator(".recovery-code-reveal code").first().textContent();
    expect(code).toMatch(/^TB-/);
    await page.getByRole("button", { name: "退出登录" }).click();

    await page.getByRole("button", { name: "使用恢复码重设密码" }).click();
    await page.getByLabel("账号邮箱").fill(email);
    await page.getByLabel("恢复码", { exact: true }).fill(code ?? "");
    await page.getByLabel("新密码", { exact: true }).fill(replacement);
    await page.getByLabel("确认新密码").fill(replacement);
    await page.getByRole("button", { name: "重设密码" }).click();
    await expect(page.getByText("密码已重设。请使用新密码登录。")).toBeVisible();
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(replacement);
    await page.getByRole("button", { name: "进入 TakeBoard" }).click();
    await expect(page.getByRole("button", { name: /Invited E2E/ })).toBeVisible();
  } finally {
    await context.close();
    const users = await request.get("/api/admin/users");
    const user = (
      (await users.json()) as { users: Array<{ id: string; email: string }> }
    ).users.find((candidate) => candidate.email === email);
    if (user) await request.patch(`/api/admin/users/${user.id}`, { data: { status: "disabled" } });
  }
});
