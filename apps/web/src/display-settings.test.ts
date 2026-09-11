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
  it("supports intermediate percentages, rounds sub-percent values and rejects invalid preferences", () => {
    expect(resolveDisplayScale("1.17")).toBe(1.17);
    expect(resolveDisplayScale("1.235")).toBe(1.24);
    for (const invalid of ["", "0", "Infinity", "NaN", "-1", "0.89", "1.41"])
      expect(resolveDisplayScale(invalid)).toBe(1.12);
  });
});
