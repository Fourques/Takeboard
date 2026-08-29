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

export const commandLogTable = sqliteTable("command_log", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  commandType: text("command_type").notNull(),
  requestId: text("request_id"),
  requestJson: text("request_json").notNull(),
  inverseJson: text("inverse_json"),
  resultJson: text("result_json").notNull(),
  effectsJson: text("effects_json").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  appliedRevision: integer("applied_revision").notNull(),
  createdAt: text("created_at").notNull(),
  undoneAt: text("undone_at"),
  undoCommandId: text("undo_command_id"),
});
