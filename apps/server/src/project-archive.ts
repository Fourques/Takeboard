import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, opendir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve, sep } from "node:path";
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { extract, type Header, pack } from "tar-stream";
import { ProjectStore } from "./storage/project-store.js";

const manifestName = "takeboard-package.json";
const projectPrefix = "project/";
const maxManifestBytes = 2 * 1024 * 1024;
const maxArchiveEntries = 100_000;
const maxExpandedBytes = 1024 * 1024 * 1024 * 1024;
const transientDatabaseSuffixes = ["-wal", "-shm", "-journal"];

type ProjectPackageFile = {
  path: string;
  size: number;
  sha256: string;
};

export type ProjectPackageManifest = {
  format: "takeboard.project-package";
  version: 1;
  exportedAt: string;
  sourceKey: string;
  projectId: string;
  title: string;
  revision: number;
  files: ProjectPackageFile[];
};

export class ProjectArchiveError extends Error {
  constructor(
    readonly statusCode: 400 | 409 | 413,
    message: string,
  ) {
    super(message);
    this.name = "ProjectArchiveError";
  }
}

function portablePath(value: string) {
  return value.split(sep).join("/");
}

function isTransientDatabaseFile(name: string) {
  return transientDatabaseSuffixes.some((suffix) => name.endsWith(suffix));
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventoryProject(directory: string) {
  const root = resolve(directory);
  const files: Array<ProjectPackageFile & { absolutePath: string; mtime: Date }> = [];
  const walk = async (current: string) => {
    const handle = await opendir(current);
    for await (const entry of handle) {
      if (current === root && entry.name === "backups") continue;
      if (entry.name === ".DS_Store" || isTransientDatabaseFile(entry.name)) continue;
      const absolutePath = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ProjectArchiveError(400, `项目包含不支持的符号链接：${entry.name}`);
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new ProjectArchiveError(400, `项目包含不支持的文件类型：${entry.name}`);
      }
      const fileStat = await stat(absolutePath);
      const path = portablePath(relative(root, absolutePath));
      files.push({
        path,
        size: fileStat.size,
        sha256: await sha256File(absolutePath),
        absolutePath,
        mtime: fileStat.mtime,
      });
      if (files.length > maxArchiveEntries) {
        throw new ProjectArchiveError(413, "项目文件数量超过可导出的安全上限");
      }
    }
  };
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function addBufferEntry(
  archive: ReturnType<typeof pack>,
  header: Partial<Header> & Pick<Header, "name">,
  buffer: Buffer,
) {
  return new Promise<void>((resolveEntry, rejectEntry) => {
    archive.entry(header, buffer, (error) => (error ? rejectEntry(error) : resolveEntry()));
  });
}

export async function createProjectArchive(
  directory: string,
  metadata: Omit<ProjectPackageManifest, "format" | "version" | "exportedAt" | "files">,
): Promise<Readable> {
  const files = await inventoryProject(directory);
  const manifest: ProjectPackageManifest = {
    format: "takeboard.project-package",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...metadata,
    files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
  };
  const archive = pack();
  const compressed = archive.pipe(createGzip({ level: 6 }));
  void (async () => {
    try {
      const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await addBufferEntry(
        archive,
        { name: manifestName, size: manifestBuffer.byteLength, mode: 0o600 },
        manifestBuffer,
      );
      for (const file of files) {
        const entry = archive.entry({
          name: `${projectPrefix}${file.path}`,
          size: file.size,
          mode: 0o600,
          mtime: file.mtime,
          type: "file",
        });
        await pipeline(createReadStream(file.absolutePath), entry);
      }
      archive.finalize();
    } catch (error) {
      archive.destroy(error instanceof Error ? error : new Error("项目打包失败"));
    }
  })();
  return compressed;
}

function safeArchivePath(value: string) {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/")) {
    throw new ProjectArchiveError(400, "项目包包含不安全路径");
  }
  const normalized = normalize(value).split(sep).join("/");
  if (normalized !== value || value.split("/").some((part) => part === ".." || part === "")) {
    throw new ProjectArchiveError(400, "项目包包含路径穿越内容");
  }
  return value;
}

function parseManifest(value: Buffer): ProjectPackageManifest {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value.toString("utf8"));
  } catch {
    throw new ProjectArchiveError(400, "项目包清单不是有效 JSON");
  }
  if (!candidate || typeof candidate !== "object") {
    throw new ProjectArchiveError(400, "项目包缺少有效清单");
  }
  const manifest = candidate as Partial<ProjectPackageManifest>;
  if (
    manifest.format !== "takeboard.project-package" ||
    manifest.version !== 1 ||
    typeof manifest.sourceKey !== "string" ||
    typeof manifest.projectId !== "string" ||
    typeof manifest.title !== "string" ||
    typeof manifest.revision !== "number" ||
    !Array.isArray(manifest.files)
  ) {
    throw new ProjectArchiveError(400, "项目包格式或版本不受支持");
  }
  const files = manifest.files.map((entry) => {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new ProjectArchiveError(400, "项目包文件清单无效");
    }
    return { path: safeArchivePath(entry.path), size: entry.size, sha256: entry.sha256 };
  });
  if (new Set(files.map((entry) => entry.path)).size !== files.length) {
    throw new ProjectArchiveError(400, "项目包文件清单包含重复路径");
  }
  return { ...(manifest as ProjectPackageManifest), files };
}

export async function findActiveProjectById(root: string, projectId: string) {
  const directory = await opendir(root);
  for await (const entry of directory) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const marker = JSON.parse(
        await readFile(join(root, entry.name, "project.takeboard.json"), "utf8"),
      ) as { project?: { id?: string } };
      if (marker.project?.id === projectId) return entry.name;
    } catch {
      // A damaged unrelated directory must not block importing a valid package.
    }
  }
  return null;
}

function importedProjectKey(sourceKey: string, title: string) {
  const safeSource = basename(sourceKey)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 120);
  if (safeSource.endsWith(".takeboard") && safeSource.length > ".takeboard".length) {
    return safeSource;
  }
  const safeTitle = [...title.normalize("NFKC")]
    .map((character) =>
      character.codePointAt(0) && (character.codePointAt(0) as number) < 32 ? "-" : character,
    )
    .join("")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${safeTitle || "imported-project"}.takeboard`;
}

async function availableProjectKey(root: string, desired: string) {
  try {
    await stat(join(root, desired));
  } catch {
    return desired;
  }
  const stem = desired.endsWith(".takeboard") ? desired.slice(0, -10) : desired;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem}-${index}.takeboard`;
    try {
      await stat(join(root, candidate));
    } catch {
      return candidate;
    }
  }
  throw new ProjectArchiveError(409, "无法为导入项目分配安全目录");
}

export async function importProjectArchive(projectsRoot: string, archivePath: string) {
  const root = resolve(projectsRoot);
  await mkdir(root, { recursive: true });
  const workRoot = join(root, ".imports", randomUUID());
  const extractedProject = join(workRoot, "project");
  await mkdir(extractedProject, { recursive: true, mode: 0o700 });
  const actualFiles = new Map<string, { size: number; sha256: string }>();
  let manifestBuffer: Buffer | null = null;
  let entryCount = 0;
  let expandedBytes = 0;
  const unpack = extract();
  unpack.on("entry", (header, stream, next) => {
    void (async () => {
      const name = safeArchivePath(header.name);
      entryCount += 1;
      if (entryCount > maxArchiveEntries) {
        throw new ProjectArchiveError(413, "项目包文件数量超过安全上限");
      }
      if (header.type !== "file" && header.type !== "directory") {
        throw new ProjectArchiveError(400, `项目包包含不支持的条目类型：${header.type}`);
      }
      if (header.type === "directory") {
        if (name !== "project" && !name.startsWith(projectPrefix)) {
          throw new ProjectArchiveError(400, "项目包目录结构无效");
        }
        await mkdir(join(workRoot, name), { recursive: true, mode: 0o700 });
        stream.resume();
        return;
      }
      const declaredSize = header.size ?? 0;
      expandedBytes += declaredSize;
      if (expandedBytes > maxExpandedBytes) {
        throw new ProjectArchiveError(413, "项目包解压后超过安全容量上限");
      }
      if (name === manifestName) {
        if (manifestBuffer) throw new ProjectArchiveError(400, "项目包包含重复清单");
        if (declaredSize > maxManifestBytes) {
          throw new ProjectArchiveError(413, "项目包清单过大");
        }
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          length += buffer.byteLength;
          if (length > maxManifestBytes) throw new ProjectArchiveError(413, "项目包清单过大");
          chunks.push(buffer);
        }
        manifestBuffer = Buffer.concat(chunks);
        return;
      }
      if (!name.startsWith(projectPrefix) || name === projectPrefix) {
        throw new ProjectArchiveError(400, "项目包文件必须位于 project 目录内");
      }
      const relativePath = safeArchivePath(name.slice(projectPrefix.length));
      if (actualFiles.has(relativePath)) {
        throw new ProjectArchiveError(400, "项目包包含重复文件路径");
      }
      const destination = join(extractedProject, relativePath);
      if (!destination.startsWith(`${extractedProject}${sep}`)) {
        throw new ProjectArchiveError(400, "项目包文件超出项目目录");
      }
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const hash = createHash("sha256");
      let size = 0;
      const measure = new Transform({
        transform(chunk, _encoding, callback) {
          const buffer = Buffer.from(chunk);
          size += buffer.byteLength;
          if (size > declaredSize || expandedBytes - declaredSize + size > maxExpandedBytes) {
            callback(new ProjectArchiveError(413, "项目包文件大小与清单不符"));
            return;
          }
          hash.update(buffer);
          callback(null, buffer);
        },
      });
      await pipeline(stream, measure, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
      if (size !== declaredSize) throw new ProjectArchiveError(400, "项目包文件长度不完整");
      actualFiles.set(relativePath, { size, sha256: hash.digest("hex") });
    })().then(() => next(), next);
  });

  try {
    await pipeline(createReadStream(archivePath), createGunzip(), unpack);
    if (!manifestBuffer) throw new ProjectArchiveError(400, "项目包缺少清单");
    const manifest = parseManifest(manifestBuffer);
    if (manifest.files.length !== actualFiles.size) {
      throw new ProjectArchiveError(400, "项目包文件数量与清单不一致");
    }
    for (const file of manifest.files) {
      const actual = actualFiles.get(file.path);
      if (!actual || actual.size !== file.size || actual.sha256 !== file.sha256) {
        throw new ProjectArchiveError(400, `项目包文件校验失败：${file.path}`);
      }
    }
    if (!actualFiles.has("project.takeboard.json") || !actualFiles.has("takeboard.db")) {
      throw new ProjectArchiveError(400, "项目包缺少项目清单或数据库");
    }
    const store = ProjectStore.openExisting(extractedProject);
    if (!store) throw new ProjectArchiveError(400, "项目包不是可读取的 TakeBoard 项目");
    let current: ReturnType<ProjectStore["loadCurrent"]>;
    try {
      current = store.loadCurrent();
    } finally {
      store.close();
    }
    if (!current || current.snapshot.project.id !== manifest.projectId) {
      throw new ProjectArchiveError(400, "项目包清单与项目数据库不一致");
    }
    const duplicateKey = await findActiveProjectById(root, manifest.projectId);
    if (duplicateKey) {
      throw new ProjectArchiveError(409, `项目已经存在于“${duplicateKey}”，没有重复导入`);
    }
    const key = await availableProjectKey(
      root,
      importedProjectKey(manifest.sourceKey, current.snapshot.project.title),
    );
    await rename(extractedProject, join(root, key));
    return {
      key,
      title: current.snapshot.project.title,
      projectId: current.snapshot.project.id,
      revision: current.revision,
      manifest,
    };
  } catch (error) {
    if (error instanceof ProjectArchiveError) throw error;
    throw new ProjectArchiveError(
      400,
      error instanceof Error ? `无法读取项目包：${error.message}` : "无法读取项目包",
    );
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}
