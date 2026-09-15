import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ProjectStore } from "../apps/server/src/storage/project-store";
import { runSchema, takeSchema } from "../packages/contracts/src/index";
import { createTakeBoardId } from "../packages/domain/src/index";
import { expect, test } from "./fixtures";

test("library locates displayed and historical results, disambiguates names and follows recorded references", async ({
  page,
  request,
}) => {
  test.skip(Boolean(process.env.TAKEBOARD_E2E_REMOTE), "Isolated local fixture only");
  const title = `资产定位 ${Date.now()}`;
  const { key } = await (
    await request.post("/api/projects", { data: { title, firstShotIntent: "定位结果" } })
  ).json();
  try {
    await page.goto("/");
    // Real decodable video bytes; the completed generation record remains an explicit fixture.
    const video = Buffer.from(
      await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const paint = canvas.getContext("2d");
        if (!paint) throw new Error("Canvas unavailable");
        paint.fillStyle = "#9b91ce";
        paint.fillRect(0, 0, 160, 90);
        const stream = canvas.captureStream(12);
        const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => chunks.push(event.data);
        const stopped = new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
        });
        recorder.start();
        const animation = setInterval(() => paint.fillRect(0, 0, 160, 90), 70);
        await new Promise((resolve) => setTimeout(resolve, 450));
        recorder.stop();
        await stopped;
        clearInterval(animation);
        for (const track of stream.getTracks()) track.stop();
        return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
      }),
    );
    const buffer = await readFile("apps/web/public/scene/takeboard-crew-mascot.webp");
    for (const [index, name] of ["person.webp", "render.webm", "render.webm"].entries()) {
      const response = await request.post(
        `/api/projects/${key}/assets?canvas=${index === 0 ? "1" : "0"}`,
        {
          multipart: {
            file: {
              name,
              mimeType: index === 0 ? "image/webp" : "video/webm",
              buffer: index === 0 ? buffer : video,
            },
          },
        },
      );
      expect(response.ok()).toBeTruthy();
    }
    const store = ProjectStore.openExisting(
      resolve(process.env.TAKEBOARD_E2E_DATA_ROOT ?? "test-results/e2e-data", key),
    );
    if (!store) throw new Error("Missing isolated fixture");
    let sourceId = "";
    let shotItemId = "";
    try {
      const current = store.loadCurrent();
      if (!current) throw new Error("Missing snapshot");
      const shot = current.snapshot.shots[0];
      const source = current.snapshot.assets[0];
      if (!shot || !source) throw new Error("Missing test inputs");
      sourceId = source.id;
      shotItemId = current.snapshot.canvasItems.find((item) => item.refType === "shot")?.id ?? "";
      const at = new Date().toISOString();
      for (const [index, asset] of current.snapshot.assets.slice(1).entries()) {
        const run = runSchema.parse({
          id: createTakeBoardId("run"),
          shotId: shot.id,
          recipeId: createTakeBoardId("recipe"),
          recipeVersion: "navigation-fixture@1",
          workflowSha256: "a".repeat(64),
          workerId: createTakeBoardId("worker"),
          status: "completed",
          createdAt: at,
          updatedAt: at,
          inputs: [
            {
              slot: "reference_image_0",
              refType: "asset",
              refId: source.id,
              assetSha256: source.sha256,
            },
          ],
          parameters: {
            seed: 101 + index,
            promptSource: "@person 在花园里",
            prompt: "<Picture 1> 在花园里",
            models: ["fixture.safetensors"],
          },
        });
        const take = takeSchema.parse({
          id: createTakeBoardId("take"),
          shotId: shot.id,
          runId: run.id,
          assetId: asset.id,
          status: "candidate",
          createdAt: at,
          updatedAt: at,
        });
        current.snapshot.runs.push(run);
        current.snapshot.takes.push(take);
      }
      // Rename after generation: navigation must follow saved identity, not guessed text.
      source.originalName = "portrait-renamed.webp";
      shot.status = "review";
      await store.save(current.snapshot, { type: "test.asset_navigation_fixture" });
    } finally {
      store.close();
    }
    const before = (await (await request.get(`/api/projects/${key}`)).json()).snapshot;
    await page.goto("/");
    await page
      .locator(".project-card")
      .filter({ hasText: title })
      .getByRole("button", { name: /打开画板/ })
      .click();
    await expect(page.locator(".scene-chip")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "打开分镜墙" })).toHaveCount(0);
    const canvas = await page.locator(".canvas-wrap").boundingBox();
    if (!canvas) throw new Error("Missing canvas");
    await page.mouse.move(canvas.x + canvas.width - 80, canvas.y + 160);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 30, canvas.y + 160, { steps: 12 });
    await page.mouse.up();
    const library = page.getByLabel("项目资产库");
    for (const [display, state, seed] of [
      ["render · 2", "画布中", "102"],
      ["render · 1", "镜头结果", "101"],
      ["render · 2", "画布中", "102"],
    ]) {
      await page.getByRole("button", { name: /打开资产库/ }).click();
      const card = library.locator(".asset-vault-card").filter({ hasText: display });
      await expect(card.locator(".asset-canvas-state")).toHaveText(state ?? "");
      if (seed === "101") {
        await card.click();
        await expect(library.locator(".asset-detail-panel video")).toBeVisible();
        await expect(library.locator(".asset-detail-scroll")).toHaveCSS("scrollbar-width", "none");
        await page.screenshot({
          path: "test-results/asset-video-details.png",
          animations: "disabled",
        });
      }
      if (seed === "101")
        await page.screenshot({ path: "test-results/asset-locations.png", animations: "disabled" });
      await card.dblclick();
      await expect(library).toBeHidden();
      await expect(page.locator(`.react-flow__node[data-id="${shotItemId}"]`)).toHaveClass(
        /selected/,
      );
      await expect(page.locator(`.react-flow__node[data-id="${shotItemId}"]`)).toBeInViewport({
        ratio: 0.4,
      });
      await expect(page.locator(".run-settings")).toContainText(seed ?? "");
      await expect
        .poll(() =>
          page
            .locator(".inspector .detail-media video")
            .evaluate((node: HTMLVideoElement) => node.videoWidth),
        )
        .toBe(160);
      await expect(page.locator(".run-prompt .record-mention")).toHaveText("@person");
    }
    await page.locator(".run-record").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/result-record-details.png",
      animations: "disabled",
    });
    await page.locator(".record-mention").click();
    await expect(page.getByLabel("素材节点检查器")).toContainText("portrait-renamed.webp");
    const after = (await (await request.get(`/api/projects/${key}`)).json()).snapshot;
    expect(after.canvasItems).toEqual(before.canvasItems);
    expect(after.takes).toEqual(before.takes);
    expect(after.runs).toEqual(before.runs);
    expect(after.assets.find((asset: { id: string }) => asset.id === sourceId)?.originalName).toBe(
      "portrait-renamed.webp",
    );
    await page.screenshot({
      path: "test-results/asset-reference-navigation.png",
      animations: "disabled",
    });
  } finally {
    expect((await request.delete(`/api/projects/${key}`)).ok()).toBeTruthy();
  }
});
