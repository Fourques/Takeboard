import { buildApp } from "./app.js";

const host = process.env.TAKEBOARD_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.TAKEBOARD_PORT ?? "48120", 10);
const app = buildApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
