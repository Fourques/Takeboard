import { readFile } from "node:fs/promises";
import type { ProjectSnapshot } from "@takeboard/contracts";
import { expect, test } from "./fixtures";

// Explicitly opt in: this test consumes GPU time, never substitutes a mocked response.
test("@gpu reference image travels through a real generation and returns to result details", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.TAKEBOARD_LIVE_REFERENCE !== "1",
    "Requires an idle, configured ComfyUI GPU; run explicitly with TAKEBOARD_LIVE_REFERENCE=1.",
  );
  test.setTimeout(15 * 60_000);
  page.setDefaultTimeout(15_000);
  const path = "Kino/Kino_QwenImage2512_I2I.json";
  const available = await (await request.get("/api/workflows")).json();
  const workflow = available.workflows.find((item: { path: string }) => item.path === path);
  expect(workflow?.diagnostic?.executable).toBe(true);
  const queue = await (await fetch("http://127.0.0.1:8188/queue")).json();
  expect(queue.queue_running).toHaveLength(0);
  expect(queue.queue_pending).toHaveLength(0);
  const title = `Reference QA ${Date.now()}`;
  const { key } = await (
    await request.post("/api/projects", { data: { title, firstShotIntent: "参考素材验收" } })
  ).json();
  try {
    expect(
      (
        await request.put(`/api/workflows/library?path=${encodeURIComponent(path)}`, {
          data: { included: true },
        })
      ).ok(),
    ).toBeTruthy();
    const upload = await request.post(`/api/projects/${key}/assets?x=650&y=80`, {
      multipart: {
        file: {
          name: "reference-mascot.webp",
          mimeType: "image/webp",
          buffer: await readFile("apps/web/public/scene/takeboard-crew-mascot.webp"),
        },
      },
    });
    expect(upload.ok()).toBeTruthy();
    const { snapshot } = (await upload.json()) as { snapshot: ProjectSnapshot };
    const shotNode = snapshot.canvasItems.find((item) => item.refType === "shot");
    const sourceNode = snapshot.canvasItems.find((item) => item.refType === "asset");
    if (!shotNode || !sourceNode) throw new Error("Missing reference test nodes");
    for (const command of [
      { type: "canvas.edit_item", itemId: shotNode.id, workflowPath: path },
      {
        type: "canvas.connect_items",
        sourceItemId: sourceNode.id,
        targetItemId: shotNode.id,
        targetSlot: "first_frame",
      },
    ])
      expect(
        (
          await request.post(`/api/projects/${key}/commands`, {
            data: { requestId: crypto.randomUUID(), command },
          })
        ).ok(),
      ).toBeTruthy();
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await page.locator(".react-flow__node-shot .shot-planning-surface").dblclick();
    await expect(page.getByLabel("生成模型", { exact: true })).toHaveValue(path);
    await expect(page.locator(".model-driven-slots")).toContainText("1/1");
    await expect(page.locator(".prompt-mention-chips")).toContainText("reference-mascot");
    await page
      .locator(".prompt-field textarea")
      .fill(
        "A small friendly film director mascot holding a clapperboard in a warm studio, soft cinematic light, preserve the character.",
      );
    for (const [id, value] of [
      ["generation-width", "768"],
      ["generation-height", "768"],
      ["generation-steps", "8"],
      ["generation-seed", "20260914"],
    ]) {
      await page.locator(`#${id}`).fill(value ?? "");
      await page.locator(`#${id}`).press("Tab");
    }
    await page
      .getByRole("group", { name: "每批候选数量" })
      .getByRole("button", { name: "1", exact: true })
      .click();
    const submitted = page.waitForResponse(
      (response) => response.url().endsWith("/generate") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "生成 1 个", exact: true }).click();
    const response = await submitted;
    expect(response.ok(), await response.text()).toBeTruthy();
    const { runId } = await response.json();
    let completed: ProjectSnapshot | undefined;
    await expect
      .poll(
        async () => {
          const state = await (await request.get(`/api/projects/${key}/runs/${runId}`)).json();
          console.log(
            `Live reference: ${state.status}${state.progress?.percent != null ? ` ${Math.round(state.progress.percent)}%` : ""}`,
          );
          completed = state.snapshot;
          return ["completed", "failed", "cancelled", "orphaned"].includes(state.status);
        },
        { timeout: 12 * 60_000, intervals: [5000, 10000] },
      )
      .toBe(true);
    const run = completed?.runs.find((item) => item.id === runId);
    expect(run?.status, run?.errorMessage ?? "Run must complete").toBe("completed");
    expect(run?.inputs.some((input) => input.refId === sourceNode.refId)).toBe(true);
    expect(run?.parameters.seed).toBe(20260914);
    const take = completed?.takes.find((item) => item.runId === runId);
    const asset = completed?.assets.find((item) => item.id === take?.assetId);
    expect(asset?.mediaType).toBe("image");
    expect(asset?.byteSize).toBeGreaterThan(1000);
    expect(
      (await request.get(`/api/projects/${key}/assets/${asset?.id}/content`)).ok(),
    ).toBeTruthy();
    await page.getByRole("tab", { name: /结果/ }).click();
    await expect(page.locator(".detail-media img")).toBeVisible();
    await expect(page.locator(".run-inputs")).toContainText("reference-mascot.webp");
    await expect(page.locator(".run-settings")).toContainText("20260914");
    await page.screenshot({
      path: "test-results/live-reference-result.png",
      animations: "disabled",
    });
    await page.locator(".run-record").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/live-reference-record.png",
      animations: "disabled",
    });
  } finally {
    // Project deletion owns cancellation; never interrupt another ComfyUI job.
    try {
      expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
    } finally {
      expect(
        (
          await request.put(`/api/workflows/library?path=${encodeURIComponent(path)}`, {
            data: { included: workflow.library.included },
          })
        ).ok(),
      ).toBeTruthy();
    }
  }
});
