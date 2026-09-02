import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPortal } from "../../portal/src/app.js";
import { buildApp } from "../src/app.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: "127.0.0.1", port: 0 }, resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not allocate test port");
  await new Promise<void>((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  return address.port;
}

function session(response: { headers: Record<string, unknown>; json(): unknown }) {
  const cookie = String(response.headers["set-cookie"] ?? "").split(";", 1)[0] ?? "";
  const csrf = (response.json() as { csrfToken: string }).csrfToken;
  if (!cookie || !csrf) throw new Error("test session was not established");
  return { cookie, csrf };
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    value = await read();
  }
  return value;
}

async function remoteGet(port: number, host: string, path: string, cookie: string) {
  return await new Promise<{ status: number; body: string }>((resolveRequest, rejectRequest) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { host, cookie },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolveRequest({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    request.once("error", rejectRequest);
    request.end();
  });
}

describe.sequential("TakeBoard portal end-to-end", () => {
  it("pairs, authorizes a remote local-account request, and revokes immediately", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-portal-e2e-"));
    const portalPort = await availablePort();
    const localPort = await availablePort();
    const portalOrigin = `http://127.0.0.1:${portalPort}`;
    const portal = buildPortal({
      databasePath: join(root, "portal", "portal.db"),
      hostname: "127.0.0.1",
      publicOrigin: portalOrigin,
      webRoot: null,
      secureCookies: false,
      allowRegistration: false,
    });
    await portal.listen({ host: "127.0.0.1", port: portalPort });

    const previousPort = process.env.TAKEBOARD_PORT;
    const previousInstance = process.env.TAKEBOARD_INSTANCE_ID;
    const previousName = process.env.TAKEBOARD_INSTANCE_NAME;
    process.env.TAKEBOARD_PORT = String(localPort);
    process.env.TAKEBOARD_INSTANCE_ID = "instance-portal-e2e-123456";
    process.env.TAKEBOARD_INSTANCE_NAME = "Portal test workstation";
    const local = buildApp({
      projectsRoot: join(root, "local", "projects"),
      webRoot: null,
      auth: { mode: "required", databasePath: join(root, "local", "auth.db") },
      backupAutomation: false,
    });
    if (previousPort === undefined) delete process.env.TAKEBOARD_PORT;
    else process.env.TAKEBOARD_PORT = previousPort;
    if (previousInstance === undefined) delete process.env.TAKEBOARD_INSTANCE_ID;
    else process.env.TAKEBOARD_INSTANCE_ID = previousInstance;
    if (previousName === undefined) delete process.env.TAKEBOARD_INSTANCE_NAME;
    else process.env.TAKEBOARD_INSTANCE_NAME = previousName;
    await local.listen({ host: "127.0.0.1", port: localPort });
    cleanup.push(async () => {
      await local.close();
      await portal.close();
      await rm(root, { recursive: true, force: true });
    });

    const localBootstrap = await local.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Local owner",
        email: "local@example.com",
        password: "local owner password is secure",
      },
    });
    expect(localBootstrap.statusCode, localBootstrap.body).toBe(201);
    const localSession = session(localBootstrap);

    const portalRegister = await portal.inject({
      method: "POST",
      url: "/__portal/api/auth/register",
      headers: { host: `127.0.0.1:${portalPort}` },
      payload: {
        name: "Portal owner",
        email: "portal@example.com",
        password: "portal owner password is secure",
      },
    });
    expect(portalRegister.statusCode, portalRegister.body).toBe(201);
    const portalSession = session(portalRegister);

    const pairing = await local.inject({
      method: "POST",
      url: "/api/admin/portal/pairing",
      headers: {
        cookie: localSession.cookie,
        "x-takeboard-csrf": localSession.csrf,
      },
      payload: { portalUrl: portalOrigin },
    });
    expect(pairing.statusCode, pairing.body).toBe(201);
    expect(pairing.json()).toMatchObject({ state: "pairing", canManage: true });
    const code = pairing.json().pairing.userCode as string;

    const claim = await portal.inject({
      method: "POST",
      url: "/__portal/api/pairings/claim",
      headers: {
        host: `127.0.0.1:${portalPort}`,
        cookie: portalSession.cookie,
        "x-takeboard-portal-csrf": portalSession.csrf,
      },
      payload: { code },
    });
    expect(claim.statusCode, claim.body).toBe(200);

    const connected = await waitFor(
      async () =>
        (
          await local.inject({
            method: "GET",
            url: "/api/portal/status",
            headers: { cookie: localSession.cookie },
          })
        ).json() as { state: string },
      (value) => value.state === "connected",
    );
    expect(connected.state).toBe("connected");

    const deviceList = await portal.inject({
      method: "GET",
      url: "/__portal/api/devices",
      headers: { host: `127.0.0.1:${portalPort}`, cookie: portalSession.cookie },
    });
    expect(deviceList.statusCode, deviceList.body).toBe(200);
    const device = deviceList.json().devices[0] as { id: string; slug: string; online: boolean };
    expect(device.online).toBe(true);

    const remote = await remoteGet(
      portalPort,
      `${device.slug}.127.0.0.1:${portalPort}`,
      "/api/projects",
      portalSession.cookie,
    );
    expect(remote.status, remote.body).toBe(200);
    expect(JSON.parse(remote.body)).toEqual({ projects: [] });

    const revoked = await portal.inject({
      method: "DELETE",
      url: `/__portal/api/devices/${device.id}`,
      headers: {
        host: `127.0.0.1:${portalPort}`,
        cookie: portalSession.cookie,
        "x-takeboard-portal-csrf": portalSession.csrf,
      },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    const localRevoked = await waitFor(
      async () =>
        (
          await local.inject({
            method: "GET",
            url: "/api/portal/status",
            headers: { cookie: localSession.cookie },
          })
        ).json() as { state: string },
      (value) => value.state === "revoked",
    );
    expect(localRevoked.state).toBe("revoked");

    const secondPairing = await local.inject({
      method: "POST",
      url: "/api/admin/portal/pairing",
      headers: {
        cookie: localSession.cookie,
        "x-takeboard-csrf": localSession.csrf,
      },
      payload: { portalUrl: portalOrigin },
    });
    expect(secondPairing.statusCode, secondPairing.body).toBe(201);
    const secondClaim = await portal.inject({
      method: "POST",
      url: "/__portal/api/pairings/claim",
      headers: {
        host: `127.0.0.1:${portalPort}`,
        cookie: portalSession.cookie,
        "x-takeboard-portal-csrf": portalSession.csrf,
      },
      payload: { code: secondPairing.json().pairing.userCode },
    });
    expect(secondClaim.statusCode, secondClaim.body).toBe(200);
    const reconnected = await waitFor(
      async () =>
        (
          await local.inject({
            method: "GET",
            url: "/api/portal/status",
            headers: { cookie: localSession.cookie },
          })
        ).json() as { state: string },
      (value) => value.state === "connected",
    );
    expect(reconnected.state).toBe("connected");

    const localDisconnect = await local.inject({
      method: "DELETE",
      url: "/api/admin/portal",
      headers: {
        cookie: localSession.cookie,
        "x-takeboard-csrf": localSession.csrf,
      },
    });
    expect(localDisconnect.statusCode, localDisconnect.body).toBe(200);
    expect(localDisconnect.json()).toMatchObject({ state: "not_configured", lastError: null });
    const afterLocalDisconnect = await portal.inject({
      method: "GET",
      url: "/__portal/api/devices",
      headers: { host: `127.0.0.1:${portalPort}`, cookie: portalSession.cookie },
    });
    expect(afterLocalDisconnect.json().devices[0]).toMatchObject({
      id: device.id,
      online: false,
    });
    expect(afterLocalDisconnect.json().devices[0].revokedAt).toBeTruthy();
  }, 20_000);
});
