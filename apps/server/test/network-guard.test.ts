import { describe, expect, it, vi } from "vitest";
import { loopbackOnlyFetch } from "./network-guard.js";

describe("server test outbound guard", () => {
  it("rejects unmocked non-loopback traffic without calling the transport", async () => {
    const transport = vi.fn<typeof fetch>();
    const guarded = loopbackOnlyFetch(transport);
    for (const input of [
      "https://comfy.test/prompt",
      new URL("https://example.com/"),
      new Request("https://comfy.test/free", { method: "POST", body: "synthetic" }),
      "http://127.0.0.1.example.com/",
    ]) {
      await expect(guarded(input)).rejects.toThrow("block unmocked external fetch");
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("preserves loopback request and response semantics", async () => {
    const response = new Response("local fixture");
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
    const guarded = loopbackOnlyFetch(transport);
    for (const input of [
      "http://localhost:1234/",
      "http://127.0.0.1:1234/",
      "http://[::1]:1234/",
    ]) {
      const init = { method: "POST", body: "synthetic fixture" };
      expect(await guarded(input, init)).toBe(response);
      expect(transport).toHaveBeenLastCalledWith(input, init);
    }
  });

  it("installs the guard as the default fetch for server tests", async () => {
    await expect(fetch("https://comfy.test/")).rejects.toThrow("block unmocked external fetch");
  });
});
