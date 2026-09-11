import type { APIRequestContext, Page } from "@playwright/test";
import type { ProjectSnapshot, Run } from "@takeboard/contracts";
import { expect, test } from "./fixtures";

// Controlled acknowledgement fixtures exercise the real UI session controller;
// they intentionally do not execute a GPU workflow or claim generation quality.
async function sessionFixture(
  page: Page,
  request: APIRequestContext,
  runningSecond: boolean,
  runningBatch = false,
) {
  const title = `提交会话 ${Date.now()}`;
  const created = await request.post("/api/projects", { data: { title } });
  expect(created.ok()).toBeTruthy();
  const { key } = await created.json();
  const shots: string[] = [];
  for (const label of ["提交镜头", "另一个镜头"]) {
    const createdShot = await request.post(`/api/projects/${key}/commands`, {
      data: { requestId: crypto.randomUUID(), command: { type: "canvas.create_shot", label } },
    });
    expect(createdShot.ok()).toBeTruthy();
    const { shotId, itemId } = await createdShot.json();
    shots.push(shotId);
    expect(
      (
        await request.post(`/api/projects/${key}/commands`, {
          data: {
            requestId: crypto.randomUUID(),
            command: {
              type: "canvas.edit_item",
              itemId,
              workflowPath: "Kino/Kino_QwenImage2512_T2I.json",
            },
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
  const [a, b] = shots;
  if (!a || !b) throw new Error("Fixture shots were not created");
  const payload = (await (await request.get(`/api/projects/${key}`)).json()) as {
    key: string;
    revision: number;
    snapshot: ProjectSnapshot;
  };
  const appendRun = (id: string, shotId: string, parameters: Record<string, unknown> = {}) => {
    payload.snapshot.runs.push({
      id,
      shotId,
      recipeId: "recipe_fixture",
      recipeVersion: "fixture@1",
      workflowSha256: "a".repeat(64),
      workerId: "worker_fixture",
      promptId: id,
      status: "running",
      inputs: [],
      parameters,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Run);
    payload.revision++;
  };
  if (runningSecond) appendRun("run-b", b);
  if (runningBatch) {
    appendRun("run-batch-1", a, { candidateBatchId: "batch-existing", candidateIndex: 1 });
    appendRun("run-batch-2", a, { candidateBatchId: "batch-existing", candidateIndex: 2 });
  }
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submissions = 0;
  const cancellations: string[] = [];
  await page.route(`**/api/projects/${key}`, (route) => route.fulfill({ json: payload }));
  await page.route(`**/api/projects/${key}/sync`, (route) => route.fulfill({ status: 304 }));
  await page.route("**/api/workflows", (route) =>
    route.fulfill({ json: { workflows: [], editorUrl: "http://127.0.0.1:8188" } }),
  );
  await page.route(`**/api/projects/${key}/shots/*/generate`, async (route) => {
    submissions++;
    const body = route.request().postDataJSON();
    await gate;
    appendRun("run-a", a, body);
    await route.fulfill({
      json: { ...payload, runId: "run-a", status: "running", progress: null },
    });
  });
  await page.route(`**/api/projects/${key}/runs/*`, async (route) => {
    const id = route.request().url().split("/").at(-1);
    await route.fulfill({
      json: {
        ...payload,
        runId: id,
        status: payload.snapshot.runs.find((run) => run.id === id)?.status ?? "running",
        progress: null,
      },
    });
  });
  await page.route(`**/api/projects/${key}/runs/*/cancel`, async (route) => {
    const id = route.request().url().split("/").at(-2);
    if (!id) throw new Error("Missing cancelled run");
    cancellations.push(id);
    const run = payload.snapshot.runs.find((run) => run.id === id);
    if (run) run.status = "cancelled";
    payload.revision++;
    await route.fulfill({
      json: {
        ...payload,
        runId: id,
        status: "cancelled",
        cancelled: true,
        resourcesReleased: true,
      },
    });
  });
  await page.goto("/");
  await page
    .locator(".project-card")
    .filter({ hasText: title })
    .getByRole("button", { name: /打开画板/ })
    .click();
  await page.locator(".shot-list > button").filter({ hasText: "提交镜头" }).click();
  await page.locator(".prompt-with-mentions textarea").fill("受控会话回归测试");
  return {
    key,
    release,
    cancellations,
    submissions: () => submissions,
    cleanup: async () => {
      release();
      await request.delete(`/api/projects/${key}`);
    },
  };
}

test("stop waits for the submitted identity and does not submit the rest of a batch", async ({
  page,
  request,
}) => {
  const fixture = await sessionFixture(page, request, false);
  try {
    await page
      .getByRole("group", { name: "每批候选数量" })
      .getByRole("button", { name: "3", exact: true })
      .click();
    await page.getByRole("button", { name: "生成 3 个", exact: true }).click();
    await expect.poll(fixture.submissions).toBe(1);
    await page.getByRole("button", { name: /停止生成并清理任务/ }).click();
    await expect(page.getByRole("button", { name: "正在停止并清理…" })).toBeDisabled();
    expect(fixture.cancellations).toEqual([]);
    fixture.release();
    await expect.poll(() => fixture.cancellations).toEqual(["run-a"]);
    await expect(page.getByText("1 个生成任务已停止并完成清理")).toBeVisible();
    expect(fixture.submissions()).toBe(1);
  } finally {
    await fixture.cleanup();
  }
});

test("restoring a running batch does not repeatedly update canvas nodes", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await sessionFixture(page, request, false, true);
  try {
    await expect(page.getByText("候选结果 · 0/2 已保存").first()).toBeVisible();
    await page.locator(".shot-list > button").filter({ hasText: "另一个镜头" }).click();
    await page.locator(".shot-list > button").filter({ hasText: "提交镜头" }).click();
    await expect(page.getByText("候选结果 · 0/2 已保存").first()).toBeVisible();
    await expect(page.locator(".fatal-error-shell")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(fixture.submissions()).toBe(0);
  } finally {
    await fixture.cleanup();
  }
});

test("stopping another shot never cancels the pending first shot or steals selection on acknowledgement", async ({
  page,
  request,
}) => {
  const fixture = await sessionFixture(page, request, true);
  try {
    await page.getByRole("button", { name: "生成 1 个", exact: true }).click();
    await expect.poll(fixture.submissions).toBe(1);
    await page.locator(".shot-list > button").filter({ hasText: "另一个镜头" }).click();
    await page
      .getByLabel("镜头候选检查器")
      .getByRole("button", { name: /停止.*清理/ })
      .click();
    await expect.poll(() => fixture.cancellations).toEqual(["run-b"]);
    fixture.release();
    await expect(page.getByText(/已提交 1 个独立运行/)).toBeVisible();
    await expect(page.locator(".shot-list > button.active")).toContainText("另一个镜头");
    expect(fixture.cancellations).toEqual(["run-b"]);
  } finally {
    await fixture.cleanup();
  }
});
