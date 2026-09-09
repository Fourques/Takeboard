import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth-service.js";
import {
  applyStagedProjectRestore,
  createInstanceBackup,
  instanceBackupPath,
  listInstanceBackups,
  restoreInstanceOffline,
  stageInstanceRestore,
} from "../src/instance-backup.js";
import { addStorageRoot, linkProjectDirectory } from "../src/project-locations.js";
import { ProjectService } from "../src/project-service.js";
import { ProjectStore } from "../src/storage/project-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TakeBoard instance backups", () => {
  it("backs up real externally located content and restores a self-contained project without overwriting the source", async () => {
    const base = await mkdtemp(join(tmpdir(), "takeboard-external-backup-"));
    roots.push(base);
    const root = join(base, "instance");
    const external = join(base, "film-drive");
    await mkdir(root);
    await mkdir(external);
    const auth = new AuthService(join(root, ".system", "auth.db"), "required");
    try {
      const admin = auth.createBootstrap(
        {
          name: "Owner",
          email: "backup@studio.test",
          password: "external project backup passphrase",
        },
        [],
      );
      await addStorageRoot(root, { path: external, name: "Film drive" });
      const key = "external-film.takeboard";
      const directory = join(external, "Film (external).takeboard");
      const created = await new ProjectService().create({
        projectDirectory: directory,
        title: "External film",
      });
      auth.grantProjectOwner(created.snapshot.project.id, admin.id);
      await linkProjectDirectory(root, key, directory, {
        projectId: created.snapshot.project.id,
        title: "External film",
        updatedAt: created.snapshot.project.updatedAt,
      });
      const backup = await createInstanceBackup(root, auth);
      expect(backup.projectCount).toBe(1);
      const archive = instanceBackupPath(root, backup.id);
      if (!archive) throw new Error("Missing backup archive");
      await rename(external, `${external}-offline`);
      await expect(createInstanceBackup(root, auth)).rejects.toThrow(/项目文件夹不可用/);
      const offline = await stageInstanceRestore(root, archive);
      expect(offline.projects[0]?.alreadyExists).toBe(true);
      await rename(`${external}-offline`, external);
      await rename(join(root, key), join(root, ".saved-index"));
      const staged = await stageInstanceRestore(root, archive);
      expect(staged.projects[0]?.alreadyExists).toBe(false);
      await applyStagedProjectRestore(root, staged.restoreId, auth, admin.id);
      const original = JSON.parse(
        await readFile(join(directory, "project.takeboard.json"), "utf8"),
      );
      const restored = JSON.parse(
        await readFile(join(root, key, "project.takeboard.json"), "utf8"),
      );
      expect(restored.project).toEqual(original.project);
    } finally {
      auth.close();
    }
  });
  it("honors the requested local recovery-point limit", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "takeboard-instance-retention-"));
    roots.push(dataRoot);
    const auth = new AuthService(join(dataRoot, ".system", "auth.db"), "required");
    auth.createBootstrap(
      {
        name: "Retention owner",
        email: "retention@example.com",
        password: "retention owner has a secure passphrase",
      },
      [],
    );
    await createInstanceBackup(dataRoot, auth, 2);
    await createInstanceBackup(dataRoot, auth, 2);
    await createInstanceBackup(dataRoot, auth, 2);
    expect(await listInstanceBackups(dataRoot)).toHaveLength(2);
    await expect(createInstanceBackup(dataRoot, auth, 1.5)).rejects.toThrow(/integer/);
    auth.close();
  });

  it("creates a consistent verified backup and restores only missing projects online", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "takeboard-instance-backup-"));
    roots.push(dataRoot);
    const auth = new AuthService(join(dataRoot, ".system", "auth.db"), "required");
    const admin = auth.createBootstrap(
      {
        name: "Backup owner",
        email: "backup@example.com",
        password: "backup owner has a secure passphrase",
      },
      [],
    );
    const key = "recoverable-film.takeboard";
    const created = await new ProjectService().create({
      projectDirectory: join(dataRoot, key),
      title: "Recoverable film",
      createStarterShot: true,
      firstShotIntent: "A verified frame",
    });
    auth.grantProjectOwner(created.snapshot.project.id, admin.id);
    // Device ACL principals belong in the backup but are not login accounts.
    auth.localIdentity();
    const sessionBeforeBackup = auth.createSession(admin.id, "backup-test", "127.0.0.1");

    const backup = await createInstanceBackup(dataRoot, auth);
    expect(backup).toMatchObject({ projectCount: 1, userCount: 1 });
    expect((await listInstanceBackups(dataRoot))[0]).toEqual(backup);
    const archive = instanceBackupPath(dataRoot, backup.id);
    if (!archive) throw new Error("Backup path was not created");

    const firstInspection = await stageInstanceRestore(dataRoot, archive);
    expect(firstInspection.projects).toEqual([
      expect.objectContaining({ title: "Recoverable film", alreadyExists: true }),
    ]);
    const skipped = await applyStagedProjectRestore(
      dataRoot,
      firstInspection.restoreId,
      auth,
      admin.id,
    );
    expect(skipped).toMatchObject({ restored: [], skipped: ["Recoverable film"] });

    await rename(join(dataRoot, key), join(dataRoot, ".trash-project-for-test"));
    const secondInspection = await stageInstanceRestore(dataRoot, archive);
    expect(secondInspection.projects[0]?.alreadyExists).toBe(false);
    const restored = await applyStagedProjectRestore(
      dataRoot,
      secondInspection.restoreId,
      auth,
      admin.id,
    );
    expect(restored).toMatchObject({ restored: ["Recoverable film"], skipped: [] });
    const store = ProjectStore.openExisting(join(dataRoot, key));
    expect(store?.loadCurrent()?.snapshot).toMatchObject({
      project: { id: created.snapshot.project.id, title: "Recoverable film" },
      shots: [{ intent: "A verified frame" }],
    });
    store?.close();
    expect(auth.projectRole(created.snapshot.project.id, admin.id)).toBe("owner");
    auth.createUser(
      {
        name: "Post-backup member",
        email: "later@example.com",
        password: "a passphrase created after the backup",
        instanceRole: "member",
      },
      admin.id,
      null,
    );
    expect(auth.listUsers()).toHaveLength(2);
    auth.close();

    const receipt = await restoreInstanceOffline(
      dataRoot,
      archive,
      join(dataRoot, ".system", "auth.db"),
    );
    expect(receipt).toMatchObject({ projects: 1, users: 1, sessionsRevoked: true });
    const restoredAuth = new AuthService(join(dataRoot, ".system", "auth.db"), "required");
    expect(restoredAuth.listUsers()).toEqual([
      expect.objectContaining({ email: "backup@example.com" }),
    ]);
    expect(restoredAuth.projectRole(created.snapshot.project.id, admin.id)).toBe("owner");
    expect(restoredAuth.resolveSession(sessionBeforeBackup.token)).toBeNull();
    restoredAuth.close();
  }, 30_000);
});
