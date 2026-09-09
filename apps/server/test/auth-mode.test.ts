import { afterEach, expect, it, vi } from "vitest";
import { authModeFromEnvironment } from "../src/app.js";

afterEach(() => vi.unstubAllEnvs());

it("defaults to optional locally but never silently downgrades a mistyped authentication policy", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TAKEBOARD_AUTH_MODE", undefined);
  expect(authModeFromEnvironment()).toBe("optional");
  for (const mode of ["optional", "required", "trusted_local", "off"] as const) {
    vi.stubEnv("TAKEBOARD_AUTH_MODE", mode);
    expect(authModeFromEnvironment()).toBe(mode);
  }
  vi.stubEnv("TAKEBOARD_AUTH_MODE", "requried");
  expect(authModeFromEnvironment).toThrow("TAKEBOARD_AUTH_MODE 无效");
});
