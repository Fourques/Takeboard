import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

// Exercise the exact bundled, dependency-free selector with controlled endpoints.
const source = await readFile(new URL("./runtime-launcher.mjs", import.meta.url), "utf8");
const selector = source.slice(
  source.indexOf("async function selectPort("),
  source.indexOf("function openBrowser("),
);
function fixture(record, endpoints, configured) {
  return new Function(
    "health",
    "portAvailable",
    "process",
    "readFile",
    "join",
    `${selector}; return selectPort;`,
  )(
    async (port) => endpoints.get(port) ?? null,
    async (port) => !endpoints.has(port),
    { env: { TAKEBOARD_PORT: configured } },
    async () => JSON.stringify(record),
    join,
  );
}
test("finds a later existing instance before choosing an earlier free port", async () => {
  const choose = fixture(null, new Map([[48121, { instanceId: "same-instance", version: "v1" }]]));
  assert.deepEqual(await choose("same-instance", "v1", "/unused"), { port: 48121, existing: true });
});
test("discovers a desktop instance outside the fallback port range", async () => {
  const record = { port: 51234, instanceId: "same-instance" };
  const choose = fixture(record, new Map([[51234, { ...record, version: "v1" }]]));
  assert.deepEqual(await choose("same-instance", "v1", "/unused"), { port: 51234, existing: true });
});
test("does not reuse a foreign service or bypass a version mismatch", async () => {
  const choose = fixture(
    { port: 51234, instanceId: "same-instance" },
    new Map([[51234, { instanceId: "someone-else", version: "v1" }]]),
  );
  assert.deepEqual(await choose("same-instance", "v1", "/unused"), {
    port: 48120,
    existing: false,
  });
  const differentVersion = fixture(
    null,
    new Map([[48121, { instanceId: "same-instance", version: "v2" }]]),
  );
  await assert.rejects(differentVersion("same-instance", "v1", "/unused"), /请先/);
});
