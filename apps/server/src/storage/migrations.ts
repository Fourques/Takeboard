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

  const applied = client
    .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
    .pluck()
    .get(initialMigration.id);
  if (applied) {
    return;
  }

  client.transaction(() => {
    client.exec(initialMigration.sql);
    client
      .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run(initialMigration.id, new Date().toISOString());
  })();
}
