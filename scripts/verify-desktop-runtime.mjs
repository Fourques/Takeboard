// Execute the packaged runtime, not the workspace's Node or node_modules.
// This is an API/lifecycle gate, not a claim of native window or GPU validation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const binary = resolve(process.argv[2] ?? "");
const resources = resolve(process.argv[3] ?? "");
assert.ok(process.argv[2] && process.argv[3], "Supply packaged Node and resource directory");
assert.ok(existsSync(binary) && existsSync(join(resources, "launcher.mjs")));
const root = await mkdtemp(join(tmpdir(), "takeboard-packaged-runtime-"));
const lease = join(root, ".system", "instance.json");
let child;
let exited;
let ended = true;
let log = "";
async function until(label, check) {
  const deadline = Date.now() + 30000;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await delay(150);
  }
  throw new Error(`${label}: ${last?.message ?? "timeout"}\n${log}`);
}
async function start() {
  log = "";
  ended = false;
  child = spawn(binary, [join(resources, "launcher.mjs"), "start", "--no-open"], {
    cwd: resources,
    env: {
      ...process.env,
      TAKEBOARD_DATA_ROOT: root,
      TAKEBOARD_PORT: "",
      TAKEBOARD_AUTH_MODE: "optional",
      TAKEBOARD_SECURE_COOKIES: "0",
      TAKEBOARD_BACKUP_DESTINATION: "",
      TAKEBOARD_DESKTOP: "1",
      COMFY_URL: "http://127.0.0.1:1",
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  exited = new Promise((resolve) =>
    child.once("close", (code) => {
      ended = true;
      resolve(code);
    }),
  );
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      log = (log + chunk).slice(-12000);
    });
  return await until("packaged service readiness", async () => {
    if (spawnError) throw spawnError;
    assert.equal(ended, false, log);
    const record = JSON.parse(await readFile(lease, "utf8"));
    const origin = `http://127.0.0.1:${record.port}`;
    const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }).then(
      (r) => r.json(),
    );
    return health.service === "takeboard-server" && health.instanceId === record.instanceId
      ? { origin, instanceId: record.instanceId }
      : null;
  });
}
async function stop() {
  if (!child || ended) return;
  child.stdin.write("takeboard.launcher.shutdown\n");
  await until("packaged launcher shutdown", () => ended);
  assert.equal(await exited, 0, log);
  await until("owned lease released", () => !existsSync(lease));
}
try {
  const first = await start();
  const response = await fetch(`${first.origin}/api/auth/status`);
  const status = await response.json();
  assert.equal(status.access, "local");
  assert.equal(status.configured, false);
  const cookie = response.headers.get("set-cookie").split(";", 1)[0];
  const created = await fetch(`${first.origin}/api/projects`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "x-takeboard-csrf": status.csrfToken },
    body: JSON.stringify({ title: "Packaged runtime verification" }),
  });
  assert.equal(created.status, 201, await created.text());
  await stop();
  const second = await start();
  assert.equal(second.instanceId, first.instanceId);
  const restored = await fetch(`${second.origin}/api/auth/status`, { headers: { cookie } }).then(
    (r) => r.json(),
  );
  assert.equal(restored.access, "local");
  assert.equal(
    restored.csrfToken,
    status.csrfToken,
    "Session must survive the real process restart",
  );
  const list = await fetch(`${second.origin}/api/projects`, { headers: { cookie } }).then((r) =>
    r.json(),
  );
  assert.equal(list.projects.length, 1);
  assert.equal(list.projects[0].title, "Packaged runtime verification");
  await stop();
  console.log(
    "PASS: packaged runtime starts, creates a project without signup, restores the session/data and releases its owned lease",
  );
} finally {
  await stop().catch(() => {
    child?.kill("SIGKILL");
  });
  if (!ended) await exited;
  // Never remove a directory while its server lease is still live.
  if (!existsSync(lease)) await rm(root, { recursive: true, force: true });
  else console.error(`Retained diagnostic data because a lease remains: ${root}`);
}
