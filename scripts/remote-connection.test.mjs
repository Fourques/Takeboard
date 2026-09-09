import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  connectRemote,
  remoteFailure,
  takeboardHealth,
  validateRemoteHost,
} from "./remote-connection.mjs";

const fixture = fileURLToPath(new URL("fixtures/remote-ssh.mjs", import.meta.url));
const ssh = { sshCommand: process.execPath, sshPrefix: [fixture, "proxy"] };
async function server(t, handler) {
  const app = createServer(handler);
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    app.closeAllConnections();
    return new Promise((resolve) => app.close(resolve));
  });
  return app.address().port;
}
async function unusedPort() {
  const socket = createTcpServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
const healthy = (_request, reply) =>
  reply.end(
    JSON.stringify({ service: "takeboard-server", status: "ok", instanceId: "test-instance" }),
  );

test("validates SSH destinations without interpreting commands", () => {
  for (const host of ["server", "user@192.168.1.10", "duanqw-kami-tail", "user@::1"])
    assert.equal(validateRemoteHost(host), host);
  for (const host of [
    "",
    "-oProxyCommand=bad",
    "server\ncommand",
    "server -p 22",
    "user@$(command)",
    "server;command",
    null,
  ])
    assert.throws(() => validateRemoteHost(host));
  assert.match(remoteFailure("Permission denied", true), /身份验证失败/);
  assert.match(remoteFailure("REMOTE HOST IDENTIFICATION HAS CHANGED", true), /指纹/);
  assert.match(remoteFailure("Could not resolve hostname", true), /找不到/);
  assert.match(remoteFailure("bind: Address already in use", true), /不会关闭其他程序/);
});

test("verifies service identity instead of accepting any successful web response", async (t) => {
  const other = await server(t, (_request, reply) => reply.end(JSON.stringify({ status: "ok" })));
  assert.equal(await takeboardHealth(other), null);
  const target = await server(t, healthy);
  assert.equal((await takeboardHealth(target)).instanceId, "test-instance");
  const oversized = await server(t, (_request, reply) => reply.end("x".repeat(20_000)));
  assert.equal(await takeboardHealth(oversized), null);
  const redirected = await server(t, (_request, reply) => {
    reply.writeHead(302, { location: `http://127.0.0.1:${target}/api/health` });
    reply.end();
  });
  assert.equal(await takeboardHealth(redirected), null);
});

test("skips occupied ports, probes past stalled candidates, forwards real traffic and releases owned ports", async (t) => {
  const occupied = await server(t, (_request, reply) => reply.end("other application"));
  const stalled = await server(t, () => {});
  const target = await server(t, healthy);
  const connection = await connectRemote({
    ...ssh,
    host: "test-host",
    remotePorts: [stalled, target],
    preferredLocalPort: occupied,
    comfyRemotePort: null,
    timeoutMs: 3000,
  });
  t.after(() => connection.close());
  assert.notEqual(connection.localPort, occupied);
  assert.equal(connection.remotePort, target);
  assert.equal(connection.instanceId, "test-instance");
  assert.equal(connection.comfyUrl, null);
  assert.equal(await (await fetch(`http://127.0.0.1:${occupied}`)).text(), "other application");
  assert.equal((await takeboardHealth(connection.localPort)).instanceId, "test-instance");
  await connection.close();
  await connection.close();
  assert.equal(await takeboardHealth(connection.localPort), null);
  const port = createTcpServer();
  await new Promise((resolve, reject) =>
    port.once("error", reject).listen(connection.localPort, "127.0.0.1", resolve),
  );
  await new Promise((resolve) => port.close(resolve));
  assert.equal(await (await fetch(`http://127.0.0.1:${occupied}`)).text(), "other application");
});

test("rejects ambiguous servers rather than selecting an arbitrary project directory", async (t) => {
  const first = await server(t, healthy);
  const second = await server(t, healthy);
  await assert.rejects(
    connectRemote({
      ...ssh,
      host: "test-host",
      remotePorts: [first, second],
      comfyRemotePort: null,
      timeoutMs: 3000,
    }),
    /多个 TakeBoard/,
  );
});

test("reports SSH authentication and executable failures without claiming a connection succeeded", async () => {
  await assert.rejects(
    connectRemote({
      ...ssh,
      sshPrefix: [fixture, "denied"],
      host: "test-host",
      remotePorts: [48120],
      comfyRemotePort: null,
      timeoutMs: 3000,
    }),
    /身份验证失败/,
  );
  await assert.rejects(
    connectRemote({
      host: "test-host",
      sshCommand: "/nonexistent/takeboard-test-ssh",
      remotePorts: [48120],
      comfyRemotePort: null,
      timeoutMs: 3000,
    }),
    /无法启动 SSH/,
  );
});

test("cancellation before and after readiness terminates the owned transport", async (t) => {
  const port = await unusedPort();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 150);
  t.after(() => clearTimeout(timer));
  await assert.rejects(
    connectRemote({
      ...ssh,
      sshPrefix: [fixture, "silent"],
      host: "test-host",
      remotePorts: [port],
      comfyRemotePort: null,
      signal: abort.signal,
    }),
    /abort/i,
  );
  const target = await server(t, healthy);
  const readyAbort = new AbortController();
  const ready = await connectRemote({
    ...ssh,
    host: "test-host",
    remotePorts: [target],
    comfyRemotePort: null,
    signal: readyAbort.signal,
    timeoutMs: 3000,
  });
  t.after(() => ready.close());
  readyAbort.abort();
  await ready.closed;
  assert.equal(await takeboardHealth(ready.localPort), null);
});

test("times out a silent transport and cleans up instead of waiting for every forwarded port in sequence", async () => {
  const started = Date.now();
  await assert.rejects(
    connectRemote({
      ...ssh,
      sshPrefix: [fixture, "silent"],
      host: "test-host",
      remotePorts: [48120],
      comfyRemotePort: null,
      timeoutMs: 350,
    }),
    /没有找到可响应/,
  );
  assert.ok(Date.now() - started < 2500);
});
