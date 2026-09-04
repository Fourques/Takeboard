import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exceptionFile = resolve(repositoryRoot, "security/rust-advisory-exceptions.json");
const lockFile = resolve(repositoryRoot, "apps/desktop/src-tauri/Cargo.lock");
const sourceRoot = resolve(repositoryRoot, "apps/desktop/src-tauri/src");

async function rustSources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await rustSources(path)));
    else if (entry.isFile() && entry.name.endsWith(".rs")) files.push(path);
  }
  return files;
}

function packageVersions(lock, packageName) {
  return [...lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)]
    .filter((match) => match[1] === packageName)
    .map((match) => match[2]);
}

const policy = JSON.parse(await readFile(exceptionFile, "utf8"));
const exception = policy.exceptions?.find((entry) => entry.advisoryId === "RUSTSEC-2024-0429");
if (!exception) throw new Error("RUSTSEC-2024-0429 requires an explicit reviewed exception");

const expiresAt = Date.parse(`${exception.expiresOn}T23:59:59Z`);
if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
  throw new Error(`RUSTSEC-2024-0429 exception expired on ${exception.expiresOn}`);
}

const lock = await readFile(lockFile, "utf8");
const installed = packageVersions(lock, exception.package);
if (installed.length === 0) throw new Error(`Cargo.lock does not contain ${exception.package}`);

const unexpected = installed.filter((version) => !exception.affectedVersions.includes(version));
if (unexpected.length > 0) {
  throw new Error(
    `glib dependency changed to ${unexpected.join(", ")}; review the advisory and update or remove the exception`,
  );
}

for (const source of await rustSources(sourceRoot)) {
  const contents = await readFile(source, "utf8");
  if (contents.includes("VariantStrIter")) {
    throw new Error(`Affected API VariantStrIter became reachable from ${source}`);
  }
}

console.log(
  `RUSTSEC-2024-0429 is confined to glib ${installed.join(", ")} in the Linux preview; ` +
    `TakeBoard Rust sources do not reference the affected API and the exception expires ${exception.expiresOn}.`,
);
