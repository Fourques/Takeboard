import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isMainModule } from "./is-main-module.mjs";

export const repository = "https://github.com/Fourques/Takeboard";
const api = "https://api.github.com/repos/Fourques/Takeboard/releases?per_page=100";
const versionPattern =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function version(value) {
  if (typeof value !== "string" || value.length > 100) return null;
  const match = value.match(versionPattern);
  if (!match || match[4]?.split(".").some((part) => /^0\d+$/.test(part))) return null;
  return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split(".") ?? [] };
}
export function compareVersions(left, right) {
  const a = version(left),
    b = version(right);
  if (!a || !b) throw new Error("版本号无效");
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length)
    return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/** Require the exact platform/architecture; never offer a different CPU's installer. */
export function selectRelease(releases, { currentVersion, channel, platform, arch }) {
  if (!version(currentVersion)) throw new Error("当前应用版本无效");
  if (!Array.isArray(releases)) throw new Error("发布服务返回了无效数据");
  const eligible = releases.filter(
    (item) =>
      item &&
      !item.draft &&
      version(item.tag_name) &&
      (channel === "beta" || (!item.prerelease && !version(item.tag_name).pre.length)),
  );
  eligible.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const latest = eligible[0];
  if (!latest) return { status: "no_release", release: null };
  if (compareVersions(latest.tag_name, currentVersion) <= 0)
    return { status: "up_to_date", release: null };
  const os = { darwin: "macos", win32: "windows", linux: "linux" }[platform];
  const ext = { darwin: "dmg", win32: "exe", linux: "deb" }[platform];
  const tag = latest.tag_name;
  const standard = `TakeBoard-v${tag.replace(/^v/, "")}-${os}-${arch}.${ext}`;
  // Support both our friendly release names and Tauri's untouched signed filenames.
  const cpu =
    arch === "arm64"
      ? "aarch64"
      : arch === "x64"
        ? platform === "linux"
          ? "amd64"
          : "x64"
        : "unsupported";
  const tauri = `TakeBoard_${tag.replace(/^v/, "")}_${cpu}${platform === "win32" ? "-setup" : ""}.${ext}`;
  const names = [standard, tauri];
  const asset =
    os &&
    ["arm64", "x64"].includes(arch) &&
    latest.assets?.find((item) => {
      if (!names.includes(item.name) || item.state !== "uploaded" || !(item.size > 0)) return false;
      try {
        const url = new URL(item.browser_download_url);
        return (
          url.origin === "https://github.com" &&
          !url.search &&
          !url.hash &&
          decodeURIComponent(url.pathname) ===
            `/Fourques/Takeboard/releases/download/${tag}/${item.name}`
        );
      } catch {
        return false;
      }
    });
  return {
    status: asset ? "update" : "no_installer",
    release: {
      version: tag.replace(/^v/, ""),
      notesUrl: `${repository}/releases/tag/${encodeURIComponent(tag)}`,
      // Plain text only, never render release Markdown/HTML from the network.
      notes: typeof latest.body === "string" ? latest.body.slice(0, 12000) : "",
      downloadUrl: asset ? asset.browser_download_url : null,
      filename: asset ? asset.name : null,
    },
  };
}

export async function fetchReleases(fetchImpl = fetch) {
  const response = await fetchImpl(api, {
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "TakeBoard-update-check",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 429
        ? "GitHub 请求频率受限，请稍后重试"
        : `无法检查更新（HTTP ${response.status}）`,
    );
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error("发布数据过大，已停止检查");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function updateCommand({
  file,
  currentVersion,
  operation,
  input = {},
  platform = process.platform,
  arch = process.arch,
  fetchImpl = fetch,
}) {
  let settings = {
    version: 1,
    channel: version(currentVersion)?.pre.length ? "beta" : "stable",
    autoCheck: true,
    skippedVersion: null,
  };
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    if (
      saved.version !== 1 ||
      !["beta", "stable"].includes(saved.channel) ||
      typeof saved.autoCheck !== "boolean" ||
      (saved.skippedVersion !== null && !version(saved.skippedVersion))
    )
      throw new Error("更新设置损坏，请检查应用配置文件");
    settings = saved;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!["status", "save", "check", "automatic"].includes(operation))
    throw new Error("未知更新操作");
  if (operation === "save") {
    if (
      !["beta", "stable"].includes(input.channel) ||
      typeof input.autoCheck !== "boolean" ||
      (input.skippedVersion !== null && !version(input.skippedVersion))
    )
      throw new Error("更新偏好无效");
    settings = {
      version: 1,
      channel: input.channel,
      autoCheck: input.autoCheck,
      skippedVersion: input.skippedVersion,
    };
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(settings), { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const base = { ...settings, currentVersion, platform, arch, status: "idle", release: null };
  if (
    operation === "status" ||
    operation === "save" ||
    (operation === "automatic" && !settings.autoCheck)
  )
    return base;
  try {
    const result = selectRelease(await fetchReleases(fetchImpl), base);
    if (operation === "automatic" && result.release?.version === settings.skippedVersion)
      result.status = "skipped";
    return { ...base, ...result, checkedAt: new Date().toISOString() };
  } catch (error) {
    return {
      ...base,
      status: "error",
      error: error instanceof Error ? error.message : "无法连接发布服务",
    };
  }
}

if (isMainModule(import.meta.url)) {
  try {
    const [file, currentVersion, operation, raw = "{}"] = process.argv.slice(2);
    console.log(
      JSON.stringify(
        await updateCommand({ file, currentVersion, operation, input: JSON.parse(raw) }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
