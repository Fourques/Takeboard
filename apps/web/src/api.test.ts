import { describe, expect, it } from "vitest";
import { isTimeoutFailure } from "./api";

describe("API transport failures", () => {
  it("recognizes browser abort and timeout errors as retryable timeouts", () => {
    expect(isTimeoutFailure(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isTimeoutFailure(new DOMException("timed out", "TimeoutError"))).toBe(true);
  });

  it("does not label an ordinary network error as a timeout", () => {
    expect(isTimeoutFailure(new TypeError("Failed to fetch"))).toBe(false);
    expect(isTimeoutFailure("offline")).toBe(false);
  });
});
