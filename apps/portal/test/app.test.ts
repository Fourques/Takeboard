import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildPortal } from "../src/app.js";

const cleanups: Array<() => Promise<void>> = [];
const portalRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "takeboard-portal-app-"));
  const app = buildPortal({
    databasePath: resolve(root, "portal.db"),
    hostname: "portal.example.test",
    publicOrigin: "https://portal.example.test",
    webRoot: resolve(portalRoot, "ui"),
    secureCookies: true,
    allowRegistration: false,
    bootstrapToken: "test-only-bootstrap-token-1234567890",
  });
  cleanups.push(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await app.ready();
  return app;
}

describe("portal HTTP boundary", () => {
  it("serves the account UI and assets with browser security headers", async () => {
    const app = await fixture();
    const page = await app.inject({
      method: "GET",
      url: "/",
      headers: { host: "portal.example.test" },
    });
    expect(page.statusCode, page.body).toBe(200);
    expect(page.body).toContain("TakeBoard Portal");
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");

    const stylesheet = await app.inject({
      method: "GET",
      url: "/__portal/assets/portal.css",
      headers: { host: "portal.example.test" },
    });
    expect(stylesheet.statusCode, stylesheet.body).toBe(200);
    expect(stylesheet.headers["content-type"]).toContain("text/css");
  });

  it("rejects unknown hosts and protects state-changing account requests", async () => {
    const app = await fixture();
    const rejected = await app.inject({
      method: "GET",
      url: "/",
      headers: { host: "attacker.test" },
    });
    expect(rejected.statusCode).toBe(421);

    const registered = await app.inject({
      method: "POST",
      url: "/__portal/api/auth/register",
      headers: { host: "portal.example.test" },
      payload: {
        name: "Portal Owner",
        email: "owner@example.test",
        password: "a sufficiently private portal password",
        setupToken: "test-only-bootstrap-token-1234567890",
      },
    });
    expect(registered.statusCode, registered.body).toBe(201);
    expect(registered.headers["set-cookie"]).toContain("Secure");
    expect(registered.headers["set-cookie"]).toContain("Domain=.portal.example.test");
    const cookie = String(registered.headers["set-cookie"]).split(";", 1)[0];

    const withoutCsrf = await app.inject({
      method: "POST",
      url: "/__portal/api/pairings/claim",
      headers: { host: "portal.example.test", cookie },
      payload: { code: "ABCD-EFGH" },
    });
    expect(withoutCsrf.statusCode).toBe(403);
  });

  it("requires a deployment-held token for the first public administrator", async () => {
    const app = await fixture();
    const status = await app.inject({
      method: "GET",
      url: "/__portal/api/auth/status",
      headers: { host: "portal.example.test" },
    });
    expect(status.json()).toMatchObject({ configured: false, bootstrapRequired: true });

    const rejected = await app.inject({
      method: "POST",
      url: "/__portal/api/auth/register",
      headers: { host: "portal.example.test" },
      payload: {
        name: "Attacker",
        email: "attacker@example.test",
        password: "a sufficiently private attacker password",
        setupToken: "wrong-bootstrap-token-value",
      },
    });
    expect(rejected.statusCode).toBe(403);
  });
});
