import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, opendir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import BetterSqlite3 from "better-sqlite3";
import { extract, type Header, pack } from "tar-stream";
import type { AuthService } from "./auth-service.js";
import {
  createProjectArchive,
  findActiveProjectById,
  importProjectArchive,
} from "./project-archive.js";
import { acquireProjectLock, acquireProjectLocks } from "./project-request-lock.js";
import { ProjectStore } from "./storage/project-store.js";

const manifestName = "takeboard-instance.json";
const identityName = "identity/auth.db";
const maxManifestBytes = 2 * 1024 * 1024;
const maxEntries = 10_000;
const maxExpandedBytes = 2 * 1024 * 1024 * 1024 * 1024;

type BackupFile = { path: string; size: number; sha256: string };
type BackupProject = { key: string; projectId: string; title: string; revision: number };

export type InstanceBackupManifest = {
  format: "takeboard.instance-backup";
  version: 1;
  createdAt: string;
  projects: BackupProject[];
  users: number;
  files: BackupFile[];
};

export type StoredInstanceBackup = {
  id: string;
  filename: string;
  createdAt: string;
  size: number;
  projectCount: number;
  userCount: number;
};

export type StagedRestore = {
  restoreId: string;
  createdAt: string;
  projectCount: number;
  userCount: number;
  projects: Array<BackupProject & { alreadyExists: boolean }>;
  expiresAt: string;
};

export class InstanceBackupError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409 | 413,
    message: string,
  ) {
    super(message);
    this.name = "InstanceBackupError";
  }
}

function isProjectKey(value: string) {
  return /^[a-z0-9][a-z0-9-]{0,80}\.takeboard$/.test(value) && basename(value) === value;
}

function safePath(value: string) {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/")) {
    throw new InstanceBackupError(400, "实例备份包含不安全路径");
  }
  const normalized = normalize(value).split(sep).join("/");
  if (normalized !== value || value.split("/").some((part) => part === "" || part === "..")) {
    throw new InstanceBackupError(400, "实例备份包含路径穿越内容");
  }
  return value;
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function addBuffer(
  archive: ReturnType<typeof pack>,
  header: Partial<Header> & Pick<Header, "name">,
  value: Buffer,
) {
  return new Promise<void>((resolveEntry, rejectEntry) => {
    archive.entry(header, value, (error) => (error ? rejectEntry(error) : resolveEntry()));
  });
}

async function projectKeys(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && isProjectKey(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function createInstanceBackup(projectsRoot: string, auth: AuthService) {
  const root = resolve(projectsRoot);
  const releaseCatalog = await acquireProjectLock("__catalog__");
  const keys = await projectKeys(root);
  let releaseProjects: () => void;
  try {
    releaseProjects = await acquireProjectLocks(keys);
  } catch (error) {
    releaseCatalog();
    throw error;
  }
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const backupsRoot = join(root, ".system", "backups");
  const workRoot = join(backupsRoot, `.creating-${id}`);
  const filesRoot = join(workRoot, "files");
  const destination = join(backupsRoot, `${id}.takeboard-instance.tgz`);
  try {
    await mkdir(filesRoot, { recursive: true, mode: 0o700 });
    const identityPath = join(filesRoot, identityName);
    await mkdir(dirname(identityPath), { recursive: true, mode: 0o700 });
    auth.backupDatabase(identityPath);
    const projects: BackupProject[] = [];
    for (const key of keys) {
      const directory = join(root, key);
      const store = ProjectStore.openExisting(directory);
      if (!store) continue;
      let current: ReturnType<ProjectStore["loadCurrent"]>;
      try {
        current = store.loadCurrent();
        if (!current) continue;
        const active = current.snapshot.runs.filter(
          (run) => !["completed", "failed", "cancelled"].includes(run.status),
        );
        if (active.length) {
          throw new InstanceBackupError(
            409,
            `“${current.snapshot.project.title}”仍有 ${active.length} 个生成任务，完成或停止后再备份`,
          );
        }
      } finally {
        store.close();
      }
      if (!current) continue;
      const projectPackagePath = join(filesRoot, "projects", `${key}.tgz`);
      await mkdir(dirname(projectPackagePath), { recursive: true, mode: 0o700 });
      await pipeline(
        await createProjectArchive(directory, {
          sourceKey: key,
          projectId: current.snapshot.project.id,
          title: current.snapshot.project.title,
          revision: current.revision,
        }),
        createWriteStream(projectPackagePath, { flags: "wx", mode: 0o600 }),
      );
      projects.push({
        key,
        projectId: current.snapshot.project.id,
        title: current.snapshot.project.title,
        revision: current.revision,
      });
    }
    const usersDatabase = new BetterSqlite3(identityPath, { readonly: true, fileMustExist: true });
    const users = usersDatabase.prepare("SELECT COUNT(*) FROM auth_users").pluck().get() as number;
    usersDatabase.close();
    const relativeFiles = [
      identityName,
      ...projects.map((project) => `projects/${project.key}.tgz`),
    ];
    const files: BackupFile[] = [];
    for (const relativePath of relativeFiles) {
      const file = join(filesRoot, relativePath);
      const info = await stat(file);
      files.push({ path: relativePath, size: info.size, sha256: await sha256File(file) });
    }
    const manifest: InstanceBackupManifest = {
      format: "takeboard.instance-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      projects,
      users,
      files,
    };
    const archive = pack();
    const compressed = archive.pipe(createGzip({ level: 6 }));
    const writing = pipeline(
      compressed,
      createWriteStream(`${destination}.partial`, { flags: "wx", mode: 0o600 }),
    );
    void (async () => {
      try {
        const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
        await addBuffer(
          archive,
          { name: manifestName, size: manifestBuffer.byteLength, mode: 0o600 },
          manifestBuffer,
        );
        for (const file of files) {
          const entry = archive.entry({
            name: file.path,
            size: file.size,
            type: "file",
            mode: 0o600,
          });
          await pipeline(createReadStream(join(filesRoot, file.path)), entry);
        }
        archive.finalize();
      } catch (error) {
        archive.destroy(error instanceof Error ? error : new Error("实例备份打包失败"));
      }
    })();
    await writing;
    await rename(`${destination}.partial`, destination);
    const info = await stat(destination);
    await writeFileMetadata(destination, manifest, info.size);
    await pruneBackups(backupsRoot);
    return storedBackupFromManifest(destination, manifest, info.size);
  } finally {
    releaseProjects();
    releaseCatalog();
    await rm(workRoot, { recursive: true, force: true });
    await rm(`${destination}.partial`, { force: true });
  }
}

async function writeFileMetadata(path: string, manifest: InstanceBackupManifest, size: number) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    `${path}.json`,
    `${JSON.stringify(storedBackupFromManifest(path, manifest, size), null, 2)}\n`,
    { mode: 0o600 },
  );
}

function storedBackupFromManifest(
  path: string,
  manifest: InstanceBackupManifest,
  size: number,
): StoredInstanceBackup {
  return {
    id: basename(path).replace(/\.takeboard-instance\.tgz$/, ""),
    filename: basename(path),
    createdAt: manifest.createdAt,
    size,
    projectCount: manifest.projects.length,
    userCount: manifest.users,
  };
}

async function pruneBackups(root: string) {
  const files = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".takeboard-instance.tgz"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const stale of files.slice(5)) {
    await rm(join(root, stale), { force: true });
    await rm(join(root, `${stale}.json`), { force: true });
  }
}

export async function listInstanceBackups(projectsRoot: string) {
  const root = join(resolve(projectsRoot), ".system", "backups");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const backups: StoredInstanceBackup[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".takeboard-instance.tgz.json")) continue;
    try {
      const parsed = JSON.parse(
        await readFile(join(root, entry.name), "utf8"),
      ) as StoredInstanceBackup;
      const archive = join(root, parsed.filename);
      const info = await stat(archive);
      if (info.isFile() && info.size === parsed.size) backups.push(parsed);
    } catch {
      // Ignore partial or manually damaged backup metadata.
    }
  }
  return backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function instanceBackupPath(projectsRoot: string, id: string) {
  if (!/^[A-Za-z0-9-]{10,100}$/.test(id)) return null;
  return join(resolve(projectsRoot), ".system", "backups", `${id}.takeboard-instance.tgz`);
}

function parseManifest(value: Buffer) {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value.toString("utf8"));
  } catch {
    throw new InstanceBackupError(400, "实例备份清单不是有效 JSON");
  }
  const manifest = candidate as Partial<InstanceBackupManifest> | null;
  if (
    manifest?.format !== "takeboard.instance-backup" ||
    manifest.version !== 1 ||
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !Array.isArray(manifest.projects) ||
    !Number.isSafeInteger(manifest.users) ||
    (manifest.users ?? -1) < 0 ||
    !Array.isArray(manifest.files)
  ) {
    throw new InstanceBackupError(400, "实例备份格式或版本不受支持");
  }
  const files = manifest.files.map((file) => {
    if (
      !file ||
      typeof file.path !== "string" ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new InstanceBackupError(400, "实例备份文件清单无效");
    return { path: safePath(file.path), size: file.size, sha256: file.sha256 };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length)
    throw new InstanceBackupError(400, "实例备份包含重复文件");
  const projects = manifest.projects.map((project) => {
    if (
      !project ||
      typeof project.key !== "string" ||
      !isProjectKey(project.key) ||
      typeof project.projectId !== "string" ||
      project.projectId.length < 1 ||
      project.projectId.length > 256 ||
      typeof project.title !== "string" ||
      project.title.trim().length < 1 ||
      project.title.length > 200 ||
      !Number.isSafeInteger(project.revision) ||
      project.revision < 1
    ) {
      throw new InstanceBackupError(400, "实例备份项目清单无效");
    }
    return {
      key: project.key,
      projectId: project.projectId,
      title: project.title,
      revision: project.revision,
    };
  });
  if (
    new Set(projects.map((project) => project.key)).size !== projects.length ||
    new Set(projects.map((project) => project.projectId)).size !== projects.length
  ) {
    throw new InstanceBackupError(400, "实例备份包含重复项目");
  }
  const expectedFiles = new Set([
    identityName,
    ...projects.map((project) => `projects/${project.key}.tgz`),
  ]);
  if (expectedFiles.size !== files.length || files.some((file) => !expectedFiles.has(file.path))) {
    throw new InstanceBackupError(400, "实例备份文件与项目清单不一致");
  }
  return { ...(manifest as InstanceBackupManifest), projects, files };
}

async function pruneExpiredRestoreStages(root: string) {
  const restoresRoot = join(root, ".system", "restores");
  const entries = await readdir(restoresRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const directory = join(restoresRoot, entry.name);
    try {
      const staged = JSON.parse(
        await readFile(join(directory, "restore.json"), "utf8"),
      ) as Partial<StagedRestore>;
      if (typeof staged.expiresAt === "string" && Date.parse(staged.expiresAt) <= Date.now()) {
        await rm(directory, { recursive: true, force: true });
      }
    } catch {
      const information = await stat(directory).catch(() => null);
      if (information && information.mtimeMs < Date.now() - 2 * 60 * 60 * 1000) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}

export async function stageInstanceRestore(
  projectsRoot: string,
  archivePath: string,
): Promise<StagedRestore> {
  const root = resolve(projectsRoot);
  await pruneExpiredRestoreStages(root);
  const restoreId = randomUUID();
  const workRoot = join(root, ".system", "restores", restoreId);
  const filesRoot = join(workRoot, "files");
  await mkdir(filesRoot, { recursive: true, mode: 0o700 });
  const actual = new Map<string, BackupFile>();
  let manifestBuffer: Buffer | null = null;
  let entries = 0;
  let expanded = 0;
  const unpack = extract();
  unpack.on("entry", (header, stream, next) => {
    void (async () => {
      const name = safePath(header.name);
      entries += 1;
      if (entries > maxEntries) throw new InstanceBackupError(413, "实例备份条目过多");
      if (header.type !== "file") throw new InstanceBackupError(400, "实例备份只能包含文件");
      const declared = header.size ?? 0;
      expanded += declared;
      if (expanded > maxExpandedBytes)
        throw new InstanceBackupError(413, "实例备份解压后超过安全上限");
      if (name === manifestName) {
        if (manifestBuffer || declared > maxManifestBytes)
          throw new InstanceBackupError(400, "实例备份清单无效");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          size += buffer.length;
          if (size > maxManifestBytes) throw new InstanceBackupError(413, "实例备份清单过大");
          chunks.push(buffer);
        }
        manifestBuffer = Buffer.concat(chunks);
        return;
      }
      if (
        name !== identityName &&
        !/^projects\/[a-z0-9][a-z0-9-]{0,80}\.takeboard\.tgz$/.test(name)
      )
        throw new InstanceBackupError(400, "实例备份目录结构无效");
      if (actual.has(name)) throw new InstanceBackupError(400, "实例备份包含重复文件路径");
      const destination = join(filesRoot, name);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const hash = createHash("sha256");
      let size = 0;
      const measure = new Transform({
        transform(chunk, _encoding, callback) {
          const buffer = Buffer.from(chunk);
          size += buffer.length;
          if (size > declared)
            return callback(new InstanceBackupError(413, "实例备份文件长度异常"));
          hash.update(buffer);
          callback(null, buffer);
        },
      });
      await pipeline(stream, measure, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
      if (size !== declared) throw new InstanceBackupError(400, "实例备份文件不完整");
      actual.set(name, { path: name, size, sha256: hash.digest("hex") });
    })().then(() => next(), next);
  });
  try {
    await pipeline(createReadStream(archivePath), createGunzip(), unpack);
    if (!manifestBuffer) throw new InstanceBackupError(400, "实例备份缺少清单");
    const manifest = parseManifest(manifestBuffer);
    if (manifest.files.length !== actual.size)
      throw new InstanceBackupError(400, "实例备份文件数量与清单不一致");
    for (const file of manifest.files) {
      const value = actual.get(file.path);
      if (!value || value.size !== file.size || value.sha256 !== file.sha256)
        throw new InstanceBackupError(400, `实例备份文件校验失败：${file.path}`);
    }
    if (!actual.has(identityName)) throw new InstanceBackupError(400, "实例备份缺少身份数据库");
    const identity = new BetterSqlite3(join(filesRoot, identityName), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      if (identity.pragma("quick_check", { simple: true }) !== "ok")
        throw new Error("identity database quick_check failed");
      const users = identity.prepare("SELECT COUNT(*) FROM auth_users").pluck().get() as number;
      if (users !== manifest.users) throw new Error("identity user count mismatch");
    } finally {
      identity.close();
    }
    const validationRoot = join(workRoot, "validated");
    await mkdir(validationRoot, { recursive: true, mode: 0o700 });
    for (const project of manifest.projects) {
      if (!isProjectKey(project.key) || !actual.has(`projects/${project.key}.tgz`))
        throw new InstanceBackupError(400, "实例备份项目清单无效");
      const checked = await importProjectArchive(
        validationRoot,
        join(filesRoot, "projects", `${project.key}.tgz`),
      );
      if (checked.projectId !== project.projectId || checked.revision !== project.revision)
        throw new InstanceBackupError(400, `项目校验不一致：${project.title}`);
    }
    await rm(validationRoot, { recursive: true, force: true });
    const projects = await Promise.all(
      manifest.projects.map(async (project) => ({
        ...project,
        alreadyExists: Boolean(await findActiveProjectById(root, project.projectId)),
      })),
    );
    const staged: StagedRestore = {
      restoreId,
      createdAt: manifest.createdAt,
      projectCount: manifest.projects.length,
      userCount: manifest.users,
      projects,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(workRoot, "restore.json"), `${JSON.stringify(staged, null, 2)}\n`, {
      mode: 0o600,
    });
    return staged;
  } catch (error) {
    await rm(workRoot, { recursive: true, force: true });
    if (error instanceof InstanceBackupError) throw error;
    throw new InstanceBackupError(
      400,
      error instanceof Error ? `无法验证实例备份：${error.message}` : "无法验证实例备份",
    );
  }
}

export async function readStagedRestore(projectsRoot: string, restoreId: string) {
  if (!/^[a-f0-9-]{36}$/.test(restoreId)) return null;
  const root = join(resolve(projectsRoot), ".system", "restores", restoreId);
  try {
    const staged = JSON.parse(await readFile(join(root, "restore.json"), "utf8")) as StagedRestore;
    if (Date.parse(staged.expiresAt) <= Date.now()) {
      await rm(root, { recursive: true, force: true });
      return null;
    }
    return staged;
  } catch {
    return null;
  }
}

export async function applyStagedProjectRestore(
  projectsRoot: string,
  restoreId: string,
  auth: AuthService,
  actorId: string,
) {
  const staged = await readStagedRestore(projectsRoot, restoreId);
  if (!staged) throw new InstanceBackupError(404, "恢复会话不存在或已经过期");
  const root = resolve(projectsRoot);
  const workRoot = join(root, ".system", "restores", restoreId);
  const releaseCatalog = await acquireProjectLock("__catalog__");
  let releaseProjects: () => void;
  try {
    releaseProjects = await acquireProjectLocks(staged.projects.map((project) => project.key));
  } catch (error) {
    releaseCatalog();
    throw error;
  }
  const restored: string[] = [];
  const skipped: string[] = [];
  try {
    for (const project of staged.projects) {
      if (await findActiveProjectById(root, project.projectId)) {
        skipped.push(project.title);
        continue;
      }
      const imported = await importProjectArchive(
        root,
        join(workRoot, "files", "projects", `${project.key}.tgz`),
      );
      auth.grantProjectOwner(imported.projectId, actorId);
      restored.push(imported.title);
    }
    auth.audit(
      actorId,
      "backup.projects_restored",
      "instance",
      null,
      { restoreId, restored: restored.length, skipped: skipped.length },
      null,
    );
    return { restored, skipped, identityRestored: false as const };
  } finally {
    releaseProjects();
    releaseCatalog();
    await rm(workRoot, { recursive: true, force: true });
  }
}

export async function removeStagedRestore(projectsRoot: string, restoreId: string) {
  if (!/^[a-f0-9-]{36}$/.test(restoreId)) return false;
  const root = join(resolve(projectsRoot), ".system", "restores", restoreId);
  try {
    const handle = await opendir(root);
    await handle.close();
  } catch {
    return false;
  }
  await rm(root, { recursive: true, force: true });
  return true;
}

export async function restoreInstanceOffline(
  projectsRoot: string,
  archivePath: string,
  authDatabasePath: string,
) {
  const root = resolve(projectsRoot);
  const staged = await stageInstanceRestore(root, resolve(archivePath));
  const workRoot = join(root, ".system", "restores", staged.restoreId);
  const rollbackRoot = join(root, ".system", "offline-restore-rollbacks", staged.restoreId);
  const rollbackProjects = join(rollbackRoot, "projects");
  const authPath = resolve(authDatabasePath);
  const previousAuthPath = join(rollbackRoot, "auth.db");
  const moved: Array<{ from: string; to: string }> = [];
  const importedKeys: string[] = [];
  let authBackedUp = false;
  let authReplaced = false;
  await mkdir(rollbackProjects, { recursive: true, mode: 0o700 });
  try {
    try {
      await copyFile(authPath, previousAuthPath);
      authBackedUp = true;
    } catch {
      // A new instance may not have an identity database yet.
    }
    for (const project of staged.projects) {
      const existing = await findActiveProjectById(root, project.projectId);
      if (!existing) continue;
      const from = join(root, existing);
      const to = join(rollbackProjects, existing);
      await rename(from, to);
      moved.push({ from, to });
    }
    for (const project of staged.projects) {
      const imported = await importProjectArchive(
        root,
        join(workRoot, "files", "projects", `${project.key}.tgz`),
      );
      importedKeys.push(imported.key);
    }
    await mkdir(dirname(authPath), { recursive: true, mode: 0o700 });
    for (const suffix of ["-wal", "-shm", "-journal"])
      await rm(`${authPath}${suffix}`, { force: true });
    await copyFile(join(workRoot, "files", identityName), authPath);
    authReplaced = true;
    const restoredIdentity = new BetterSqlite3(authPath, { fileMustExist: true });
    try {
      restoredIdentity.pragma("foreign_keys = ON");
      restoredIdentity.transaction(() => {
        restoredIdentity.prepare("DELETE FROM auth_sessions").run();
        restoredIdentity.prepare("DELETE FROM auth_login_failures").run();
      })();
      if (restoredIdentity.pragma("quick_check", { simple: true }) !== "ok") {
        throw new Error("恢复后的身份数据库完整性检查失败");
      }
    } finally {
      restoredIdentity.close();
    }
    const receipt = {
      format: "takeboard.offline-restore-receipt",
      version: 1,
      restoredAt: new Date().toISOString(),
      sourceCreatedAt: staged.createdAt,
      projects: staged.projectCount,
      users: staged.userCount,
      sessionsRevoked: true,
      previousData: rollbackRoot,
    };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(rollbackRoot, "restore-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600 },
    );
    await rm(workRoot, { recursive: true, force: true });
    return receipt;
  } catch (error) {
    if (authReplaced) {
      if (authBackedUp) await copyFile(previousAuthPath, authPath).catch(() => undefined);
      else await rm(authPath, { force: true }).catch(() => undefined);
    }
    for (const key of importedKeys.reverse())
      await rm(join(root, key), { recursive: true, force: true });
    for (const entry of moved.reverse()) await rename(entry.to, entry.from).catch(() => undefined);
    await rm(workRoot, { recursive: true, force: true });
    throw error;
  }
}
