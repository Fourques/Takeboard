import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isMainModule } from "./is-main-module.mjs";

test("entry detection distinguishes imports, missing paths and aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "takeboard-entry-alias-"));
  try {
    const alias = join(root, "scripts");
    await symlink(
      dirname(fileURLToPath(import.meta.url)),
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.equal(isMainModule(import.meta.url, join(alias, "is-main-module.test.mjs")), true);
    assert.equal(isMainModule(import.meta.url, join(alias, "desktop-updates.mjs")), false);
    assert.equal(isMainModule(import.meta.url, join(root, "missing")), false);
    assert.equal(isMainModule(import.meta.url, "-"), false);
    const result = await promisify(execFile)(
      process.execPath,
      [join(alias, "desktop-updates.mjs"), join(root, "updates.json"), "0.2.0-beta.8", "status"],
      { timeout: 10000 },
    );
    assert.equal(JSON.parse(result.stdout).currentVersion, "0.2.0-beta.8");
    for (const [script, argument] of [
      ["desktop-connection.mjs", '{"kind":"invalid"}'],
      ["remote-service.mjs", "invalid"],
    ]) {
      const failed = await promisify(execFile)(process.execPath, [join(alias, script), argument], {
        timeout: 10000,
      }).then(
        () => null,
        (error) => error,
      );
      assert.equal(failed?.code, 1);
      assert.equal(JSON.parse(failed.stdout).state, "failed");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
