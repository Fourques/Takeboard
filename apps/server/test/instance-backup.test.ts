import { mkdtemp, rename, rm } from "node:fs/promises";
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
import { ProjectService } from "../src/project-service.js";
import { ProjectStore } from "../src/storage/project-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TakeBoard instance backups", () => {
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
    expect(receipt).toMatchObject({ projects: 1, users: 1 });
    const restoredAuth = new AuthService(join(dataRoot, ".system", "auth.db"), "required");
    expect(restoredAuth.listUsers()).toEqual([
      expect.objectContaining({ email: "backup@example.com" }),
    ]);
    expect(restoredAuth.projectRole(created.snapshot.project.id, admin.id)).toBe("owner");
    restoredAuth.close();
  }, 30_000);
});
