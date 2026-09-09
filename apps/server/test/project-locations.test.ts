import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { projectDirectory } from "../src/project-locations.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "takeboard-locations-"));
  cleanup.push(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "instance");
  const external = join(base, "films");
  await mkdir(root);
  await mkdir(external);
  const app = buildApp({ projectsRoot: root, webRoot: null, runReconciliation: false });
  cleanup.push(() => app.close());
  return { app, root, external, base };
}

describe("device-scoped project folders", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "rolls back a newly reserved external project when POSIX catalog write permission is revoked",
    async () => {
      const { app, root, external } = await fixture();
      const added = await app.inject({
        method: "POST",
        url: "/api/storage/roots",
        payload: { path: external },
      });
      await chmod(root, 0o500);
      try {
        const created = await app.inject({
          method: "POST",
          url: "/api/projects",
          payload: { title: "未发布项目", storageRootId: added.json().root.id },
        });
        expect(created.statusCode).toBeGreaterThanOrEqual(400);
        expect(await readdir(external)).toEqual([]);
      } finally {
        await chmod(root, 0o700);
      }
    },
  );

  it("keeps long Unicode project names within filesystem component limits", async () => {
    const { app } = await fixture();
    const title = "镜头🎬".repeat(45);
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title, storageRootId: "instance" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().snapshot.project.title).toBe(title);
  });
  it("stores projects in the selected folder and preserves list, open, export, recycle and restore", async () => {
    const { app, root, external } = await fixture();
    const added = await app.inject({
      method: "POST",
      url: "/api/storage/roots",
      payload: { path: external, name: "影片盘" },
    });
    expect(added.statusCode).toBe(200);
    const rootId = added.json().root.id;
    const folder = await app.inject({
      method: "POST",
      url: "/api/storage/folders",
      payload: { rootId, name: "短片" },
    });
    expect(folder.statusCode).toBe(201);
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "远端影片", storageRootId: rootId, storageFolder: "短片" },
    });
    expect(created.statusCode).toBe(201);
    const key = created.json().key;
    const directory = projectDirectory(root, key);
    expect(directory.startsWith(join(external, "短片", "远端影片 ("))).toBe(true);
    expect(projectDirectory(root, key)).toBe(directory);
    expect(
      JSON.parse(await readFile(join(directory, "project.takeboard.json"), "utf8")).project.title,
    ).toBe("远端影片");
    expect(
      (await app.inject("/api/projects")).json().projects.map((item: { key: string }) => item.key),
    ).toContain(key);
    expect((await app.inject(`/api/projects/${key}`)).statusCode).toBe(200);
    expect((await app.inject(`/api/projects/${key}/location`)).json().directory).toBe(directory);
    expect((await app.inject(`/api/projects/${key}/export`)).statusCode).toBe(200);
    const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${key}` });
    expect(deleted.statusCode).toBe(200);
    expect((await app.inject("/api/projects")).json().projects).toHaveLength(0);
    // Recycle is recoverable and never deletes files from the chosen disk.
    expect(await readFile(join(directory, "project.takeboard.json"), "utf8")).toContain("远端影片");
    const trash = (await app.inject("/api/projects/trash")).json().projects;
    expect(trash).toHaveLength(1);
    const restored = await app.inject({
      method: "POST",
      url: `/api/projects/trash/${trash[0].trashKey}/restore`,
    });
    expect(restored.statusCode).toBe(200);
    expect(projectDirectory(root, restored.json().key)).toBe(directory);
    expect((await app.inject(`/api/projects/${restored.json().key}`)).statusCode).toBe(200);
  });

  it("rejects traversal, symlink escapes, internal folders and file paths", async () => {
    const { app, root, external } = await fixture();
    await symlink(external, join(root, "escape"), "dir");
    for (const folder of ["../films", "escape", ".system", "/tmp", "a/../../films"]) {
      const response = await app.inject(
        `/api/storage/folders?${new URLSearchParams({ rootId: "instance", folder })}`,
      );
      expect(response.statusCode).toBe(400);
    }
    const bad = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "禁止", storageRootId: "unknown" },
    });
    expect(bad.statusCode).toBe(400);
    const disk = await app.inject({
      method: "POST",
      url: "/api/storage/roots",
      payload: { path: "/" },
    });
    expect(disk.statusCode).toBe(400);
  });

  it("retains an unavailable project in the catalog and reconnects after the disk returns", async () => {
    const { app, root, external } = await fixture();
    const added = await app.inject({
      method: "POST",
      url: "/api/storage/roots",
      payload: { path: external },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { title: "保留项目", storageRootId: added.json().root.id },
    });
    expect(created.statusCode).toBe(201);
    const key = created.json().key;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${key}`,
          payload: { title: "保留项目（新名称）" },
        })
      ).statusCode,
    ).toBe(200);
    await rename(external, `${external}-unmounted`);
    const list = await app.inject("/api/projects");
    expect(list.statusCode).toBe(200);
    expect(list.json().projects).toMatchObject([
      { key, title: "保留项目（新名称）", unavailable: true },
    ]);
    expect((await app.inject(`/api/projects/${key}`)).statusCode).toBe(409);
    for (const url of [
      "/api/operations/tasks",
      "/api/operations/storage",
      "/api/operations/diagnostics",
      "/api/projects/trash",
    ]) {
      expect((await app.inject(url)).statusCode, url).toBe(200);
    }
    await rename(`${external}-unmounted`, external);
    const restarted = buildApp({ projectsRoot: root, webRoot: null });
    cleanup.push(() => restarted.close());
    expect((await restarted.inject(`/api/projects/${key}`)).statusCode).toBe(200);
    expect((await restarted.inject("/api/projects")).json().projects).toHaveLength(1);
  });

  it("returns server identity separately from GPU information and requires authentication", async () => {
    const { app, root } = await fixture();
    const status = await app.inject("/api/device");
    expect(status.json()).toMatchObject({ projectsDirectory: root, canManage: true });
    expect(status.json()).not.toHaveProperty("gpu");
    const protectedApp = buildApp({
      projectsRoot: root,
      webRoot: null,
      auth: { mode: "optional" },
    });
    cleanup.push(() => protectedApp.close());
    expect((await protectedApp.inject("/api/device")).statusCode).toBe(401);
    expect((await protectedApp.inject("/api/storage/roots")).statusCode).toBe(401);
  });
});
