import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";

/** An OS-backed SQLite lock, not a PID-file heuristic. Survives PID reuse and is
 * released by the OS after crashes. Never delete/replace the lock database inode.
 */
export function acquireInstanceLease(dataRoot: string) {
  mkdirSync(resolve(dataRoot), { recursive: true, mode: 0o700 });
  const root = realpathSync(resolve(dataRoot));
  const systemRoot = join(root, ".system");
  mkdirSync(systemRoot, { recursive: true, mode: 0o700 });
  const client = new BetterSqlite3(join(systemRoot, "instance-lock.db"), { timeout: 0 });
  try {
    client.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    client.close();
    throw new Error(
      "此数据目录已有 TakeBoard 正在运行。请打开现有实例，或先从原启动方式停止服务；未启动第二个实例。",
      { cause: error },
    );
  }
  const token = randomUUID();
  const recordPath = join(systemRoot, "instance.json");
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      if (record.token === token) unlinkSync(recordPath);
    } catch {
      /* Missing/stale discovery metadata does not change lock ownership. */
    }
    try {
      client.exec("ROLLBACK");
    } finally {
      client.close();
    }
  };
  try {
    const idPath = join(root, ".takeboard-instance-id");
    let instanceId: string;
    try {
      instanceId = readFileSync(idPath, "utf8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      instanceId = randomUUID();
      try {
        writeFileSync(idPath, `${instanceId}\n`, { flag: "wx", mode: 0o600 });
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
        instanceId = readFileSync(idPath, "utf8").trim();
      }
    }
    if (!/^[A-Za-z0-9-]{10,100}$/.test(instanceId)) throw new Error("数据目录中的实例标识无效");
    return {
      instanceId,
      release,
      publish(port: number, version: string) {
        if (released) throw new Error("Instance lease has been released");
        const temporary = `${recordPath}.${token}.tmp`;
        try {
          writeFileSync(
            temporary,
            JSON.stringify({ token, pid: process.pid, instanceId, port, version }),
            { mode: 0o600 },
          );
          renameSync(temporary, recordPath);
        } finally {
          try {
            unlinkSync(temporary);
          } catch {
            /* renamed or never created */
          }
        }
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
