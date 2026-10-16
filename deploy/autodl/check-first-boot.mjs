#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { starterWorkflows } from "./starter-workflows.mjs";

// Read-only verification against a separate, empty-data, loopback test instance.
// Never initialize an account or start a generation service from this check.
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.equal(config.mode, "tunnel");
const base = `http://127.0.0.1:${config.port ?? 48120}`;
const get = (path) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
assert.equal((await get("/api/health")).status, 200);
const authResponse = await get("/api/auth/status");
assert.equal(authResponse.status, 200);
const auth = await authResponse.json();
assert.equal(auth.configured, false, "Use an isolated fresh-data instance, never a user workspace");
assert.ok([401, 428].includes((await get("/api/projects")).status));
const { parseWorkflowBinding, workflowHash } = await import(
  pathToFileURL(join(config.appRoot, "dist/workflow-bindings.js")).href
);
const userRoot = join(config.dataRoot, "comfy", "user", "default");
for (const recipe of starterWorkflows) {
  const document = JSON.parse(await readFile(join(userRoot, "workflows", recipe.path), "utf8"));
  assert.deepEqual(document, recipe.prompt);
  const key = `${Buffer.from(recipe.path).toString("base64url")}.json`;
  const bindingFile = join(userRoot, "takeboard", "bindings", key);
  const binding = parseWorkflowBinding(
    JSON.parse(await readFile(bindingFile, "utf8")),
    recipe.path,
  );
  assert.ok(binding, "Binding must pass the actual server parser");
  assert.equal(binding.workflowHash, workflowHash(document));
  assert.equal((await stat(bindingFile)).mode & 0o777, 0o600);
  const library = JSON.parse(await readFile(join(userRoot, "takeboard", "library", key), "utf8"));
  assert.equal(library.included, true);
  assert.equal(library.name, recipe.name);
}
for (const directory of ["acceptance", "projects"]) {
  assert.deepEqual(
    (
      await readdir(join(config.dataRoot, directory)).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      })
    ).filter(
      (name) => directory !== "projects" || ![".system", ".takeboard-instance-id"].includes(name),
    ),
    [],
    `Fresh ${directory} must be empty`,
  );
}
const proof = {
  format: "takeboard.autodl-first-boot.v1",
  checkedAt: new Date().toISOString(),
  health: true,
  administratorUnclaimed: true,
  anonymousProjectsBlocked: true,
  starterBindingsMatchCoreParserAndHash: true,
  starterCount: starterWorkflows.length,
  testScope: "Fresh data boot on the configured instance, not a newly provisioned saved image",
};
if (process.argv[3])
  await writeFile(process.argv[3], JSON.stringify(proof, null, 2), { mode: 0o600 });
console.log(JSON.stringify(proof));
