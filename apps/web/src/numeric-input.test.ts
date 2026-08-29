import { describe, expect, it } from "vitest";
import { normalizeNumber } from "./numeric-input";

describe("numeric input normalization", () => {
  it("clamps only when the user commits instead of injecting a leading zero", () => {
    expect(normalizeNumber(32, 256, 2048, 32)).toBe(256);
    expect(normalizeNumber(832, 256, 2048, 32)).toBe(832);
  });

  it("snaps decimal duration without floating-point tails", () => {
    expect(normalizeNumber(3.49, 1, 15, 0.5)).toBe(3.5);
    expect(normalizeNumber(15.8, 1, 15, 0.5)).toBe(15);
  });

  it("preserves an unrestricted valid value", () => {
    expect(normalizeNumber(42)).toBe(42);
  });
});
