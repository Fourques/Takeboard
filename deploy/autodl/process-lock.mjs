import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";

/** Linux flock belongs to the open file description, not a PID or removable marker.
 * Pass this same descriptor to the downloader: an orphaned transfer retains the lease.
 */
export async function acquireDownloadLock(root) {
  try {
    await stat(join(root, ".takeboard-download.lock"));
    throw new Error("存在旧版下载锁；请先确认旧下载进程已退出，再移除旧锁。未启动第二个下载者");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return acquireLease(
    root,
    ".takeboard-download.flock",
    "已有模型下载或校验正在进行；未启动第二个下载者",
  );
}

export function acquireAcceptanceLock(root) {
  return acquireLease(
    root,
    ".takeboard-acceptance.flock",
    "已有云端验收正在进行；未启动第二份验收",
  );
}

async function acquireLease(root, name, busyMessage) {
  if (process.platform !== "linux")
    throw new Error("AutoDL 维护脚本仅支持 Linux，需要 util-linux 的 flock");
  const lock = await open(
    join(root, name),
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("flock", ["--exclusive", "--nonblock", "3"], {
        stdio: ["ignore", "ignore", "ignore", lock.fd],
      });
      child.once("error", reject);
      child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(busyMessage))));
    });
    return lock;
  } catch (error) {
    await lock.close();
    throw error;
  }
}
