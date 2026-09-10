import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { storageFolder } from "./project-locations.js";

export type ProjectLocation = { storageRootId: string; storageFolder: string };
export type DeviceSettings = { version: 1; revision: number; projectLocation: ProjectLocation };
const file = (root: string) => join(root, ".system", "device-settings.json");

export async function readDeviceSettings(root: string): Promise<DeviceSettings> {
  let source: string;
  try {
    source = await readFile(file(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      version: 1,
      revision: 0,
      projectLocation: { storageRootId: "instance", storageFolder: "" },
    };
  }
  let value: DeviceSettings;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("设备设置损坏，请恢复配置；未使用替代保存位置");
  }
  if (
    value?.version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.projectLocation?.storageRootId !== "string" ||
    typeof value.projectLocation?.storageFolder !== "string"
  )
    throw new Error("设备设置损坏，请恢复配置；未使用替代保存位置");
  return value;
}

/** Caller holds the device-settings lock. Defaults affect new projects only. */
export async function saveDeviceSettings(
  root: string,
  revision: number,
  location: ProjectLocation,
) {
  const previous = await readDeviceSettings(root);
  if (previous.revision !== revision)
    throw Object.assign(new Error("设置已在其他窗口修改，请重新打开设置后再保存"), {
      statusCode: 409,
    });
  await storageFolder(root, location.storageRootId, location.storageFolder);
  const next: DeviceSettings = { version: 1, revision: revision + 1, projectLocation: location };
  await mkdir(join(root, ".system"), { recursive: true, mode: 0o700 });
  const temporary = `${file(root)}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(next), { flag: "wx", mode: 0o600 });
    await rename(temporary, file(root));
  } finally {
    await rm(temporary, { force: true });
  }
  return next;
}
