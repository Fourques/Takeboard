import assert from "node:assert/strict";
import test from "node:test";
import { DESKTOP_ICONS, validateDesktopReleaseConfig } from "./desktop-release-config.mjs";

test("keeps application version and native bundle icons aligned", () => {
  const config = {
    version: "0.2.0-beta.1",
    bundle: {
      icon: DESKTOP_ICONS,
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
});
