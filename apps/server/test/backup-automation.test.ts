import { appendFile, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import {
  backupAutomationConfigFromEnvironment,
  type ExternalBackupRecord,
  selectRetainedBackupIds,
} from "../src/backup-automation.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function sessionHeaders(response: {
  headers: Record<string, string | string[] | number | undefined>;
  json(): unknown;
}) {
  const setCookie = response.headers["set-cookie"];
  const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";", 1)[0];
  const csrf = (response.json() as { csrfToken: string }).csrfToken;
  return { cookie, "x-takeboard-csrf": csrf };
}

function retentionRecord(id: string, createdAt: string): ExternalBackupRecord {
  return {
    format: "takeboard.external-instance-backup",
    version: 1,
    sourceInstanceId: "11111111-1111-4111-8111-111111111111",
    id: `backup-${id}`,
    filename: `backup-${id}.takeboard-instance.tgz`,
    createdAt,
    copiedAt: createdAt,
    size: 1,
    archiveSha256: "a".repeat(64),
    projectCount: 1,
    userCount: 1,
    separateDevice: true,
  };
}

describe("scheduled external backups", () => {
  it("runs the first configured backup automatically after startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-backup-scheduler-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const projectsRoot = join(root, "projects");
    const app = buildApp({
      projectsRoot,
      webRoot: null,
      auth: { mode: "required", databasePath: join(projectsRoot, ".system", "auth.db") },
      backupAutomation: {
        destination: join(root, "external-volume"),
        intervalHours: 24,
        localCopies: 2,
        retention: { daily: 7, weekly: 4, monthly: 6 },
        restoreDrillIntervalDays: 30,
        startupDelayMs: 10,
      },
    });
    cleanup.push(() => app.close());
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Scheduled backup administrator",
        email: "scheduled-backup@example.com",
        password: "a long passphrase for scheduled backup verification",
      },
    });
    const headers = sessionHeaders(bootstrap);

    await vi.waitFor(
      async () => {
        const status = await app.inject({
          method: "GET",
          url: "/api/admin/backups/automation",
          headers: { cookie: headers.cookie },
        });
        expect(status.json()).toMatchObject({
          status: {
            externalBackupCount: 1,
            lastSuccessAt: expect.any(String),
            lastRestoreDrillPassed: true,
          },
        });
      },
      { timeout: 8_000, interval: 100 },
    );
    const audit = await app.inject({
      method: "GET",
      url: "/api/admin/audit?limit=20",
      headers: { cookie: headers.cookie },
    });
    expect(audit.json().entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "backup.external_scheduled" })]),
    );
  }, 15_000);

  it("copies, verifies, restores and reports an external instance backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-backup-automation-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const projectsRoot = join(root, "projects");
    const destination = join(root, "external-volume");
    const appOptions = {
      projectsRoot,
      webRoot: null,
      auth: { mode: "required", databasePath: join(projectsRoot, ".system", "auth.db") },
      backupAutomation: {
        destination,
        intervalHours: 24,
        localCopies: 2,
        retention: { daily: 7, weekly: 4, monthly: 6 },
        restoreDrillIntervalDays: 30,
        startupDelayMs: 3_600_000,
      },
    } as const;
    let app = buildApp(appOptions);
    cleanup.push(() => app.close());
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Backup administrator",
        email: "backup-automation@example.com",
        password: "a long passphrase for backup verification",
      },
    });
    const headers = sessionHeaders(bootstrap);
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers,
      payload: { title: "External recovery fixture" },
    });
    expect(project.statusCode, project.body).toBe(201);

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/backups/automation/run",
      headers,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      backup: { projectCount: 1, userCount: 1 },
      drill: { passed: true, projectCount: 1, userCount: 1 },
      drillError: null,
    });
    const backup = created.json().backup as ExternalBackupRecord;

    const status = await app.inject({
      method: "GET",
      url: "/api/admin/backups/automation",
      headers: { cookie: headers.cookie },
    });
    expect(status.json()).toMatchObject({
      status: {
        enabled: true,
        destinationReady: true,
        externalBackupCount: 1,
        lastRestoreDrillPassed: true,
      },
    });
    await app.close();
    app = buildApp(appOptions);
    const restartedStatus = await app.inject({
      method: "GET",
      url: "/api/admin/backups/automation",
      headers: { cookie: headers.cookie },
    });
    expect(restartedStatus.json()).toMatchObject({
      status: {
        externalBackupCount: 1,
        latestExternalBackup: { sourceInstanceId: backup.sourceInstanceId },
        lastRestoreDrillPassed: true,
      },
    });
    const diagnostics = await app.inject({
      method: "GET",
      url: "/api/operations/diagnostics",
      headers: { cookie: headers.cookie },
    });
    expect(diagnostics.json()).toMatchObject({
      backup: {
        automation: { enabled: true, externalBackupCount: 1, lastRestoreDrillPassed: true },
      },
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "backup.automation", status: "warning" }),
      ]),
    });

    await appendFile(join(destination, backup.filename), "corruption");
    const rejectedDrill = await app.inject({
      method: "POST",
      url: "/api/admin/backups/automation/drill",
      headers,
    });
    expect(rejectedDrill.statusCode).toBe(503);
    expect(rejectedDrill.json().error).toContain("哈希已变化");
    const failedStatus = await app.inject({
      method: "GET",
      url: "/api/admin/backups/automation",
      headers: { cookie: headers.cookie },
    });
    expect(failedStatus.json()).toMatchObject({
      status: {
        externalBackupCount: 1,
        damagedExternalBackupCount: 1,
        lastRestoreDrillPassed: false,
      },
    });

    const retried = await app.inject({
      method: "POST",
      url: "/api/admin/backups/automation/run",
      headers,
    });
    expect(retried.statusCode, retried.body).toBe(201);
    expect(retried.json()).toMatchObject({ drill: { passed: true }, drillError: null });
    const newest = retried.json().backup as ExternalBackupRecord;
    await rm(join(destination, newest.filename));
    const missingStatus = await app.inject({
      method: "GET",
      url: "/api/admin/backups/automation",
      headers: { cookie: headers.cookie },
    });
    expect(missingStatus.json()).toMatchObject({
      status: { externalBackupCount: 2, damagedExternalBackupCount: 2 },
    });
    const missingDrill = await app.inject({
      method: "POST",
      url: "/api/admin/backups/automation/drill",
      headers,
    });
    expect(missingDrill.statusCode).toBe(503);
    expect(missingDrill.json().error).toContain("缺失或不可读");
  }, 30_000);

  it("retains independent daily, weekly and monthly recovery points", () => {
    const records = [
      retentionRecord("aug-30", "2026-08-30T10:00:00.000Z"),
      retentionRecord("aug-29", "2026-08-29T10:00:00.000Z"),
      retentionRecord("aug-23", "2026-08-23T10:00:00.000Z"),
      retentionRecord("aug-01", "2026-08-01T10:00:00.000Z"),
      retentionRecord("jul-31", "2026-07-31T10:00:00.000Z"),
      retentionRecord("jul-01", "2026-07-01T10:00:00.000Z"),
    ];
    expect(
      [...selectRetainedBackupIds(records, { daily: 2, weekly: 2, monthly: 2 })].sort(),
    ).toEqual(["backup-aug-23", "backup-aug-29", "backup-aug-30", "backup-jul-31"].sort());
  });

  it("keeps shared external storage isolated between data instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-backup-multi-instance-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const destination = join(root, "shared-external-volume");
    const createInstance = (name: string) => {
      const projectsRoot = join(root, `${name}-projects`);
      const app = buildApp({
        projectsRoot,
        webRoot: null,
        auth: { mode: "required", databasePath: join(projectsRoot, ".system", "auth.db") },
        backupAutomation: {
          destination,
          intervalHours: 24,
          localCopies: 2,
          retention: { daily: 1, weekly: 0, monthly: 0 },
          restoreDrillIntervalDays: 30,
          startupDelayMs: 3_600_000,
        },
      });
      cleanup.push(() => app.close());
      return { app, name };
    };
    const alpha = createInstance("alpha");
    const beta = createInstance("beta");

    const bootstrapInstance = async (instance: ReturnType<typeof createInstance>) => {
      const bootstrap = await instance.app.inject({
        method: "POST",
        url: "/api/auth/bootstrap",
        payload: {
          name: `${instance.name} administrator`,
          email: `${instance.name}@example.com`,
          password: `a long passphrase for ${instance.name} backup isolation`,
        },
      });
      return sessionHeaders(bootstrap);
    };
    const alphaHeaders = await bootstrapInstance(alpha);
    const betaHeaders = await bootstrapInstance(beta);

    const first = await alpha.app.inject({
      method: "POST",
      url: "/api/admin/backups/automation/run",
      headers: alphaHeaders,
    });
    const second = await beta.app.inject({
      method: "POST",
      url: "/api/admin/backups/automation/run",
      headers: betaHeaders,
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(second.statusCode, second.body).toBe(201);
    expect(first.json().backup.sourceInstanceId).not.toBe(second.json().backup.sourceInstanceId);

    for (const [instance, headers] of [
      [alpha, alphaHeaders],
      [beta, betaHeaders],
    ] as const) {
      const status = await instance.app.inject({
        method: "GET",
        url: "/api/admin/backups/automation",
        headers: { cookie: headers.cookie },
      });
      expect(status.json()).toMatchObject({
        status: { externalBackupCount: 1, damagedExternalBackupCount: 0 },
      });
    }

    const repeated = await alpha.app.inject({
      method: "POST",
      url: "/api/admin/backups/automation/run",
      headers: alphaHeaders,
    });
    expect(repeated.statusCode, repeated.body).toBe(201);
    const metadata = (await readdir(destination)).filter((name) => name.endsWith(".external.json"));
    expect(metadata).toHaveLength(2);
    const betaStatus = await beta.app.inject({
      method: "GET",
      url: "/api/admin/backups/automation",
      headers: { cookie: betaHeaders.cookie },
    });
    expect(betaStatus.json()).toMatchObject({
      status: { externalBackupCount: 1, damagedExternalBackupCount: 0 },
    });
  }, 30_000);

  it("rejects fractional retention counts instead of silently rounding them", () => {
    const config = backupAutomationConfigFromEnvironment({
      TAKEBOARD_BACKUP_DESTINATION: "/external/backups",
      TAKEBOARD_BACKUP_KEEP_DAILY: "2.5",
    });
    expect(config.localCopies).toBe(2);
    expect(config.configurationError).toContain("TAKEBOARD_BACKUP_KEEP_DAILY");
  });

  it("validates programmatic automation configuration at the service boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-backup-config-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const projectsRoot = join(root, "projects");
    const app = buildApp({
      projectsRoot,
      webRoot: null,
      auth: { mode: "required", databasePath: join(projectsRoot, ".system", "auth.db") },
      backupAutomation: {
        destination: join(root, "external-volume"),
        intervalHours: 24,
        localCopies: 1.5,
        retention: { daily: 7, weekly: 4, monthly: 6 },
        restoreDrillIntervalDays: 30,
      },
    });
    cleanup.push(() => app.close());
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Configuration administrator",
        email: "backup-config@example.com",
        password: "a long passphrase for configuration validation",
      },
    });
    const headers = sessionHeaders(bootstrap);
    const status = await app.inject({
      method: "GET",
      url: "/api/admin/backups/automation",
      headers: { cookie: headers.cookie },
    });
    expect(status.json()).toMatchObject({
      status: { enabled: false, configurationError: expect.stringContaining("本机副本数") },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/backups/automation/run",
      headers,
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a destination nested inside the live data root", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-backup-boundary-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({
      projectsRoot: root,
      webRoot: null,
      auth: { mode: "required", databasePath: join(root, ".system", "auth.db") },
      backupAutomation: {
        destination: join(root, "unsafe-backups"),
        intervalHours: 24,
        localCopies: 2,
        retention: { daily: 7, weekly: 4, monthly: 6 },
        restoreDrillIntervalDays: 30,
        startupDelayMs: 3_600_000,
      },
    });
    cleanup.push(() => app.close());
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: {
        name: "Boundary administrator",
        email: "backup-boundary@example.com",
        password: "a long passphrase for boundary testing",
      },
    });
    const headers = sessionHeaders(bootstrap);
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/backups/automation/run",
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("数据目录内部");
  });

  it.skipIf(process.platform === "win32")(
    "rejects an external-looking symlink that resolves inside the data root",
    async () => {
      const parent = await mkdtemp(join(tmpdir(), "takeboard-backup-symlink-"));
      cleanup.push(() => rm(parent, { recursive: true, force: true }));
      const root = join(parent, "projects");
      const internal = join(root, "hidden-backups");
      const linkedDestination = join(parent, "external-link");
      await mkdir(internal, { recursive: true });
      await symlink(internal, linkedDestination, "dir");
      const app = buildApp({
        projectsRoot: root,
        webRoot: null,
        auth: { mode: "required", databasePath: join(root, ".system", "auth.db") },
        backupAutomation: {
          destination: linkedDestination,
          intervalHours: 24,
          localCopies: 2,
          retention: { daily: 7, weekly: 4, monthly: 6 },
          restoreDrillIntervalDays: 30,
          startupDelayMs: 3_600_000,
        },
      });
      cleanup.push(() => app.close());
      const bootstrap = await app.inject({
        method: "POST",
        url: "/api/auth/bootstrap",
        payload: {
          name: "Symlink administrator",
          email: "backup-symlink@example.com",
          password: "a long passphrase for symlink testing",
        },
      });
      const headers = sessionHeaders(bootstrap);
      const status = await app.inject({
        method: "GET",
        url: "/api/admin/backups/automation",
        headers: { cookie: headers.cookie },
      });
      expect(status.json()).toMatchObject({ status: { destinationReady: false } });
      const response = await app.inject({
        method: "POST",
        url: "/api/admin/backups/automation/run",
        headers,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("符号链接");
    },
  );
});
