import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { starterWorkflows } from "./starter-workflows.mjs";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
const hash = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
async function createMissing(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(file, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

// System images exclude the data disk. Restore only the fixed, tested starter graphs;
// never copy accounts, projects, outputs or execution history into a public image.
export async function seedWorkflows(dataRoot) {
  const userRoot = join(dataRoot, "comfy", "user", "default");
  const marker = join(userRoot, "takeboard", "autodl-starters-v1.json");
  try {
    await access(marker);
    return []; // Removal and edits after first boot are user choices, not installation failures.
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const installed = [];
  for (const recipe of starterWorkflows) {
    const workflowFile = join(userRoot, "workflows", recipe.path);
    const workflowHash = hash(recipe.prompt);
    await createMissing(workflowFile, recipe.prompt);
    let current;
    try {
      current = JSON.parse(await readFile(workflowFile, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) continue; // An edited user file is not ours to repair.
      throw error;
    }
    if (hash(current) !== workflowHash) continue;
    const key = `${Buffer.from(recipe.path).toString("base64url")}.json`;
    await createMissing(join(userRoot, "takeboard", "bindings", key), {
      version: 1,
      workflowPath: recipe.path,
      workflowHash,
      capability: recipe.capability,
      outputMediaType: recipe.outputMediaType,
      parameters: recipe.parameters,
      media: recipe.media,
      trusted: true,
      verifiedAt: "2026-10-13T06:40:15.000Z",
    });
    await createMissing(join(userRoot, "takeboard", "library", key), {
      name: recipe.name,
      included: true,
    });
    installed.push(recipe.path);
  }
  await createMissing(marker, { version: 1, workflows: installed });
  return installed;
}
