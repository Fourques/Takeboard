import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pack } from "tar-stream";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectArchive, importProjectArchive } from "../src/project-archive.js";
import { ProjectService } from "../src/project-service.js";
import { ProjectStore } from "../src/storage/project-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryRoot(label: string) {
  const root = await mkdtemp(join(tmpdir(), label));
  temporaryDirectories.push(root);
  return root;
}

async function writeTarGzip(
  path: string,
  entries: Array<{ name: string; value: Buffer | string }>,
) {
  const archive = pack();
  const writing = pipeline(archive, createGzip(), createWriteStream(path));
  for (const entry of entries) {
    const value = Buffer.isBuffer(entry.value) ? entry.value : Buffer.from(entry.value, "utf8");
    await new Promise<void>((resolveEntry, rejectEntry) => {
      archive.entry({ name: entry.name, size: value.byteLength }, value, (error) =>
        error ? rejectEntry(error) : resolveEntry(),
      );
    });
  }
  archive.finalize();
  await writing;
}

describe("TakeBoard project packages", () => {
  it("streams a complete project through export, integrity validation and import", async () => {
    const sourceRoot = await temporaryRoot("takeboard-package-source-");
    const destinationRoot = await temporaryRoot("takeboard-package-destination-");
    const sourceKey = "night-ferry.takeboard";
    const sourceDirectory = join(sourceRoot, sourceKey);
    const created = await new ProjectService().create({
      projectDirectory: sourceDirectory,
      title: "夜航计划",
      createStarterShot: true,
      firstShotIntent: "人物走进雨幕",
    });
    const originalBytes = Buffer.concat([
      Buffer.from("TakeBoard project package\n"),
      Buffer.alloc(256 * 1024, 37),
    ]);
    await writeFile(join(sourceDirectory, "assets", "originals", "reference.bin"), originalBytes);
    const archivePath = join(sourceRoot, "night-ferry.takeboard.tgz");
    await pipeline(
      await createProjectArchive(sourceDirectory, {
        sourceKey,
        projectId: created.snapshot.project.id,
        title: created.snapshot.project.title,
        revision: created.revision,
      }),
      createWriteStream(archivePath),
    );

    const imported = await importProjectArchive(destinationRoot, archivePath);
    expect(imported).toMatchObject({
      key: sourceKey,
      title: "夜航计划",
      projectId: created.snapshot.project.id,
      revision: created.revision,
      manifest: {
        format: "takeboard.project-package",
        version: 1,
      },
    });
    expect(
      await readFile(join(destinationRoot, imported.key, "assets", "originals", "reference.bin")),
    ).toEqual(originalBytes);
    const importedStore = ProjectStore.openExisting(join(destinationRoot, imported.key));
    expect(importedStore?.loadCurrent()?.snapshot).toMatchObject({
      project: { id: created.snapshot.project.id, title: "夜航计划" },
      shots: [{ intent: "人物走进雨幕" }],
    });
    importedStore?.close();

    await expect(importProjectArchive(destinationRoot, archivePath)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("rejects traversal entries without writing outside the isolated import directory", async () => {
    const root = await temporaryRoot("takeboard-package-traversal-");
    const archivePath = join(root, "malicious.tgz");
    await writeTarGzip(archivePath, [{ name: "../escaped.txt", value: "not allowed" }]);

    await expect(importProjectArchive(join(root, "projects"), archivePath)).rejects.toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: expect.stringMatching(/路径/),
      }),
    );
    expect(existsSync(join(root, "escaped.txt"))).toBe(false);
  });

  it("rejects signed package metadata that disagrees with the project database", async () => {
    const sourceRoot = await temporaryRoot("takeboard-package-metadata-source-");
    const destinationRoot = await temporaryRoot("takeboard-package-metadata-destination-");
    const sourceKey = "metadata-check.takeboard";
    const sourceDirectory = join(sourceRoot, sourceKey);
    const created = await new ProjectService().create({
      projectDirectory: sourceDirectory,
      title: "Metadata check",
    });
    const archivePath = join(sourceRoot, "metadata-check.tgz");
    await pipeline(
      await createProjectArchive(sourceDirectory, {
        sourceKey,
        projectId: created.snapshot.project.id,
        title: created.snapshot.project.title,
        revision: created.revision + 1,
      }),
      createWriteStream(archivePath),
    );

    await expect(importProjectArchive(destinationRoot, archivePath)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/清单与项目数据库不一致/),
    });
  });

  it("rejects a signed package whose portable snapshot disagrees with SQLite", async () => {
    const sourceRoot = await temporaryRoot("takeboard-package-snapshot-source-");
    const destinationRoot = await temporaryRoot("takeboard-package-snapshot-destination-");
    const sourceKey = "snapshot-check.takeboard";
    const sourceDirectory = join(sourceRoot, sourceKey);
    const created = await new ProjectService().create({
      projectDirectory: sourceDirectory,
      title: "Database title",
    });
    await writeFile(
      join(sourceDirectory, "project.takeboard.json"),
      `${JSON.stringify(
        {
          ...created.snapshot,
          project: { ...created.snapshot.project, title: "Portable title" },
        },
        null,
        2,
      )}\n`,
    );
    const archivePath = join(sourceRoot, "snapshot-check.tgz");
    await pipeline(
      await createProjectArchive(sourceDirectory, {
        sourceKey,
        projectId: created.snapshot.project.id,
        title: created.snapshot.project.title,
        revision: created.revision,
      }),
      createWriteStream(archivePath),
    );

    await expect(importProjectArchive(destinationRoot, archivePath)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/清单与项目数据库不一致/),
    });
  });

  it("rejects a package when any extracted file differs from its signed manifest", async () => {
    const root = await temporaryRoot("takeboard-package-integrity-");
    const archivePath = join(root, "tampered.tgz");
    const files = [
      { path: "project.takeboard.json", value: Buffer.from("{}") },
      { path: "takeboard.db", value: Buffer.from("not-a-database") },
    ];
    const manifest = {
      format: "takeboard.project-package",
      version: 1,
      exportedAt: "2026-08-29T12:00:00.000Z",
      sourceKey: "tampered.takeboard",
      projectId: "project_tampered",
      title: "被篡改的项目",
      revision: 1,
      files: files.map((file) => ({
        path: file.path,
        size: file.value.byteLength,
        sha256: "0".repeat(64),
      })),
    };
    await writeTarGzip(archivePath, [
      { name: "takeboard-package.json", value: JSON.stringify(manifest) },
      ...files.map((file) => ({ name: `project/${file.path}`, value: file.value })),
    ]);

    await expect(importProjectArchive(join(root, "projects"), archivePath)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/校验失败/),
    });
  });
});
