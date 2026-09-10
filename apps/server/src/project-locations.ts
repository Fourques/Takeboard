import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { access, mkdir, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type StorageRoot = { id: string; name: string; path: string };
const marker = ".takeboard-location.json";
const configuration = (root: string) => join(root, ".system", "project-storage-roots.json");

export function storageRoots(root: string): StorageRoot[] {
  const result = [{ id: "instance", name: "默认项目位置", path: resolve(root) }];
  if (!existsSync(configuration(root))) return result;
  const parsed = JSON.parse(readFileSync(configuration(root), "utf8"));
  if (parsed.version !== 1 || !Array.isArray(parsed.roots))
    throw new Error("项目位置配置损坏，请先恢复配置");
  for (const item of parsed.roots) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[a-f0-9]{24}$/.test(item.id) ||
      typeof item.name !== "string" ||
      typeof item.path !== "string" ||
      !isAbsolute(item.path)
    ) {
      throw new Error("项目位置配置无效");
    }
    result.push(item);
  }
  return result;
}

export function contained(root: string, target: string) {
  const path = relative(root, target);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

/** Index directories keep stable URL keys; the real project lives in the chosen folder.
 * Read failures never fall back to a new empty project in the instance root.
 */
export function projectDirectory(root: string, key: string): string {
  const index = join(root, key);
  const file = join(index, marker);
  if (!existsSync(file)) return index;
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (value.version !== 1 || typeof value.path !== "string" || !isAbsolute(value.path))
    throw new Error("项目位置记录无效");
  // Resolve links on every access, including after a disk was remounted.
  let target: string;
  try {
    // Match fs.promises.realpath used when registering roots. Windows short
    // names/junctions must not mix legacy JS and native canonicalization.
    target = realpathSync.native(value.path);
  } catch {
    throw Object.assign(new Error("项目文件夹不可用，请连接原存储设备后重试；没有创建替代项目"), {
      statusCode: 409,
      code: "PROJECT_LOCATION_UNAVAILABLE",
    });
  }
  const baseRoot = root.endsWith(`${sep}.trash`) ? resolve(root, "..") : root;
  const allowed = storageRoots(baseRoot).some((entry) => {
    try {
      const base = realpathSync.native(entry.path);
      return (
        target !== base && contained(base, target) && !contained(join(base, ".system"), target)
      );
    } catch {
      return false;
    }
  });
  if (!allowed || !lstatSync(target).isDirectory())
    throw new Error("项目文件夹不在允许的位置，或磁盘不可用");
  return target;
}

export async function addStorageRoot(root: string, input: { path: string; name: string }) {
  if (!isAbsolute(input.path) || input.path.length > 4096) throw new Error("请选择绝对文件夹路径");
  const path = await realpath(input.path);
  if (resolve(path, "..") === path) throw new Error("不能将整个磁盘根目录开放为项目位置");
  const instanceRoot = await realpath(root);
  if (
    contained(join(instanceRoot, ".system"), path) ||
    contained(join(instanceRoot, ".trash"), path)
  )
    throw new Error("不能使用 TakeBoard 内部目录");
  await access(path, constants.R_OK | constants.W_OK);
  await readdir(path); // Require a directory, not a writable file.
  const roots = storageRoots(root);
  const existing = roots.find((item) => item.path === path);
  if (existing) return existing;
  const item = {
    id: createHash("sha256").update(path).digest("hex").slice(0, 24),
    name: input.name.trim().slice(0, 100) || "项目位置",
    path,
  };
  await mkdir(join(root, ".system"), { recursive: true, mode: 0o700 });
  const temporary = `${configuration(root)}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({
      version: 1,
      roots: [...roots.filter((entry) => entry.id !== "instance"), item],
    }),
    { flag: "wx", mode: 0o600 },
  );
  await rename(temporary, configuration(root));
  return item;
}

export async function storageFolder(root: string, rootId: string, folder = "") {
  const entry = storageRoots(root).find((item) => item.id === rootId);
  if (!entry) throw new Error("项目位置不存在，请重新选择");
  if (
    isAbsolute(folder) ||
    folder.includes("\\") ||
    folder.split("/").some((part) => part === ".." || part.startsWith(".")) ||
    folder.length > 2048
  )
    throw new Error("文件夹路径无效");
  const base = await realpath(entry.path);
  const path = await realpath(join(base, folder));
  if (!contained(base, path) || folder.split("/").some((part) => part.endsWith(".takeboard")))
    throw new Error("不能在其他项目内部创建项目");
  if (existsSync(join(path, "project.takeboard.json"))) throw new Error("请选择项目之外的父文件夹");
  const actualRelative = relative(base, path);
  if (actualRelative.split(sep).some((part) => part.startsWith(".") || part.endsWith(".takeboard")))
    throw new Error("不能在隐藏目录或其他项目内部创建项目");
  let ancestor = path;
  while (contained(base, ancestor)) {
    if (existsSync(join(ancestor, "project.takeboard.json")))
      throw new Error("不能在其他项目内部创建项目");
    if (ancestor === base) break;
    ancestor = resolve(ancestor, "..");
  }
  await access(path, constants.R_OK | constants.W_OK);
  return { entry, path };
}

export async function linkProjectDirectory(
  root: string,
  key: string,
  directory: string,
  summary: { projectId: string; title: string; updatedAt: string },
) {
  const index = join(root, key);
  if (resolve(index) === resolve(directory)) return;
  await mkdir(index, { mode: 0o700 });
  try {
    await writeFile(
      join(index, marker),
      JSON.stringify({ version: 1, path: directory, ...summary }),
      {
        flag: "wx",
        mode: 0o600,
      },
    );
  } catch (error) {
    // Only this invocation's exclusively reserved index, never the real project.
    await rm(index, { recursive: true, force: true });
    throw error;
  }
}

export function isLocatedProject(root: string, key: string) {
  return existsSync(join(root, key, marker));
}

export async function updateLocatedProjectSummary(
  root: string,
  key: string,
  summary: { projectId: string; title: string; updatedAt: string },
) {
  const file = join(root, key, marker);
  if (!existsSync(file)) return;
  const previous = JSON.parse(readFileSync(file, "utf8"));
  if (previous.version !== 1 || previous.projectId !== summary.projectId)
    throw new Error("项目位置索引不匹配");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ ...previous, ...summary }), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function locatedProjectSummary(
  root: string,
  key: string,
): { projectId: string; title: string; updatedAt: string } | null {
  try {
    const data = JSON.parse(readFileSync(join(root, key, marker), "utf8"));
    if (
      data.version !== 1 ||
      typeof data.projectId !== "string" ||
      typeof data.title !== "string" ||
      typeof data.updatedAt !== "string"
    )
      return null;
    return { projectId: data.projectId, title: data.title, updatedAt: data.updatedAt };
  } catch {
    return null;
  }
}
