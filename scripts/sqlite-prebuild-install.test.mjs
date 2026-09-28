import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const requireFromServer = createRequire(new URL("../apps/server/package.json", import.meta.url));
const install = requireFromServer("better-sqlite3/package.json").scripts.install;
assert.match(install, /^node -e ".*"$/);
const source = install.slice('node -e "'.length, -1);

function run(prebuild, loadError) {
  const calls = [];
  const require = (name) => {
    if (name === "./lib/binding")
      return {
        getPrebuildPath: () => prebuild,
        getBinding: () => {
          calls.push("load");
          if (loadError) throw loadError;
        },
      };
    assert.equal(name, "child_process");
    return {
      execSync: (command, options) => {
        assert.equal(command, "node-gyp rebuild");
        assert.equal(options.stdio, "inherit");
        calls.push("compile");
      },
    };
  };
  runInNewContext(source, { require });
  return calls;
}

test("host prebuild is actually loaded without requiring a compiler", () => {
  assert.deepEqual(run("prebuilds/win32-x64.node"), ["load"]);
});
test("unsupported targets retain the upstream source-build fallback", () => {
  assert.deepEqual(run(null), ["compile"]);
});
test("an unusable prebuild fails installation instead of hiding the error", () => {
  const failure = new Error("native load failed");
  assert.throws(
    () => run("prebuilds/win32-x64.node", failure),
    (error) => error === failure,
  );
});
