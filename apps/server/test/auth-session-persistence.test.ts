import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth-service.js";

const day = 86_400_000;
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

describe("persistent login", () => {
  it("keeps localhost instances signed in independently and migrates legacy cookies without reviving them on logout", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-session-isolation-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const apps = ["first", "second"].map((name) =>
      buildApp({
        projectsRoot: join(root, name, "projects"),
        webRoot: null,
        auth: { mode: "required", databasePath: join(root, name, "auth.db") },
      }),
    );
    for (const app of apps) cleanups.push(() => app.close());
    const credentials = {
      name: "Owner",
      email: "owner@example.com",
      password: "correct horse battery staple",
      remember: true,
    };
    const logins = await Promise.all(
      apps.map((app) =>
        app.inject({ method: "POST", url: "/api/auth/bootstrap", payload: credentials }),
      ),
    );
    const cookies = logins.map((login) => String(login.headers["set-cookie"]).split(";", 1)[0]);
    expect(cookies[0]?.split("=", 1)[0]).not.toBe(cookies[1]?.split("=", 1)[0]);
    for (const app of apps) {
      const status = await app.inject({
        method: "GET",
        url: "/api/auth/status",
        headers: { cookie: cookies.join("; ") },
      });
      expect(status.json().user.email).toBe(credentials.email);
    }
    const first = apps[0];
    if (!first || !cookies[0]) throw new Error("Missing fixture");
    const legacyCookie = cookies[0].replace(/^[^=]+=/, "takeboard_session=");
    const old = await first.inject({
      method: "GET",
      url: "/api/auth/status",
      headers: { cookie: legacyCookie },
    });
    expect(old.json().user.email).toBe(credentials.email);
    const login = await first.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: credentials,
      headers: { cookie: legacyCookie },
    });
    const updatedCookie = String(login.headers["set-cookie"]).split(";", 1)[0];
    const logout = await first.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: `${updatedCookie}; ${legacyCookie}`,
        "x-takeboard-csrf": login.json().csrfToken,
      },
    });
    expect(logout.statusCode).toBe(200);
    const oldAfterLogout = await first.inject({
      method: "GET",
      url: "/api/auth/status",
      headers: { cookie: legacyCookie },
    });
    expect(oldAfterLogout.json().user).toBeNull();
    const other = await apps[1]?.inject({
      method: "GET",
      url: "/api/auth/status",
      headers: { cookie: cookies.join("; ") },
    });
    expect(other?.json().user.email).toBe(credentials.email);
  });

  it("survives a database reopen, refreshes idle expiry, bounds the lifetime and permits revocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-session-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "auth.db");
    let auth = new AuthService(path, "required");
    cleanups.push(() => auth.close());
    const user = auth.createBootstrap(
      { name: "Owner", email: "owner@example.com", password: "correct horse battery staple" },
      [],
    );
    const started = Date.now();
    const time = vi.spyOn(Date, "now").mockReturnValue(started);
    const remembered = auth.createSession(user.id, null, null, true);
    const cookieName = auth.sessionCookieName;
    const temporary = auth.createSession(user.id, null, null, false);
    const revoked = auth.createSession(user.id, null, null, true);
    expect(auth.revokeSession(user.id, revoked.id)).toBe(true);
    auth.close();
    auth = new AuthService(path, "required");
    expect(auth.sessionCookieName).toBe(cookieName);
    time.mockReturnValue(started + 2 * day);
    expect(auth.resolveSession(temporary.token)).toBeNull();
    expect(auth.resolveSession(revoked.token)).toBeNull();
    expect(auth.resolveSession(remembered.token)?.user.id).toBe(user.id);
    for (const elapsed of [8, 14, 20, 26, 29]) {
      time.mockReturnValue(started + elapsed * day);
      expect(auth.resolveSession(remembered.token)?.user.id).toBe(user.id);
    }
    time.mockReturnValue(started + 30 * day);
    expect(auth.resolveSession(remembered.token)).toBeNull();
    const idle = auth.createSession(user.id, null, null, true);
    time.mockReturnValue(started + 37 * day);
    expect(auth.resolveSession(idle.token)).toBeNull();
  });

  it("migrates the old session table without extending existing sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-session-migration-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "auth.db");
    let auth = new AuthService(path, "required");
    cleanups.push(() => auth.close());
    const user = auth.createBootstrap(
      { name: "Owner", email: "owner@example.com", password: "correct horse battery staple" },
      [],
    );
    const session = auth.createSession(user.id, null, null);
    auth.close();
    const db = new BetterSqlite3(path);
    db.exec("ALTER TABLE auth_sessions DROP COLUMN remembered");
    db.close();
    auth = new AuthService(path, "required");
    expect(auth.resolveSession(session.token)?.user.id).toBe(user.id);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * day);
    expect(auth.resolveSession(session.token)).toBeNull();
  });

  it("issues a persistent cookie only on explicit opt-in and clears it on logout", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-session-cookie-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({
      projectsRoot: join(root, "projects"),
      webRoot: null,
      auth: { mode: "required", databasePath: join(root, "auth.db"), secureCookies: true },
    });
    cleanups.push(() => app.close());
    const credentials = {
      name: "Owner",
      email: "owner@example.com",
      password: "correct horse battery staple",
    };
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: { ...credentials, remember: true },
    });
    expect(bootstrap.statusCode).toBe(201);
    const cookie = String(bootstrap.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly; SameSite=Lax; Max-Age=");
    expect(cookie).toContain("Secure");
    expect(Number(cookie.match(/Max-Age=(\d+)/)?.[1])).toBeGreaterThanOrEqual(
      (30 * day) / 1000 - 2,
    );
    for (const remember of [false, undefined, "true"]) {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { ...credentials, remember },
      });
      expect(login.statusCode).toBe(200);
      expect(String(login.headers["set-cookie"])).not.toContain("Max-Age");
    }
    const headers = {
      cookie: cookie.split(";", 1)[0],
      "x-takeboard-csrf": bootstrap.json().csrfToken,
    };
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    const status = await app.inject({ method: "GET", url: "/api/auth/status", headers });
    expect(status.json().user).toBeNull();
  });
});
