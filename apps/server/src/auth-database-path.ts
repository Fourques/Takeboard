import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Older builds accidentally treated an explicit filename as a directory.
 * Preserve that database in place; never silently bootstrap an empty identity store.
 */
export function resolveAuthDatabasePath(projectsRoot: string, configured?: string) {
  if (!configured?.trim()) return resolve(projectsRoot, ".system", "auth.db");
  const path = resolve(configured);
  if (!existsSync(path) || statSync(path).isFile()) return path;
  const legacyPath = join(path, ".system", "auth.db");
  if (statSync(path).isDirectory() && existsSync(legacyPath) && statSync(legacyPath).isFile()) {
    return legacyPath;
  }
  throw new Error("TAKEBOARD_AUTH_DATABASE 必须指向数据库文件，不能指向目录；原数据未修改");
}
