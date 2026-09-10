import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Called only under the project's exclusive job ownership, before a new attempt. */
export async function cleanupInterruptedOutput(destination: string) {
  const prefix = `${basename(destination)}.`;
  const entries = await readdir(dirname(destination), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.name.startsWith(prefix) &&
      /^[a-f0-9-]{36}\.partial$/i.test(entry.name.slice(prefix.length))
    )
      await unlink(join(dirname(destination), entry.name));
  }
}

export type TransferProgress = {
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
};

/** Only publish a complete, flushed file. A failed attempt never damages a prior result. */
export async function saveOutputResponse(
  response: Response,
  destination: string,
  progress: (value: TransferProgress) => void = () => {},
  signal?: AbortSignal,
) {
  if (!response.ok || !response.body) throw new Error("生成文件没有可读取的内容");
  const rawLength = response.headers.get("content-length");
  const length = rawLength && /^\d+$/.test(rawLength) ? Number(rawLength) : null;
  // Fetch decodes compressed bodies; their wire length must not be compared with decoded bytes.
  const totalBytes =
    !response.headers.get("content-encoding") && Number.isSafeInteger(length) ? length : null;
  const temporary = `${destination}.${randomUUID()}.partial`;
  const reader = response.body.getReader();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  const hash = createHash("sha256");
  let receivedBytes = 0;
  try {
    signal?.throwIfAborted();
    await mkdir(dirname(destination), { recursive: true });
    handle = await open(temporary, "wx", 0o600);
    progress({ receivedBytes, totalBytes, percent: totalBytes ? 0 : null });
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
        if (!bytesWritten) throw new Error("项目磁盘无法继续写入");
        offset += bytesWritten;
      }
      hash.update(value);
      receivedBytes += value.byteLength;
      if (totalBytes !== null && receivedBytes > totalBytes) throw new Error("生成文件长度不一致");
      progress({
        receivedBytes,
        totalBytes,
        percent: totalBytes ? Math.min(99, Math.floor((receivedBytes / totalBytes) * 100)) : null,
      });
    }
    if (!receivedBytes || (totalBytes !== null && receivedBytes !== totalBytes))
      throw new Error("生成文件不完整，保留远端结果等待重新下载");
    await handle.sync();
    await handle.close();
    signal?.throwIfAborted();
    await rename(temporary, destination);
    return { byteSize: receivedBytes, sha256: hash.digest("hex") };
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

/** Inspect bounded metadata, including MP4 moov boxes stored after a large mdat. */
export async function readMediaMetadata(path: string, video: boolean) {
  const file = await open(path, "r");
  const limit = 16 * 1024 * 1024;
  try {
    const { size } = await file.stat();
    const prefix = Buffer.alloc(Math.min(size, limit));
    await file.read(prefix, 0, prefix.length, 0);
    if (!video || size <= limit || prefix.toString("ascii", 4, 8) !== "ftyp") return prefix;
    const boxes: Buffer[] = [];
    let offset = 0;
    let scanned = 0;
    while (offset + 8 <= size && boxes.length < 2 && scanned++ < 10_000) {
      const header = Buffer.alloc(16);
      const { bytesRead } = await file.read(header, 0, 16, offset);
      if (bytesRead < 8) break;
      const short = header.readUInt32BE(0);
      const length =
        short === 1 && bytesRead === 16
          ? Number(header.readBigUInt64BE(8))
          : short || size - offset;
      if (
        !Number.isSafeInteger(length) ||
        length < (short === 1 ? 16 : 8) ||
        offset + length > size
      )
        break;
      const type = header.toString("ascii", 4, 8);
      if ((type === "ftyp" || type === "moov") && length <= limit) {
        const box = Buffer.alloc(length);
        await file.read(box, 0, length, offset);
        boxes.push(box);
      }
      offset += length;
    }
    return boxes.length === 2 ? Buffer.concat(boxes) : prefix;
  } finally {
    await file.close();
  }
}
