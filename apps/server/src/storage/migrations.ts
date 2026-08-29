import type BetterSqlite3 from "better-sqlite3";

const initialMigration = {
  id: "001_project_state",
  sql: `
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

    CREATE INDEX event_log_project_sequence_idx
      ON event_log(project_id, sequence);
  `,
} as const;

const commandLogMigration = {
  id: "002_command_log",
  sql: `
    CREATE TABLE command_log (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      request_id TEXT,
      request_json TEXT NOT NULL,
      inverse_json TEXT,
      result_json TEXT NOT NULL,
      effects_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('applied', 'undone')),
      applied_revision INTEGER NOT NULL CHECK (applied_revision > 0),
      created_at TEXT NOT NULL,
      undone_at TEXT,
      undo_command_id TEXT
    );

    CREATE UNIQUE INDEX command_log_project_request_idx
      ON command_log(project_id, request_id)
      WHERE request_id IS NOT NULL;

    CREATE INDEX command_log_project_created_idx
      ON command_log(project_id, created_at DESC);
  `,
} as const;

const migrations = [initialMigration, commandLogMigration] as const;

export function pendingDatabaseMigrations(client: BetterSqlite3.Database) {
  const hasMigrationTable = client
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations' LIMIT 1",
    )
    .pluck()
    .get();
  if (!hasMigrationTable) return migrations.map((migration) => migration.id);
  const applied = new Set(
    client.prepare("SELECT id FROM schema_migrations").pluck().all() as string[],
  );
  return migrations.map((migration) => migration.id).filter((id) => !applied.has(id));
}

export function migrateDatabase(client: BetterSqlite3.Database) {
  client.pragma("foreign_keys = ON");
  client.pragma("journal_mode = WAL");
  client.pragma("busy_timeout = 5000");
  client.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of migrations) {
    const applied = client
      .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
      .pluck()
      .get(migration.id);
    if (applied) continue;

    client.transaction(() => {
      client.exec(migration.sql);
      client
        .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(migration.id, new Date().toISOString());
    })();
  }
}
