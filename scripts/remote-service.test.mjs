import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { inspectService, startService } from "./remote-service.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "takeboard-service-test-"));
  const cleanup = [];
  t.after(async () => {
    // Node after hooks run in registration order. Stop owned services before
    // removing their working directory (Windows correctly refuses otherwise).
    for (const close of cleanup.reverse()) await close();
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const bundle = join(root, "bundle");
  const data = join(root, "data");
  await mkdir(bundle);
  await mkdir(join(data, ".system"), { recursive: true });
  await writeFile(join(bundle, "BUILD.json"), JSON.stringify({ applicationVersion: "1.2.3" }));
  await writeFile(join(bundle, "launcher.mjs"), "process.exitCode = 17;");
  await writeFile(join(data, ".takeboard-instance-id"), "service-test-instance");
  return { bundle, data, after: (close) => cleanup.push(close) };
}

test("inspection is read-only; a reused running server is not stopped or relaunched", async (t) => {
  const { bundle, data, after } = await fixture(t);
  assert.equal((await inspectService(bundle, data)).state, "stopped");
  const server = createServer((_request, response) =>
    response.end(
      JSON.stringify({
        service: "takeboard-server",
        status: "ok",
        instanceId: "service-test-instance",
        version: "1.2.3",
      }),
    ),
  );
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  after(() => {
    server.closeAllConnections();
    return new Promise((done) => server.close(done));
  });
  await writeFile(
    join(data, ".system", "instance.json"),
    JSON.stringify({
      instanceId: "service-test-instance",
      port: server.address().port,
      pid: process.pid,
    }),
  );
  const result = await startService(bundle, data, "service-test-instance");
  assert.equal(result.state, "running");
  await assert.rejects(readFile(join(data, ".system", "remote-start.log")), { code: "ENOENT" });
  await assert.rejects(startService(bundle, data, "changed-instance"), /身份变化/);
  assert.equal((await inspectService(bundle, data)).state, "running");
});

test("unresponsive live process and corrupt identity block startup without killing anything", async (t) => {
  const { bundle, data, after } = await fixture(t);
  const server = createServer((_request, response) => response.end("x".repeat(20000)));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  after(() => {
    server.closeAllConnections();
    return new Promise((done) => server.close(done));
  });
  await writeFile(
    join(data, ".system", "instance.json"),
    JSON.stringify({
      instanceId: "service-test-instance",
      port: server.address().port,
      pid: process.pid,
    }),
  );
  assert.equal((await inspectService(bundle, data)).state, "busy");
  await assert.rejects(startService(bundle, data), /不会重复启动/);
  await writeFile(join(data, ".takeboard-instance-id"), "invalid");
  await assert.rejects(inspectService(bundle, data), /实例标识无效/);
});

test("a real failing launcher returns a failure, not a successful connection", async (t) => {
  const { bundle, data } = await fixture(t);
  await assert.rejects(startService(bundle, data), /启动失败/);
  assert.equal((await inspectService(bundle, data)).state, "stopped");
});

// A deliberately small fixture service exercises the detached child lifecycle;
// this is not a claim of ComfyUI/GPU or native installer compatibility.
async function fixtureLauncher(bundle, reportedVersion) {
  await writeFile(
    join(bundle, "launcher.mjs"),
    `
    import { createServer } from 'node:http';
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const data = process.env.TAKEBOARD_DATA_ROOT;
    const server = createServer((req,res) => {
      if (req.url === '/test-shutdown') { res.end('bye'); server.close(() => process.exit(0)); return; }
      res.end(JSON.stringify({service:'takeboard-server',status:'ok',instanceId:'service-test-instance',version:${JSON.stringify(reportedVersion)}}));
    });
    server.listen(0,'127.0.0.1',() => writeFileSync(join(data,'.system','instance.json'), JSON.stringify({instanceId:'service-test-instance',port:server.address().port,pid:process.pid})));
    process.on('message', message => { if (message?.type === 'takeboard.launcher.shutdown') server.close(() => process.exit(0)); });
  `,
  );
}

test("authorized detached startup returns a verified port and survives the helper disconnect", async (t) => {
  const { bundle, data, after } = await fixture(t);
  await fixtureLauncher(bundle, "1.2.3");
  let port;
  after(async () => {
    if (!port) return;
    const { pid } = JSON.parse(await readFile(join(data, ".system", "instance.json"), "utf8"));
    await fetch(`http://127.0.0.1:${port}/test-shutdown`, { signal: AbortSignal.timeout(5000) });
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") break;
        throw error;
      }
      assert(Date.now() < deadline, "Owned fixture process did not exit after shutdown");
      await delay(25);
    }
  });
  const running = await startService(bundle, data, "service-test-instance");
  port = running.port;
  assert.equal(running.state, "running");
  assert.equal((await inspectService(bundle, data)).port, running.port);
});

test("verification failure rolls back only its spawned launcher through IPC", async (t) => {
  const { bundle, data } = await fixture(t);
  await fixtureLauncher(bundle, "wrong-version");
  await assert.rejects(startService(bundle, data), /其他版本/);
  const record = JSON.parse(await readFile(join(data, ".system", "instance.json"), "utf8"));
  await assert.rejects(fetch(`http://127.0.0.1:${record.port}/api/health`));
  assert.equal((await inspectService(bundle, data)).state, "stopped");
});
