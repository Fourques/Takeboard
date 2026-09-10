import { createHash } from "node:crypto";
import { mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupInterruptedOutput,
  readMediaMetadata,
  saveOutputResponse,
  type TransferProgress,
} from "../src/output-transfer.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "takeboard-transfer-"));
  roots.push(root);
  return { root, path: join(root, "result.mp4") };
}

describe("durable output downloads", () => {
  it("cleans only an interrupted attempt for the exact owned output", async () => {
    const { root, path } = await fixture();
    const partial = "result.mp4.00000000-0000-4000-8000-000000000000.partial";
    const other = "another.mp4.00000000-0000-4000-8000-000000000000.partial";
    await writeFile(join(root, partial), "interrupted");
    await writeFile(join(root, other), "unrelated");
    await writeFile(path, "already published");
    await cleanupInterruptedOutput(path);
    expect((await readdir(root)).sort()).toEqual([other, "result.mp4"].sort());
    expect(await readFile(path, "utf8")).toBe("already published");
  });
  it("streams chunks, reports measured bytes and publishes the complete hash", async () => {
    const { root, path } = await fixture();
    const progress: TransferProgress[] = [];
    const bytes = Buffer.from("a complete video fixture");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 4));
        controller.enqueue(bytes.subarray(4));
        controller.close();
      },
    });
    const saved = await saveOutputResponse(
      new Response(stream, { headers: { "content-length": String(bytes.length) } }),
      path,
      (item) => progress.push(item),
    );
    expect(saved).toEqual({
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(await readFile(path)).toEqual(bytes);
    expect(progress[1]).toMatchObject({ receivedBytes: 4, totalBytes: bytes.length });
    expect(progress.every((item) => item.percent !== null && item.percent < 100)).toBe(true);
    expect(await readdir(root)).toEqual(["result.mp4"]);
  });
  it.each(["truncated", "empty", "too-long"])(
    "preserves an existing result on %s downloads and removes only its own partial",
    async (kind) => {
      const { root, path } = await fixture();
      await writeFile(path, "previous");
      const body = kind === "empty" ? "" : "new";
      const length = kind === "too-long" ? "1" : "20";
      await expect(
        saveOutputResponse(new Response(body, { headers: { "content-length": length } }), path),
      ).rejects.toThrow();
      expect(await readFile(path, "utf8")).toBe("previous");
      expect(await readdir(root)).toEqual(["result.mp4"]);
    },
  );
  it("does not fabricate percentages without a known decoded length", async () => {
    const { path } = await fixture();
    const progress: TransferProgress[] = [];
    await saveOutputResponse(
      new Response("decoded content", {
        headers: { "content-encoding": "gzip", "content-length": "2" },
      }),
      path,
      (item) => progress.push(item),
    );
    expect(progress.every((item) => item.percent === null && item.totalBytes === null)).toBe(true);
  });
  it("cancels a stalled body without publishing or leaving a partial file", async () => {
    const { root, path } = await fixture();
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("partial"));
      },
    });
    const saving = saveOutputResponse(new Response(body), path, () => {}, abort.signal);
    abort.abort();
    await expect(saving).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });
  it("reads MP4 metadata beyond a large mdat without allocating the entire video", async () => {
    const { path } = await fixture();
    const file = await open(path, "w");
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24);
    ftyp.write("ftyp", 4);
    const mdat = Buffer.alloc(8);
    mdat.writeUInt32BE(40 * 1024 * 1024);
    mdat.write("mdat", 4);
    const moov = Buffer.alloc(16);
    moov.writeUInt32BE(16);
    moov.write("moov", 4);
    await file.write(ftyp, 0, ftyp.length, 0);
    await file.write(mdat, 0, 8, 24);
    await file.write(moov, 0, 16, 24 + 40 * 1024 * 1024);
    await file.close();
    expect(await readMediaMetadata(path, true)).toEqual(Buffer.concat([ftyp, moov]));
  });
});
