import { describe, expect, it } from "vitest";
import { parseConnectionDisplay } from "./device-context";

describe("device display metadata", () => {
  it("preserves the chosen remote name and address without importing permissions", () => {
    expect(
      parseConnectionDisplay(
        JSON.stringify({ kind: "ssh", address: "edit-host", name: "剪辑主机", admin: true }),
      ),
    ).toEqual({ kind: "ssh", address: "edit-host", name: "剪辑主机", instanceId: undefined });
  });
  it("rejects malformed and oversized values", () => {
    for (const value of [
      null,
      "bad",
      "{}",
      JSON.stringify({ kind: "ssh", address: "x\n" }),
      JSON.stringify({ kind: "ssh", address: "x".repeat(3000) }),
      JSON.stringify({ kind: "fake", address: "x" }),
    ])
      expect(parseConnectionDisplay(value)).toBeNull();
  });
});
