import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function authApp() {
  const root = await mkdtemp(join(tmpdir(), "takeboard-auth-"));
  const app = buildApp({
    projectsRoot: join(root, "projects"),
    webRoot: null,
    auth: { mode: "required", databasePath: join(root, "system", "auth.db") },
  });
  cleanup.push(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  return app;
}

function sessionHeaders(response: {
  headers: Record<string, string | string[] | number | undefined>;
  json(): unknown;
}) {
  const setCookie = response.headers["set-cookie"];
  const cookie =
    String(Array.isArray(setCookie) ? (setCookie[0] ?? "") : (setCookie ?? "")).split(";", 1)[0] ??
    "";
  const csrfToken = (response.json() as { csrfToken: string }).csrfToken;
  if (!cookie || !csrfToken) throw new Error("Authentication response did not establish a session");
  return { cookie, csrf: csrfToken };
}

describe("TakeBoard authentication and authorization", () => {
  it("bootstraps one administrator and protects state-changing requests with CSRF", async () => {
    const app = await authApp();
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json()).toMatchObject({ enabled: true, configured: false, user: null });

    const blocked = await app.inject({ method: "GET", url: "/api/projects" });
    expect(blocked.statusCode).toBe(428);
    expect(blocked.json()).toMatchObject({ code: "SETUP_REQUIRED" });

    const weak = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: { name: "Owner", email: "owner@example.com", password: "short" },
    });
    expect(weak.statusCode).toBe(400);

    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Owner",
        email: "OWNER@example.com",
        password: "correct horse battery staple",
      },
    });
    expect(bootstrap.statusCode, bootstrap.body).toBe(201);
    expect(bootstrap.headers["set-cookie"]).toContain("HttpOnly");
    expect(bootstrap.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(bootstrap.json()).toMatchObject({
      user: { email: "owner@example.com", instanceRole: "admin" },
    });
    const owner = sessionHeaders(bootstrap);

    const csrfBlocked = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner.cookie },
      payload: { title: "Private film" },
    });
    expect(csrfBlocked.statusCode).toBe(403);
    expect(csrfBlocked.json()).toMatchObject({ code: "CSRF_INVALID" });

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: owner.cookie, "x-takeboard-csrf": owner.csrf },
      payload: { title: "Private film" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const key = created.json().key as string;
    const projects = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: owner.cookie },
    });
    expect(projects.json().projects).toEqual([expect.objectContaining({ key, role: "owner" })]);

    const duplicateBootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Attacker",
        email: "attacker@example.com",
        password: "another long secure password",
      },
    });
    expect(duplicateBootstrap.statusCode).toBe(409);
  });

  it("enforces instance and project roles at the API boundary", async () => {
    const app = await authApp();
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Admin",
        email: "admin@example.com",
        password: "admin passphrase is sufficiently long",
      },
    });
    const admin = sessionHeaders(bootstrap);
    const adminId = bootstrap.json().user.id as string;
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie: admin.cookie, "x-takeboard-csrf": admin.csrf },
      payload: { title: "Shared production" },
    });
    const key = created.json().key as string;

    const memberCreated = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: { cookie: admin.cookie, "x-takeboard-csrf": admin.csrf },
      payload: {
        name: "Reviewer",
        email: "reviewer@example.com",
        password: "temporary reviewer passphrase",
        instanceRole: "member",
      },
    });
    expect(memberCreated.statusCode, memberCreated.body).toBe(201);
    const memberId = memberCreated.json().user.id as string;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "reviewer@example.com", password: "temporary reviewer passphrase" },
    });
    const member = sessionHeaders(login);

    const passwordGate = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: member.cookie },
    });
    expect(passwordGate.statusCode).toBe(403);
    expect(passwordGate.json()).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
    const changedInitialPassword = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: member.cookie, "x-takeboard-csrf": member.csrf },
      payload: {
        currentPassword: "temporary reviewer passphrase",
        newPassword: "reviewer chose a private passphrase",
      },
    });
    expect(changedInitialPassword.statusCode, changedInitialPassword.body).toBe(200);

    const privateCatalog = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: member.cookie },
    });
    expect(privateCatalog.json().projects).toEqual([]);
    const deniedDirect = await app.inject({
      method: "GET",
      url: `/api/projects/${key}`,
      headers: { cookie: member.cookie },
    });
    expect(deniedDirect.statusCode).toBe(403);
    const deniedAdmin = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { cookie: member.cookie },
    });
    expect(deniedAdmin.statusCode).toBe(403);

    const shared = await app.inject({
      method: "PUT",
      url: `/api/projects/${key}/members/${memberId}`,
      headers: { cookie: admin.cookie, "x-takeboard-csrf": admin.csrf },
      payload: { role: "viewer" },
    });
    expect(shared.statusCode, shared.body).toBe(200);
    const lastOwnerRemoval = await app.inject({
      method: "DELETE",
      url: `/api/projects/${key}/members/${adminId}`,
      headers: { cookie: admin.cookie, "x-takeboard-csrf": admin.csrf },
    });
    expect(lastOwnerRemoval.statusCode).toBe(400);
    expect(lastOwnerRemoval.json().error).toContain("至少需要保留一位 Owner");
    const visible = await app.inject({
      method: "GET",
      url: `/api/projects/${key}`,
      headers: { cookie: member.cookie },
    });
    expect(visible.statusCode).toBe(200);
    const viewerWrite = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}`,
      headers: { cookie: member.cookie, "x-takeboard-csrf": member.csrf },
      payload: { title: "Should not change" },
    });
    expect(viewerWrite.statusCode).toBe(403);

    await app.inject({
      method: "PUT",
      url: `/api/projects/${key}/members/${memberId}`,
      headers: { cookie: admin.cookie, "x-takeboard-csrf": admin.csrf },
      payload: { role: "editor" },
    });
    const editorWrite = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}`,
      headers: { cookie: member.cookie, "x-takeboard-csrf": member.csrf },
      payload: { title: "Editor changed this" },
    });
    expect(editorWrite.statusCode, editorWrite.body).toBe(200);
    const editorDelete = await app.inject({
      method: "DELETE",
      url: `/api/projects/${key}`,
      headers: { cookie: member.cookie, "x-takeboard-csrf": member.csrf },
    });
    expect(editorDelete.statusCode).toBe(403);
    const audit = await app.inject({
      method: "GET",
      url: "/api/admin/audit",
      headers: { cookie: admin.cookie },
    });
    expect(audit.statusCode, audit.body).toBe(200);
    expect(audit.json().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "authorization.denied",
          actor: expect.objectContaining({ id: memberId }),
        }),
        expect.objectContaining({ action: "project.member_set" }),
      ]),
    );
  }, 20_000);

  it("requires the current password and revokes other sessions after a password change", async () => {
    const app = await authApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Owner",
        email: "owner@example.com",
        password: "original secure passphrase",
      },
    });
    const current = sessionHeaders(first);
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.com", password: "original secure passphrase" },
    });
    const second = sessionHeaders(secondLogin);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: current.cookie, "x-takeboard-csrf": current.csrf },
      payload: {
        currentPassword: "wrong password value",
        newPassword: "replacement secure passphrase",
      },
    });
    expect(wrong.statusCode).toBe(400);

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: current.cookie, "x-takeboard-csrf": current.csrf },
      payload: {
        currentPassword: "original secure passphrase",
        newPassword: "replacement secure passphrase",
      },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const revoked = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: second.cookie },
    });
    expect(revoked.statusCode).toBe(401);
    const currentStillWorks = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { cookie: current.cookie },
    });
    expect(currentStillWorks.statusCode).toBe(200);
  }, 20_000);
});
