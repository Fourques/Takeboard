import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const cleanup: Array<() => Promise<void>> = [];

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
