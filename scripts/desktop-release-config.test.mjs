import assert from "node:assert/strict";
import test from "node:test";
import {
  DESKTOP_ICONS,
  validateDesktopReleaseConfig,
  WINDOWS_WIX_UPGRADE_CODE,
  windowsInstallerVersion,
} from "./desktop-release-config.mjs";

test("maps release channels to monotonically ordered MSI versions", () => {
  assert.equal(windowsInstallerVersion("0.2.0-alpha.1"), "0.2.0.1");
  assert.equal(windowsInstallerVersion("0.2.0-beta.1"), "0.2.0.20001");
  assert.equal(windowsInstallerVersion("0.2.0-rc.1"), "0.2.0.40001");
  assert.equal(windowsInstallerVersion("0.2.0"), "0.2.0.65535");
});

test("rejects unsupported or overflowing desktop versions", () => {
  assert.throws(() => windowsInstallerVersion("0.2.0-preview.1"), /不符合/);
  assert.throws(() => windowsInstallerVersion("256.0.0"), /超出/);
  assert.throws(() => windowsInstallerVersion("0.2.0-beta.20000"), /1–19999/);
});

test("keeps app identity, icons and the Windows upgrade identity aligned", () => {
  const config = {
    version: "0.2.0-beta.1",
    bundle: {
      icon: DESKTOP_ICONS,
      windows: {
        wix: {
          version: "0.2.0.20001",
          upgradeCode: WINDOWS_WIX_UPGRADE_CODE,
        },
      },
    },
  };
  assert.deepEqual(validateDesktopReleaseConfig("0.2.0-beta.1", config), {
    icons: DESKTOP_ICONS,
    wixVersion: "0.2.0.20001",
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
});
