import { extname } from "node:path";
import type { ProjectSnapshot, Run } from "@takeboard/contracts";

/** Name the collected copy, never the upstream file. Existing user names remain untouched. */
export function generatedAssetName(
  snapshot: ProjectSnapshot,
  run: Run,
  filename: string,
  image: boolean,
) {
  const shot = snapshot.shots.find((item) => item.id === run.shotId);
  const label =
    (typeof run.parameters.shotLabel === "string" ? run.parameters.shotLabel : shot?.label) ||
    "生成结果";
  const stem =
    [...label]
      .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
      .join("")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/[. ]+$/, "")
      .slice(0, 80) || "生成结果";
  const ordinal = Math.max(
    1,
    snapshot.runs
      .filter((item) => item.shotId === run.shotId)
      .findIndex((item) => item.id === run.id) + 1,
  );
  const base = `${stem} · ${image ? "图片" : "视频"} ${String(ordinal).padStart(2, "0")}`;
  const extension =
    extname(filename)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, "")
      .slice(0, 12) || (image ? ".png" : ".mp4");
  const names = new Set(snapshot.assets.map((asset) => asset.originalName));
  let name = `${base}${extension}`;
  for (let index = 2; names.has(name); index++) name = `${base} (${index})${extension}`;
  return name;
}
