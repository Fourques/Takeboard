import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repositoryRoot, "scripts", "write-desktop-checksums.mjs");

test("writes checksums only for distributable desktop installers", async () => {
  const root = await mkdtemp(join(tmpdir(), "takeboard-checksums-"));
  try {
    const nested = join(root, "dmg");
    await mkdir(nested);
    const installer = join(nested, "TakeBoard.dmg");
    await writeFile(installer, "TakeBoard desktop fixture", "utf8");
    await writeFile(join(nested, "bundle.json"), "{}", "utf8");

    await execute(process.execPath, [script, root]);

    assert.equal(
      await readFile(`${installer}.sha256`, "utf8"),
      "a7a880106ef6a640ac410cad947b33aafe9211bd6dfe10784a25f3f84c159009  TakeBoard.dmg\n",
    );
    await assert.rejects(readFile(join(nested, "bundle.json.sha256"), "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when a bundle directory has no installer", async () => {
  const root = await mkdtemp(join(tmpdir(), "takeboard-checksums-empty-"));
  try {
    await assert.rejects(execute(process.execPath, [script, root]), /没有在 .* 找到桌面安装包/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
