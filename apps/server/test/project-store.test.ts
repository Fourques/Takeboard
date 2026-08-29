import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaVersion } from "@takeboard/contracts";
import BetterSqlite3 from "better-sqlite3";
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
    await writeFile(
      join(projectDirectory, "project.takeboard.json"),
      `${JSON.stringify(snapshot("Interrupted newer snapshot"), null, 2)}\n`,
    );

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
        "backups",
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

  it("upgrades an existing project database with command history without rebuilding it", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-project-migration-"));
    temporaryDirectories.push(root);
    const projectDirectory = join(root, "existing.takeboard");
    await mkdir(projectDirectory, { recursive: true });
    const client = new BetterSqlite3(join(projectDirectory, "takeboard.db"));
    client.exec(`
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (id, applied_at) VALUES ('001_project_state', '${now}');
      CREATE TABLE project_state (
        project_id TEXT PRIMARY KEY NOT NULL,
        schema_version TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE event_log (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX event_log_project_sequence_idx ON event_log(project_id, sequence);
    `);
    client
      .prepare(
        "INSERT INTO project_state (project_id, schema_version, snapshot_json, revision, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(projectId, schemaVersion, `${JSON.stringify(snapshot())}\n`, 7, now);
    client.close();

    const store = ProjectStore.openExisting(projectDirectory);
    expect(store).not.toBeNull();
    expect(store?.loadCurrent()).toMatchObject({ revision: 7 });
    expect(store?.listCommands(projectId)).toEqual([]);
    store?.close();

    const migrated = new BetterSqlite3(join(projectDirectory, "takeboard.db"));
    expect(
      migrated.prepare("SELECT 1 FROM schema_migrations WHERE id = '002_command_log'").get(),
    ).toBeTruthy();
    expect(
      migrated
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'command_log'")
        .get(),
    ).toBeTruthy();
    migrated.close();

    const migrationBackups = await readdir(join(projectDirectory, "backups", "migrations"));
    expect(migrationBackups).toHaveLength(1);
    const backupName = migrationBackups[0];
    if (!backupName) throw new Error("Migration backup was not created");
    const backupDirectory = join(projectDirectory, "backups", "migrations", backupName);
    const backupMetadata = JSON.parse(
      await readFile(join(backupDirectory, "migration-backup.json"), "utf8"),
    );
    expect(backupMetadata).toMatchObject({
      format: "takeboard.migration-backup",
      version: 1,
      pendingMigrations: ["002_command_log"],
    });
    const backupDatabase = new BetterSqlite3(join(backupDirectory, "takeboard.db"), {
      readonly: true,
    });
    expect(
      backupDatabase
        .prepare("SELECT revision FROM project_state WHERE project_id = ?")
        .pluck()
        .get(projectId),
    ).toBe(7);
    expect(
      backupDatabase
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'command_log'")
        .get(),
    ).toBeUndefined();
    backupDatabase.close();
  });

  it("restores the pre-upgrade database when a migration cannot be applied", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-project-migration-rollback-"));
    temporaryDirectories.push(root);
    const projectDirectory = join(root, "broken-upgrade.takeboard");
    await mkdir(projectDirectory, { recursive: true });
    const client = new BetterSqlite3(join(projectDirectory, "takeboard.db"));
    client.exec(`
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (id, applied_at) VALUES ('001_project_state', '${now}');
      CREATE TABLE project_state (
        project_id TEXT PRIMARY KEY NOT NULL,
        schema_version TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE event_log (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE command_log (legacy_collision TEXT);
    `);
    client
      .prepare(
        "INSERT INTO project_state (project_id, schema_version, snapshot_json, revision, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(projectId, schemaVersion, `${JSON.stringify(snapshot())}\n`, 11, now);
    client.close();

    expect(() => ProjectStore.openExisting(projectDirectory)).toThrow(/已从.+自动恢复/);

    const restored = new BetterSqlite3(join(projectDirectory, "takeboard.db"), { readonly: true });
    expect(
      restored
        .prepare("SELECT revision FROM project_state WHERE project_id = ?")
        .pluck()
        .get(projectId),
    ).toBe(11);
    expect(
      restored.prepare("SELECT 1 FROM schema_migrations WHERE id = '002_command_log'").get(),
    ).toBeUndefined();
    expect(restored.prepare("PRAGMA table_info(command_log)").all()).toEqual([
      expect.objectContaining({ name: "legacy_collision" }),
    ]);
    restored.close();
    expect(await readdir(join(projectDirectory, "backups", "migrations"))).toHaveLength(1);
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
