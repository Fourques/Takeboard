import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function browser(storage = new Map<string, string>(), initialCookie = "") {
  let cookie = initialCookie;
  const root = { dataset: {} as Record<string, string> };
  const events = new EventTarget();
  const doc = {
    documentElement: root,
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value.split(";")[0] ?? "";
    },
  };
  const win = {
    location: { protocol: "http:" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  return { doc, win, storage };
}

describe("theme preferences", () => {
  it("uses soft color for a fresh install and rejects unknown cookie values", async () => {
    browser();
    const theme = await import("./theme-preferences");
    expect(theme.readThemePreference()).toBe("chroma");
    expect(theme.themeFromCookie("takeboard_theme=unexpected")).toBeNull();
    expect(theme.themeFromCookie("other_takeboard_theme=noir")).toBeNull();
  });

  it("preserves all explicit old choices, including noir, and migrates them to a host cookie", async () => {
    for (const selected of ["noir", "light", "chroma"] as const) {
      vi.resetModules();
      const { doc } = browser(new Map([["takeboard.theme", selected]]));
      const theme = await import("./theme-preferences");
      expect(theme.readThemePreference()).toBe(selected);
      theme.rememberTheme(theme.readThemePreference());
      expect(doc.cookie).toBe(`takeboard_theme=${selected}`);
    }
  });

  it("recovers after a port change without localStorage and uses the latest host preference", async () => {
    const { doc } = browser();
    const original = await import("./theme-preferences");
    original.rememberTheme("light");
    vi.resetModules();
    browser(new Map(), doc.cookie);
    const restarted = await import("./theme-preferences");
    expect(restarted.readThemePreference()).toBe("light");
    vi.resetModules();
    browser(new Map([["takeboard.theme", "noir"]]), doc.cookie);
    expect((await import("./theme-preferences")).readThemePreference()).toBe("light");
  });

  it("does not crash or lose the active selection if both storage mechanisms are blocked", async () => {
    const { doc, win } = browser();
    Object.defineProperty(doc, "cookie", {
      get: () => {
        throw new Error("blocked");
      },
      set: () => {
        throw new Error("blocked");
      },
    });
    win.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    win.localStorage.setItem = () => {
      throw new Error("blocked");
    };
    const theme = await import("./theme-preferences");
    expect(theme.readThemePreference()).toBe("chroma");
    expect(() => theme.rememberTheme("noir")).not.toThrow();
    expect(theme.readThemePreference()).toBe("noir");
    expect(doc.documentElement.dataset.theme).toBe("noir");
  });

  it("notifies all mounted switches only on relevant preference changes", async () => {
    const { win } = browser();
    const theme = await import("./theme-preferences");
    const listener = vi.fn();
    const unsubscribe = theme.subscribeToTheme(listener);
    theme.rememberTheme("light");
    expect(listener).toHaveBeenCalledTimes(1);
    win.dispatchEvent(Object.assign(new Event("storage"), { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    theme.rememberTheme("chroma");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
