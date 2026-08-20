import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaVersion } from "@takeboard/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectService } from "../src/project-service.js";
import { ProjectStore } from "../src/storage/project-store.js";

const now = "2026-08-13T03:30:00.000Z";
const later = "2026-08-13T03:31:00.000Z";
const projectId = "project_018f47a0-2c91-7a4f-a812-78f12a2c4510";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function snapshot(title = "TakeBoard demo") {
  return {
    schemaVersion,
    exportedAt: now,
    project: {
      id: projectId,
      schemaVersion,
      title,
      defaultAspectRatio: "9:16",
      createdAt: now,
      updatedAt: title === "TakeBoard demo" ? now : later,
    },
    scenes: [],
    textItems: [],
    entities: [],
    assets: [],
    shots: [],
    runs: [],
    takes: [],
    approvals: [],
    canvasItems: [],
    canvasEdges: [],
  } as const;
}

describe("ProjectStore", () => {
  it("persists a project transactionally and restores it after reopen", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-project-store-"));
    temporaryDirectories.push(root);
    const projectDirectory = join(root, "demo.takeboard");

    const firstStore = await ProjectStore.open(projectDirectory);
    expect((await firstStore.save(snapshot())).revision).toBe(1);
    expect((await firstStore.save(snapshot("Renamed film"))).revision).toBe(2);
    firstStore.close();

    const reopenedStore = await ProjectStore.open(projectDirectory);
    expect(reopenedStore.load(projectId)).toMatchObject({
      revision: 2,
      snapshot: { project: { title: "Renamed film" } },
    });
    expect((await reopenedStore.readOpenSnapshot()).project.title).toBe("Renamed film");
    expect(reopenedStore.eventCount(projectId, "project.saved")).toBe(2);
    reopenedStore.close();
    expect((await readdir(projectDirectory)).sort()).toEqual(
      [
        "assets",
        "exports",
        "logs",
        "project.takeboard.json",
        "recipes",
        "renders",
        "runs",
        "takeboard.db",
        "trash",
      ].sort(),
    );
  });

  it("strips unknown secrets before writing the open snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-project-secret-"));
    temporaryDirectories.push(root);
    const projectDirectory = join(root, "secret-test.takeboard");
    const store = await ProjectStore.open(projectDirectory);

    await store.save({ ...snapshot(), apiKey: "should-never-be-exported" });
    store.close();

    const exported = await readFile(join(projectDirectory, "project.takeboard.json"), "utf8");
    expect(exported).not.toContain("should-never-be-exported");
    expect(exported).not.toContain(projectDirectory);
  });
});

describe("ProjectService", () => {
  it("creates an empty project that can be reopened without knowing its internal ID", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-project-service-"));
    temporaryDirectories.push(root);
    const projectDirectory = join(root, "first-film.takeboard");
    const service = new ProjectService();

    const created = await service.create({
      projectDirectory,
      title: "First film",
      defaultAspectRatio: "16:9",
      now: new Date(now),
    });
    const reopened = await service.open(projectDirectory);

    expect(reopened).toEqual(created);
    expect(created.revision).toBe(1);
    expect(created.snapshot.project.id).toMatch(/^project_/);
  });
});
