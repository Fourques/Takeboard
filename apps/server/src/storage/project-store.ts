import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type CommandAuditEntry,
  type CommandEffect,
  type ProjectSnapshot,
  projectSnapshotSchema,
} from "@takeboard/contracts";
import BetterSqlite3 from "better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrateDatabase, pendingDatabaseMigrations } from "./migrations.js";
import { commandLogTable, eventLogTable, projectStateTable } from "./schema.js";

const databaseFileName = "takeboard.db";
const snapshotFileName = "project.takeboard.json";

type MigrationBackup = {
  directory: string;
  databasePath: string;
};

function migrationBackup(
  client: BetterSqlite3.Database,
  projectDirectory: string,
  pendingMigrations: string[],
): MigrationBackup {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = join(
    projectDirectory,
    "backups",
    "migrations",
    `${timestamp}-${pendingMigrations.join("_")}`,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const backupDatabasePath = join(directory, databaseFileName);
  client.prepare("VACUUM INTO ?").run(backupDatabasePath);
  const snapshotPath = join(projectDirectory, snapshotFileName);
  if (existsSync(snapshotPath)) copyFileSync(snapshotPath, join(directory, snapshotFileName));
  writeFileSync(
    join(directory, "migration-backup.json"),
    `${JSON.stringify(
      {
        format: "takeboard.migration-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        pendingMigrations,
        databaseFile: databaseFileName,
        snapshotFile: existsSync(snapshotPath) ? snapshotFileName : null,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return { directory, databasePath: backupDatabasePath };
}

function restoreMigrationBackup(backup: MigrationBackup, databasePath: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      unlinkSync(`${databasePath}${suffix}`);
    } catch {
      // A journal is optional and normally absent after the database closes.
    }
  }
  copyFileSync(backup.databasePath, databasePath);
}

export type StoredProjectCommand = {
  id: string;
  projectId: string;
  commandType: string;
  requestId: string | null;
  request: unknown;
  inverse: unknown | null;
  result: Record<string, unknown>;
  effects: CommandEffect[];
  summary: string;
  status: "applied" | "undone";
  appliedRevision: number;
  createdAt: string;
  undoneAt: string | null;
  undoCommandId: string | null;
};

type ProjectStoreEvent = {
  type: string;
  payload?: Record<string, unknown>;
  command?: {
    id: string;
    commandType: string;
    requestId: string | null;
    request: unknown;
    inverse: unknown | null;
    result: Record<string, unknown>;
    effects: CommandEffect[];
    summary: string;
  };
  undoesCommandId?: string;
};

export class ProjectStore {
  readonly projectDirectory: string;
  private readonly client: BetterSqlite3.Database;
  private readonly database;

  private constructor(projectDirectory: string) {
    this.projectDirectory = resolve(projectDirectory);
    const databasePath = join(this.projectDirectory, databaseFileName);
    const existingDatabase = existsSync(databasePath) && statSync(databasePath).size > 0;
    const client = new BetterSqlite3(databasePath);
    const pendingMigrations = existingDatabase ? pendingDatabaseMigrations(client) : [];
    const backup = pendingMigrations.length
      ? migrationBackup(client, this.projectDirectory, pendingMigrations)
      : null;
    try {
      migrateDatabase(client);
    } catch (error) {
      client.close();
      if (backup) {
        try {
          restoreMigrationBackup(backup, databasePath);
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `数据库升级失败，且无法从 ${backup.directory} 自动恢复`,
          );
        }
        throw new Error(`数据库升级失败，已从 ${backup.directory} 自动恢复`, { cause: error });
      }
      throw error;
    }
    this.client = client;
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
        join(resolvedDirectory, "backups"),
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

  async save(untrustedSnapshot: unknown, event: ProjectStoreEvent = { type: "project.saved" }) {
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

    const temporarySnapshot = await this.writeSnapshotTemporary(snapshotJson);
    const snapshotDestination = join(this.projectDirectory, snapshotFileName);
    try {
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

        if (event.command) {
          transaction
            .insert(commandLogTable)
            .values({
              id: event.command.id,
              projectId: snapshot.project.id,
              commandType: event.command.commandType,
              requestId: event.command.requestId,
              requestJson: JSON.stringify(event.command.request),
              inverseJson:
                event.command.inverse === null ? null : JSON.stringify(event.command.inverse),
              resultJson: JSON.stringify(event.command.result),
              effectsJson: JSON.stringify(event.command.effects),
              summary: event.command.summary,
              status: "applied",
              appliedRevision: nextRevision,
              createdAt: snapshot.project.updatedAt,
              undoneAt: null,
              undoCommandId: null,
            })
            .run();
        }

        if (event.undoesCommandId) {
          const changed = transaction
            .update(commandLogTable)
            .set({
              status: "undone",
              undoneAt: snapshot.project.updatedAt,
              undoCommandId: event.command?.id ?? null,
            })
            .where(
              and(
                eq(commandLogTable.projectId, snapshot.project.id),
                eq(commandLogTable.id, event.undoesCommandId),
                eq(commandLogTable.status, "applied"),
              ),
            )
            .run();
          if (changed.changes !== 1) throw new Error("Command is no longer available to undo");
        }

        // Publish the portable snapshot before SQLite commits. A rename failure now
        // aborts and rolls back the database transaction instead of leaving SQLite
        // one revision ahead of project.takeboard.json.
        renameSync(temporarySnapshot, snapshotDestination);
        return nextRevision;
      });

      return { revision, snapshot };
    } catch (error) {
      try {
        await this.restorePortableSnapshotFromDatabase();
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          "Project save failed and the portable snapshot could not be reconciled",
        );
      }
      throw error;
    } finally {
      await unlink(temporarySnapshot).catch(() => undefined);
    }
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

  findCommandByRequestId(projectId: string, requestId: string) {
    const row = this.database
      .select()
      .from(commandLogTable)
      .where(
        and(eq(commandLogTable.projectId, projectId), eq(commandLogTable.requestId, requestId)),
      )
      .get();
    return row ? this.parseCommandRow(row) : null;
  }

  loadCommand(projectId: string, commandId: string) {
    const row = this.database
      .select()
      .from(commandLogTable)
      .where(and(eq(commandLogTable.projectId, projectId), eq(commandLogTable.id, commandId)))
      .get();
    return row ? this.parseCommandRow(row) : null;
  }

  listCommands(projectId: string, limit = 50): CommandAuditEntry[] {
    return this.database
      .select()
      .from(commandLogTable)
      .where(eq(commandLogTable.projectId, projectId))
      .orderBy(desc(commandLogTable.appliedRevision))
      .limit(Math.max(1, Math.min(200, limit)))
      .all()
      .map((row) => {
        const command = this.parseCommandRow(row);
        return {
          id: command.id,
          commandType: command.commandType,
          requestId: command.requestId,
          summary: command.summary,
          status: command.status,
          appliedRevision: command.appliedRevision,
          createdAt: command.createdAt,
          undoneAt: command.undoneAt,
          undoable: command.inverse !== null,
          effects: command.effects,
        };
      });
  }

  async readOpenSnapshot() {
    const contents = await readFile(join(this.projectDirectory, snapshotFileName), "utf8");
    return projectSnapshotSchema.parse(JSON.parse(contents));
  }

  close() {
    this.client.close();
  }

  private async writeSnapshotTemporary(snapshotJson: string) {
    const temporary = join(
      this.projectDirectory,
      `.${snapshotFileName}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, snapshotJson, { encoding: "utf8", mode: 0o600 });
      return temporary;
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private async restorePortableSnapshotFromDatabase() {
    const destination = join(this.projectDirectory, snapshotFileName);
    const current = this.loadCurrent();
    if (!current) {
      await unlink(destination).catch(() => undefined);
      return;
    }
    const snapshotJson = `${JSON.stringify(current.snapshot, null, 2)}\n`;
    const recoverySnapshot = await this.writeSnapshotTemporary(snapshotJson);
    try {
      renameSync(recoverySnapshot, destination);
    } finally {
      await unlink(recoverySnapshot).catch(() => undefined);
    }
  }

  private parseCommandRow(row: typeof commandLogTable.$inferSelect): StoredProjectCommand {
    return {
      id: row.id,
      projectId: row.projectId,
      commandType: row.commandType,
      requestId: row.requestId,
      request: JSON.parse(row.requestJson) as unknown,
      inverse: row.inverseJson === null ? null : (JSON.parse(row.inverseJson) as unknown),
      result: JSON.parse(row.resultJson) as Record<string, unknown>,
      effects: JSON.parse(row.effectsJson) as CommandEffect[],
      summary: row.summary,
      status: row.status === "undone" ? "undone" : "applied",
      appliedRevision: row.appliedRevision,
      createdAt: row.createdAt,
      undoneAt: row.undoneAt,
      undoCommandId: row.undoCommandId,
    };
  }
}
