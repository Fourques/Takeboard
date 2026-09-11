import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop release versions match the server, native host and workspace manifests", async () => {
  const version = JSON.parse(await read("package.json")).version;
  for (const path of [
    "apps/desktop/package.json",
    "apps/server/package.json",
    "apps/web/package.json",
    "apps/portal/package.json",
    "apps/desktop/src-tauri/tauri.conf.json",
    "packages/contracts/package.json",
    "packages/domain/package.json",
    "packages/executor-comfy/package.json",
    "packages/identity/package.json",
    "packages/portal-protocol/package.json",
  ]) {
    assert.equal(JSON.parse(await read(path)).version, version, path);
  }
  assert.equal(
    (await read("apps/server/src/app.ts")).match(/takeBoardVersion = "([^"]+)"/)[1],
    version,
  );
  for (const path of ["apps/desktop/src-tauri/Cargo.toml", "apps/desktop/src-tauri/Cargo.lock"]) {
    assert.ok(
      (await read(path)).includes(`name = "takeboard-desktop"\nversion = "${version}"`),
      path,
    );
  }
});

test("public preview pipeline builds only native installers and checks final packaged runtimes", async () => {
  const workflow = await read(".github/workflows/desktop-preview.yml");
  assert.doesNotMatch(workflow, /bundle:portable|release\/\*\.tar\.gz|demo:capture/);
  const matrices = [...workflow.matchAll(/'(\[\{"os":[^']+\])'/g)].map((match) =>
    JSON.parse(match[1]),
  );
  assert.equal(matrices.length, 2);
  assert.deepEqual(
    matrices[0].map((target) => target.platform),
    ["macos-arm64"],
  );
  assert.equal(matrices[0][0].rust_target, "aarch64-apple-darwin");
  assert.equal(matrices[0][0].bundles, "dmg");
  assert.equal(matrices[1].length, 6);
  assert.match(workflow, /default: macos-arm64/);
  assert.match(workflow, /inputs.platform == 'macos-arm64'/);
  assert.equal((workflow.match(/node scripts\/verify-desktop-runtime.mjs/g) ?? []).length, 3);
  assert.match(workflow, /hdiutil attach -readonly/);
  assert.match(workflow, /Start-Process -FilePath/);
  assert.match(workflow, /sudo apt-get install -y .\/apps\/desktop/);
  assert.ok(
    workflow.indexOf("Verify runtime from") < workflow.indexOf("Upload desktop installers"),
  );
});
