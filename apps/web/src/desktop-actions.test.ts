import { describe, expect, it } from "vitest";
import { desktopActionUrl } from "./desktop-actions";

describe("desktop navigation bridge", () => {
  it("encodes paths as data and uses the reserved origin only for capable installers", () => {
    const path = "/Users/creator/视频 & shots/#1";
    const modern = new URL(desktopActionUrl("reveal-folder", { path, actionId: "test" }, true));
    expect(modern.origin).toBe("https://takeboard-desktop.invalid");
    expect(modern.pathname).toBe("/reveal-folder");
    expect(modern.searchParams.get("path")).toBe(path);
    expect(modern.hash).toBe("");
    const legacy = new URL(desktopActionUrl("connections", { actionId: "test" }, false));
    expect(legacy.protocol).toBe("takeboard-desktop:");
    expect(legacy.hostname).toBe("connections");
  });
});
