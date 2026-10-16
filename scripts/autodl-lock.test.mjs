import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { acceptance } from "../deploy/autodl/acceptance.mjs";
import { acquireAcceptanceLock, acquireDownloadLock } from "../deploy/autodl/process-lock.mjs";

const linux = { skip: process.platform !== "linux" };
test(
  "the Linux lease excludes concurrent downloaders and is reusable without deleting its inode",
  linux,
  async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-download-lock-"));
    try {
      const lock = await acquireDownloadLock(root);
      try {
        await assert.rejects(acquireDownloadLock(root), /第二个下载者/);
      } finally {
        await lock.close();
      }
      const replacement = await acquireDownloadLock(root);
      await replacement.close();
      await writeFile(join(root, ".takeboard-download.lock"), "");
      await assert.rejects(acquireDownloadLock(root), /旧版下载锁/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "a transfer inherits the lease after its supervisor crashes; closing the last descriptor releases it",
  linux,
  async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-orphan-lock-"));
    const moduleUrl = new URL("../deploy/autodl/process-lock.mjs", import.meta.url).href;
    const code = `const {acquireDownloadLock}=await import(${JSON.stringify(moduleUrl)});const lock=await acquireDownloadLock(process.argv[1]);process.stdout.write('ready\\n');setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, root], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ended = once(child, "exit");
    try {
      let text = "";
      child.stdout.on("data", (bytes) => {
        text += bytes;
      });
      const deadline = Date.now() + 5000;
      while (!text.includes("ready") && Date.now() < deadline && child.exitCode === null)
        await delay(20);
      assert.ok(text.includes("ready"), "child must acquire the lock");
      await assert.rejects(acquireDownloadLock(root), /第二个下载者/);
      child.kill("SIGKILL");
      await ended;
      const lock = await acquireDownloadLock(root);
      // A real child (the same descriptor layout as curl/aria2) keeps ownership when the parent closes it.
      const transfer = spawn(
        process.execPath,
        ["-e", "process.stdout.write('ready');setInterval(()=>{},1000)"],
        {
          stdio: ["ignore", "pipe", "ignore", lock.fd],
        },
      );
      const transferEnded = once(transfer, "exit");
      try {
        await once(transfer.stdout, "data");
        await lock.close();
        await assert.rejects(acquireDownloadLock(root), /第二个下载者/);
      } finally {
        transfer.kill("SIGKILL");
        await transferEnded;
        await lock.close().catch(() => {});
      }
      const final = await acquireDownloadLock(root);
      await final.close();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await ended;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "generation and lifecycle acceptance share one lease before reading sessions or calling APIs",
  linux,
  async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-acceptance-lock-"));
    const privateRoot = join(root, "acceptance");
    const configFile = join(root, "cloud.json");
    // acceptance creates its private directory; no session or API is needed for this guard test.
    await mkdir(privateRoot);
    await writeFile(configFile, JSON.stringify({ mode: "tunnel", dataRoot: root }));
    const lock = await acquireAcceptanceLock(privateRoot);
    try {
      await assert.rejects(acceptance(configFile), /已有云端验收/);
      const lifecycle = spawn(
        process.execPath,
        [new URL("../deploy/autodl/lifecycle.mjs", import.meta.url).pathname, configFile],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      lifecycle.stderr.on("data", (bytes) => {
        stderr += bytes;
      });
      const [code] = await once(lifecycle, "exit");
      assert.notEqual(code, 0);
      assert.match(stderr, /已有云端验收/);
      assert.doesNotMatch(stderr, /ENOENT|fetch failed/);
    } finally {
      await lock.close();
      const next = await acquireAcceptanceLock(privateRoot);
      await next.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
