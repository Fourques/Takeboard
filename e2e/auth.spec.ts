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
    await expect(page.locator(".account-button").first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test("administrator can understand and operate external backup protection", async ({ page }) => {
  const timestamp = new Date().toISOString();
  const status = {
    enabled: true,
    configurationError: null,
    destinationLabel: "studio-backups",
    destinationReady: true,
    separateDevice: true,
    intervalHours: 24,
    localCopies: 2,
    retention: { daily: 7, weekly: 4, monthly: 6 },
    restoreDrillIntervalDays: 30,
    running: false,
    lastAttemptAt: timestamp,
    lastSuccessAt: timestamp,
    nextRunAt: timestamp,
    lastError: null,
    externalBackupCount: 3,
    damagedExternalBackupCount: 0,
    latestExternalBackup: null,
    lastRestoreDrillAt: timestamp,
    lastRestoreDrillPassed: true,
    lastRestoreDrillError: null,
  };
  await page.route("**/api/admin/backups/automation", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status }),
    });
  });
  await page.route("**/api/admin/backups/automation/run", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        backup: {
          format: "takeboard.external-instance-backup",
          version: 1,
          sourceInstanceId: "11111111-1111-4111-8111-111111111111",
          id: "backup-ui-evidence",
          filename: "backup-ui-evidence.takeboard-instance.tgz",
          createdAt: timestamp,
          copiedAt: timestamp,
          size: 1,
          archiveSha256: "a".repeat(64),
          projectCount: 1,
          userCount: 1,
          separateDevice: true,
        },
        drill: null,
        drillError: null,
      }),
    });
  });
  await page.route("**/api/admin/backups/automation/drill", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        report: {
          format: "takeboard.restore-drill",
          version: 1,
          id: "drill-ui-evidence",
          backupId: "backup-ui-evidence",
          backupSha256: "a".repeat(64),
          startedAt: timestamp,
          completedAt: timestamp,
          elapsedSeconds: 1,
          projectCount: 1,
          userCount: 1,
          passed: true,
          platform: "linux",
          architecture: "x64",
        },
      }),
    });
  });

  await page.goto("/");
  await page.locator(".account-button").first().click();
  await page.getByRole("button", { name: "备份与恢复" }).click();
  const account = page.getByRole("dialog", { name: /TakeBoard E2E/ });
  await expect(account.getByRole("heading", { name: "外部副本与恢复演练" })).toBeVisible();
  await expect(account.getByText("保护正常")).toBeVisible();
  await expect(account.getByText("3 份")).toBeVisible();
  await expect(account.getByText("不同文件系统")).toBeVisible();
  await expect(account.getByText("最近通过")).toBeVisible();

  await account.getByRole("button", { name: "立即建立外部副本" }).click();
  await expect(account.getByText("外部副本已完成校验并安全保存。")).toBeVisible();
  await account.getByRole("button", { name: "运行恢复演练" }).click();
  await expect(account.getByText("隔离恢复演练通过：身份数据库与全部项目均可读取。")).toBeVisible();
  await page.screenshot({
    path: "test-results/takeboard-backup-automation.png",
    animations: "disabled",
  });
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

    await page.locator(".account-button").first().click();
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
    await expect(page.locator(".account-button").first()).toBeVisible();
  } finally {
    await context.close();
    const users = await request.get("/api/admin/users");
    const user = (
      (await users.json()) as { users: Array<{ id: string; email: string }> }
    ).users.find((candidate) => candidate.email === email);
    if (user) await request.patch(`/api/admin/users/${user.id}`, { data: { status: "disabled" } });
  }
});
