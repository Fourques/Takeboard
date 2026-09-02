#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const supportedExtensions = new Set([".appimage", ".deb", ".dmg", ".exe", ".msi", ".rpm"]);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return paths.flat();
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const bundleRoot = resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("请提供 Tauri bundle 目录");
const installers = (await filesBelow(bundleRoot)).filter((path) =>
  supportedExtensions.has(extname(path).toLowerCase()),
);
if (installers.length === 0) throw new Error(`没有在 ${bundleRoot} 找到桌面安装包`);

for (const installer of installers) {
  const checksum = `${await sha256(installer)}  ${basename(installer)}\n`;
  await writeFile(`${installer}.sha256`, checksum, "utf8");
  console.log(`${basename(installer)}: ${checksum.slice(0, 64)}`);
}
