import { expect, test } from "./fixtures";

// UI contract test with explicit connection mocks. SSH/HTTP execution is covered
// separately by server tests and the real SSH smoke, not claimed by this fixture.
test("generation service choice preserves local storage and fits short/narrow windows", async ({
  page,
}) => {
  let calls = 0;
  let catalogReads = 0;
  let trashReads = 0;
  let workflowReads = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET") return;
    const path = new URL(request.url()).pathname;
    if (path === "/api/projects") catalogReads++;
    if (path === "/api/projects/trash") trashReads++;
    if (path === "/api/workflows") workflowReads++;
  });
  let state = {
    workerId: "local",
    localWorkerId: "local",
    name: "默认 ComfyUI",
    address: "http://127.0.0.1:8188",
    kind: "existing",
    state: "configured",
    error: null,
    profiles: [] as unknown[],
  };
  await page.route("**/api/generation/connection", async (route) => {
    if (route.request().method() === "POST") {
      calls++;
      const target = route.request().postDataJSON();
      expect(target).toEqual({ kind: "ssh", host: "user@studio", port: 8188, name: "创作工作站" });
      state = {
        ...state,
        workerId: "remote",
        name: target.name,
        address: `${target.host}:8188`,
        kind: "ssh",
        profiles: [{ workerId: "remote", target }],
      };
    }
    await route.fulfill({ json: state });
  });
  await page.goto(
    `/#${new URLSearchParams({ "tb-device": JSON.stringify({ kind: "local", address: "" }) })}`,
  );
  await expect(page.getByLabel("当前设备：此电脑")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 620 });
  await page.getByRole("button", { name: "选择生成设备", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "选择生成设备" });
  await expect(panel.locator("input")).toHaveCount(0);
  await panel.getByRole("button", { name: "管理设备" }).click();
  await expect(panel).toBeHidden();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "添加设备", exact: true }).click();
  await settings.getByLabel("IP 或 SSH 名称", { exact: true }).fill("user@studio");
  await settings.getByLabel("设备名称（选填）").fill("创作工作站");
  const port = settings.getByLabel("ComfyUI 端口", { exact: true });
  await port.fill("");
  await expect(port).toHaveValue("");
  await settings.getByRole("button", { name: "连接并保存" }).click();
  await expect(settings.getByRole("alert")).toContainText("1–65535");
  expect(calls).toBe(0);
  const catalogBefore = catalogReads;
  const trashBefore = trashReads;
  const workflowsBefore = workflowReads;
  expect(catalogBefore).toBeGreaterThan(0);
  await port.fill("8188");
  await settings.getByRole("button", { name: "连接并保存" }).click();
  await expect(settings.getByRole("status")).toContainText("已切换设备");
  await expect(settings.getByRole("button", { name: /创作工作站 user@studio/ })).toBeVisible();
  await expect.poll(() => workflowReads).toBeGreaterThan(workflowsBefore);
  expect(catalogReads).toBe(catalogBefore);
  expect(trashReads).toBe(trashBefore);
  const bounds = await settings.boundingBox();
  if (!bounds) throw new Error("Settings not visible");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(620);
  await settings.getByRole("heading", { name: "远程项目", exact: true }).scrollIntoViewIfNeeded();
  await expect(settings.getByRole("heading", { name: "远程项目", exact: true })).toBeInViewport();
  await page.screenshot({ path: "test-results/generation-connection-narrow.png" });
});

test("project catalog loads without waiting for generation discovery", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: { title: "独立项目目录测试" } });
  expect(created.ok()).toBeTruthy();
  const { key } = await created.json();
  let releaseDiscovery = () => {};
  const discoveryGate = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  await page.route("**/api/workflows", async (route) => {
    await discoveryGate;
    await route.fulfill({ json: { workflows: [], editorUrl: "http://127.0.0.1:8188" } });
  });
  try {
    await page.goto("/");
    // A real project must render while discovery is still deliberately pending.
    await expect(
      page.locator(".project-card-managed").filter({ hasText: "独立项目目录测试" }),
    ).toBeAttached();
  } finally {
    releaseDiscovery();
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
