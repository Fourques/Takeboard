import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ProjectStore } from "../src/storage/project-store.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe("production operations center", () => {
  it("lists active work across projects and reports categorized storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-operations-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({
      projectsRoot: root,
      webRoot: null,
      // Keep diagnostics deterministic even when a developer has ComfyUI running locally.
      comfyUrl: "http://127.0.0.1:1",
    });
    cleanup.push(() => app.close());

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "任务中心项目", aspectRatio: "16:9" },
    });
    const key = created.json().key as string;
    const shotId = created.json().snapshot.shots[0].id as string;
    const store = ProjectStore.openExisting(join(root, key));
    const current = store?.loadCurrent();
    if (!store || !current) throw new Error("Project fixture could not be opened");
    const timestamp = toIsoTimestamp();
    const runId = createTakeBoardId("run");
    current.snapshot.runs.push({
      id: runId,
      shotId,
      recipeId: createTakeBoardId("recipe"),
      recipeVersion: "test@1",
      workflowSha256: "9".repeat(64),
      workerId: createTakeBoardId("worker"),
      promptId: "operations-prompt",
      status: "running",
      inputs: [],
      parameters: {
        recipePath: "Kino/Test.json",
        outputMediaType: "video",
      },
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await store.save(current.snapshot, { type: "test.operations", payload: {} });
    store.close();
    const brokenDirectory = join(root, "broken-project.takeboard");
    await mkdir(brokenDirectory, { recursive: true });
    await writeFile(join(brokenDirectory, "takeboard.db"), "not a sqlite database", "utf8");

    const tasks = await app.inject({ method: "GET", url: "/api/operations/tasks" });
    expect(tasks.statusCode, tasks.body).toBe(200);
    expect(tasks.json()).toMatchObject({
      activeCount: 1,
      tasks: [
        {
          projectKey: key,
          projectTitle: "任务中心项目",
          shotId,
          runId,
          status: "running",
          recipePath: "Kino/Test.json",
          outputMediaType: "video",
          canCancel: true,
        },
      ],
    });

    const storage = await app.inject({ method: "GET", url: "/api/operations/storage" });
    expect(storage.statusCode, storage.body).toBe(200);
    expect(storage.json()).toMatchObject({
      projects: [
        {
          projectKey: key,
          projectTitle: "任务中心项目",
          totalBytes: expect.any(Number),
          categories: {
            originals: 0,
            proxies: 0,
            renders: 0,
          },
        },
      ],
      activeProjectBytes: expect.any(Number),
      trashBytes: 0,
      filesystem: {
        availableBytes: expect.any(Number),
        reserveBytes: 5 * 1024 ** 3,
        generationReady: expect.any(Boolean),
      },
    });
    expect(storage.json().projects[0].totalBytes).toBeGreaterThan(0);

    const diagnostics = await app.inject({ method: "GET", url: "/api/operations/diagnostics" });
    expect(diagnostics.statusCode, diagnostics.body).toBe(200);
    expect(diagnostics.json()).toMatchObject({
      format: "takeboard.support-report",
      reportVersion: 1,
      application: {
        version: "0.1.0",
        nodeVersion: expect.stringMatching(/^v/),
        platform: expect.any(String),
        architecture: expect.any(String),
        authMode: "off",
      },
      workload: { visibleProjects: 1, activeRuns: 1, failedRuns: 0 },
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "data.writable", status: "pass" }),
        expect.objectContaining({ id: "data.projects", status: "warning" }),
        expect.objectContaining({ id: "runtime.web", status: "pass" }),
        expect.objectContaining({ id: "worker.comfy", status: "warning" }),
      ]),
    });
    expect(diagnostics.body).not.toContain(root);
    expect(diagnostics.body).not.toContain("任务中心项目");
    expect(diagnostics.body).not.toContain("broken-project");
  });
});
