import type { Asset, ProjectSnapshot } from "@takeboard/contracts";

type AssetContext = Pick<ProjectSnapshot, "canvasItems" | "entities" | "shots" | "takes">;
export type AssetLocation = { itemId: string; takeId?: string; state: "canvas" | "result" };

/** Prefer the exact visible media, then its result history. Never create a node to navigate. */
export function locateAsset(context: AssetContext, assetId: string): AssetLocation | null {
  const direct = context.canvasItems.find(
    (item) => item.refType === "asset" && item.refId === assetId,
  );
  if (direct) return { itemId: direct.id, state: "canvas" };
  let history: AssetLocation | null = null;
  for (const item of context.canvasItems) {
    if (item.refType !== "shot") continue;
    const shot = context.shots.find((shot) => shot.id === item.refId);
    const takes = context.takes.filter((take) => take.shotId === item.refId);
    const shown =
      takes.find((take) => take.id === shot?.approvedTakeId) ??
      [...takes].reverse().find((take) => take.status !== "rejected");
    if (shown?.assetId === assetId) return { itemId: item.id, takeId: shown.id, state: "canvas" };
    const take = takes.find((take) => take.assetId === assetId);
    if (take && !history) history = { itemId: item.id, takeId: take.id, state: "result" };
  }
  const entity = context.canvasItems.find(
    (item) =>
      item.refType === "entity" &&
      context.entities
        .find((entity) => entity.id === item.refId)
        ?.referenceAssetIds.includes(assetId),
  );
  return entity ? { itemId: entity.id, state: "canvas" } : history;
}

/** Display-only disambiguation: keep user filenames, paths, prompts and saved IDs untouched. */
export function assetDisplayNames(assets: Asset[]): Map<string, string> {
  const groups = new Map<string, Asset[]>();
  for (const asset of assets) {
    const name = asset.originalName.replace(/\.[^.]+$/, "") || asset.originalName;
    groups.set(name, [...(groups.get(name) ?? []), asset]);
  }
  const result = new Map<string, string>();
  for (const [name, group] of groups) {
    group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    group.forEach((asset, index) => {
      result.set(asset.id, group.length > 1 ? `${name} · ${index + 1}` : name);
    });
  }
  return result;
}
