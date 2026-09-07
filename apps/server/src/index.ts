import { resolve } from "node:path";
import { authModeFromEnvironment, buildApp, takeBoardVersion } from "./app.js";
import { acquireInstanceLease } from "./instance-lease.js";
import { assertSafeBindHost } from "./request-security.js";

const host = process.env.TAKEBOARD_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.TAKEBOARD_PORT ?? "48120", 10);
assertSafeBindHost(
  host,
  process.env.TAKEBOARD_ALLOW_NON_LOOPBACK === "1",
  authModeFromEnvironment(),
);
const lease = acquireInstanceLease(
  resolve(process.env.TAKEBOARD_DATA_ROOT ?? ".takeboard-data/projects"),
);
process.env.TAKEBOARD_INSTANCE_ID = lease.instanceId;
process.once("exit", lease.release);
const app = (() => {
  try {
    return buildApp();
  } catch (error) {
    lease.release();
    throw error;
  }
})();
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
      lease.release();
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
// Only a spawned/IPC-owned server follows its launcher. Standalone servers have
// no IPC parent, and a desktop that merely borrows a server never owns this channel.
if (process.connected) process.once("disconnect", () => void shutdown("launcher-disconnected"));

try {
  await app.listen({ host, port });
  const address = app.server.address();
  if (address && typeof address !== "string") lease.publish(address.port, takeBoardVersion);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown("startup-failure");
}
