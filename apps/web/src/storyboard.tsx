import type { Asset, ProjectSnapshot, Shot, Take } from "@takeboard/contracts";
import { useMemo, useState } from "react";
import { projectApi } from "./api";

type StoryboardProps = {
  snapshot: ProjectSnapshot;
  projectKey: string | null;
  readOnly: boolean;
  onOpenShot: (shotId: string) => void;
  onReorderShot: (shotId: string, toIndex: number) => Promise<boolean>;
  onClose: () => void;
};

function previewForShot(snapshot: ProjectSnapshot, shot: Shot) {
  const takes = snapshot.takes.filter((take) => take.shotId === shot.id);
  const take =
    takes.find((candidate) => candidate.id === shot.approvedTakeId) ??
    [...takes].reverse().find((candidate) => candidate.status !== "rejected") ??
    null;
  const asset = snapshot.assets.find((candidate) => candidate.id === take?.assetId) ?? null;
  return { take, asset, takeCount: takes.length };
}

function statusLabel(status: Shot["status"]) {
  if (status === "approved") return "已采用";
  if (status === "review") return "待选择";
  if (status === "generating") return "生成中";
  return "待制作";
}

function StoryboardMedia({
  asset,
  take,
  projectKey,
  title,
  compact = false,
}: {
  asset: Asset | null;
  take: Take | null;
  projectKey: string | null;
  title: string;
  compact?: boolean;
}) {
  const source = projectKey && asset ? projectApi.assetUrl(projectKey, asset.id, compact) : null;
  if (source && asset?.mediaType === "video") {
    return compact ? (
      <video src={source} muted playsInline preload="metadata" aria-label={`${title} 视频缩略图`} />
    ) : (
      // biome-ignore lint/a11y/useMediaCaption: generated clips do not have an authored caption track; native controls and the written shot intent remain available.
      <video
        src={source}
        controls
        playsInline
        preload="metadata"
        aria-label={`${title} 视频预览`}
      />
    );
  }
  if (source && asset?.mediaType === "image") {
    return <img src={source} alt={`${title} 预览`} />;
  }
  return (
    <div className="storyboard-empty-media" role="img" aria-label={`${title} 尚无可预览结果`}>
      <span>{take ? "MEDIA OFFLINE" : "OPEN FRAME"}</span>
      <i />
      <i />
    </div>
  );
}

export function Storyboard({
  snapshot,
  projectKey,
  readOnly,
  onOpenShot,
  onReorderShot,
  onClose,
}: StoryboardProps) {
  const orderedScenes = useMemo(
    () =>
      [...snapshot.scenes]
        .sort((left, right) => left.order - right.order)
        .map((scene) => ({
          scene,
          shots: snapshot.shots
            .filter((shot) => shot.sceneId === scene.id)
            .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
        })),
    [snapshot.scenes, snapshot.shots],
  );
  const firstShot = orderedScenes.flatMap((entry) => entry.shots)[0] ?? null;
  const [selectedShotId, setSelectedShotId] = useState<string | null>(firstShot?.id ?? null);
  const [draggedShotId, setDraggedShotId] = useState<string | null>(null);
  const [movingShotId, setMovingShotId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const selectedShot = snapshot.shots.find((shot) => shot.id === selectedShotId) ?? firstShot;
  const draggedShot = snapshot.shots.find((shot) => shot.id === draggedShotId) ?? null;
  const selectedPreview = selectedShot ? previewForShot(snapshot, selectedShot) : null;
  const approvedShots = snapshot.shots.filter((shot) => shot.status === "approved");
  const reviewShots = snapshot.shots.filter((shot) => shot.status === "review");
  const generatingShots = snapshot.shots.filter((shot) => shot.status === "generating");
  const totalDuration = snapshot.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  const approvedDuration = approvedShots.reduce((sum, shot) => sum + shot.durationSeconds, 0);

  const reorder = async (shotId: string, toIndex: number) => {
    if (readOnly || movingShotId) return;
    setMovingShotId(shotId);
    setReorderError(null);
    try {
      const saved = await onReorderShot(shotId, toIndex);
      if (!saved) setReorderError("顺序没有保存，请检查项目是否已在其他页面更新后重试。");
    } finally {
      setMovingShotId(null);
      setDraggedShotId(null);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the non-content backdrop closes the modal; the explicit close button and Escape remain keyboard-accessible.
    <div
      className="storyboard-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="storyboard-shell" role="dialog" aria-modal="true" aria-label="项目分镜墙">
        <header className="storyboard-header">
          <div>
            <span className="section-kicker">STORYBOARD</span>
            <h2>{snapshot.project.title}</h2>
            <p>按最终播放顺序检查覆盖率、节奏与已采用画面。</p>
            {reorderError ? (
              <div className="storyboard-error" role="alert">
                {reorderError}
              </div>
            ) : null}
          </div>
          <div className="storyboard-header-actions">
            {readOnly ? <span>VIEW ONLY</span> : <small>拖动卡片，或用箭头调整顺序</small>}
            <button type="button" onClick={onClose} aria-label="关闭分镜墙">
              ×
            </button>
          </div>
        </header>

        <section className="storyboard-coverage" aria-label="整片覆盖率">
          <article>
            <span>APPROVED</span>
            <strong>
              {approvedShots.length}
              <i> / {snapshot.shots.length}</i>
            </strong>
            <div>
              <i
                style={{
                  width: `${snapshot.shots.length ? (approvedShots.length / snapshot.shots.length) * 100 : 0}%`,
                }}
              />
            </div>
          </article>
          <article>
            <span>READY TO REVIEW</span>
            <strong>{reviewShots.length}</strong>
            <small>{generatingShots.length} 个仍在生成</small>
          </article>
          <article>
            <span>RUNTIME COVERED</span>
            <strong>{approvedDuration.toFixed(approvedDuration % 1 ? 1 : 0)}s</strong>
            <small>计划 {totalDuration.toFixed(totalDuration % 1 ? 1 : 0)}s</small>
          </article>
          <article>
            <span>OPEN SHOTS</span>
            <strong>{snapshot.shots.length - approvedShots.length}</strong>
            <small>{orderedScenes.length} 个场次</small>
          </article>
        </section>

        <div className="storyboard-body">
          <div className="storyboard-wall">
            {orderedScenes.map(({ scene, shots }) => (
              <section className="storyboard-scene" key={scene.id}>
                <div className="storyboard-scene-heading">
                  <span>{String(scene.order + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{scene.title || scene.label}</strong>
                    <small>
                      {shots.length} 镜 ·{" "}
                      {shots.reduce((sum, shot) => sum + shot.durationSeconds, 0)}s
                    </small>
                  </div>
                </div>
                <div className="storyboard-grid">
                  {shots.map((shot, index) => {
                    const preview = previewForShot(snapshot, shot);
                    return (
                      <article
                        className={`storyboard-card ${selectedShot?.id === shot.id ? "selected" : ""} status-${shot.status} ${draggedShotId === shot.id ? "dragging" : ""}`}
                        key={shot.id}
                        draggable={!readOnly && !movingShotId}
                        onDragStart={(event) => {
                          setDraggedShotId(shot.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", shot.id);
                        }}
                        onDragEnd={() => setDraggedShotId(null)}
                        onDragOver={(event) => {
                          if (
                            !readOnly &&
                            draggedShotId &&
                            draggedShotId !== shot.id &&
                            draggedShot?.sceneId === shot.sceneId
                          ) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourceId = event.dataTransfer.getData("text/plain");
                          if (
                            sourceId &&
                            sourceId !== shot.id &&
                            draggedShot?.sceneId === shot.sceneId
                          ) {
                            void reorder(sourceId, index);
                          }
                        }}
                      >
                        <button
                          className="storyboard-card-main"
                          type="button"
                          onClick={() => setSelectedShotId(shot.id)}
                          onDoubleClick={() => onOpenShot(shot.id)}
                          aria-label={`预览镜头 ${shot.label}`}
                        >
                          <div className="storyboard-card-media">
                            <StoryboardMedia
                              asset={preview.asset}
                              take={preview.take}
                              projectKey={projectKey}
                              title={shot.label}
                              compact
                            />
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <i>{statusLabel(shot.status)}</i>
                          </div>
                          <div className="storyboard-card-copy">
                            <strong>{shot.label}</strong>
                            <span>
                              {shot.durationSeconds}s · {shot.aspectRatio} · {preview.takeCount}{" "}
                              Takes
                            </span>
                            <p>{shot.intent || "尚未填写镜头意图"}</p>
                          </div>
                        </button>
                        {!readOnly ? (
                          <fieldset
                            className="storyboard-order-actions"
                            aria-label={`${shot.label} 顺序`}
                          >
                            <button
                              type="button"
                              disabled={index === 0 || Boolean(movingShotId)}
                              onClick={() => void reorder(shot.id, index - 1)}
                              aria-label={`${shot.label} 前移`}
                            >
                              ←
                            </button>
                            <button
                              type="button"
                              disabled={index === shots.length - 1 || Boolean(movingShotId)}
                              onClick={() => void reorder(shot.id, index + 1)}
                              aria-label={`${shot.label} 后移`}
                            >
                              →
                            </button>
                          </fieldset>
                        ) : null}
                      </article>
                    );
                  })}
                  {shots.length === 0 ? (
                    <div className="storyboard-scene-empty">这个场次还没有镜头</div>
                  ) : null}
                </div>
              </section>
            ))}
            {snapshot.shots.length === 0 ? (
              <div className="storyboard-project-empty">
                建立镜头后，这里会按播放顺序形成整片视图。
              </div>
            ) : null}
          </div>

          <aside className="storyboard-preview" aria-label="镜头只读预览">
            {selectedShot && selectedPreview ? (
              <>
                <div className="storyboard-preview-media">
                  <StoryboardMedia
                    asset={selectedPreview.asset}
                    take={selectedPreview.take}
                    projectKey={projectKey}
                    title={selectedShot.label}
                  />
                </div>
                <div className="storyboard-preview-copy">
                  <span>
                    {statusLabel(selectedShot.status)} · {selectedShot.aspectRatio}
                  </span>
                  <h3>{selectedShot.label}</h3>
                  <p>{selectedShot.intent || "这个镜头还没有补充说明。"}</p>
                  <dl>
                    <div>
                      <dt>时长</dt>
                      <dd>{selectedShot.durationSeconds}s</dd>
                    </div>
                    <div>
                      <dt>候选</dt>
                      <dd>{selectedPreview.takeCount}</dd>
                    </div>
                  </dl>
                  <button type="button" onClick={() => onOpenShot(selectedShot.id)}>
                    回到画布查看
                  </button>
                </div>
              </>
            ) : (
              <div className="storyboard-preview-empty">选择一个镜头查看</div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
