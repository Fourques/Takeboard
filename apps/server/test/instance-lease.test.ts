import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { restoreInstanceOffline } from "../src/instance-backup.js";
import { acquireInstanceLease } from "../src/instance-lease.js";

const roots: string[] = [];
const releases: Array<() => void> = [];
const sqlitePath = createRequire(import.meta.url).resolve("better-sqlite3");
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("exclusive data-directory ownership", () => {
  it("rejects a second process and publishes reusable identity only for the owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-lease-"));
    roots.push(root);
    const lease = acquireInstanceLease(root);
    releases.push(lease.release);
    lease.publish(49123, "test-version");
    const record = JSON.parse(await readFile(join(root, ".system", "instance.json"), "utf8"));
    expect(record).toMatchObject({
      instanceId: lease.instanceId,
      port: 49123,
      version: "test-version",
    });
    expect(() => acquireInstanceLease(root)).toThrow("已有 TakeBoard");
    await expect(
      restoreInstanceOffline(root, join(root, "unused-backup.tgz"), join(root, "auth.db")),
    ).rejects.toThrow("已有 TakeBoard");
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const Database=require(${JSON.stringify(sqlitePath)});
      const db=new Database(process.argv[1], {timeout:0});
      try { db.exec("BEGIN EXCLUSIVE"); process.stdout.write("acquired"); }
      catch(error) { process.stdout.write(error.code); }
      finally { db.close(); }
    `,
        join(root, ".system", "instance-lock.db"),
      ],
      { encoding: "utf8", timeout: 5_000 },
    );
    if (child.error) throw child.error;
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe("SQLITE_BUSY");
    lease.release();
    await expect(readFile(join(root, ".system", "instance.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const next = acquireInstanceLease(root);
    releases.push(next.release);
    expect(next.instanceId).toBe(lease.instanceId);
  });

  it("automatically releases an OS lock after a crashed owner without deleting lock files", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-lease-crash-"));
    roots.push(root);
    const initial = acquireInstanceLease(root);
    initial.release();
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
      const Database=require(${JSON.stringify(sqlitePath)});
      const db=new Database(process.argv[1], {timeout:0});
      db.exec("BEGIN EXCLUSIVE"); process.stdout.write("ready");
      setInterval(()=>{},1000);
    `,
        join(root, ".system", "instance-lock.db"),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      await Promise.race([
        once(child.stdout, "data"),
        once(child, "exit").then(() => {
          throw new Error("Lock test process exited before readiness");
        }),
      ]);
      expect(() => acquireInstanceLease(root)).toThrow("已有 TakeBoard");
    } finally {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }
    const recovered = acquireInstanceLease(root);
    releases.push(recovered.release);
    expect(recovered.instanceId).toBe(initial.instanceId);
  });
});
