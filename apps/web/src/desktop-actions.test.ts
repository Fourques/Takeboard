import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopActionUrl, requestDesktopAction } from "./desktop-actions";

afterEach(() => vi.unstubAllGlobals());

describe("desktop navigation bridge", () => {
  it("hands the exact ComfyUI URL to the native bridge and waits for acknowledgement", async () => {
    const events = new EventTarget();
    let destination: URL | null = null;
    vi.stubGlobal("document", { documentElement: { dataset: { theme: "chroma" } } });
    vi.stubGlobal("window", {
      __takeboardNativeActions: 2,
      setTimeout,
      clearTimeout,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      location: {
        set href(value: string) {
          destination = new URL(value);
          const actionId = destination.searchParams.get("actionId");
          queueMicrotask(() =>
            events.dispatchEvent(
              new CustomEvent("takeboard:desktop-action", { detail: { actionId } }),
            ),
          );
        },
      },
    });
    const url = "http://127.0.0.1:48288/?takeboard_workflow=TakeBoard%2Fmy%20workflow.json";
    await requestDesktopAction("open-external", { url });
    expect(destination).not.toBeNull();
    expect((destination as unknown as URL).pathname).toBe("/open-external");
    expect((destination as unknown as URL).searchParams.get("url")).toBe(url);
  });
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
