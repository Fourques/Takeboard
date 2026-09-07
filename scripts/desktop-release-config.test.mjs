import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DESKTOP_ICONS, validateDesktopReleaseConfig } from "./desktop-release-config.mjs";

test("keeps application version and native bundle icons aligned", () => {
  const config = {
    version: "0.2.0-beta.1",
    bundle: {
      icon: DESKTOP_ICONS,
      resources: { "resources/TakeBoard/": "TakeBoard/" },
    },
  };
  assert.deepEqual(validateDesktopReleaseConfig("0.2.0-beta.1", config), {
    icons: DESKTOP_ICONS,
  });
  assert.throws(() => validateDesktopReleaseConfig("0.2.0-beta.2", config), /版本 .* 不一致/);
  assert.throws(
    () =>
      validateDesktopReleaseConfig("0.2.0-beta.1", {
        ...config,
        bundle: { ...config.bundle, icon: ["icons/icon.ico"] },
      }),
    /缺少图标声明/,
  );
  assert.throws(
    () =>
      validateDesktopReleaseConfig("0.2.0-beta.1", {
        ...config,
        bundle: { ...config.bundle, resources: ["resources/TakeBoard"] },
      }),
    /运行资源必须映射/,
  );
});

test("production manifest maps the embedded runtime to the native launcher's resource path", async () => {
  const config = JSON.parse(
    await readFile(new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const application = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  validateDesktopReleaseConfig(application.version, config);
});
