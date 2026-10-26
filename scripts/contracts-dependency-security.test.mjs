import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// GHSA-mrhx-c7xc-m3w5: size bounds must reject oversized collections before
// traversing elements. Small fixtures exercise the flaw without risking an OOM.
for (const name of ["contracts", "portal-protocol"]) {
  const require = createRequire(new URL(`../packages/${name}/package.json`, import.meta.url));
  const { z } = require("zod");
  for (const kind of ["array", "set", "map"]) {
    test(`${name}: Zod rejects an oversized ${kind} before parsing elements`, async () => {
      let parsed = 0;
      const element = z.string().superRefine(() => {
        parsed++;
      });
      const schema =
        kind === "array"
          ? z.array(element).max(2)
          : kind === "set"
            ? z.set(element).max(2)
            : z.map(element, element).max(2);
      const input = (values) =>
        kind === "array"
          ? values
          : kind === "set"
            ? new Set(values)
            : new Map(values.map((value) => [value, value]));
      for (const asyncParse of [false, true]) {
        parsed = 0;
        const result = asyncParse
          ? await schema.safeParseAsync(input(["a", "b", "c"]))
          : schema.safeParse(input(["a", "b", "c"]));
        assert.equal(result.success, false);
        assert.deepEqual(
          result.error.issues.map((issue) => issue.code),
          ["too_big"],
        );
        assert.equal(parsed, 0, "oversized input must not run element validators");
      }
      const allowed = schema.safeParse(input(["a", "b"]));
      assert.equal(allowed.success, true);
      assert.ok(parsed > 0, "valid collections still run element validators");
    });
  }
}
