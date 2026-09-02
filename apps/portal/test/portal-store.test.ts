import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PortalStore } from "../src/portal-store.js";

const roots: string[] = [];
const stores: PortalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storeFixture() {
  const root = await mkdtemp(join(tmpdir(), "takeboard-portal-store-"));
  roots.push(root);
  const databasePath = join(root, "portal.db");
  const store = new PortalStore(databasePath);
  stores.push(store);
  return { root, databasePath, store };
}

describe("PortalStore", () => {
  it("creates a protected first account and persistent master key", async () => {
    const fixture = await storeFixture();
    const user = fixture.store.register(
      { email: "Owner@Example.com", name: "Owner", password: "correct horse battery staple" },
      false,
    );
    expect(user).toMatchObject({ email: "owner@example.com", role: "admin", status: "active" });
    expect(() =>
      fixture.store.register(
        { email: "next@example.com", name: "Next", password: "correct horse battery staple" },
        false,
      ),
    ).toThrow(/没有开放/);
    const keyPath = `${fixture.databasePath}.key`;
    const keyStat = await stat(keyPath);
    expect(keyStat.isFile()).toBe(true);
    // POSIX mode bits do not represent Windows ACLs; Node ignores `mode` there. On Unix, the
    // secret must never inherit group or world access.
    if (process.platform !== "win32") {
      expect(keyStat.mode & 0o777).toBe(0o600);
    }
    expect(Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64url")).toHaveLength(32);
  });

  it("completes pairing without exposing a stored plaintext device token", async () => {
    const fixture = await storeFixture();
    const user = fixture.store.register(
      { email: "owner@example.com", name: "Owner", password: "correct horse battery staple" },
      false,
    );
    const pairing = fixture.store.startPairing(
      {
        instanceId: "instance-1234567890",
        instanceName: "Studio GPU",
        applicationVersion: "0.2.0-beta.1",
      },
      "127.0.0.1",
    );
    expect(fixture.store.pairingStatus(pairing.pairingId, "wrong-secret")).toBeNull();
    expect(fixture.store.pairingStatus(pairing.pairingId, pairing.connectorSecret)).toMatchObject({
      state: "pending",
    });
    const claimed = fixture.store.claimPairing(pairing.userCode, user.id, "127.0.0.1");
    const completed = fixture.store.pairingStatus(pairing.pairingId, pairing.connectorSecret);
    expect(completed).toMatchObject({
      state: "paired",
      deviceId: claimed.id,
      portalSubject: user.id,
    });
    if (completed?.state !== "paired") throw new Error("pairing did not complete");
    expect(
      fixture.store.authenticateDevice("instance-1234567890", completed.deviceToken),
    ).toMatchObject({
      id: claimed.id,
      ownerId: user.id,
    });
    expect(fixture.store.listDevices(user.id, new Set([claimed.id]))[0]).toMatchObject({
      online: true,
    });
    expect(fixture.store.revokeDevice(claimed.id, user.id, "127.0.0.1")).toBe(true);
    expect(
      fixture.store.authenticateDevice("instance-1234567890", completed.deviceToken),
    ).toBeNull();
  });

  it("enforces login throttling after repeated invalid credentials", async () => {
    const fixture = await storeFixture();
    fixture.store.register(
      { email: "owner@example.com", name: "Owner", password: "correct horse battery staple" },
      false,
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        fixture.store.authenticate("owner@example.com", "wrong password value", "10.0.0.2"),
      ).toMatchObject({ user: null, rateLimited: false });
    }
    expect(
      fixture.store.authenticate("owner@example.com", "wrong password value", "10.0.0.2"),
    ).toEqual({ user: null, rateLimited: true });
  });
});
