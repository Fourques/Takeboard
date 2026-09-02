import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth-service.js";
import { buildRemoteAccessStatus } from "../src/remote-access-routes.js";

const services: AuthService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function configuredAuth() {
  const auth = new AuthService(":memory:", "required");
  auth.createBootstrap(
    {
      name: "Owner",
      email: "owner@example.com",
      password: "correct horse battery staple",
    },
    [],
  );
  services.push(auth);
  return auth;
}

function request(protocol = "http", host = "127.0.0.1:48120") {
  return { protocol, headers: { host } } as FastifyRequest;
}

describe("remote access readiness", () => {
  it("reports loopback plus SSH as the safe default without pretending a portal exists", () => {
    const status = buildRemoteAccessStatus(request(), {
      auth: configuredAuth(),
      instanceId: "018f25f2-43b2-7d4b-b87c-61bc87f0ee58",
      bindHost: "127.0.0.1",
      port: 48_121,
    });

    expect(status.currentAccess).toMatchObject({
      kind: "local_or_ssh",
      protection: "loopback",
    });
    expect(status.ssh).toMatchObject({ state: "ready", remotePort: 48_121 });
    expect(status.ssh.command).toContain("-L 48230:127.0.0.1:48121");
    expect(status.https.state).toBe("not_configured");
    expect(status.managedPortal.state).toBe("not_available");
  });

  it("requires secure cookies and exact host/origin allowlists for a team HTTPS URL", () => {
    const auth = configuredAuth();
    const unsafe = buildRemoteAccessStatus(request("https", "studio.example.com"), {
      auth,
      instanceId: "018f25f2-43b2-7d4b-b87c-61bc87f0ee58",
      publicUrl: "https://studio.example.com",
      secureCookies: false,
      allowedHosts: ["studio.example.com"],
      allowedOrigins: ["https://studio.example.com"],
    });
    expect(unsafe.https.state).toBe("blocked");
    expect(unsafe.checks).toContainEqual(
      expect.objectContaining({ id: "cookies", status: "blocked" }),
    );

    const ready = buildRemoteAccessStatus(request("https", "studio.example.com"), {
      auth,
      instanceId: "018f25f2-43b2-7d4b-b87c-61bc87f0ee58",
      publicUrl: "https://studio.example.com",
      secureCookies: true,
      allowedHosts: ["studio.example.com"],
      allowedOrigins: ["https://studio.example.com"],
    });
    expect(ready.https.state).toBe("ready");
    expect(ready.checks.filter((check) => check.status === "blocked")).toEqual([]);
  });

  it("blocks malformed or non-HTTPS public entry points", () => {
    const status = buildRemoteAccessStatus(request(), {
      auth: configuredAuth(),
      publicUrl: "http://studio.example.com?token=secret",
    });
    expect(status.https).toMatchObject({ state: "blocked", publicUrl: null });
    expect(status.https.detail).toContain("HTTPS");
  });
});
