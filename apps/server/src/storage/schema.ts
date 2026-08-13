import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectStateTable = sqliteTable("project_state", {
  projectId: text("project_id").primaryKey(),
  schemaVersion: text("schema_version").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const eventLogTable = sqliteTable("event_log", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  eventType: text("event_type").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
});
