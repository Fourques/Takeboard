import { describe, expect, it } from "vitest";
import {
  connectorToPortalSchema,
  portalProtocolVersion,
  portalToConnectorSchema,
  relayHeaders,
} from "../src/index.js";

describe("portal relay protocol", () => {
  it("accepts bounded protocol frames", () => {
    expect(
      portalToConnectorSchema.parse({
        type: "request_start",
        id: "request-1",
        method: "POST",
        path: "/api/projects/demo/runs",
        headers: { "content-type": "application/json" },
        portalSubject: "user-1",
        portalSessionId: "session-1",
      }).type,
    ).toBe("request_start");
    expect(
      connectorToPortalSchema.parse({
        type: "hello",
        protocol: portalProtocolVersion,
        instanceId: "instance-1",
        instanceName: "Workstation",
        applicationVersion: "0.2.0-beta.1",
      }).type,
    ).toBe("hello");
  });

  it("rejects oversized chunks and unsupported methods", () => {
    expect(() =>
      portalToConnectorSchema.parse({
        type: "request_chunk",
        id: "request-1",
        sequence: 0,
        data: "a".repeat(300_000),
      }),
    ).toThrow();
    expect(() =>
      portalToConnectorSchema.parse({
        type: "request_chunk",
        id: "request-1",
        sequence: 0,
        data: "this is not base64",
      }),
    ).toThrow();
    expect(() =>
      portalToConnectorSchema.parse({
        type: "request_start",
        id: "request-1",
        method: "CONNECT",
        path: "/",
        headers: {},
        portalSubject: "user-1",
        portalSessionId: "session-1",
      }),
    ).toThrow();
    expect(() =>
      portalToConnectorSchema.parse({
        type: "request_start",
        id: "request-1",
        method: "GET",
        path: "//attacker.example/private",
        headers: {},
        portalSubject: "user-1",
        portalSessionId: "session-1",
      }),
    ).toThrow();
    expect(() =>
      portalToConnectorSchema.parse({
        type: "request_start",
        id: "request-1",
        method: "GET",
        path: "/\\attacker.example/private",
        headers: {},
        portalSubject: "user-1",
        portalSessionId: "session-1",
      }),
    ).toThrow();
  });

  it("strips credentials and hop-by-hop headers at the trust boundary", () => {
    expect(
      relayHeaders(
        [
          ["Host", "device.portal.example"],
          ["Cookie", "portal=secret"],
          ["Authorization", "Bearer secret"],
          ["Connection", "keep-alive"],
          ["Range", "bytes=0-100"],
        ],
        "request",
      ),
    ).toEqual({ range: "bytes=0-100" });
    expect(relayHeaders([["Set-Cookie", "local=secret"]], "response")).toEqual({});
  });
});
