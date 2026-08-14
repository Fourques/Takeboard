import type { Asset, Entity } from "@takeboard/contracts";
import { useMemo, useRef, useState } from "react";
import { projectApi } from "./api";

type AssetKind = "character" | "location" | "prop";
type AssetFilter = "all" | AssetKind;

export function AssetLibrary({
  assets,
  busy,
  entities,
  onClose,
  onPickFrame,
  onUpload,
  open,
  projectKey,
  selectedFirstFrameId,
  selectedLastFrameId,
  selectedReferenceId,
}: {
  assets: Asset[];
  busy: boolean;
  entities: Entity[];
  onClose: () => void;
  onPickFrame: (assetId: string, slot: "first" | "last" | "reference") => void;
  onUpload: (file: File, metadata: { kind: AssetKind; name: string }) => Promise<void>;
  open: boolean;
  projectKey: string;
  selectedFirstFrameId: string | null;
  selectedLastFrameId: string | null;
  selectedReferenceId: string | null;
}) {
  const [kind, setKind] = useState<AssetFilter>("all");
  const [uploadKind, setUploadKind] = useState<AssetKind>("character");
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const entityCards = useMemo(
    () => entities.filter((entity) => kind === "all" || entity.kind === kind),
    [entities, kind],
  );
  const referencedAssetIds = useMemo(
    () => new Set(entities.flatMap((entity) => entity.referenceAssetIds)),
    [entities],
  );
  const looseImageAssets = useMemo(
    () =>
      assets.filter((asset) => asset.mediaType === "image" && !referencedAssetIds.has(asset.id)),
    [assets, referencedAssetIds],
  );

  if (!open) return null;
  return (
    <div className="studio-backdrop asset-backdrop">
      <aside className="asset-library">
        <header className="studio-header">
          <div>
            <span className="section-kicker">ASSET VAULT</span>
            <h2>项目资产库</h2>
            <p>人物、场景和道具素材留在自己的项目中</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭资产库">
            ×
          </button>
        </header>
        <div className="asset-kind-tabs">
          {(["all", "character", "location", "prop"] as const).map((item) => (
            <button
              type="button"
              key={item}
              className={kind === item ? "active" : ""}
              onClick={() => {
                setKind(item);
                if (item !== "all") setUploadKind(item);
              }}
            >
              {item === "all"
                ? "全部"
                : item === "character"
                  ? "人物"
                  : item === "location"
                    ? "场景"
                    : "道具"}
              <span>
                {item === "all"
                  ? entities.length + looseImageAssets.length
                  : entities.filter((entity) => entity.kind === item).length}
              </span>
            </button>
          ))}
        </div>
        <div className="asset-grid">
          {entityCards.map((entity) => {
            const asset = [...assets]
              .reverse()
              .find((item) => entity.referenceAssetIds.includes(item.id));
            return (
              <article
                className={`asset-vault-card ${asset?.id === selectedFirstFrameId || asset?.id === selectedLastFrameId || asset?.id === selectedReferenceId ? "selected" : ""}`}
                key={entity.id}
              >
                {asset ? (
                  <img src={projectApi.assetUrl(projectKey, asset.id, true)} alt="" />
                ) : (
                  <div className="asset-placeholder">{entity.name.slice(0, 1)}</div>
                )}
                <div>
                  <strong>{entity.name}</strong>
                  <span>
                    {entity.kind === "character"
                      ? "人物参考"
                      : entity.kind === "location"
                        ? "场景参考"
                        : "道具参考"}
                  </span>
                </div>
                {asset?.mediaType === "image" ? (
                  <div className="asset-slot-actions">
                    <button type="button" onClick={() => onPickFrame(asset.id, "first")}>
                      {asset.id === selectedFirstFrameId ? "✓ 首帧" : "设为首帧"}
                    </button>
                    <button type="button" onClick={() => onPickFrame(asset.id, "last")}>
                      {asset.id === selectedLastFrameId ? "✓ 尾帧" : "设为尾帧"}
                    </button>
                    <button type="button" onClick={() => onPickFrame(asset.id, "reference")}>
                      {asset.id === selectedReferenceId ? "✓ 参考" : "设为参考"}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
          {(kind === "all" ? looseImageAssets : []).map((asset) => (
            <article
              className={`asset-vault-card ${asset.id === selectedFirstFrameId || asset.id === selectedLastFrameId || asset.id === selectedReferenceId ? "selected" : ""}`}
              key={asset.id}
            >
              <img src={projectApi.assetUrl(projectKey, asset.id, true)} alt="" />
              <div>
                <strong>{asset.originalName}</strong>
                <span>未分类图片</span>
              </div>
              <div className="asset-slot-actions">
                <button type="button" onClick={() => onPickFrame(asset.id, "first")}>
                  {asset.id === selectedFirstFrameId ? "✓ 首帧" : "设为首帧"}
                </button>
                <button type="button" onClick={() => onPickFrame(asset.id, "last")}>
                  {asset.id === selectedLastFrameId ? "✓ 尾帧" : "设为尾帧"}
                </button>
                <button type="button" onClick={() => onPickFrame(asset.id, "reference")}>
                  {asset.id === selectedReferenceId ? "✓ 参考" : "设为参考"}
                </button>
              </div>
            </article>
          ))}
          {entityCards.length === 0 && (kind !== "all" || looseImageAssets.length === 0) ? (
            <div className="asset-empty">
              <span>◇</span>
              <strong>
                还没有
                {kind === "all"
                  ? "图片"
                  : kind === "character"
                    ? "人物"
                    : kind === "location"
                      ? "场景"
                      : "道具"}
                资产
              </strong>
              <p>添加后可以拖入镜头，或设为首帧、尾帧和参考图。</p>
            </div>
          ) : null}
        </div>
        <div className="asset-upload-bar">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onUpload(file, { kind: uploadKind, name }).then(() => setName(""));
              }
              event.target.value = "";
            }}
          />
          <select
            aria-label="资产分类"
            value={uploadKind}
            onChange={(event) => setUploadKind(event.target.value as AssetKind)}
          >
            <option value="character">人物</option>
            <option value="location">场景</option>
            <option value="prop">道具</option>
          </select>
          <input
            aria-label="资产名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={
              uploadKind === "character"
                ? "人物名称（可选）"
                : uploadKind === "location"
                  ? "场景名称（可选）"
                  : "道具名称（可选）"
            }
          />
          <button type="button" disabled={busy} onClick={() => input.current?.click()}>
            ＋ 添加
            {uploadKind === "character" ? "人物" : uploadKind === "location" ? "场景" : "道具"}
            资产
          </button>
        </div>
      </aside>
    </div>
  );
}
