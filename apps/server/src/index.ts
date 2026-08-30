import { authModeFromEnvironment, buildApp } from "./app.js";
import { assertSafeBindHost } from "./request-security.js";

const host = process.env.TAKEBOARD_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.TAKEBOARD_PORT ?? "48120", 10);
assertSafeBindHost(
  host,
  process.env.TAKEBOARD_ALLOW_NON_LOOPBACK === "1",
  authModeFromEnvironment(),
);
const app = buildApp();
let shutdownPromise: Promise<void> | null = null;

function disconnectParent() {
  if (process.connected) process.disconnect();
}

function shutdown(reason: string) {
  shutdownPromise ??= (async () => {
    app.log.info({ reason }, "TakeBoard server is stopping");
    try {
      await app.close();
    } catch (error) {
      app.log.error(error, "TakeBoard server could not stop cleanly");
      process.exitCode = 1;
    } finally {
      disconnectParent();
    }
  })();
  return shutdownPromise;
}

const onControlMessage = (message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "takeboard.server.shutdown"
  ) {
    void shutdown("launcher");
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.on("message", onControlMessage);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown("startup-failure");
}
