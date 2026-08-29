import { describe, expect, it } from "vitest";
import { resolveDisplayScale } from "./display-scale";

describe("display scale preference", () => {
  it("starts new browsers with the clearer 112% setting", () => {
    expect(resolveDisplayScale(null)).toBe(1.12);
    expect(resolveDisplayScale("unexpected")).toBe(1.12);
  });

  it("preserves every supported explicit user choice", () => {
    expect(resolveDisplayScale("0.9")).toBe(0.9);
    expect(resolveDisplayScale("1")).toBe(1);
    expect(resolveDisplayScale("1.24")).toBe(1.24);
    expect(resolveDisplayScale("1.4")).toBe(1.4);
  });
});
