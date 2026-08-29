import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { acquireProjectLock } from "../src/project-request-lock.js";
import { ProjectStore } from "../src/storage/project-store.js";

const cleanup: Array<() => Promise<void>> = [];

function imageBytes() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

function imageUpload() {
  const boundary = "----takeboard-project-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="frame.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const bytes = imageBytes();
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([prefix, bytes, suffix]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function videoUpload() {
  const boundary = "----takeboard-video-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="motion.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
  );
  const bytes = Buffer.from("00000018667479706d70343200000000", "hex");
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([prefix, bytes, suffix]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function projectPackageUpload(bytes: Buffer) {
  const boundary = "----takeboard-project-package-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="projectPackage"; filename="project.takeboard.tgz"\r\nContent-Type: application/gzip\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([prefix, bytes, suffix]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe("TakeBoard project API", () => {
  it("serializes project creation behind the instance catalog lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-catalog-lock-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());
    const release = await acquireProjectLock("__catalog__");
    let settled = false;
    const pending = app
      .inject({ method: "POST", url: "/api/projects", payload: { title: "锁内新项目" } })
      .then((response) => {
        settled = true;
        return response;
      });
    try {
      await new Promise<void>((resolveTick) => setImmediate(resolveTick));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    const created = await pending;
    expect(created.statusCode, created.body).toBe(201);
  });

  it("stops active generation before moving a project to trash", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-delete-active-run-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null, comfyUrl: "http://comfy.test" });
    cleanup.push(() => app.close());
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "正在生成的项目" },
    });
    const key = created.json().key as string;
    const shotResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots`,
      payload: { label: "删除安全测试" },
    });
    const store = ProjectStore.openExisting(join(root, key));
    expect(store).not.toBeNull();
    const current = store?.loadCurrent();
    expect(current).not.toBeNull();
    if (!store || !current) throw new Error("Project fixture could not be opened");
    const timestamp = toIsoTimestamp();
    const shotId = shotResponse.json().shotId as string;
    const shot = current.snapshot.shots.find((item) => item.id === shotId);
    if (!shot) throw new Error("Shot fixture could not be found");
    shot.status = "generating";
    current.snapshot.runs.push({
      id: createTakeBoardId("run"),
      shotId,
      recipeId: createTakeBoardId("recipe"),
      recipeVersion: "test@1",
      workflowSha256: "1".repeat(64),
      workerId: createTakeBoardId("worker"),
      promptId: "prompt-delete-project",
      status: "running",
      inputs: [],
      parameters: {},
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await store.save(current.snapshot, { type: "test.active_run", payload: {} });
    store.close();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/jobs/prompt-delete-project/cancel")) {
        return Response.json({ cancelled: true });
      }
      if (url.endsWith("/history")) return Response.json({});
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await app.inject({ method: "GET", url: "/api/projects" });
    expect(catalog.json().projects[0].activeRunCount).toBe(1);
    const blockedExport = await app.inject({
      method: "GET",
      url: `/api/projects/${key}/export`,
    });
    expect(blockedExport.statusCode, blockedExport.body).toBe(409);
    expect(blockedExport.json().activeRunIds).toHaveLength(1);
    const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${key}` });

    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({ deleted: true, stoppedRunCount: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://comfy.test/api/jobs/prompt-delete-project/cancel",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await readdir(join(root, ".trash"))).toHaveLength(1);
    const trash = await app.inject({ method: "GET", url: "/api/projects/trash" });
    const trashKey = trash.json().projects[0].trashKey as string;
    const restored = await app.inject({
      method: "POST",
      url: `/api/projects/trash/${trashKey}/restore`,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const reopened = ProjectStore.openExisting(join(root, key));
    const restoredSnapshot = reopened?.loadCurrent()?.snapshot;
    reopened?.close();
    expect(restoredSnapshot?.runs[0]?.status).toBe("cancelled");
    expect(restoredSnapshot?.shots.find((item) => item.id === shotId)?.status).toBe("draft");
  });

  it("keeps a project when ComfyUI cannot confirm cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-delete-unconfirmed-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null, comfyUrl: "http://comfy.test" });
    cleanup.push(() => app.close());
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "不能误删" },
    });
    const key = created.json().key as string;
    const shotResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots`,
      payload: { label: "保留安全测试" },
    });
    const store = ProjectStore.openExisting(join(root, key));
    const current = store?.loadCurrent();
    if (!store || !current) throw new Error("Project fixture could not be opened");
    const timestamp = toIsoTimestamp();
    current.snapshot.runs.push({
      id: createTakeBoardId("run"),
      shotId: shotResponse.json().shotId as string,
      recipeId: createTakeBoardId("recipe"),
      recipeVersion: "test@1",
      workflowSha256: "2".repeat(64),
      workerId: createTakeBoardId("worker"),
      promptId: "prompt-still-running",
      status: "running",
      inputs: [],
      parameters: {},
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await store.save(current.snapshot, { type: "test.active_run", payload: {} });
    store.close();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/queue")) {
          return Response.json({ queue_running: [[1, "prompt-still-running"]] });
        }
        return Response.json({ cancelled: false });
      }),
    );

    const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${key}` });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json()).toMatchObject({ activeRunCount: 1, stoppedRunCount: 0 });
    expect((await app.inject({ method: "GET", url: `/api/projects/${key}` })).statusCode).toBe(200);
  });

  it("imports library assets without polluting the canvas and edits metadata directly", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-asset-library-api-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "资产测试" },
    });
    const key = created.json().key as string;
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets?kind=location&name=%E9%9B%BE%E6%B8%AF&canvas=0`,
      ...imageUpload(),
    });

    expect(uploaded.statusCode, uploaded.body).toBe(201);
    expect(uploaded.json().snapshot.assets).toEqual([
      expect.objectContaining({ originalName: "雾港", libraryKind: "location" }),
    ]);
    expect(uploaded.json().snapshot.entities).toEqual([
      expect.objectContaining({ kind: "location", name: "雾港" }),
    ]);
    expect(uploaded.json().snapshot.canvasItems).toEqual([]);

    const assetId = uploaded.json().snapshot.assets[0].id as string;
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}/assets/${assetId}`,
      payload: {
        title: "雾港晨光.png",
        customTags: ["清晨", "冷雾"],
        libraryKind: "prop",
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().snapshot.assets[0]).toMatchObject({
      originalName: "雾港晨光.png",
      customTags: ["清晨", "冷雾"],
      libraryKind: "prop",
    });

    const reopened = await app.inject({ method: "GET", url: `/api/projects/${key}` });
    expect(reopened.json().snapshot.assets[0]).toMatchObject({
      originalName: "雾港晨光.png",
      customTags: ["清晨", "冷雾"],
      libraryKind: "prop",
    });
    expect(reopened.json().snapshot.canvasItems).toEqual([]);

    const invalidKind = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}/assets/${assetId}`,
      payload: { libraryKind: "archive" },
    });
    expect(invalidKind.statusCode).toBe(400);
  });

  it("creates a named blank workspace without forcing a shot or project format", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-blank-project-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "自由工作区" },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().snapshot).toMatchObject({
      project: { title: "自由工作区" },
      scenes: [{ label: "SC-01", title: "工作画板" }],
      shots: [],
      canvasItems: [],
    });
    const key = created.json().key as string;
    const listed = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listed.json().projects[0]).toMatchObject({
      key,
      revision: created.json().revision,
      aspectRatio: "自由画布",
      sceneCount: 1,
      shotCount: 0,
    });

    const shot = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots`,
      payload: { aspectRatio: "9:16" },
    });
    expect(shot.statusCode, shot.body).toBe(201);
    expect(shot.json().snapshot.shots).toEqual([
      expect.objectContaining({ label: "SH-01", intent: "", aspectRatio: "9:16" }),
    ]);
    expect(shot.json().snapshot.canvasItems).toEqual([
      expect.objectContaining({ refType: "shot", refId: shot.json().shotId }),
    ]);

    const note = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/text-nodes`,
      payload: { title: "运镜备注", body: "缓慢推进", x: 240, y: 360 },
    });
    expect(note.statusCode, note.body).toBe(201);
    expect(note.json().snapshot.textItems).toEqual([
      expect.objectContaining({ title: "运镜备注", body: "缓慢推进" }),
    ]);
    expect(note.json().snapshot.canvasItems).toContainEqual(
      expect.objectContaining({ id: note.json().itemId, refType: "text", x: 240, y: 360 }),
    );

    const video = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets?x=20&y=40`,
      ...videoUpload(),
    });
    expect(video.statusCode, video.body).toBe(201);
    const videoAsset = video
      .json()
      .snapshot.assets.find((asset: { mediaType: string }) => asset.mediaType === "video");
    const videoItem = video
      .json()
      .snapshot.canvasItems.find(
        (item: { refType: string; refId: string }) =>
          item.refType === "asset" && item.refId === videoAsset.id,
      );
    const shotItem = video
      .json()
      .snapshot.canvasItems.find((item: { refType: string }) => item.refType === "shot");
    expect(videoItem).toMatchObject({ x: 20, y: 40 });
    const connectedVideo = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/canvas-connections`,
      payload: {
        sourceItemId: videoItem.id,
        targetItemId: shotItem.id,
        targetSlot: "reference_video",
      },
    });
    expect(connectedVideo.statusCode, connectedVideo.body).toBe(200);
    expect(connectedVideo.json().snapshot.canvasEdges).toContainEqual(
      expect.objectContaining({ targetSlot: "reference_video", targetSlotIndex: 0 }),
    );
  });

  it("creates, lists and opens a usable project with a first scene and shot", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-project-api-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        title: "真实短片",
        aspectRatio: "9:16",
        sceneTitle: "屋顶夜景",
        firstShotIntent: "角色回头，镜头缓慢推进。",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().snapshot).toMatchObject({
      project: { title: "真实短片" },
      scenes: [{ title: "屋顶夜景" }],
      shots: [{ intent: "角色回头，镜头缓慢推进。", status: "draft" }],
    });

    const key = created.json().key as string;
    const listed = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listed.json().projects).toEqual([
      expect.objectContaining({
        key,
        title: "真实短片",
        sceneCount: 1,
        shotCount: 1,
        boards: [
          expect.objectContaining({
            label: "SC-01",
            title: "屋顶夜景",
            itemCount: 1,
            nodes: [expect.objectContaining({ refType: "shot", label: "SH-01" })],
          }),
        ],
      }),
    ]);

    const opened = await app.inject({ method: "GET", url: `/api/projects/${key}` });
    expect(opened.json().snapshot.project.title).toBe("真实短片");
    expect(opened.json().revision).toBe(1);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}`,
      payload: { title: "新片名" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().snapshot.project.title).toBe("新片名");
    expect(renamed.json().revision).toBe(2);

    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets`,
      ...imageUpload(),
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const importedAsset = uploaded.json().snapshot.assets[0] as {
      storagePath: string;
      proxyPath: string;
      width: number;
      height: number;
    };
    expect(importedAsset).toMatchObject({ width: 1, height: 1 });
    expect(importedAsset.proxyPath).not.toBe(importedAsset.storagePath);
    expect(await readFile(join(root, key, importedAsset.storagePath))).toEqual(imageBytes());
    const items = uploaded.json().snapshot.canvasItems as Array<{
      id: string;
      refType: string;
    }>;
    const sourceItemId = items.find((item) => item.refType === "asset")?.id;
    const targetItemId = items.find((item) => item.refType === "shot")?.id;
    const tagged = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}/canvas-items/${sourceItemId}`,
      payload: { customTags: ["夜景", "冷色"] },
    });
    expect(tagged.statusCode, tagged.body).toBe(200);
    expect(tagged.json().snapshot.assets[0].customTags).toEqual(["夜景", "冷色"]);
    const untagged = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}/canvas-items/${sourceItemId}`,
      payload: { customTags: [] },
    });
    expect(untagged.statusCode, untagged.body).toBe(200);
    expect(untagged.json().snapshot.assets[0].customTags).toEqual([]);
    const connected = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/canvas-connections`,
      payload: { sourceItemId, targetItemId, targetSlot: "first_frame" },
    });
    expect(connected.statusCode).toBe(200);
    expect(connected.json().snapshot.canvasEdges).toEqual([
      expect.objectContaining({
        sourceItemId,
        targetItemId,
        targetSlot: "first_frame",
        targetSlotIndex: 0,
      }),
    ]);
    const edgeId = connected.json().snapshot.canvasEdges[0].id as string;
    const disconnected = await app.inject({
      method: "DELETE",
      url: `/api/projects/${key}/canvas-connections/${edgeId}`,
    });
    expect(disconnected.statusCode, disconnected.body).toBe(200);
    expect(disconnected.json().snapshot.canvasEdges).toEqual([]);
    const reopened = await app.inject({ method: "GET", url: `/api/projects/${key}` });
    expect(reopened.json().revision).toBe(7);

    const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${key}` });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({ key, deleted: true, recoverable: true });
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json().projects).toEqual([]);
    expect(await readdir(join(root, ".trash"))).toHaveLength(1);
    const trash = await app.inject({ method: "GET", url: "/api/projects/trash" });
    expect(trash.statusCode, trash.body).toBe(200);
    expect(trash.json().projects).toEqual([
      expect.objectContaining({ originalKey: key, title: "新片名", shotCount: 1 }),
    ]);
    const trashKey = trash.json().projects[0].trashKey as string;
    const restored = await app.inject({
      method: "POST",
      url: `/api/projects/trash/${encodeURIComponent(trashKey)}/restore`,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ restored: true, key, title: "新片名" });
    expect((await app.inject({ method: "GET", url: `/api/projects/${key}` })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/api/projects/trash" })).json().projects,
    ).toEqual([]);
  });

  it("reuses a generated shot image as another shot input", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-shot-as-input-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "镜头结果复用", aspectRatio: "16:9" },
    });
    const key = created.json().key as string;
    const secondShot = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/shots`,
      payload: { aspectRatio: "16:9", x: 700, y: 180 },
    });
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets`,
      ...imageUpload(),
    });
    const snapshot = uploaded.json().snapshot;
    const sourceShot = snapshot.shots[0];
    const targetShot = snapshot.shots.find(
      (shot: { id: string }) => shot.id === secondShot.json().shotId,
    );
    const generatedAsset = snapshot.assets[0];
    const timestamp = toIsoTimestamp();
    const runId = createTakeBoardId("run");
    const takeId = createTakeBoardId("take");
    snapshot.runs.push({
      id: runId,
      shotId: sourceShot.id,
      recipeId: createTakeBoardId("recipe"),
      recipeVersion: "test@1",
      workflowSha256: "a".repeat(64),
      workerId: createTakeBoardId("worker"),
      promptId: "generated-shot-input",
      status: "completed",
      inputs: [],
      parameters: {},
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    snapshot.takes.push({
      id: takeId,
      runId,
      shotId: sourceShot.id,
      assetId: generatedAsset.id,
      status: "approved",
      rejectionReasons: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    sourceShot.status = "approved";
    sourceShot.approvedTakeId = takeId;
    const store = ProjectStore.openExisting(join(root, key));
    expect(store).not.toBeNull();
    await store?.save(snapshot, { type: "test.generated_shot_ready" });
    store?.close();

    const sourceItem = snapshot.canvasItems.find(
      (item: { refType: string; refId: string }) =>
        item.refType === "shot" && item.refId === sourceShot.id,
    );
    const targetItem = snapshot.canvasItems.find(
      (item: { refType: string; refId: string }) =>
        item.refType === "shot" && item.refId === targetShot.id,
    );
    const connected = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/canvas-connections`,
      payload: {
        sourceItemId: sourceItem.id,
        targetItemId: targetItem.id,
        targetSlot: "first_frame",
      },
    });
    expect(connected.statusCode, connected.body).toBe(200);
    expect(connected.json().snapshot.canvasEdges).toContainEqual(
      expect.objectContaining({
        sourceItemId: sourceItem.id,
        targetItemId: targetItem.id,
        targetSlot: "first_frame",
      }),
    );

    const selfConnection = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/canvas-connections`,
      payload: {
        sourceItemId: sourceItem.id,
        targetItemId: sourceItem.id,
        targetSlot: "reference",
      },
    });
    expect(selfConnection.statusCode).toBe(400);
  });

  it("edits, duplicates, removes and restores canvas nodes without deleting domain data", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-canvas-api-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "可编辑画布", aspectRatio: "16:9" },
    });
    const key = created.json().key as string;
    const shotId = created.json().snapshot.shots[0].id as string;
    const itemId = created.json().snapshot.canvasItems[0].id as string;

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}/canvas-items/${itemId}`,
      payload: { title: "S010", body: "雨夜车站，人物缓慢抬头。", durationSeconds: 7.5 },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().snapshot.shots[0]).toMatchObject({
      label: "S010",
      intent: "雨夜车站，人物缓慢抬头。",
      durationSeconds: 7.5,
    });

    const duplicated = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/canvas-items/${itemId}/duplicate`,
      payload: { x: 620, y: 330 },
    });
    expect(duplicated.statusCode, duplicated.body).toBe(201);
    expect(duplicated.json().snapshot.canvasItems).toHaveLength(2);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/projects/${key}/canvas-items/${itemId}`,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().snapshot.shots).toHaveLength(1);
    expect(removed.json().snapshot.canvasItems).toHaveLength(1);

    const restored = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/canvas-items`,
      payload: { refType: "shot", refId: shotId, x: 180, y: 180 },
    });
    expect(restored.statusCode, restored.body).toBe(201);
    expect(restored.json().snapshot.canvasItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ refType: "shot", refId: shotId })]),
    );
  });

  it("deletes a new shot from both the canvas and shot list but preserves run history", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-shot-delete-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "镜头删除一致性" },
    });
    const key = created.json().key as string;
    const first = await app.inject({ method: "POST", url: `/api/projects/${key}/shots` });
    const second = await app.inject({ method: "POST", url: `/api/projects/${key}/shots` });
    const firstShotId = first.json().shotId as string;
    const firstItemId = first.json().itemId as string;
    const secondShotId = second.json().shotId as string;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/projects/${key}/shots/${firstShotId}`,
    });

    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({
      removedShotId: firstShotId,
      removedItemIds: [firstItemId],
    });
    expect(deleted.json().snapshot.shots).toEqual([
      expect.objectContaining({ id: secondShotId, order: 0 }),
    ]);
    expect(deleted.json().snapshot.canvasItems).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ refId: firstShotId })]),
    );

    const store = ProjectStore.openExisting(join(root, key));
    const current = store?.loadCurrent();
    if (!store || !current) throw new Error("Project fixture could not be opened");
    const timestamp = toIsoTimestamp();
    current.snapshot.runs.push({
      id: createTakeBoardId("run"),
      shotId: secondShotId,
      recipeId: createTakeBoardId("recipe"),
      recipeVersion: "test@1",
      workflowSha256: "3".repeat(64),
      workerId: createTakeBoardId("worker"),
      promptId: "completed-shot-history",
      status: "completed",
      inputs: [],
      parameters: {},
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await store.save(current.snapshot, { type: "test.completed_run", payload: {} });
    store.close();

    const historyProtected = await app.inject({
      method: "DELETE",
      url: `/api/projects/${key}/shots/${secondShotId}`,
    });
    expect(historyProtected.statusCode).toBe(409);
    expect(historyProtected.json().error).toContain("生成记录");
    const reopened = await app.inject({ method: "GET", url: `/api/projects/${key}` });
    expect(reopened.json().snapshot.shots).toEqual([expect.objectContaining({ id: secondShotId })]);
  });

  it("does not create a project directory while returning 404", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-project-missing-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());

    const response = await app.inject({ method: "GET", url: "/api/projects/ghost.takeboard" });

    expect(response.statusCode).toBe(404);
    expect(await readdir(root)).toEqual([]);
  });

  it("serializes concurrent writes for the same project", async () => {
    const app = buildApp({ webRoot: null });
    cleanup.push(() => app.close());
    let active = 0;
    let maximumActive = 0;
    app.post<{ Params: { key: string } }>("/api/projects/:key/test-lock", async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { ok: true };
    });

    await Promise.all([
      app.inject({ method: "POST", url: "/api/projects/locked.takeboard/test-lock" }),
      app.inject({ method: "POST", url: "/api/projects/locked.takeboard/test-lock" }),
    ]);

    expect(maximumActive).toBe(1);
  });

  it("creates unique directories for concurrent projects with the same title", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-project-keys-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => app.close());

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { title: "同名项目", aspectRatio: "16:9" },
      }),
      app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { title: "同名项目", aspectRatio: "16:9" },
      }),
    ]);

    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(201);
    expect(first.json().key).not.toBe(second.json().key);
  });

  it("exports and imports a verified project package through the public API", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "takeboard-project-export-route-"));
    const destinationRoot = await mkdtemp(join(tmpdir(), "takeboard-project-import-route-"));
    cleanup.push(() => rm(sourceRoot, { recursive: true, force: true }));
    cleanup.push(() => rm(destinationRoot, { recursive: true, force: true }));
    const sourceApp = buildApp({ projectsRoot: sourceRoot, webRoot: null });
    const destinationApp = buildApp({ projectsRoot: destinationRoot, webRoot: null });
    cleanup.push(() => sourceApp.close());
    cleanup.push(() => destinationApp.close());

    const created = await sourceApp.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "可迁移项目", aspectRatio: "16:9", firstShotIntent: "穿过雾港" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const key = created.json().key as string;
    const exported = await sourceApp.inject({
      method: "GET",
      url: `/api/projects/${key}/export`,
    });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers["content-type"]).toContain("application/gzip");
    expect(exported.headers["content-disposition"]).toContain("takeboard-project.tgz");

    const imported = await destinationApp.inject({
      method: "POST",
      url: "/api/projects/import",
      ...projectPackageUpload(exported.rawPayload),
    });
    expect(imported.statusCode, imported.body).toBe(201);
    expect(imported.json()).toMatchObject({ imported: true, title: "可迁移项目" });
    const reopened = await destinationApp.inject({
      method: "GET",
      url: `/api/projects/${imported.json().key}`,
    });
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json().snapshot).toMatchObject({
      project: { id: created.json().snapshot.project.id, title: "可迁移项目" },
      shots: [{ intent: "穿过雾港" }],
    });

    const duplicate = await destinationApp.inject({
      method: "POST",
      url: "/api/projects/import",
      ...projectPackageUpload(exported.rawPayload),
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json().error).toContain("已经存在");

    const deletedSource = await sourceApp.inject({
      method: "DELETE",
      url: `/api/projects/${key}`,
    });
    expect(deletedSource.statusCode, deletedSource.body).toBe(200);
    const reimportedSource = await sourceApp.inject({
      method: "POST",
      url: "/api/projects/import",
      ...projectPackageUpload(exported.rawPayload),
    });
    expect(reimportedSource.statusCode, reimportedSource.body).toBe(201);
    const trashKey = (await sourceApp.inject({ method: "GET", url: "/api/projects/trash" })).json()
      .projects[0].trashKey as string;
    const ambiguousRestore = await sourceApp.inject({
      method: "POST",
      url: `/api/projects/trash/${trashKey}/restore`,
    });
    expect(ambiguousRestore.statusCode, ambiguousRestore.body).toBe(409);
    expect(ambiguousRestore.json()).toMatchObject({
      duplicateKey: reimportedSource.json().key,
      projectId: created.json().snapshot.project.id,
    });
  });
});
