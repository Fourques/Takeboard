import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "release");
const checksumFiles = (await readdir(directory)).filter((name) => name.endsWith(".sha256"));
if (checksumFiles.length === 0) throw new Error(`没有找到校验文件：${directory}`);

for (const checksumFile of checksumFiles) {
  const line = (await readFile(join(directory, checksumFile), "utf8")).trim();
  const match = /^([a-f0-9]{64})\s{2}([^/\\]+)$/.exec(line);
  if (!match) throw new Error(`校验文件格式无效：${checksumFile}`);
  const expected = match[1];
  const filename = basename(match[2]);
  const artifact = join(directory, filename);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== expected) throw new Error(`${filename} 的 SHA-256 校验失败`);
  console.log(`verified ${filename}`);
}
