import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./runtime-launcher.mjs", import.meta.url), "utf8");
const slice = source.slice(
  source.indexOf("const backgroundChildren"),
  source.indexOf("async function start()"),
);
const { stopOwnedServer, backgroundChildren } = new Function(
  `${slice}; return {stopOwnedServer, backgroundChildren}`,
)();
test("launcher accepts explicit background handoff rather than killing its task collector", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  let killed = false;
  child.kill = () => {
    killed = true;
  };
  child.send = (_message, callback) => {
    callback(null);
    setImmediate(() => child.emit("message", { type: "takeboard.server.background" }));
  };
  await stopOwnedServer(child);
  assert.equal(killed, false);
});
test("handoff acknowledged before the send callback cannot be lost", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  child.kill = () => assert.fail("Must not kill acknowledged background collector");
  child.send = (_message, callback) => {
    backgroundChildren.add(child);
    callback(null);
  };
  await stopOwnedServer(child);
});
