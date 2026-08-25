import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
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

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe("TakeBoard project API", () => {
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
});
