import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("two isolated browser CI shards cover every functional test exactly once", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /shard: \[1, 2\]/);
  assert.match(workflow, /pnpm test:e2e:functional --shard=\$\{\{ matrix.shard \}\}\/2/);
  assert.match(workflow, /browser-failure-diagnostics-\$\{\{ matrix.shard \}\}/);
  const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
  const collect = (shard) => {
    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [
          cli,
          "test",
          "--list",
          "--reporter=json",
          "--grep-invert",
          "@performance",
          ...(shard ? [`--shard=${shard}/2`] : []),
        ],
        {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 8 * 1024 * 1024,
        },
      ),
    );
    const keys = [];
    const visit = (suites) => {
      for (const suite of suites) {
        for (const spec of suite.specs ?? [])
          for (const item of spec.tests)
            keys.push(`${item.projectName}:${spec.file}:${spec.line}:${spec.column}:${spec.title}`);
        visit(suite.suites ?? []);
      }
    };
    visit(report.suites);
    return keys;
  };
  const full = collect();
  const first = collect(1);
  const second = collect(2);
  assert.ok(full.length > 0 && first.length > 0 && second.length > 0);
  assert.equal(new Set([...first, ...second]).size, first.length + second.length);
  assert.deepEqual([...first, ...second].sort(), full.sort());
});
