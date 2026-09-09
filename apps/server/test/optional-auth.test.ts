import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  cleanup.length = 0;
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "takeboard-optional-"));
  const app = buildApp({
    projectsRoot: join(root, "projects"),
    webRoot: null,
    auth: { mode: "optional", databasePath: join(root, "auth.db") },
  });
  cleanup.push(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  return app;
}
function session(response: { headers: Record<string, unknown>; json(): { csrfToken: string } }) {
  return {
    cookie: String(response.headers["set-cookie"]).split(";", 1)[0] ?? "",
    "x-takeboard-csrf": response.json().csrfToken,
  };
}

describe("optional accounts with device-scoped project authorization", () => {
  it("creates device projects without signup, enforces CSRF, and keeps account projects private", async () => {
    const app = await setup();
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json()).toMatchObject({
      access: "local",
      configured: false,
      user: null,
      localAvailable: true,
    });
    const local = session(status);
    const denied = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: local.cookie },
      payload: { title: "Device project" },
    });
    expect(denied.statusCode).toBe(403);
    const deviceProject = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: local,
      payload: { title: "Device project" },
    });
    expect(deviceProject.statusCode, deviceProject.body).toBe(201);
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Owner",
        email: "owner@example.com",
        password: "correct horse battery staple",
      },
    });
    expect(bootstrap.statusCode, bootstrap.body).toBe(201);
    const account = session(bootstrap);
    const privateProject = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: account,
      payload: { title: "Account private project" },
    });
    expect(privateProject.statusCode).toBe(201);
    const key = privateProject.json().key;
    expect(typeof key).toBe("string");
    for (const url of [`/api/projects/${key}`, `/api/projects/${key}/export`]) {
      const response = await app.inject({ method: "GET", url, headers: local });
      expect(response.statusCode, response.body).toBe(403);
    }
    const list = await app.inject({ method: "GET", url: "/api/projects", headers: local });
    expect(list.json().projects.map((project: { title: string }) => project.title)).toEqual([
      "Device project",
    ]);
    // Clearing browser storage must not orphan device projects or expose accounts.
    const restored = session(await app.inject({ method: "GET", url: "/api/auth/status" }));
    const restoredList = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: restored,
    });
    expect(restoredList.json().projects.map((project: { title: string }) => project.title)).toEqual(
      ["Device project"],
    );
    const users = await app.inject({ method: "GET", url: "/api/admin/users", headers: account });
    expect(users.json().users).toHaveLength(1);
    for (const url of ["/api/admin/users", "/api/auth/sessions", "/api/portal/status"]) {
      expect((await app.inject({ method: "GET", url, headers: local })).statusCode).toBe(401);
    }
  });

  it("does not grant device access through a proxy, remote peer, cross-site request, or invalid session", async () => {
    const app = await setup();
    const local = session(await app.inject({ method: "GET", url: "/api/auth/status" }));
    for (const headers of [
      { "x-forwarded-for": "203.0.113.1" },
      { forwarded: "for=203.0.113.1" },
    ]) {
      const status = await app.inject({
        method: "GET",
        url: "/api/auth/status",
        headers: { ...headers, cookie: local.cookie },
      });
      expect(status.json()).toMatchObject({
        access: "none",
        localAvailable: false,
        csrfToken: null,
      });
      expect(
        (await app.inject({ method: "POST", url: "/api/auth/local", headers })).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/projects",
            headers: { ...headers, cookie: local.cookie },
          })
        ).statusCode,
      ).toBe(401);
    }
    const remote = await app.inject({
      method: "GET",
      url: "/api/auth/status",
      remoteAddress: "203.0.113.1",
    });
    expect(remote.json().localAvailable).toBe(false);
    const crossSite = await app.inject({
      method: "POST",
      url: "/api/auth/local",
      headers: { origin: "https://evil.example" },
    });
    expect(crossSite.statusCode).toBe(403);
    const invalid = await app.inject({
      method: "GET",
      url: "/api/auth/status",
      headers: { cookie: local.cookie.replace(/=.*/, "=expired") },
    });
    expect(invalid.json()).toMatchObject({ access: "none", csrfToken: null });
    const expiredCookie = local.cookie.replace(/=.*/, "=expired");
    const rejected = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: expiredCookie },
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.headers["set-cookie"]).toBeUndefined();
    const subsequentStatus = await app.inject({
      method: "GET",
      url: "/api/auth/status",
      headers: { cookie: expiredCookie },
    });
    expect(subsequentStatus.json()).toMatchObject({ access: "none", csrfToken: null });
    const explicitLocal = await app.inject({
      method: "POST",
      url: "/api/auth/local",
      headers: { cookie: expiredCookie },
    });
    expect(explicitLocal.json()).toMatchObject({ access: "local" });
  });
});
