import { describe, expect, it } from "vitest";
import {
  csrfForSessionToken,
  hashPassword,
  normalizeEmail,
  tokenDigest,
  validatePassword,
  verifyPassword,
} from "../src/index.js";

describe("shared identity primitives", () => {
  it("normalizes email without locale-specific surprises", () => {
    expect(normalizeEmail("  Creator@Example.COM ")).toBe("creator@example.com");
  });

  it("hashes passwords with a random salt and verifies them", () => {
    const first = hashPassword("correct horse battery staple");
    const second = hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(verifyPassword("correct horse battery staple", first)).toBe(true);
    expect(verifyPassword("incorrect horse battery staple", first)).toBe(false);
    expect(verifyPassword("x".repeat(257), first)).toBe(false);
  });

  it("rejects weak passwords and derives stable one-way tokens", () => {
    expect(validatePassword("takeboard123")).toMatch(/常见/);
    expect(validatePassword("short")).toMatch(/12/);
    expect(tokenDigest("secret")).toHaveLength(64);
    expect(csrfForSessionToken("session")).toBe(csrfForSessionToken("session"));
    expect(csrfForSessionToken("session")).not.toBe(csrfForSessionToken("another"));
  });
});
