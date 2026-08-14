import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type ProjectSnapshot, projectSnapshotSchema } from "@takeboard/contracts";
import BetterSqlite3 from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrateDatabase } from "./migrations.js";
import { eventLogTable, projectStateTable } from "./schema.js";

const databaseFileName = "takeboard.db";
const snapshotFileName = "project.takeboard.json";

export class ProjectStore {
  readonly projectDirectory: string;
  private readonly client: BetterSqlite3.Database;
  private readonly database;

  private constructor(projectDirectory: string) {
    this.projectDirectory = resolve(projectDirectory);
    this.client = new BetterSqlite3(join(this.projectDirectory, databaseFileName));
    migrateDatabase(this.client);
    this.database = drizzle(this.client);
  }

  static async open(projectDirectory: string) {
    const resolvedDirectory = resolve(projectDirectory);
    await Promise.all(
      [
        resolvedDirectory,
        join(resolvedDirectory, "assets", "originals"),
        join(resolvedDirectory, "assets", "proxies"),
        join(resolvedDirectory, "renders"),
        join(resolvedDirectory, "runs"),
        join(resolvedDirectory, "recipes"),
        join(resolvedDirectory, "logs"),
        join(resolvedDirectory, "exports"),
        join(resolvedDirectory, "trash"),
      ].map((directory) => mkdir(directory, { recursive: true })),
    );
    return new ProjectStore(resolvedDirectory);
  }

  static openExisting(projectDirectory: string) {
    const resolvedDirectory = resolve(projectDirectory);
    if (!existsSync(join(resolvedDirectory, databaseFileName))) return null;
    return new ProjectStore(resolvedDirectory);
  }

  async save(
    untrustedSnapshot: unknown,
    event: { type: string; payload?: Record<string, unknown> } = { type: "project.saved" },
  ) {
    const snapshot = projectSnapshotSchema.parse(untrustedSnapshot);
    const snapshotJson = `${JSON.stringify(snapshot, null, 2)}\n`;

    const existingProject = this.database
      .select({ projectId: projectStateTable.projectId })
      .from(projectStateTable)
      .limit(1)
      .get();
    if (existingProject && existingProject.projectId !== snapshot.project.id) {
      throw new Error("A .takeboard directory can contain only one project");
    }

    const revision = this.database.transaction((transaction) => {
      const current = transaction
        .select({ revision: projectStateTable.revision })
        .from(projectStateTable)
        .where(eq(projectStateTable.projectId, snapshot.project.id))
        .get();
      const nextRevision = (current?.revision ?? 0) + 1;

      transaction
        .insert(projectStateTable)
        .values({
          projectId: snapshot.project.id,
          schemaVersion: snapshot.schemaVersion,
          snapshotJson,
          revision: nextRevision,
          updatedAt: snapshot.project.updatedAt,
        })
        .onConflictDoUpdate({
          target: projectStateTable.projectId,
          set: {
            schemaVersion: snapshot.schemaVersion,
            snapshotJson,
            revision: nextRevision,
            updatedAt: snapshot.project.updatedAt,
          },
        })
        .run();

      transaction
        .insert(eventLogTable)
        .values({
          projectId: snapshot.project.id,
          eventType: event.type,
          payloadJson: JSON.stringify({ revision: nextRevision, ...event.payload }),
          createdAt: snapshot.project.updatedAt,
        })
        .run();

      return nextRevision;
    });

    await this.writeSnapshotAtomically(snapshotJson);
    return { revision, snapshot };
  }

  load(projectId: string): { revision: number; snapshot: ProjectSnapshot } | null {
    const row = this.database
      .select({
        snapshotJson: projectStateTable.snapshotJson,
        revision: projectStateTable.revision,
      })
      .from(projectStateTable)
      .where(eq(projectStateTable.projectId, projectId))
      .get();

    if (!row) {
      return null;
    }
    return {
      revision: row.revision,
      snapshot: projectSnapshotSchema.parse(JSON.parse(row.snapshotJson)),
    };
  }

  loadCurrent(): { revision: number; snapshot: ProjectSnapshot } | null {
    const row = this.database
      .select({
        snapshotJson: projectStateTable.snapshotJson,
        revision: projectStateTable.revision,
      })
      .from(projectStateTable)
      .limit(1)
      .get();

    if (!row) {
      return null;
    }
    return {
      revision: row.revision,
      snapshot: projectSnapshotSchema.parse(JSON.parse(row.snapshotJson)),
    };
  }

  eventCount(projectId: string, eventType: string) {
    return this.database
      .select({ sequence: eventLogTable.sequence })
      .from(eventLogTable)
      .where(and(eq(eventLogTable.projectId, projectId), eq(eventLogTable.eventType, eventType)))
      .all().length;
  }

  async readOpenSnapshot() {
    const contents = await readFile(join(this.projectDirectory, snapshotFileName), "utf8");
    return projectSnapshotSchema.parse(JSON.parse(contents));
  }

  close() {
    this.client.close();
  }

  private async writeSnapshotAtomically(snapshotJson: string) {
    const destination = join(this.projectDirectory, snapshotFileName);
    const temporary = join(
      this.projectDirectory,
      `.${snapshotFileName}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, snapshotJson, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}
