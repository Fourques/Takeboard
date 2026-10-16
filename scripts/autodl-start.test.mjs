import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { test } from "node:test";
import {
  cloudEnvironment,
  hasCloudAdministrator,
  start,
  validateCloudDirectories,
} from "../deploy/autodl/start.mjs";

const config = {
  appRoot: "/opt/takeboard/app",
  webRoot: "/opt/takeboard/web",
  comfyRoot: "/opt/takeboard/ComfyUI",
  python: "/opt/takeboard/env/bin/python",
  dataRoot: "/root/autodl-tmp/TakeBoard",
};
for (const [name, path, root] of [
  ["POSIX", posix, "/sandbox"],
  ["Windows", win32, "C:\\sandbox"],
]) {
  test(`${name} paths reject roots and nesting without rejecting independent siblings`, () => {
    const fixture = {
      appRoot: path.join(root, "app"),
      webRoot: path.join(root, "web"),
      comfyRoot: path.join(root, "ComfyUI"),
      python: path.join(root, "env", "python"),
      dataRoot: path.join(root, "data"),
    };
    assert.equal(validateCloudDirectories(fixture, path), fixture.dataRoot);
    assert.equal(
      validateCloudDirectories({ ...fixture, dataRoot: `${fixture.appRoot}-data` }, path),
      `${fixture.appRoot}-data`,
    );
    for (const dataRoot of [
      fixture.appRoot,
      root,
      path.join(fixture.appRoot, "data"),
      path.join(fixture.appRoot, "..cache"),
    ])
      assert.throws(() => validateCloudDirectories({ ...fixture, dataRoot }, path), /相互独立/);
    for (const key of Object.keys(fixture))
      assert.throws(
        () => validateCloudDirectories({ ...fixture, [key]: path.parse(root).root }, path),
        /绝对路径/,
      );
    assert.throws(
      () => validateCloudDirectories({ ...fixture, python: "python" }, path),
      /绝对路径/,
    );
    if (path === win32) {
      assert.equal(
        validateCloudDirectories({ ...fixture, dataRoot: "D:\\projects" }, path),
        "D:\\projects",
      );
      assert.throws(
        () => validateCloudDirectories({ ...fixture, dataRoot: "c:\\SANDBOX\\APP\\data" }, path),
        /相互独立/,
      );
      assert.throws(
        () => validateCloudDirectories({ ...fixture, dataRoot: "\\\\server\\share\\" }, path),
        /绝对路径/,
      );
    }
  });
}
test("cloud starts privately, requires accounts, and does not inherit desktop settings", () => {
  const env = cloudEnvironment(config, {
    PATH: "/bin",
    HTTPS_PROXY: "http://proxy:8080",
    NO_PROXY: "example.org",
    TAKEBOARD_DESKTOP: "1",
    TAKEBOARD_AUTH_MODE: "off",
    COMFY_URL: "http://other:9999",
    COMFY_START_SERVICE: "external.service",
    TAKEBOARD_BACKUP_DESTINATION: "/private",
  });
  assert.equal(env.TAKEBOARD_HOST, "127.0.0.1");
  assert.equal(env.TAKEBOARD_AUTH_MODE, "required");
  assert.equal(env.COMFY_URL, "http://127.0.0.1:8188");
  assert.equal(env.COMFY_START_PID_FILE, join(env.COMFY_START_CWD, ".takeboard-comfy.pid"));
  assert.equal(env.TAKEBOARD_DESKTOP, undefined);
  assert.equal(env.COMFY_START_SERVICE, undefined);
  assert.equal(env.TAKEBOARD_BACKUP_DESTINATION, undefined);
  assert.equal(env.HTTPS_PROXY, "http://proxy:8080");
  assert.equal(env.NO_PROXY, "example.org,127.0.0.1,localhost,::1");
  const args = JSON.parse(env.COMFY_START_ARGS_JSON);
  assert.equal(args[args.indexOf("--listen") + 1], "127.0.0.1");
  assert.ok(args.includes("--disable-all-custom-nodes"));
});
test("HTTPS requires an exact root origin, secure cookies, and authenticated mode", () => {
  const env = cloudEnvironment(
    { ...config, mode: "https", publicUrl: "https://gpu.example.org:8443/" },
    {},
  );
  assert.equal(env.TAKEBOARD_PORT, "6006");
  assert.equal(env.TAKEBOARD_ALLOWED_HOSTS, "gpu.example.org:8443");
  assert.equal(env.TAKEBOARD_ALLOWED_ORIGINS, "https://gpu.example.org:8443");
  assert.equal(env.TAKEBOARD_SECURE_COOKIES, "1");
  for (const publicUrl of [
    undefined,
    "http://gpu.example.org",
    "https://user:password@gpu.example.org",
    "https://gpu.example.org/path",
    "https://gpu.example.org/?token=private",
  ])
    assert.throws(() => cloudEnvironment({ ...config, mode: "https", publicUrl }, {}));
});
test("reject unknown modes, invalid ports, overlapping data and relative paths", () => {
  for (const patch of [
    { mode: "public" },
    { port: 8188 },
    { port: 0 },
    { port: 1.5 },
    { dataRoot: "/" },
    { dataRoot: "/opt/takeboard" },
    { dataRoot: "/opt/takeboard/app/data" },
    { python: "python" },
  ])
    assert.throws(() => cloudEnvironment({ ...config, ...patch }, {}));
});
test("missing identity is not initialized or exposed as a public administrator", () => {
  assert.equal(hasCloudAdministrator("/missing/app", "/missing/auth.db"), false);
});
test("incomplete installs fail before starting or creating data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "takeboard-autodl-test-"));
  try {
    const file = join(dir, "cloud.json");
    await writeFile(file, JSON.stringify({ ...config, appRoot: join(dir, "missing-app") }));
    await assert.rejects(start(file), /安装不完整/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
