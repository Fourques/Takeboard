import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { connectionTarget, verifyConnection } from "./desktop-connection.mjs";

test("desktop accepts SSH aliases and HTTPS origins, not commands, credentials or plaintext remote logins", () => {
  assert.deepEqual(connectionTarget({ kind: "ssh", address: " user@server ", port: "" }), {
    kind: "ssh",
    address: "user@server",
    port: null,
  });
  assert.equal(
    connectionTarget({ kind: "portal", address: "https://portal.example.com/" }).address,
    "https://portal.example.com",
  );
  for (const address of [
    "http://192.168.1.20:48120",
    "file:///etc/passwd",
    "https://user:secret@server/",
    "https://server/path",
    "https://server/?password=secret",
  ]) {
    assert.throws(() => connectionTarget({ kind: "https", address }));
  }
  for (const port of [-1, 0, 65536, "12.5", "abc"])
    assert.throws(() => connectionTarget({ kind: "ssh", address: "server", port }));
  assert.throws(() => connectionTarget({ kind: "https", address: "server" }), /完整的 HTTPS 地址/);
});

async function healthServer(t) {
  const server = createServer((request, reply) => {
    reply.setHeader("content-type", "application/json");
    reply.end(
      JSON.stringify(
        request.url === "/api/health"
          ? { service: "takeboard-server", status: "ok", instanceId: "desktop-target-instance" }
          : { service: "takeboard-portal", status: "ok" },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("desktop verifies the actual service and rejects a changed server identity", async (t) => {
  const address = await healthServer(t);
  const verified = await verifyConnection({ kind: "https", address });
  assert.equal(verified.instanceId, "desktop-target-instance");
  await verified.close();
  await assert.rejects(
    verifyConnection({ kind: "https", address, instanceId: "another-instance" }),
    /身份与保存记录不同/,
  );
  assert.equal((await verifyConnection({ kind: "portal", address })).instanceId, address);
});

for (const shutdown of ["command", "parent-exit"]) {
  test(`desktop broker releases ownership on ${shutdown} without stopping the server`, async (t) => {
    const address = await healthServer(t);
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("desktop-connection.mjs", import.meta.url)),
        JSON.stringify({ kind: "https", address }),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    });
    const exit = new Promise((resolve) => child.once("exit", resolve));
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("broker readiness timeout")), 3000);
      child.once("error", reject);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("\n")) {
          clearTimeout(timer);
          resolve(JSON.parse(output.trim()));
        }
      });
    });
    assert.equal(ready.state, "ready");
    assert.equal(ready.url, address);
    assert.equal(child.exitCode, null);
    if (shutdown === "command") child.stdin.write("takeboard.launcher.shutdown\n");
    else child.stdin.end();
    assert.equal(await exit, 0);
    assert.equal((await (await fetch(`${address}/api/health`)).json()).status, "ok");
  });
}

test("desktop rejects oversized health responses before consuming an unbounded body", async (t) => {
  const server = createServer((_request, reply) => {
    reply.write("x".repeat(16385));
    // Intentionally leave the response open; the client must stop reading itself.
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  await assert.rejects(
    verifyConnection({ kind: "https", address: `http://127.0.0.1:${server.address().port}` }),
    /服务器响应异常/,
  );
});
