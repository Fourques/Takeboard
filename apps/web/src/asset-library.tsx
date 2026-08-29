import type { Asset, CanvasItem, Entity } from "@takeboard/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { projectApi } from "./api";

type AssetKind = "character" | "location" | "prop";
type AssetScope = "all" | "image" | "video" | "character" | "location" | "prop" | "loose";
type AssetLayout = "grid" | "list";
type AssetSort = "recent" | "name" | "size";
type AssetSlot = "first" | "last" | "reference" | "referenceVideo" | "referenceAudio";

const kindLabels: Record<AssetKind, string> = {
  character: "人物",
  location: "场景",
  prop: "道具",
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return null;
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return minutes > 0
    ? `${minutes}:${seconds.toFixed(seconds < 10 ? 1 : 0).padStart(4, "0")}`
    : `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
}

function assetStem(name: string) {
  return name.replace(/\.[^.]+$/, "") || name;
}

function assetLibraryKind(asset: Asset, related: Entity[]): AssetKind | null {
  if (asset.libraryKind !== undefined) return asset.libraryKind;
  return related[0]?.kind ?? null;
}

function VaultIcon({
  name,
}: {
  name:
    | "canvas"
    | "close"
    | "grid"
    | "image"
    | "info"
    | "link"
    | "list"
    | "search"
    | "tag"
    | "upload"
    | "video";
}) {
  const paths = {
    canvas: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 15l3-3 3 2 4-5 3 4" />
      </>
    ),
    close: (
      <>
        <path d="M6 6l12 12M18 6L6 18" />
      </>
    ),
    grid: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path d="M4 17l5-4 3 2 4-5 5 6" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1.1 1.1M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1.1-1.1" />
      </>
    ),
    list: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="5" cy="6" r="1" />
        <circle cx="5" cy="12" r="1" />
        <circle cx="5" cy="18" r="1" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M16.5 16.5L21 21" />
      </>
    ),
    tag: (
      <>
        <path d="M20 13l-7 7-10-10V3h7z" />
        <circle cx="7.5" cy="7.5" r="1" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M5 20h14" />
      </>
    ),
    video: (
      <>
        <rect x="3" y="5" width="14" height="14" rx="2" />
        <path d="M17 10l4-2v8l-4-2" />
      </>
    ),
  } as const;
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export function AssetLibrary({
  assets,
  busy,
  canvasItems,
  entities,
  onAddToCanvas,
  onClose,
  onInspectMetadata,
  onPickFrame,
  onUpdateAsset,
  onUpload,
  open,
  projectKey,
  selectedFirstFrameId,
  selectedLastFrameId,
  selectedReferenceId,
  selectedReferenceImageIds,
  selectedReferenceVideoIds,
  selectedReferenceAudioIds,
  selectedShotLabel,
  allowedSlots,
}: {
  assets: Asset[];
  busy: boolean;
  canvasItems: CanvasItem[];
  entities: Entity[];
  onAddToCanvas: (assetId: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onInspectMetadata: () => Promise<{
    ok: boolean;
    error?: string;
    updated?: number;
    warnings?: number;
  }>;
  onPickFrame: (assetId: string, slot: AssetSlot) => void;
  onUpdateAsset: (
    assetId: string,
    input: {
      title?: string;
      customTags?: string[];
      libraryKind?: AssetKind | null;
    },
  ) => Promise<{ ok: boolean; error?: string }>;
  onUpload: (
    file: File,
    metadata?: { kind?: AssetKind; name?: string },
  ) => Promise<{ ok: boolean; error?: string; assetId?: string }>;
  open: boolean;
  projectKey: string;
  selectedFirstFrameId: string | null;
  selectedLastFrameId: string | null;
  selectedReferenceId: string | null;
  selectedReferenceImageIds: string[];
  selectedReferenceVideoIds: string[];
  selectedShotLabel: string | null;
  allowedSlots: {
    first: boolean;
    last: boolean;
    reference: boolean;
    referenceVideo: boolean;
    referenceAudio: boolean;
  };
  selectedReferenceAudioIds: string[];
}) {
  const [scope, setScope] = useState<AssetScope>("all");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [layout, setLayout] = useState<AssetLayout>("grid");
  const [sort, setSort] = useState<AssetSort>("recent");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadKind, setUploadKind] = useState<AssetKind | "loose">("loose");
  const [name, setName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [tagValue, setTagValue] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    assetId: string;
    x: number;
    y: number;
  } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    state: "idle" | "uploading" | "success" | "error";
    message: string;
  }>({ state: "idle", message: "原文件保持不变；单个文件不超过 100 MB" });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  const entitiesByAsset = useMemo(() => {
    const result = new Map<string, Entity[]>();
    for (const entity of entities) {
      for (const assetId of entity.referenceAssetIds) {
        result.set(assetId, [...(result.get(assetId) ?? []), entity]);
      }
    }
    return result;
  }, [entities]);

  const canvasAssetIds = useMemo(() => {
    const result = new Set<string>();
    for (const item of canvasItems) {
      if (item.refType === "asset") result.add(item.refId);
      if (item.refType === "entity") {
        const entity = entities.find((candidate) => candidate.id === item.refId);
        for (const assetId of entity?.referenceAssetIds ?? []) result.add(assetId);
      }
    }
    return result;
  }, [canvasItems, entities]);

  const availableAssets = useMemo(
    () => assets.filter((asset) => asset.mediaType === "image" || asset.mediaType === "video"),
    [assets],
  );
  const videosMissingMetadata = useMemo(
    () =>
      availableAssets.filter((asset) => asset.mediaType === "video" && !asset.metadataInspectedAt)
        .length,
    [availableAssets],
  );

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of availableAssets) {
      for (const tag of asset.customTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [availableAssets]);

  const countForScope = (candidate: AssetScope) =>
    availableAssets.filter((asset) => {
      const related = entitiesByAsset.get(asset.id) ?? [];
      const libraryKind = assetLibraryKind(asset, related);
      if (candidate === "all") return true;
      if (candidate === "image" || candidate === "video") return asset.mediaType === candidate;
      if (candidate === "loose") return libraryKind === null;
      return libraryKind === candidate;
    }).length;

  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return availableAssets
      .filter((asset) => {
        const related = entitiesByAsset.get(asset.id) ?? [];
        const libraryKind = assetLibraryKind(asset, related);
        const inScope =
          scope === "all"
            ? true
            : scope === "image" || scope === "video"
              ? asset.mediaType === scope
              : scope === "loose"
                ? libraryKind === null
                : libraryKind === scope;
        const searchable = [
          asset.originalName,
          asset.mimeType,
          libraryKind ? kindLabels[libraryKind] : "待整理",
          ...asset.customTags,
          ...related.flatMap((entity) => [entity.name, entity.description]),
        ]
          .join(" ")
          .toLocaleLowerCase();
        return (
          inScope &&
          (!activeTag || asset.customTags.includes(activeTag)) &&
          (!needle || searchable.includes(needle))
        );
      })
      .sort((left, right) => {
        if (sort === "name") return left.originalName.localeCompare(right.originalName, "zh-CN");
        if (sort === "size") return right.byteSize - left.byteSize;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      });
  }, [activeTag, availableAssets, entitiesByAsset, query, scope, sort]);

  useEffect(() => {
    if (!open) return;
    const preferred =
      selectedReferenceVideoIds[0] ??
      selectedReferenceId ??
      selectedFirstFrameId ??
      selectedLastFrameId ??
      filteredAssets[0]?.id ??
      null;
    setSelectedAssetId((current) =>
      current && filteredAssets.some((asset) => asset.id === current) ? current : preferred,
    );
  }, [
    filteredAssets,
    open,
    selectedFirstFrameId,
    selectedLastFrameId,
    selectedReferenceId,
    selectedReferenceVideoIds,
  ]);

  const selectedAsset = availableAssets.find((asset) => asset.id === selectedAssetId) ?? null;
  const selectedEntities = selectedAsset ? (entitiesByAsset.get(selectedAsset.id) ?? []) : [];
  const selectedKind = selectedAsset ? assetLibraryKind(selectedAsset, selectedEntities) : null;
  const contextAsset = contextMenu
    ? (availableAssets.find((asset) => asset.id === contextMenu.assetId) ?? null)
    : null;

  useEffect(() => {
    setRenameValue(selectedAsset?.originalName ?? "");
    setTagValue("");
    setActionStatus("");
  }, [selectedAsset?.originalName]);

  const selectedSlots = (asset: Asset) => [
    ...(asset.id === selectedFirstFrameId ? ["首帧"] : []),
    ...(asset.id === selectedLastFrameId ? ["尾帧"] : []),
    ...(asset.id === selectedReferenceId ? ["参考"] : []),
    ...(selectedReferenceVideoIds.includes(asset.id) ? ["参考视频"] : []),
  ];

  const handleFiles = async (files: File[]) => {
    const accepted = files.filter((file) => {
      const supported = [
        "image/png",
        "image/jpeg",
        "image/webp",
        "video/mp4",
        "video/webm",
        "video/quicktime",
      ].includes(file.type);
      return supported && file.size <= 100 * 1024 * 1024;
    });
    if (!accepted.length) {
      setUploadStatus({
        state: "error",
        message: "请选择 100 MB 以内的 PNG、JPEG、WebP、MP4、WebM 或 MOV",
      });
      return;
    }
    setUploadStatus({
      state: "uploading",
      message: `正在整理 ${accepted.length} 个素材并生成安全预览…`,
    });
    let completed = 0;
    let lastAssetId: string | undefined;
    for (const file of accepted) {
      const isImage = file.type.startsWith("image/");
      const assetName = accepted.length === 1 ? name.trim() : "";
      const result = await onUpload(
        file,
        isImage
          ? {
              ...(uploadKind !== "loose" ? { kind: uploadKind } : {}),
              ...(assetName ? { name: assetName } : {}),
            }
          : undefined,
      );
      if (!result.ok) {
        setUploadStatus({ state: "error", message: result.error ?? `${file.name} 导入失败` });
        return;
      }
      completed += 1;
      lastAssetId = result.assetId ?? lastAssetId;
    }
    if (lastAssetId) setSelectedAssetId(lastAssetId);
    setName("");
    setUploadStatus({
      state: "success",
      message:
        completed === 1
          ? `${accepted[0]?.name} 已加入项目资产库`
          : `${completed} 个素材已加入项目资产库`,
    });
  };

  const updateTags = async (customTags: string[]) => {
    if (!selectedAsset) return;
    const result = await onUpdateAsset(selectedAsset.id, { customTags });
    setActionStatus(result.ok ? "标签已保存" : (result.error ?? "标签保存失败"));
  };

  const updateKind = async (assetId: string, libraryKind: AssetKind | null) => {
    const result = await onUpdateAsset(assetId, { libraryKind });
    setActionStatus(result.ok ? "分类已更新" : (result.error ?? "分类保存失败"));
    if (result.ok) setContextMenu(null);
  };

  if (!open) return null;
  return (
    <div className="studio-backdrop asset-backdrop">
      <aside className="asset-library" aria-label="项目资产库">
        <header className="asset-library-header">
          <div className="asset-library-title">
            <span className="section-kicker">PROJECT ASSETS</span>
            <div>
              <h2>项目资产库</h2>
              <p>
                {availableAssets.length} 项素材 ·{" "}
                {formatBytes(availableAssets.reduce((total, asset) => total + asset.byteSize, 0))} ·
                原文件本地保存
              </p>
            </div>
          </div>
          <div className="asset-header-actions">
            <div className="asset-organize-help">
              <button
                type="button"
                className="asset-organize-trigger"
                onClick={() => setOrganizeOpen((current) => !current)}
                aria-expanded={organizeOpen}
              >
                <VaultIcon name="info" />
                整理方法
              </button>
              {organizeOpen ? (
                <div className="asset-organize-popover">
                  <strong>一套够用的整理方式</strong>
                  <ol>
                    <li>
                      <b>分类</b>
                      <span>用人物、场景、道具建立稳定结构</span>
                    </li>
                    <li>
                      <b>标签</b>
                      <span>记录版本、情绪或用途，方便组合检索</span>
                    </li>
                    <li>
                      <b>右键</b>
                      <span>快速归类、连接镜头或加入画布</span>
                    </li>
                  </ol>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="asset-import-trigger"
              onClick={() => setImportOpen((current) => !current)}
            >
              <VaultIcon name="upload" />
              导入素材
            </button>
            <button
              type="button"
              className="asset-close-button"
              onClick={onClose}
              aria-label="关闭资产库"
            >
              <VaultIcon name="close" />
            </button>
          </div>
        </header>

        <div className="asset-library-body">
          <nav className="asset-library-nav" aria-label="资产分类">
            <div className="asset-nav-section">
              <span className="asset-nav-label">资料库</span>
              {(
                [
                  ["all", "全部素材", "grid"],
                  ["image", "静态图片", "image"],
                  ["video", "参考视频", "video"],
                  ["loose", "待整理", "info"],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  type="button"
                  key={value}
                  className={scope === value ? "active" : ""}
                  onClick={() => setScope(value)}
                >
                  <VaultIcon name={icon} />
                  <span>{label}</span>
                  <em>{countForScope(value)}</em>
                </button>
              ))}
            </div>
            <div className="asset-nav-section">
              <span className="asset-nav-label">创作资产</span>
              {(["character", "location", "prop"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={scope === value ? "active" : ""}
                  onClick={() => setScope(value)}
                >
                  <span className={`asset-kind-mark ${value}`} />
                  <span>{kindLabels[value]}</span>
                  <em>{countForScope(value)}</em>
                </button>
              ))}
            </div>
            <div className="asset-nav-section asset-tag-navigation">
              <span className="asset-nav-label">标签</span>
              {tags.length ? (
                tags.slice(0, 10).map(([tag, count]) => (
                  <button
                    type="button"
                    key={tag}
                    className={activeTag === tag ? "active" : ""}
                    onClick={() => setActiveTag((current) => (current === tag ? null : tag))}
                  >
                    <VaultIcon name="tag" />
                    <span>{tag}</span>
                    <em>{count}</em>
                  </button>
                ))
              ) : (
                <p>在详情中添加标签，素材会自动汇集到这里。</p>
              )}
            </div>
            <div className="asset-nav-footnote">
              <i />
              素材仅存于当前项目
            </div>
          </nav>

          <main className="asset-library-content">
            <div className="asset-library-toolbar">
              <label className="asset-search">
                <VaultIcon name="search" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、标签或资产描述"
                  aria-label="搜索资产"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} aria-label="清除搜索">
                    ×
                  </button>
                ) : null}
              </label>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as AssetSort)}
                aria-label="资产排序"
              >
                <option value="recent">最近导入</option>
                <option value="name">按名称</option>
                <option value="size">按文件大小</option>
              </select>
              <fieldset className="asset-layout-switch" aria-label="资产布局">
                <button
                  type="button"
                  className={layout === "grid" ? "active" : ""}
                  onClick={() => setLayout("grid")}
                  aria-label="网格视图"
                >
                  <VaultIcon name="grid" />
                </button>
                <button
                  type="button"
                  className={layout === "list" ? "active" : ""}
                  onClick={() => setLayout("list")}
                  aria-label="列表视图"
                >
                  <VaultIcon name="list" />
                </button>
              </fieldset>
            </div>

            {videosMissingMetadata > 0 ? (
              <div className="asset-metadata-banner" role="status">
                <div>
                  <VaultIcon name="video" />
                  <span>
                    <strong>{videosMissingMetadata} 段历史视频缺少尺寸或时长</strong>
                    <small>从原文件补全信息，不转码、不修改视频内容。</small>
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void onInspectMetadata().then((result) => {
                      setActionStatus(
                        result.ok
                          ? `已补全 ${result.updated ?? 0} 段视频${result.warnings ? `，${result.warnings} 个暂无法识别` : ""}`
                          : (result.error ?? "识别失败"),
                      );
                    })
                  }
                >
                  {busy ? "正在识别…" : "补全信息"}
                </button>
              </div>
            ) : null}

            {importOpen ? (
              // biome-ignore lint/a11y/noStaticElementInteractions: Native file dragging requires events on the complete import surface; its button remains keyboard-accessible.
              <div
                className={`asset-import-drawer ${dragActive ? "dragging" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node))
                    setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void handleFiles([...event.dataTransfer.files]);
                }}
              >
                <div className="asset-import-copy">
                  <VaultIcon name="upload" />
                  <div>
                    <strong>导入到资产库</strong>
                    <span>拖入图片或视频；导入不会自动添加到画布</span>
                  </div>
                </div>
                <select
                  aria-label="资产分类"
                  value={uploadKind}
                  onChange={(event) => setUploadKind(event.target.value as AssetKind | "loose")}
                >
                  <option value="loose">暂不分类</option>
                  <option value="character">人物</option>
                  <option value="location">场景</option>
                  <option value="prop">道具</option>
                </select>
                <input
                  aria-label="资产名称"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="名称（单文件可选）"
                />
                <button
                  type="button"
                  disabled={busy || uploadStatus.state === "uploading"}
                  onClick={() => input.current?.click()}
                >
                  选择文件
                </button>
                <div className={`asset-upload-status ${uploadStatus.state}`} aria-live="polite">
                  <i />
                  <span>{uploadStatus.message}</span>
                </div>
              </div>
            ) : null}
            <input
              ref={input}
              className="asset-file-input"
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.mp4,.webm,.mov,image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                if (files.length) void handleFiles(files);
              }}
            />

            <div className="asset-results-heading">
              <div>
                <strong>
                  {activeTag
                    ? `标签 · ${activeTag}`
                    : scope === "all"
                      ? "全部素材"
                      : scope === "loose"
                        ? "待整理"
                        : scope === "image"
                          ? "静态图片"
                          : scope === "video"
                            ? "参考视频"
                            : kindLabels[scope]}
                </strong>
                <span>{filteredAssets.length} 项</span>
              </div>
              {query || activeTag || scope !== "all" ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setActiveTag(null);
                    setScope("all");
                  }}
                >
                  清除筛选
                </button>
              ) : null}
            </div>

            <div className={`asset-results asset-results-${layout}`}>
              {filteredAssets.map((asset) => {
                const related = entitiesByAsset.get(asset.id) ?? [];
                const slots = selectedSlots(asset);
                return (
                  <button
                    type="button"
                    key={asset.id}
                    className={`asset-vault-card ${asset.id === selectedAssetId ? "selected" : ""}`}
                    onClick={() => setSelectedAssetId(asset.id)}
                    onDoubleClick={() => {
                      setSelectedAssetId(asset.id);
                      void onAddToCanvas(asset.id).then((result) =>
                        setActionStatus(result.ok ? "已加入画布" : (result.error ?? "操作失败")),
                      );
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedAssetId(asset.id);
                      setContextMenu({
                        assetId: asset.id,
                        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 230)),
                        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 390)),
                      });
                    }}
                    aria-haspopup="menu"
                  >
                    <div className="asset-card-media">
                      {asset.mediaType === "video" ? (
                        <video
                          src={projectApi.assetUrl(projectKey, asset.id)}
                          muted
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <img src={projectApi.assetUrl(projectKey, asset.id, true)} alt="" />
                      )}
                      <span className="asset-media-type">
                        <VaultIcon name={asset.mediaType === "video" ? "video" : "image"} />
                        {asset.mediaType === "video" ? "VIDEO" : "IMAGE"}
                      </span>
                      {canvasAssetIds.has(asset.id) ? (
                        <span className="asset-canvas-state">
                          <VaultIcon name="canvas" />
                          画布中
                        </span>
                      ) : null}
                    </div>
                    <div className="asset-card-copy">
                      <div>
                        <strong title={asset.originalName}>{assetStem(asset.originalName)}</strong>
                        <span>{formatDate(asset.createdAt)}</span>
                      </div>
                      <p>
                        {related.length
                          ? related
                              .map((entity) => `${kindLabels[entity.kind]} · ${entity.name}`)
                              .join(" / ")
                          : assetLibraryKind(asset, related)
                            ? `${kindLabels[assetLibraryKind(asset, related) as AssetKind]}素材`
                            : "待整理素材"}
                      </p>
                      <div className="asset-card-meta">
                        <span>
                          {asset.width && asset.height
                            ? `${asset.width} × ${asset.height}`
                            : asset.mimeType.split("/")[1]?.toUpperCase()}
                        </span>
                        <span>
                          {asset.mediaType === "video" && formatDuration(asset.durationSeconds)
                            ? formatDuration(asset.durationSeconds)
                            : formatBytes(asset.byteSize)}
                        </span>
                      </div>
                      {slots.length || asset.customTags.length ? (
                        <div className="asset-card-tags">
                          {slots.map((slot) => (
                            <i key={slot}>{slot}</i>
                          ))}
                          {asset.customTags.slice(0, 2).map((tag) => (
                            <i key={tag}>{tag}</i>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
              {!filteredAssets.length ? (
                <div className="asset-empty">
                  <VaultIcon name={query ? "search" : "image"} />
                  <strong>{query ? "没有匹配的素材" : "这里还没有素材"}</strong>
                  <p>调整筛选条件，或导入图片与参考视频。</p>
                  <button type="button" onClick={() => setImportOpen(true)}>
                    导入素材
                  </button>
                </div>
              ) : null}
            </div>
          </main>

          <section className="asset-detail-panel" aria-label="素材详情">
            {selectedAsset ? (
              <>
                <div className="asset-detail-preview">
                  {selectedAsset.mediaType === "video" ? (
                    // biome-ignore lint/a11y/useMediaCaption: User-imported reference clips do not necessarily include caption tracks.
                    <video
                      src={projectApi.assetUrl(projectKey, selectedAsset.id)}
                      controls
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={projectApi.assetUrl(projectKey, selectedAsset.id, true)}
                      alt={selectedAsset.originalName}
                    />
                  )}
                  <span>{selectedAsset.mediaType === "video" ? "VIDEO" : "IMAGE"}</span>
                </div>
                <div className="asset-detail-scroll">
                  <form
                    className="asset-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const title = renameValue.trim();
                      if (!title || title === selectedAsset.originalName) return;
                      void onUpdateAsset(selectedAsset.id, { title }).then((result) =>
                        setActionStatus(result.ok ? "名称已保存" : (result.error ?? "保存失败")),
                      );
                    }}
                  >
                    <label htmlFor="asset-detail-name">素材名称</label>
                    <div>
                      <input
                        id="asset-detail-name"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                      <button
                        type="submit"
                        disabled={
                          busy ||
                          !renameValue.trim() ||
                          renameValue.trim() === selectedAsset.originalName
                        }
                      >
                        保存
                      </button>
                    </div>
                  </form>

                  <div className="asset-detail-section">
                    <span className="asset-detail-label">整理分类</span>
                    <select
                      className="asset-kind-select"
                      value={selectedKind ?? "loose"}
                      disabled={busy}
                      onChange={(event) =>
                        void updateKind(
                          selectedAsset.id,
                          event.target.value === "loose" ? null : (event.target.value as AssetKind),
                        )
                      }
                      aria-label="整理分类"
                    >
                      <option value="loose">待整理</option>
                      <option value="character">人物</option>
                      <option value="location">场景</option>
                      <option value="prop">道具</option>
                    </select>
                    {selectedEntities.length ? (
                      <span className="asset-detail-label asset-related-label">关联档案</span>
                    ) : null}
                    <div className="asset-entity-links">
                      {selectedEntities.length
                        ? selectedEntities.map((entity) => (
                            <span key={entity.id}>
                              <i className={`asset-kind-mark ${entity.kind}`} />
                              {kindLabels[entity.kind]} · {entity.name}
                            </span>
                          ))
                        : null}
                    </div>
                  </div>

                  <div className="asset-detail-section">
                    <span className="asset-detail-label">标签</span>
                    <div className="asset-detail-tags">
                      {selectedAsset.customTags.map((tag) => (
                        <button
                          type="button"
                          key={tag}
                          onClick={() =>
                            void updateTags(
                              selectedAsset.customTags.filter((candidate) => candidate !== tag),
                            )
                          }
                          aria-label={`移除标签 ${tag}`}
                        >
                          {tag}
                          <b>×</b>
                        </button>
                      ))}
                    </div>
                    <form
                      className="asset-tag-input"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const tag = tagValue.trim();
                        if (
                          !tag ||
                          selectedAsset.customTags.includes(tag) ||
                          selectedAsset.customTags.length >= 24
                        )
                          return;
                        setTagValue("");
                        void updateTags([...selectedAsset.customTags, tag]);
                      }}
                    >
                      <input
                        value={tagValue}
                        onChange={(event) => setTagValue(event.target.value)}
                        placeholder="输入标签后回车"
                        aria-label="新增资产标签"
                        maxLength={40}
                      />
                      <button type="submit" disabled={!tagValue.trim()}>
                        ＋
                      </button>
                    </form>
                  </div>

                  <div className="asset-detail-section">
                    <span className="asset-detail-label">文件信息</span>
                    <dl>
                      <div>
                        <dt>类型</dt>
                        <dd>{selectedAsset.mimeType}</dd>
                      </div>
                      <div>
                        <dt>尺寸</dt>
                        <dd>
                          {selectedAsset.width && selectedAsset.height
                            ? `${selectedAsset.width} × ${selectedAsset.height}`
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>大小</dt>
                        <dd>{formatBytes(selectedAsset.byteSize)}</dd>
                      </div>
                      {selectedAsset.mediaType === "video" ? (
                        <>
                          <div>
                            <dt>时长</dt>
                            <dd>{formatDuration(selectedAsset.durationSeconds) ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>帧率</dt>
                            <dd>
                              {selectedAsset.frameRate
                                ? `${selectedAsset.frameRate.toFixed(2).replace(/\.00$/, "")} fps`
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt>识别</dt>
                            <dd title={selectedAsset.metadataInspectionError ?? undefined}>
                              {selectedAsset.metadataInspectionError
                                ? "原文件已保留 · 部分信息不可读"
                                : selectedAsset.metadataInspectedAt
                                  ? "已从原文件读取"
                                  : "等待识别"}
                            </dd>
                          </div>
                        </>
                      ) : null}
                      <div>
                        <dt>导入</dt>
                        <dd>{formatDate(selectedAsset.createdAt)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="asset-detail-section asset-use-section">
                    <span className="asset-detail-label">用于创作</span>
                    <button
                      type="button"
                      className="asset-primary-action"
                      disabled={busy}
                      onClick={() =>
                        void onAddToCanvas(selectedAsset.id).then((result) =>
                          setActionStatus(result.ok ? "已加入画布" : (result.error ?? "操作失败")),
                        )
                      }
                    >
                      <VaultIcon name="canvas" />
                      {canvasAssetIds.has(selectedAsset.id) ? "定位画布节点" : "加入当前画布"}
                    </button>
                    {selectedShotLabel ? (
                      <>
                        <p>连接到「{selectedShotLabel}」</p>
                        <div className="asset-connect-actions">
                          {selectedAsset.mediaType === "image" && allowedSlots.first ? (
                            <button
                              type="button"
                              className={selectedAsset.id === selectedFirstFrameId ? "active" : ""}
                              onClick={() => onPickFrame(selectedAsset.id, "first")}
                            >
                              首帧
                            </button>
                          ) : null}
                          {selectedAsset.mediaType === "image" && allowedSlots.last ? (
                            <button
                              type="button"
                              className={selectedAsset.id === selectedLastFrameId ? "active" : ""}
                              onClick={() => onPickFrame(selectedAsset.id, "last")}
                            >
                              尾帧
                            </button>
                          ) : null}
                          {selectedAsset.mediaType === "image" && allowedSlots.reference ? (
                            <button
                              type="button"
                              className={
                                selectedReferenceImageIds.includes(selectedAsset.id) ||
                                selectedAsset.id === selectedReferenceId
                                  ? "active"
                                  : ""
                              }
                              onClick={() => onPickFrame(selectedAsset.id, "reference")}
                            >
                              参考图
                            </button>
                          ) : null}
                          {selectedAsset.mediaType === "video" && allowedSlots.referenceVideo ? (
                            <button
                              type="button"
                              className={
                                selectedReferenceVideoIds.includes(selectedAsset.id) ? "active" : ""
                              }
                              onClick={() => onPickFrame(selectedAsset.id, "referenceVideo")}
                            >
                              参考视频
                            </button>
                          ) : null}
                          {selectedAsset.mediaType === "audio" && allowedSlots.referenceAudio ? (
                            <button
                              type="button"
                              className={
                                selectedReferenceAudioIds.includes(selectedAsset.id) ? "active" : ""
                              }
                              onClick={() => onPickFrame(selectedAsset.id, "referenceAudio")}
                            >
                              参考音频
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <p>选择一个镜头后，可直接连接到模型输入。</p>
                    )}
                  </div>
                  {actionStatus ? (
                    <div className="asset-action-status" aria-live="polite">
                      {actionStatus}
                    </div>
                  ) : null}
                  <a
                    className="asset-original-link"
                    href={projectApi.assetUrl(projectKey, selectedAsset.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <VaultIcon name="link" />
                    查看原文件
                  </a>
                </div>
              </>
            ) : (
              <div className="asset-detail-empty">
                <VaultIcon name="info" />
                <strong>选择一个素材</strong>
                <p>在这里检查原图、标签和画布用途。</p>
              </div>
            )}
          </section>
        </div>
        {contextAsset && contextMenu ? (
          <div
            className="asset-context-menu"
            role="menu"
            aria-label={`${contextAsset.originalName} 快捷操作`}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="asset-context-heading">
              <strong>{assetStem(contextAsset.originalName)}</strong>
              <span>素材操作</span>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSelectedAssetId(contextAsset.id);
                setContextMenu(null);
              }}
            >
              <VaultIcon name="info" />
              查看详情
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() =>
                void onAddToCanvas(contextAsset.id).then((result) => {
                  setActionStatus(result.ok ? "已加入画布" : (result.error ?? "操作失败"));
                  setContextMenu(null);
                })
              }
            >
              <VaultIcon name="canvas" />
              {canvasAssetIds.has(contextAsset.id) ? "定位画布节点" : "加入当前画布"}
            </button>
            {selectedShotLabel ? (
              <div className="asset-context-group">
                <span>连接到「{selectedShotLabel}」</span>
                <div>
                  {contextAsset.mediaType === "image" && allowedSlots.first ? (
                    <button
                      type="button"
                      onClick={() => {
                        onPickFrame(contextAsset.id, "first");
                        setContextMenu(null);
                      }}
                    >
                      首帧
                    </button>
                  ) : null}
                  {contextAsset.mediaType === "image" && allowedSlots.last ? (
                    <button
                      type="button"
                      onClick={() => {
                        onPickFrame(contextAsset.id, "last");
                        setContextMenu(null);
                      }}
                    >
                      尾帧
                    </button>
                  ) : null}
                  {contextAsset.mediaType === "image" && allowedSlots.reference ? (
                    <button
                      type="button"
                      onClick={() => {
                        onPickFrame(contextAsset.id, "reference");
                        setContextMenu(null);
                      }}
                    >
                      参考图
                    </button>
                  ) : null}
                  {contextAsset.mediaType === "video" && allowedSlots.referenceVideo ? (
                    <button
                      type="button"
                      onClick={() => {
                        onPickFrame(contextAsset.id, "referenceVideo");
                        setContextMenu(null);
                      }}
                    >
                      参考视频
                    </button>
                  ) : null}
                  {contextAsset.mediaType === "audio" && allowedSlots.referenceAudio ? (
                    <button
                      type="button"
                      onClick={() => {
                        onPickFrame(contextAsset.id, "referenceAudio");
                        setContextMenu(null);
                      }}
                    >
                      参考音频
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="asset-context-group asset-context-kinds">
              <span>移动到</span>
              <div>
                {(
                  [
                    ["character", "人物"],
                    ["location", "场景"],
                    ["prop", "道具"],
                    ["loose", "待整理"],
                  ] as const
                ).map(([value, label]) => {
                  const related = entitiesByAsset.get(contextAsset.id) ?? [];
                  const currentKind = assetLibraryKind(contextAsset, related) ?? "loose";
                  return (
                    <button
                      type="button"
                      className={currentKind === value ? "active" : ""}
                      key={value}
                      disabled={busy}
                      onClick={() =>
                        void updateKind(
                          contextAsset.id,
                          value === "loose" ? null : (value as AssetKind),
                        )
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <a
              role="menuitem"
              href={projectApi.assetUrl(projectKey, contextAsset.id)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setContextMenu(null)}
            >
              <VaultIcon name="link" />
              查看原文件
            </a>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
