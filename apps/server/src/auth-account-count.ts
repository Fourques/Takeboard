import type BetterSqlite3 from "better-sqlite3";

/** Count login accounts, not the non-login device principal; accepts old backups. */
export function countLoginAccounts(database: BetterSqlite3.Database) {
  const columns = database.pragma("table_info(auth_users)") as Array<{ name: string }>;
  const filter = columns.some((column) => column.name === "local_identity")
    ? " WHERE local_identity = 0"
    : "";
  return database.prepare(`SELECT COUNT(*) FROM auth_users${filter}`).pluck().get() as number;
}
