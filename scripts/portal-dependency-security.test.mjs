import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";

// Resolve the packages Portal actually executes, not a separate test dependency.
const portalRequire = createRequire(new URL("../apps/portal/package.json", import.meta.url));
function dependency(...chain) {
  let requireFrom = portalRequire;
  let entry;
  for (const name of chain) {
    entry = requireFrom.resolve(name);
    requireFrom = createRequire(entry);
  }
  return { entry, module: portalRequire(entry) };
}

const uriChains = [
  ["fastify", "@fastify/ajv-compiler", "fast-uri"],
  ["fastify", "@fastify/ajv-compiler", "ajv", "fast-uri"],
  ["fastify", "fast-json-stringify", "fast-uri"],
  ["fastify", "fast-json-stringify", "ajv", "fast-uri"],
];

for (const chain of uriChains) {
  test(`host normalization is consistent: ${chain.join(" > ")}`, () => {
    const { module: uri } = dependency(...chain);
    // GHSA-hrr3-gc8f-f4qj: encoded uppercase letters must not evade host checks.
    assert.equal(uri.parse("//%41.com").host, "a.com");
    assert.equal(uri.equal("//%41.com", "//a.com"), true);
    assert.equal(uri.normalize("//%41.com"), uri.normalize("//a.com"));
    assert.equal(uri.parse("https://example.test:8443/path").host, "example.test");
  });
}

for (const chain of uriChains.filter((chain) => !chain.includes("ajv"))) {
  test(`mailto fields cannot appear only after serialization: ${chain.join(" > ")}`, () => {
    const { module: uri } = dependency(...chain);
    // GHSA-jvvf-x445-j334: decisions made before serialization must see every
    // recipient, subject and body that a subsequent parse will expose.
    const parsed = uri.parse(
      "mailto:owner@example.test?%74o=other@example.test&%73ubject=hello&%62ody=message",
    );
    const reparsed = uri.parse(uri.serialize(parsed));
    assert.deepEqual(parsed.to, reparsed.to);
    assert.equal(parsed.subject, reparsed.subject);
    assert.equal(parsed.body, reparsed.body);
    assert.ok(parsed.to.includes("owner@example.test"));
  });
}

test("Portal's brace expansion bounds parser recursion and rewrite work", () => {
  const { entry } = dependency("@fastify/static", "glob", "minimatch", "brace-expansion");
  // Isolate advisory reproductions: an accidental downgrade must fail this
  // test, not stall or exhaust the memory of the entire test runner.
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=128",
      "-e",
      `
        const assert = require('node:assert/strict');
        const { expand } = require(process.argv[1]);
        assert.deepEqual(expand('asset-{a,b}.png'), ['asset-a.png', 'asset-b.png']);
        const patterns = [
          '{' + '{a},'.repeat(8000) + 'b}',
          '{{x},' + 'a,'.repeat(130000) + 'b}',
          '{a,'.repeat(5000) + 'z' + '}'.repeat(5000),
          '{'.repeat(4000) + 'a,b' + '}'.repeat(4000),
          '{a}' + '}'.repeat(128000) + ',z}',
        ];
        for (const pattern of patterns) assert.ok(Array.isArray(expand(pattern)));
      `,
      entry,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test("Fastify still validates and serializes referenced schemas after the URI update", async () => {
  const Fastify = portalRequire("fastify");
  const app = Fastify();
  try {
    app.addSchema({
      $id: "https://example.test/schemas/result",
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    });
    app.post(
      "/result",
      {
        schema: {
          body: { $ref: "https://example.test/schemas/result#" },
          response: { 200: { $ref: "https://example.test/schemas/result#" } },
        },
      },
      async (request) => ({ name: request.body.name, privateField: "must-not-be-returned" }),
    );
    const valid = await app.inject({ method: "POST", url: "/result", payload: { name: "shot" } });
    assert.equal(valid.statusCode, 200, valid.body);
    assert.deepEqual(valid.json(), { name: "shot" });
    const invalid = await app.inject({ method: "POST", url: "/result", payload: {} });
    assert.equal(invalid.statusCode, 400, invalid.body);
  } finally {
    await app.close();
  }
});
