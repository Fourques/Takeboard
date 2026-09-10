import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compareVersions,
  fetchReleases,
  repository,
  selectRelease,
  updateCommand,
} from "./desktop-updates.mjs";

const context = {
  currentVersion: "0.2.0-beta.2",
  channel: "beta",
  platform: "darwin",
  arch: "arm64",
};
function release(tag, platform = "macos", arch = "arm64", ext = "dmg") {
  const name = `TakeBoard-${tag}-${platform}-${arch}.${ext}`;
  return {
    tag_name: tag,
    prerelease: tag.includes("-"),
    draft: false,
    body: "<script>Never render HTML</script>",
    assets: [
      {
        name,
        state: "uploaded",
        size: 512,
        browser_download_url: `${repository}/releases/download/${tag}/${name}`,
      },
    ],
  };
}
test("semantic ordering handles prereleases, numeric identifiers, stable and build metadata", () => {
  for (const [a, b] of [
    ["0.2.0-beta.10", "0.2.0-beta.2"],
    ["0.2.0", "0.2.0-rc.9"],
    ["1.10.0", "1.9.99"],
    ["1.0.0-a.b", "1.0.0-a.3"],
  ])
    assert.equal(compareVersions(a, b), 1);
  assert.equal(compareVersions("v1.0.0+build", "1.0.0"), 0);
  assert.throws(() => compareVersions("1.0.0-beta.01", "1.0.0"));
});
test("separates stable/beta and filters drafts without relying on GitHub latest", () => {
  const releases = [
    release("v0.2.0-beta.10"),
    release("v0.1.0"),
    { ...release("v9.0.0"), draft: true },
  ];
  assert.equal(selectRelease(releases, context).release.version, "0.2.0-beta.10");
  assert.equal(selectRelease(releases, { ...context, channel: "stable" }).status, "up_to_date");
  assert.equal(
    selectRelease([releases[0]], { ...context, channel: "stable" }).status,
    "no_release",
  );
});
test("matches all six native platform installers, rejects wrong CPU and hostile download URLs", () => {
  for (const [platform, os, ext] of [
    ["darwin", "macos", "dmg"],
    ["win32", "windows", "exe"],
    ["linux", "linux", "deb"],
  ]) {
    for (const arch of ["x64", "arm64"]) {
      const item = release("v0.3.0", os, arch, ext);
      assert.equal(selectRelease([item], { ...context, platform, arch }).status, "update");
      assert.equal(
        selectRelease([item], { ...context, platform, arch: arch === "arm64" ? "x64" : "arm64" })
          .status,
        "no_installer",
      );
      for (const url of [
        "https://evil.test/app.dmg",
        "file:///etc/passwd",
        `${item.assets[0].browser_download_url}?redirect=evil`,
      ]) {
        assert.equal(
          selectRelease([{ ...item, assets: [{ ...item.assets[0], browser_download_url: url }] }], {
            ...context,
            platform,
            arch,
          }).status,
          "no_installer",
        );
      }
    }
  }
});
test("preferences survive process restarts, disabled automatic checks perform no request, manual checks override skip", async () => {
  const root = await mkdtemp(join(tmpdir(), "takeboard-updates-"));
  try {
    const file = join(root, "prefs.json");
    let requests = 0;
    const args = {
      ...context,
      file,
      fetchImpl: async () => {
        requests++;
        return new Response(JSON.stringify([release("v0.3.0")]));
      },
    };
    assert.equal((await updateCommand({ ...args, operation: "status" })).channel, "beta");
    await updateCommand({
      ...args,
      operation: "save",
      input: { channel: "beta", autoCheck: false, skippedVersion: "0.3.0" },
    });
    assert.equal((await updateCommand({ ...args, operation: "automatic" })).status, "idle");
    assert.equal(requests, 0);
    assert.equal((await updateCommand({ ...args, operation: "check" })).status, "update");
    await updateCommand({
      ...args,
      operation: "save",
      input: { channel: "beta", autoCheck: true, skippedVersion: "0.3.0" },
    });
    assert.equal((await updateCommand({ ...args, operation: "automatic" })).status, "skipped");
    const saved = await readFile(file, "utf8");
    await assert.rejects(
      updateCommand({
        ...args,
        operation: "save",
        input: { channel: "evil", autoCheck: true, skippedVersion: null },
      }),
    );
    assert.equal(await readFile(file, "utf8"), saved);
    const failure = await updateCommand({
      ...args,
      operation: "check",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(failure.status, "error");
    assert.equal(failure.release, null);
    await writeFile(file, "{bad");
    await assert.rejects(updateCommand({ ...args, operation: "status" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("bounded GitHub fetch rejects rate limits, malformed data and oversized payloads", async () => {
  await assert.rejects(
    fetchReleases(async () => new Response("", { status: 429 })),
    /频率/,
  );
  await assert.rejects(fetchReleases(async () => new Response("{")));
  await assert.rejects(
    fetchReleases(async () => new Response(" ".repeat(4 * 1024 * 1024 + 1))),
    /过大/,
  );
});
