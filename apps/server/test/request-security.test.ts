import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { assertSafeBindHost, isLoopbackHostname } from "../src/request-security.js";

describe("TakeBoard local request boundary", () => {
  it("accepts loopback bind targets and rejects accidental public binding", () => {
    expect(["127.0.0.1", "localhost", "::1", "[::1]"].every(isLoopbackHostname)).toBe(true);
    expect(() => assertSafeBindHost("127.0.0.1")).not.toThrow();
    expect(() => assertSafeBindHost("0.0.0.0")).toThrow(/拒绝监听非回环地址/);
    expect(() => assertSafeBindHost("0.0.0.0", true, "off")).toThrow(/必须同时设置/);
    expect(() => assertSafeBindHost("0.0.0.0", true, "required")).not.toThrow();
  });

  it("blocks DNS-rebinding hosts and cross-site browser requests", async () => {
    const app = buildApp({ webRoot: null });
    const hostileHost = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "attacker.example" },
    });
    expect(hostileHost.statusCode, hostileHost.body).toBe(421);

    const hostileRead = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "127.0.0.1:48120", origin: "https://attacker.example" },
    });
    expect(hostileRead.statusCode, hostileRead.body).toBe(403);

    const hostileWrite = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { host: "127.0.0.1:48120", origin: "https://attacker.example" },
      payload: { title: "不应创建" },
    });
    expect(hostileWrite.statusCode, hostileWrite.body).toBe(403);
    await app.close();
  });

  it("keeps localhost, SSH-forwarded ports and explicit authenticated proxy hosts usable", async () => {
    const app = buildApp({
      webRoot: null,
      requestSecurity: {
        allowedHosts: ["studio.example.com"],
        allowedOrigins: ["https://studio.example.com"],
      },
    });
    for (const headers of [
      { host: "localhost:48120", origin: "http://localhost:48120" },
      { host: "127.0.0.1:48230", origin: "http://127.0.0.1:48230" },
      { host: "studio.example.com", origin: "https://studio.example.com" },
    ]) {
      const response = await app.inject({ method: "GET", url: "/api/health", headers });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers).toMatchObject({
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "cross-origin-resource-policy": "same-origin",
      });
      expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    }
    await app.close();
  });
});
