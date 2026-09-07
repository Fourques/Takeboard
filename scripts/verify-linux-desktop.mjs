#!/usr/bin/env node
// Run only in a disposable Linux user/session after installing the .deb.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

assert.equal(process.platform, "linux");
assert.notEqual(process.getuid(), 0, "Desktop smoke must run as an ordinary user");
assert.equal(process.env.TAKEBOARD_DESKTOP_SMOKE, "1", "Requires an explicitly disposable session");
assert.ok(
  process.env.DISPLAY && process.env.DBUS_SESSION_BUS_ADDRESS,
  "Needs X11 and session D-Bus",
);
for (const command of ["openbox", "xprop", "xdotool", "import", "convert"]) {
  execFileSync("which", [command], { stdio: "pipe" });
}
const dataRoot = join(homedir(), "TakeBoardData");
assert.ok(!existsSync(dataRoot), "Refusing to touch an existing TakeBoardData directory");
const executable = resolve(process.argv[2] ?? "/usr/bin/takeboard-desktop");
const launcher = resolve(process.argv[3] ?? "/usr/lib/TakeBoard/TakeBoard/launcher.mjs");
assert.ok(
  existsSync(executable) && existsSync(launcher),
  "Installed native host/resources missing",
);
const artifacts = resolve("test-results/linux-desktop");
await mkdir(artifacts, { recursive: true });
const children = [];
function start(command, args = [], env = {}) {
  const child = spawn(command, args, {
    env: {
      ...process.env,
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = { child, error: null, log: "" };
  child.on("error", (error) => {
    entry.error = error;
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      entry.log = (entry.log + chunk).slice(-12_000);
    });
  }
  children.push(entry);
  return entry;
}
function running(entry) {
  return !entry.error && entry.child.exitCode === null && entry.child.signalCode === null;
}
async function until(label, check, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}
async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
async function ready(entry) {
  return until("native server ready", async () => {
    assert.ok(running(entry), entry.log || String(entry.error));
    const record = JSON.parse(await readFile(join(dataRoot, ".system/instance.json"), "utf8"));
    const status = await health(record.port);
    return status?.service === "takeboard-server" && status.instanceId === record.instanceId
      ? record
      : null;
  });
}
async function windowId(entry) {
  return until("visible native window", () => {
    assert.ok(running(entry), entry.log);
    return execFileSync(
      "xdotool",
      ["search", "--onlyvisible", "--pid", String(entry.child.pid), "--name", "TakeBoard"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")[0];
  });
}
async function closeWindow(entry, id) {
  // Send a real window-manager close request, not SIGKILL or an HTTP stop shortcut.
  execFileSync("xdotool", ["windowactivate", "--sync", id]);
  execFileSync("xdotool", ["key", "--clearmodifiers", "alt+F4"]);
  await until("graceful native window exit", () => !running(entry), 15_000);
  assert.equal(entry.child.exitCode, 0, entry.log);
}
function capture(id, name) {
  const windowImage = join(artifacts, `${name}.png`);
  execFileSync("import", ["-window", id, windowImage]);
  execFileSync("import", ["-window", "root", join(artifacts, `${name}-desktop.png`)]);
  // Reject a blank dark form shell with no painted text/buttons. This is a narrow
  // smoke assertion, not OCR, a visual-quality score, or proof of a WebKit defect.
  const visibleContent = Number(
    execFileSync(
      "convert",
      [windowImage, "-colorspace", "Gray", "-threshold", "70%", "-format", "%[fx:mean]", "info:"],
      { encoding: "utf8" },
    ),
  );
  assert.ok(
    Number.isFinite(visibleContent) && visibleContent > 0.001,
    `${name}: login content did not paint (${visibleContent})`,
  );
}
async function vacantPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

try {
  start("openbox", ["--sm-disable"]);
  await until("window manager ready", () =>
    execFileSync("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"], { encoding: "utf8" }).includes(
      "window id",
    ),
  );
  const desktop = start(executable);
  const record = await ready(desktop);
  const auth = await fetch(`http://127.0.0.1:${record.port}/api/auth/status`).then((response) =>
    response.json(),
  );
  assert.equal(auth.enabled, true);
  assert.equal(auth.configured, false);
  assert.equal(auth.user, null);
  const page = await fetch(`http://127.0.0.1:${record.port}/`).then((response) => response.text());
  assert.match(page, /<div id="root"><\/div>/);
  const id = await windowId(desktop);
  // Rendering gets its own artifact; this is not a claim of automatic visual approval.
  await delay(5_000);
  capture(id, "first-launch");
  await closeWindow(desktop, id);
  await until(
    "owned server stopped and lease released",
    async () =>
      !(await health(record.port)) && !existsSync(join(dataRoot, ".system/instance.json")),
    15_000,
  );
  console.log(
    "PASS: installed native host, embedded runtime, first-run auth, window close and owned service cleanup",
  );

  const external = start(
    join(dirname(executable), "takeboard-node"),
    [launcher, "start", "--no-open"],
    {
      TAKEBOARD_DATA_ROOT: dataRoot,
      TAKEBOARD_PORT: String(await vacantPort()),
    },
  );
  const borrowed = await ready(external);
  const second = start(executable);
  const secondId = await windowId(second);
  await delay(5_000);
  const reused = await ready(second);
  assert.equal(reused.pid, borrowed.pid, "Desktop must reuse the existing server process");
  assert.equal(reused.port, borrowed.port);
  capture(secondId, "reused-service");
  await closeWindow(second, secondId);
  assert.ok(running(external));
  assert.equal(
    (await health(borrowed.port))?.instanceId,
    borrowed.instanceId,
    "Closing a borrowing window must not stop the external service",
  );
  external.child.kill("SIGTERM");
  await until(
    "external launcher stopped cleanly",
    async () =>
      !running(external) &&
      !(await health(borrowed.port)) &&
      !existsSync(join(dataRoot, ".system/instance.json")),
    15_000,
  );
  assert.equal(external.child.exitCode, 0, external.log);
  console.log(
    "PASS: existing service reused without transferring ownership; original launcher stops cleanly",
  );
  const crashed = start(executable);
  const crashRecord = await ready(crashed);
  await windowId(crashed);
  crashed.child.kill("SIGKILL");
  await until(
    "crashed desktop leaves no owned server",
    async () =>
      !running(crashed) &&
      !(await health(crashRecord.port)) &&
      !existsSync(join(dataRoot, ".system/instance.json")),
    30_000,
  );
  console.log(
    "PASS: abrupt desktop exit closes its control pipe and releases the owned server lease",
  );
  const crashedLauncher = start(
    join(dirname(executable), "takeboard-node"),
    [launcher, "start", "--no-open"],
    { TAKEBOARD_DATA_ROOT: dataRoot, TAKEBOARD_PORT: String(await vacantPort()) },
  );
  const orphanRecord = await ready(crashedLauncher);
  crashedLauncher.child.kill("SIGKILL");
  await until(
    "orphaned server follows its lost IPC parent",
    async () =>
      !running(crashedLauncher) &&
      !(await health(orphanRecord.port)) &&
      !existsSync(join(dataRoot, ".system/instance.json")),
    30_000,
  );
  console.log("PASS: abrupt launcher exit triggers server shutdown through IPC disconnect");
} catch (error) {
  for (const entry of children) if (entry.log) console.error(entry.log);
  throw error;
} finally {
  for (const entry of children.reverse()) if (running(entry)) entry.child.kill("SIGTERM");
}
