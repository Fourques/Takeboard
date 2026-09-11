import { afterEach, describe, expect, it, vi } from "vitest";
import { crashReportText } from "./app-error-boundary";

afterEach(() => vi.unstubAllGlobals());
describe("local crash reports", () => {
  it("retains diagnostic stacks without reading project or credential storage", () => {
    vi.stubGlobal("window", { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 2 });
    vi.stubGlobal("navigator", { userAgent: "test", language: "zh-CN", onLine: true });
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("must not read storage");
      },
    });
    const error = new Error("Maximum update depth exceeded");
    error.stack = "x".repeat(20_000);
    const report = JSON.parse(
      crashReportText({ error, componentStack: "ShotNode", incidentId: "incident-test" }),
    );
    expect(report.incidentId).toBe("incident-test");
    expect(report.error.componentStack).toBe("ShotNode");
    expect(report.error.stack.length).toBe(8000);
    expect(report.client.viewport).toEqual({ width: 1200, height: 800 });
    expect(report).not.toHaveProperty("project");
    expect(crashReportText({ error: null, componentStack: null, incidentId: null })).toBe("");
  });
});
