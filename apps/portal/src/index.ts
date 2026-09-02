import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPortal } from "./app.js";

const port = Number.parseInt(process.env.TAKEBOARD_PORTAL_PORT ?? "49200", 10);
const host = process.env.TAKEBOARD_PORTAL_BIND_HOST ?? "127.0.0.1";
const hostname = process.env.TAKEBOARD_PORTAL_HOSTNAME ?? "localhost";
const publicOrigin = process.env.TAKEBOARD_PORTAL_ORIGIN ?? `http://${hostname}:${port}`;
const moduleRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const app = buildPortal({
  databasePath: resolve(process.env.TAKEBOARD_PORTAL_DATABASE ?? ".takeboard-portal/portal.db"),
  hostname,
  publicOrigin,
  webRoot: process.env.TAKEBOARD_PORTAL_WEB_ROOT
    ? resolve(process.env.TAKEBOARD_PORTAL_WEB_ROOT)
    : resolve(moduleRoot, "ui"),
  secureCookies:
    process.env.TAKEBOARD_PORTAL_SECURE_COOKIES === "1" ||
    new URL(publicOrigin).protocol === "https:",
  allowRegistration: process.env.TAKEBOARD_PORTAL_ALLOW_REGISTRATION === "1",
  auditRetentionDays: Number.parseInt(
    process.env.TAKEBOARD_PORTAL_AUDIT_RETENTION_DAYS ?? "180",
    10,
  ),
  ...(process.env.TAKEBOARD_PORTAL_MASTER_KEY
    ? { masterKey: process.env.TAKEBOARD_PORTAL_MASTER_KEY }
    : {}),
  ...(process.env.TAKEBOARD_PORTAL_BOOTSTRAP_TOKEN
    ? { bootstrapToken: process.env.TAKEBOARD_PORTAL_BOOTSTRAP_TOKEN }
    : {}),
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
