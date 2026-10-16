import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { seedWorkflows } from "../deploy/autodl/seed-workflows.mjs";
import { starterWorkflows } from "../deploy/autodl/starter-workflows.mjs";

test("fresh data gets only fixed workflows, bindings and library entries; repeats preserve user choices", async () => {
  const root = await mkdtemp(join(tmpdir(), "takeboard-seed-"));
  try {
    assert.equal((await seedWorkflows(root)).length, 2);
    const userRoot = join(root, "comfy", "user", "default");
    const marker = join(userRoot, "takeboard", "autodl-starters-v1.json");
    for (const recipe of starterWorkflows) {
      const key = `${Buffer.from(recipe.path).toString("base64url")}.json`;
      const file = join(userRoot, "workflows", recipe.path);
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), recipe.prompt);
      const bindingFile = join(userRoot, "takeboard", "bindings", key);
      const binding = JSON.parse(await readFile(bindingFile, "utf8"));
      assert.equal(binding.trusted, true);
      assert.match(binding.workflowHash, /^[a-f0-9]{64}$/);
      assert.equal(binding.workflowPath, recipe.path);
      assert.equal((await stat(bindingFile)).mode & 0o777, 0o600);
      const library = join(userRoot, "takeboard", "library", key);
      await writeFile(library, JSON.stringify({ name: "My title", included: false }));
      await seedWorkflows(root);
      assert.deepEqual(JSON.parse(await readFile(library, "utf8")), {
        name: "My title",
        included: false,
      });
      await unlink(bindingFile);
      await unlink(marker);
      await seedWorkflows(root); // Resume a first boot interrupted after writing the graph.
      assert.equal(
        JSON.parse(await readFile(bindingFile, "utf8")).workflowHash,
        binding.workflowHash,
      );
      await writeFile(file, JSON.stringify({ edited: true }));
      await unlink(bindingFile);
      await unlink(marker);
      await seedWorkflows(root);
      await assert.rejects(readFile(bindingFile), { code: "ENOENT" });
      assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { edited: true });
      await writeFile(file, "unfinished user edit");
      await unlink(marker);
      await seedWorkflows(root);
      assert.equal(await readFile(file, "utf8"), "unfinished user edit");
      await unlink(file);
      await seedWorkflows(root);
      await assert.rejects(readFile(file), { code: "ENOENT" });
    }
    for (const privatePath of ["identity", "projects", "acceptance"])
      await assert.rejects(stat(join(root, privatePath)), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
