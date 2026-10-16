import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { downloadModels, modelUrl } from "../deploy/autodl/download-models.mjs";

const model = {
  repository: "official/model",
  revision: "a".repeat(40),
  file: "weights.bin",
  path: "weights.bin",
  bytes: 1,
  sha256: createHash("sha256").update("x").digest("hex"),
};
test("model URLs pin contents and reject traversal or unapproved origins", () => {
  assert.equal(
    modelUrl(model),
    `https://huggingface.co/official/model/resolve/${model.revision}/weights.bin`,
  );
  for (const patch of [
    { path: "../secret" },
    { file: "a/../b" },
    { repository: "official/model/extra" },
    { revision: "main" },
    { sha256: "x" },
    { bytes: 0 },
  ])
    assert.throws(() => modelUrl({ ...model, ...patch }));
  assert.throws(() => modelUrl(model, "http://hf-mirror.com"));
  assert.throws(() => modelUrl(model, "https://unapproved.example"));
});
test("verified models need no download space and release the Linux download lease", {
  skip: process.platform !== "linux",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "takeboard-autodl-models-"));
  try {
    const manifest = join(root, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({ format: "takeboard.autodl-models.v1", models: [model] }),
    );
    await writeFile(join(root, model.path), "x");
    await downloadModels(root, manifest);
    await assert.rejects(access(join(root, ".takeboard-download.lock")), { code: "ENOENT" });
    await writeFile(join(root, model.path), "y");
    await assert.rejects(downloadModels(root, manifest), /未覆盖/);
    assert.equal(await readFile(join(root, model.path), "utf8"), "y");
    await assert.rejects(access(join(root, ".takeboard-download.lock")), { code: "ENOENT" });
    await assert.rejects(downloadModels(root, manifest, { signal: AbortSignal.abort() }), {
      name: "AbortError",
    });
    await assert.rejects(downloadModels(root, manifest, { transport: "shell" }), /下载工具/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
