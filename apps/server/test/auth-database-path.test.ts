import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { resolveAuthDatabasePath } from "../src/auth-database-path.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("identity database location", () => {
  it("opens an explicit filename and keeps the same accounts after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-auth-path-"));
    roots.push(root);
    const path = join(root, "identity.db");
    vi.stubEnv("TAKEBOARD_AUTH_DATABASE", path);
    const options = {
      projectsRoot: join(root, "projects"),
      webRoot: null,
      auth: { mode: "required" as const },
    };
    const app = buildApp(options);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/bootstrap",
        payload: {
          name: "Owner",
          email: "owner@example.test",
          password: "correct horse battery staple",
        },
      });
      expect(response.statusCode).toBe(201);
      expect((await stat(path)).isFile()).toBe(true);
    } finally {
      await app.close();
    }
    const reopened = buildApp(options);
    try {
      expect((await reopened.inject({ url: "/api/auth/status" })).json().configured).toBe(true);
    } finally {
      await reopened.close();
    }
  });

  it("preserves the legacy nested database and rejects unrelated directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-auth-legacy-"));
    roots.push(root);
    const configured = join(root, "auth.db");
    const legacy = join(configured, ".system", "auth.db");
    await mkdir(join(configured, ".system"), { recursive: true });
    await writeFile(legacy, "existing database");
    expect(resolveAuthDatabasePath(root, configured)).toBe(legacy);
    expect(resolveAuthDatabasePath(root)).toBe(join(root, ".system", "auth.db"));
    expect(() => resolveAuthDatabasePath(root, root)).toThrow("不能指向目录");
  });
});
