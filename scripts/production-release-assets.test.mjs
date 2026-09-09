import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/production-release.yml", import.meta.url),
  "utf8",
);
const publish = workflow
  .split("      - name: Create or update GitHub release\n")[1]
  .split("        run: |\n")[1]
  .split("\n")
  .map((line) => line.replace(/^ {10}/, ""))
  .join("\n");

test("public release keeps integrity checks but excludes checksum and demo attachments", () => {
  assert.match(publish, /sha256sum --check/);
  assert.match(publish, /gh release upload "\$RELEASE_TAG" "\$\{installers\[@\]\}"/);
  assert.doesNotMatch(publish, /--clobber/);
  assert.match(workflow, /bundle\/\*\*\/\*\.sha256/);
});

for (const scenario of ["valid", "corrupt", "missing-checksum", "empty"]) {
  test(`release publication: ${scenario}`, { skip: process.platform !== "linux" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-publish-test-"));
    try {
      const bin = join(root, "bin");
      const directory = join(root, "release", "nested folder");
      await mkdir(bin);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(bin, "gh"),
        '#!/bin/bash\nprintf "%s\\n" "$@" >> "$TAKEBOARD_TEST_LOG"\n',
        { mode: 0o755 },
      );
      await writeFile(join(directory, "demo.png"), "not an installer");
      if (scenario !== "empty") {
        for (const name of ["TakeBoard Mac.dmg", "TakeBoard Windows.exe"]) {
          await writeFile(join(directory, name), "installer fixture");
          if (scenario !== "missing-checksum") {
            const digest = createHash("sha256")
              .update(scenario === "corrupt" ? "different bytes" : "installer fixture")
              .digest("hex");
            await writeFile(join(directory, `${name}.sha256`), `${digest}  ${name}\n`);
          }
        }
      }
      const log = join(root, "calls.log");
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", publish], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          RELEASE_TAG: "v0.2.0-test",
          TAKEBOARD_TEST_LOG: log,
        },
      });
      if (scenario === "valid") {
        assert.equal(result.status, 0, result.stderr);
        const calls = await readFile(log, "utf8");
        assert.match(calls, /release\nupload\nv0.2.0-test\n/);
        assert.match(calls, /release\/nested folder\/TakeBoard Mac.dmg/);
        assert.match(calls, /release\/nested folder\/TakeBoard Windows.exe/);
        assert.doesNotMatch(calls, /sha256|demo.png|clobber/);
      } else {
        assert.notEqual(result.status, 0);
        await assert.rejects(readFile(log), { code: "ENOENT" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
