import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const cleanup: Array<() => Promise<void>> = [];

function imageUpload() {
  const boundary = "----takeboard-project-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="frame.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
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
      expect.objectContaining({ key, title: "真实短片", sceneCount: 1, shotCount: 1 }),
    ]);

    const opened = await app.inject({ method: "GET", url: `/api/projects/${key}` });
    expect(opened.json().snapshot.project.title).toBe("真实短片");

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}`,
      payload: { title: "新片名" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().snapshot.project.title).toBe("新片名");

    const uploaded = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/assets`,
      ...imageUpload(),
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const items = uploaded.json().snapshot.canvasItems as Array<{
      id: string;
      refType: string;
    }>;
    const sourceItemId = items.find((item) => item.refType === "asset")?.id;
    const targetItemId = items.find((item) => item.refType === "shot")?.id;
    const connected = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/canvas-connections`,
      payload: { sourceItemId, targetItemId, targetSlot: "first_frame" },
    });
    expect(connected.statusCode).toBe(200);
    expect(connected.json().snapshot.canvasEdges).toEqual([
      expect.objectContaining({ sourceItemId, targetItemId, targetSlot: "first_frame" }),
    ]);
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
});
