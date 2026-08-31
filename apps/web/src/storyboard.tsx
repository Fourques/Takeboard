import type {
  Asset,
  BatchApprovalDecision,
  BatchApprovalPreview,
  ProjectCostSummary,
  ProjectSnapshot,
  Shot,
  Take,
} from "@takeboard/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { projectApi } from "./api";

const roughCutCss = `.rough-cut-player{display:grid;min-height:0;padding:clamp(14px,2vw,26px);overflow:auto;border-top:1px solid var(--line);background:color-mix(in srgb,var(--surface-root) 55%,transparent);grid-template-rows:minmax(260px,1fr) auto auto auto;gap:12px}.rough-cut-stage{position:relative;display:grid;min-height:0;overflow:hidden;place-items:center;border:1px solid var(--line);border-radius:12px;background:radial-gradient(circle at 50% 35%,color-mix(in srgb,var(--accent) 8%,transparent),transparent 40%),#070a09}.rough-cut-stage>:is(img,video){display:block;width:100%;height:100%;min-height:0;object-fit:contain}.rough-cut-slate{display:grid;width:min(480px,82%);padding:34px;border:1px dashed color-mix(in srgb,var(--line) 78%,var(--accent));border-radius:10px;text-align:center;background:color-mix(in srgb,var(--surface-2) 55%,transparent);gap:8px}.rough-cut-slate span{color:var(--accent-strong);font-size:calc(10px * var(--ui-scale));font-weight:800;letter-spacing:.14em}.rough-cut-slate strong{font-size:clamp(22px,3vw,38px);font-weight:560}.rough-cut-slate p{margin:0;color:var(--text-2);font-size:calc(11px * var(--ui-scale));line-height:1.6}.rough-cut-overlay{position:absolute;right:14px;bottom:14px;left:14px;display:flex;align-items:flex-end;justify-content:space-between;pointer-events:none;text-shadow:0 1px 12px #000}.rough-cut-overlay>span{padding:5px 7px;border:1px solid rgb(255 255 255/18%);border-radius:5px;color:#fff;background:rgb(0 0 0/48%);font:calc(10px * var(--ui-scale)) ui-monospace,monospace}.rough-cut-overlay>div{display:grid;text-align:right;gap:2px}.rough-cut-overlay strong{color:#fff;font-size:calc(13px * var(--ui-scale))}.rough-cut-overlay small{color:rgb(255 255 255/70%);font-size:calc(10px * var(--ui-scale))}.rough-cut-transport{display:grid;align-items:center;grid-template-columns:1fr auto 1fr;gap:12px}.rough-cut-clock strong{font:calc(16px * var(--ui-scale)) ui-monospace,monospace}.rough-cut-clock span{margin-left:5px;color:var(--faint);font:calc(10px * var(--ui-scale)) ui-monospace,monospace}.rough-cut-controls{display:flex;align-items:center;gap:6px}.rough-cut-transport button{min-height:34px;padding:0 11px;border:1px solid var(--line);border-radius:8px;color:var(--text-2);background:var(--surface-2);cursor:pointer;font-size:calc(11px * var(--ui-scale))}.rough-cut-transport button:disabled{cursor:default;opacity:.35}.rough-cut-transport .rough-cut-play{min-width:104px;border-color:color-mix(in srgb,var(--accent) 52%,var(--line));color:var(--surface-root);background:var(--accent-strong);font-weight:720}.rough-cut-open-shot{justify-self:end}.rough-cut-timeline{display:flex;min-width:0;min-height:66px;margin:0;overflow-x:auto;padding:0 0 4px;border:0;gap:4px}.rough-cut-timeline>button{position:relative;display:grid;min-width:72px;max-width:260px;padding:9px 10px 11px;overflow:hidden;border:1px solid var(--line);border-radius:7px;color:var(--text-2);text-align:left;background:var(--surface-2);cursor:pointer;gap:3px}.rough-cut-timeline>button.open{border-style:dashed;background:color-mix(in srgb,var(--surface-2) 45%,transparent)}.rough-cut-timeline>button.selected{border-color:var(--accent);color:var(--text-1)}.rough-cut-timeline span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:calc(11px * var(--ui-scale));font-weight:650}.rough-cut-timeline small{color:var(--faint);font-size:calc(9px * var(--ui-scale))}.rough-cut-timeline i{position:absolute;bottom:0;left:0;height:2px;background:var(--accent-strong)}.rough-cut-empty{display:grid;width:100%;place-items:center;border:1px dashed var(--line);border-radius:8px;color:var(--text-2);font-size:calc(11px * var(--ui-scale))}.rough-cut-note{display:flex;justify-content:space-between;color:var(--faint);font-size:calc(10px * var(--ui-scale));gap:12px}@media(max-width:680px){.rough-cut-player{grid-template-rows:minmax(220px,1fr) auto auto auto}.rough-cut-transport{grid-template-columns:auto 1fr}.rough-cut-controls{justify-self:end}.rough-cut-open-shot{display:none}.rough-cut-note{display:grid}}`;

const storyboardControlCss = `.storyboard-view-switch{display:flex;padding:3px;border:1px solid var(--line);border-radius:9px;background:color-mix(in srgb,var(--surface-root) 48%,transparent)}.storyboard-view-switch button{min-height:28px;padding:0 10px;border:0;border-radius:6px;color:var(--text-2);background:transparent;cursor:pointer;font-size:calc(11px * var(--ui-scale))}.storyboard-view-switch button[aria-selected="true"]{color:var(--text-1);background:var(--surface-2);box-shadow:0 3px 12px var(--shadow)}@media(max-width:680px){.storyboard-view-switch button{padding-inline:7px}}`;

const approvalCss = `.approval-workbench {
  position: relative;
  display: grid;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-root) 58%, transparent);
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.approval-summary {
  display: grid;
  align-items: end;
  padding: 16px clamp(18px, 2.5vw, 34px);
  border-bottom: 1px solid var(--line);
  grid-template-columns: minmax(220px, 0.7fr) minmax(0, 1.3fr);
  gap: 20px;
}

.approval-summary > div:first-child > span,
.approval-confirmation > div > span {
  color: var(--accent-strong);
  font-size: calc(8px * var(--ui-scale));
  font-weight: 900;
  letter-spacing: 0.14em;
}

.approval-summary h3,
.approval-confirmation h3 {
  margin: 4px 0;
  font-size: calc(19px * var(--ui-scale));
  font-weight: 620;
}

.approval-summary p,
.approval-confirmation p {
  margin: 0;
  color: var(--text-2);
  font-size: calc(10px * var(--ui-scale));
  line-height: 1.5;
}

.approval-cost-cards {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 7px;
}

.approval-cost-cards article {
  display: grid;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: color-mix(in srgb, var(--surface-2) 74%, transparent);
  gap: 3px;
}

.approval-cost-cards span,
.approval-cost-cards small,
.approval-shot-cost span,
.approval-shot-cost small {
  overflow: hidden;
  color: var(--faint);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(8px * var(--ui-scale));
}

.approval-cost-cards strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(14px * var(--ui-scale));
}

.approval-shot-list {
  min-height: 0;
  overflow: auto;
  padding: 8px clamp(18px, 2.5vw, 34px) 18px;
}

.approval-shot-row {
  display: grid;
  align-items: center;
  min-height: 106px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  grid-template-columns: minmax(130px, 0.62fr) minmax(260px, 2fr) minmax(120px, 0.58fr);
  gap: 14px;
}

.approval-shot-identity {
  display: grid;
  align-items: center;
  min-width: 0;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 8px;
}

.approval-shot-identity > span {
  color: var(--accent-strong);
  font:
    calc(11px * var(--ui-scale)) ui-monospace,
    monospace;
}

.approval-shot-identity > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.approval-shot-identity strong,
.approval-shot-identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.approval-shot-identity strong {
  font-size: calc(12px * var(--ui-scale));
}

.approval-shot-identity small {
  color: var(--faint);
  font-size: calc(9px * var(--ui-scale));
}

.approval-take-strip {
  display: flex;
  min-width: 0;
  overflow-x: auto;
  padding: 2px;
  gap: 7px;
}

.approval-take-strip > button {
  position: relative;
  flex: 0 0 108px;
  height: 76px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #070908;
  cursor: pointer;
}

.approval-take-strip > button:disabled {
  cursor: default;
}

.approval-take-strip > button.selected {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent);
}

.approval-take-strip > button.approved:not(.selected) {
  border-color: color-mix(in srgb, var(--green) 55%, var(--line));
}

.approval-take-strip :is(img, video) {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.approval-take-strip > button > span {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  color: rgb(255 255 255 / 35%);
  font-size: calc(8px * var(--ui-scale));
  letter-spacing: 0.12em;
}

.approval-take-strip > button > i {
  position: absolute;
  right: 4px;
  bottom: 4px;
  left: 4px;
  overflow: hidden;
  padding: 3px 5px;
  border-radius: 4px;
  color: #fff;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgb(0 0 0 / 62%);
  font-size: calc(8px * var(--ui-scale));
  font-style: normal;
  text-align: left;
}

.approval-take-strip > button > b {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 50%;
  color: var(--surface-root);
  background: var(--accent-strong);
  font-size: calc(11px * var(--ui-scale));
}

.approval-take-strip > p {
  align-self: center;
  margin: 0;
  color: var(--faint);
  font-size: calc(10px * var(--ui-scale));
}

.approval-shot-cost {
  display: grid;
  min-width: 0;
  justify-items: end;
  text-align: right;
  gap: 3px;
}

.approval-shot-cost strong {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(11px * var(--ui-scale));
}

.approval-action-bar {
  display: grid;
  align-items: center;
  padding: 12px clamp(18px, 2.5vw, 34px);
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-1) 88%, transparent);
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 14px;
}

.approval-action-bar > div {
  display: grid;
  gap: 2px;
}

.approval-action-bar strong {
  font-size: calc(11px * var(--ui-scale));
}

.approval-action-bar span,
.approval-action-bar p {
  margin: 0;
  color: var(--faint);
  font-size: calc(9px * var(--ui-scale));
}

.approval-action-bar p {
  color: var(--red);
}

.approval-action-bar > button,
.approval-confirmation button {
  min-height: 34px;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text-1);
  background: var(--surface-2);
  cursor: pointer;
  font-size: calc(10px * var(--ui-scale));
}

.approval-action-bar > button {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--line));
  color: var(--surface-root);
  background: var(--accent-strong);
  font-weight: 720;
}

.approval-action-bar button:disabled,
.approval-confirmation button:disabled {
  cursor: default;
  opacity: 0.42;
}

.approval-confirmation {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: grid;
  padding: 20px;
  place-items: center;
  background: color-mix(in srgb, var(--surface-root) 76%, transparent);
  backdrop-filter: blur(16px);
}

.approval-confirmation > div {
  display: grid;
  width: min(520px, 100%);
  max-height: 90%;
  overflow: auto;
  padding: 24px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line));
  border-radius: 14px;
  background: var(--surface-1);
  box-shadow: 0 30px 80px rgb(0 0 0 / 42%);
  gap: 10px;
}

.approval-confirmation ul {
  display: grid;
  max-height: 260px;
  overflow: auto;
  margin: 4px 0;
  padding: 0;
  list-style: none;
  gap: 5px;
}

.approval-confirmation li {
  display: flex;
  justify-content: space-between;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  gap: 12px;
}

.approval-confirmation li :is(strong, span) {
  font-size: calc(10px * var(--ui-scale));
}

.approval-confirmation li span {
  color: var(--faint);
}

.approval-confirmation > div > div {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.approval-confirmation > div > div button:last-child {
  border-color: var(--accent-strong);
  color: var(--surface-root);
  background: var(--accent-strong);
}

@media (max-width: 820px) {
  .approval-summary {
    align-items: stretch;
    grid-template-columns: 1fr;
  }

  .approval-shot-row {
    align-items: start;
    grid-template-columns: minmax(110px, 0.5fr) minmax(230px, 1fr);
  }

  .approval-shot-cost {
    display: none;
  }

  .approval-action-bar {
    grid-template-columns: 1fr auto;
  }

  .approval-action-bar p {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}`;

type StoryboardProps = {
  snapshot: ProjectSnapshot;
  projectKey: string | null;
  readOnly: boolean;
  onOpenShot: (shotId: string) => void;
  onReorderShot: (shotId: string, toIndex: number) => Promise<boolean>;
  onSnapshotChange: (payload: { revision: number; snapshot: ProjectSnapshot }) => void;
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

function approvedPreviewForShot(snapshot: ProjectSnapshot, shot: Shot) {
  const take = snapshot.takes.find((candidate) => candidate.id === shot.approvedTakeId) ?? null;
  const asset = snapshot.assets.find((candidate) => candidate.id === take?.assetId) ?? null;
  return { take, asset };
}

function statusLabel(status: Shot["status"]) {
  if (status === "approved") return "已采用";
  if (status === "review") return "待选择";
  if (status === "generating") return "生成中";
  return "待制作";
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: amount < 10 ? 3 : 2,
  }).format(amount);
}

function accuracyLabel(accuracy: "exact" | "estimated" | "unknown") {
  if (accuracy === "exact") return "精确";
  if (accuracy === "estimated") return "估算";
  return "仍有未知项";
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
  onSnapshotChange,
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
  const orderedShots = useMemo(
    () => orderedScenes.flatMap((entry) => entry.shots),
    [orderedScenes],
  );
  const playerEntries = useMemo(
    () =>
      orderedShots.map((shot) => ({
        shot,
        ...approvedPreviewForShot(snapshot, shot),
      })),
    [orderedShots, snapshot],
  );
  const firstShot = orderedShots[0] ?? null;
  const [selectedShotId, setSelectedShotId] = useState<string | null>(firstShot?.id ?? null);
  const [view, setView] = useState<"wall" | "rough-cut" | "approval">("wall");
  const [playing, setPlaying] = useState(false);
  const [elapsedInShot, setElapsedInShot] = useState(0);
  const [draggedShotId, setDraggedShotId] = useState<string | null>(null);
  const [movingShotId, setMovingShotId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [costSummary, setCostSummary] = useState<ProjectCostSummary | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const [approvalChoices, setApprovalChoices] = useState<Record<string, string>>({});
  const [approvalPreview, setApprovalPreview] = useState<BatchApprovalPreview | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const elapsedRef = useRef(0);
  const selectedShot = snapshot.shots.find((shot) => shot.id === selectedShotId) ?? firstShot;
  const draggedShot = snapshot.shots.find((shot) => shot.id === draggedShotId) ?? null;
  const selectedPreview = selectedShot ? previewForShot(snapshot, selectedShot) : null;
  const approvedShots = snapshot.shots.filter((shot) => shot.status === "approved");
  const reviewShots = snapshot.shots.filter((shot) => shot.status === "review");
  const generatingShots = snapshot.shots.filter((shot) => shot.status === "generating");
  const totalDuration = snapshot.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  const approvedDuration = approvedShots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  const selectedPlayerIndex = Math.max(
    0,
    playerEntries.findIndex((entry) => entry.shot.id === selectedShot?.id),
  );
  const selectedPlayerEntry = playerEntries[selectedPlayerIndex] ?? null;
  const selectedPlayerSource =
    projectKey && selectedPlayerEntry?.asset
      ? projectApi.assetUrl(projectKey, selectedPlayerEntry.asset.id)
      : null;
  const elapsedBeforeSelected = playerEntries
    .slice(0, selectedPlayerIndex)
    .reduce((sum, entry) => sum + entry.shot.durationSeconds, 0);
  const roughCutElapsed = Math.min(totalDuration, elapsedBeforeSelected + elapsedInShot);
  const approvalDecisions = useMemo<BatchApprovalDecision[]>(
    () =>
      Object.entries(approvalChoices).map(([shotId, takeId]) => ({
        shotId,
        takeId,
        reason: "跨镜头审批",
      })),
    [approvalChoices],
  );

  const refreshCosts = useCallback(async () => {
    if (!projectKey) return;
    try {
      const payload = await projectApi.costs(projectKey);
      setCostSummary(payload.summary);
      setCostError(null);
    } catch (cause) {
      setCostError(cause instanceof Error ? cause.message : "暂时无法读取成本账本");
    }
  }, [projectKey]);

  useEffect(() => {
    if (snapshot.exportedAt) void refreshCosts();
  }, [refreshCosts, snapshot.exportedAt]);

  const previewApprovals = async () => {
    if (!projectKey || approvalDecisions.length === 0) return;
    setApprovalBusy(true);
    setApprovalError(null);
    try {
      const payload = await projectApi.previewBatchApprovals(projectKey, approvalDecisions);
      setApprovalPreview(payload.preview);
    } catch (cause) {
      setApprovalError(cause instanceof Error ? cause.message : "无法预览审批变更");
    } finally {
      setApprovalBusy(false);
    }
  };

  const applyApprovals = async () => {
    if (!projectKey || !approvalPreview) return;
    setApprovalBusy(true);
    setApprovalError(null);
    try {
      const payload = await projectApi.applyBatchApprovals(
        projectKey,
        approvalDecisions,
        approvalPreview,
      );
      onSnapshotChange(payload);
      setApprovalChoices({});
      setApprovalPreview(null);
      await refreshCosts();
    } catch (cause) {
      setApprovalPreview(null);
      setApprovalError(cause instanceof Error ? cause.message : "审批没有提交，请重新预览后再试");
    } finally {
      setApprovalBusy(false);
    }
  };

  const selectPlayerEntry = useCallback(
    (index: number) => {
      const entry = playerEntries[index];
      if (!entry) return;
      setSelectedShotId(entry.shot.id);
      setElapsedInShot(0);
    },
    [playerEntries],
  );

  const advancePlayer = useCallback(() => {
    if (selectedPlayerIndex >= playerEntries.length - 1) {
      setPlaying(false);
      setElapsedInShot(selectedPlayerEntry?.shot.durationSeconds ?? 0);
      return;
    }
    selectPlayerEntry(selectedPlayerIndex + 1);
  }, [playerEntries.length, selectPlayerEntry, selectedPlayerEntry, selectedPlayerIndex]);

  useEffect(() => {
    elapsedRef.current = elapsedInShot;
  }, [elapsedInShot]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.focus();
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys, true);
    return () => {
      window.removeEventListener("keydown", handleDialogKeys, true);
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (view !== "rough-cut" || !playing || selectedPlayerEntry?.asset?.mediaType === "video") {
      return;
    }
    const duration = Math.max(0.1, selectedPlayerEntry?.shot.durationSeconds ?? 0.1);
    const startedAt = performance.now() - elapsedRef.current * 1_000;
    const timer = window.setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1_000;
      if (elapsed >= duration) {
        window.clearInterval(timer);
        advancePlayer();
      } else {
        setElapsedInShot(elapsed);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [advancePlayer, playing, selectedPlayerEntry, view]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || selectedPlayerEntry?.asset?.mediaType !== "video") return;
    if (view === "rough-cut" && playing) {
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, [playing, selectedPlayerEntry, view]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (view !== "rough-cut" || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.matches("input, textarea, select, button")) return;
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((current) => !current);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        selectPlayerEntry(Math.min(playerEntries.length - 1, selectedPlayerIndex + 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectPlayerEntry(Math.max(0, selectedPlayerIndex - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playerEntries.length, selectPlayerEntry, selectedPlayerIndex, view]);

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
      <style>{roughCutCss}</style>
      <style>{storyboardControlCss}</style>
      <style>{approvalCss}</style>
      <section
        className="storyboard-shell"
        role="dialog"
        aria-modal="true"
        aria-label="项目分镜墙"
        ref={dialogRef}
        tabIndex={-1}
      >
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
            <div
              className="storyboard-view-switch"
              role="tablist"
              aria-label="分镜查看方式"
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const views = ["wall", "rough-cut", "approval"] as const;
                const currentIndex = views.indexOf(view);
                const nextIndex =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? views.length - 1
                      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + views.length) %
                        views.length;
                const nextView = views[nextIndex] ?? "wall";
                setPlaying(false);
                if (nextView === "rough-cut") setElapsedInShot(0);
                setView(nextView);
                window.requestAnimationFrame(() =>
                  document.getElementById(`storyboard-tab-${nextView}`)?.focus(),
                );
              }}
            >
              <button
                type="button"
                role="tab"
                id="storyboard-tab-wall"
                aria-controls="storyboard-panel-wall"
                aria-selected={view === "wall"}
                tabIndex={view === "wall" ? 0 : -1}
                onClick={() => {
                  setPlaying(false);
                  setView("wall");
                }}
              >
                分镜墙
              </button>
              <button
                type="button"
                role="tab"
                id="storyboard-tab-rough-cut"
                aria-controls="storyboard-panel-rough-cut"
                aria-selected={view === "rough-cut"}
                tabIndex={view === "rough-cut" ? 0 : -1}
                onClick={() => {
                  setElapsedInShot(0);
                  setPlaying(false);
                  setView("rough-cut");
                }}
              >
                粗剪预览
              </button>
              <button
                type="button"
                role="tab"
                id="storyboard-tab-approval"
                aria-controls="storyboard-panel-approval"
                aria-selected={view === "approval"}
                tabIndex={view === "approval" ? 0 : -1}
                onClick={() => {
                  setPlaying(false);
                  setView("approval");
                }}
              >
                审批与成本
              </button>
            </div>
            {readOnly ? <span>VIEW ONLY</span> : null}
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

        {view === "wall" ? (
          <div
            className="storyboard-body"
            id="storyboard-panel-wall"
            role="tabpanel"
            aria-label="分镜墙内容"
          >
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
        ) : view === "rough-cut" ? (
          <section
            className="rough-cut-player"
            id="storyboard-panel-rough-cut"
            role="tabpanel"
            aria-label="只读粗剪预览"
          >
            <div className="rough-cut-stage">
              {selectedPlayerSource && selectedPlayerEntry?.asset?.mediaType === "video" ? (
                // biome-ignore lint/a11y/useMediaCaption: TakeBoard previews user-generated source clips and cannot author captions on their behalf.
                <video
                  key={selectedPlayerEntry.asset.id}
                  ref={videoRef}
                  src={selectedPlayerSource}
                  playsInline
                  preload="metadata"
                  onTimeUpdate={(event) => {
                    const planned = selectedPlayerEntry.shot.durationSeconds;
                    const elapsed = Math.min(event.currentTarget.currentTime, planned);
                    setElapsedInShot(elapsed);
                    if (playing && elapsed >= planned - 0.04) advancePlayer();
                  }}
                  onEnded={advancePlayer}
                  onError={() => setPlaying(false)}
                  aria-label={`${selectedPlayerEntry.shot.label} 粗剪视频`}
                />
              ) : selectedPlayerSource && selectedPlayerEntry?.asset?.mediaType === "image" ? (
                <img
                  src={selectedPlayerSource}
                  alt={`${selectedPlayerEntry.shot.label} 粗剪画面`}
                />
              ) : (
                <div className="rough-cut-slate">
                  <span>{selectedPlayerEntry?.take ? "MEDIA OFFLINE" : "OPEN SHOT"}</span>
                  <strong>{selectedPlayerEntry?.shot.label ?? "暂无镜头"}</strong>
                  <p>
                    {selectedPlayerEntry?.take
                      ? "已采用结果暂时无法读取，请回到画布检查素材。"
                      : "这个位置还没有已采用画面，预览会按计划时长保留空镜。"}
                  </p>
                </div>
              )}
              {selectedPlayerEntry ? (
                <div className="rough-cut-overlay">
                  <span>
                    {String(selectedPlayerIndex + 1).padStart(2, "0")} / {playerEntries.length}
                  </span>
                  <div>
                    <strong>{selectedPlayerEntry.shot.label}</strong>
                    <small>
                      {selectedPlayerEntry.asset
                        ? `${selectedPlayerEntry.asset.mediaType === "video" ? "视频" : "静帧"} · 已采用`
                        : "计划空镜"}
                    </small>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rough-cut-transport">
              <div className="rough-cut-clock">
                <strong>{formatTime(roughCutElapsed)}</strong>
                <span>/ {formatTime(totalDuration)}</span>
              </div>
              <div className="rough-cut-controls">
                <button
                  type="button"
                  disabled={selectedPlayerIndex <= 0}
                  onClick={() => selectPlayerEntry(selectedPlayerIndex - 1)}
                  aria-label="上一个镜头"
                >
                  ←
                </button>
                <button
                  className="rough-cut-play"
                  type="button"
                  disabled={playerEntries.length === 0}
                  aria-pressed={playing}
                  onClick={() => {
                    if (
                      !playing &&
                      selectedPlayerIndex === playerEntries.length - 1 &&
                      elapsedInShot >= (selectedPlayerEntry?.shot.durationSeconds ?? 0)
                    ) {
                      selectPlayerEntry(0);
                    }
                    setPlaying((current) => !current);
                  }}
                >
                  {playing ? "暂停" : "播放粗剪"}
                </button>
                <button
                  type="button"
                  disabled={selectedPlayerIndex >= playerEntries.length - 1}
                  onClick={() => selectPlayerEntry(selectedPlayerIndex + 1)}
                  aria-label="下一个镜头"
                >
                  →
                </button>
              </div>
              <button
                className="rough-cut-open-shot"
                type="button"
                disabled={!selectedPlayerEntry}
                onClick={() => selectedPlayerEntry && onOpenShot(selectedPlayerEntry.shot.id)}
              >
                回到镜头
              </button>
            </div>

            <fieldset className="rough-cut-timeline">
              <legend className="visually-hidden">粗剪时间线</legend>
              {playerEntries.map((entry, index) => {
                const selected = index === selectedPlayerIndex;
                const completed = index < selectedPlayerIndex;
                const progress = selected
                  ? Math.min(100, (elapsedInShot / Math.max(0.1, entry.shot.durationSeconds)) * 100)
                  : completed
                    ? 100
                    : 0;
                return (
                  <button
                    type="button"
                    key={entry.shot.id}
                    className={`${selected ? "selected" : ""} ${entry.asset ? "covered" : "open"}`}
                    style={{ flexGrow: Math.max(0.5, entry.shot.durationSeconds) }}
                    aria-current={selected ? "true" : undefined}
                    aria-label={`${entry.shot.label}，${entry.shot.durationSeconds} 秒，${entry.asset ? "已有采用画面" : "尚无采用画面"}`}
                    onClick={() => selectPlayerEntry(index)}
                  >
                    <span>{entry.shot.label}</span>
                    <small>{entry.shot.durationSeconds}s</small>
                    <i style={{ width: `${progress}%` }} />
                  </button>
                );
              })}
              {playerEntries.length === 0 ? (
                <div className="rough-cut-empty">建立镜头后，时间线会从这里开始。</div>
              ) : null}
            </fieldset>
            <footer className="rough-cut-note">
              <span>实心段为已采用画面，虚线段为计划空镜。</span>
              <small>这是只读节奏预览，不裁切或改写原始图片与视频。</small>
            </footer>
          </section>
        ) : (
          <section
            className="approval-workbench"
            id="storyboard-panel-approval"
            role="tabpanel"
            aria-label="跨镜头审批与成本"
          >
            <header className="approval-summary">
              <div>
                <span>PRODUCTION LEDGER</span>
                <h3>成本与采用决策</h3>
                <p>成本按实际运行归集；未知项不会被伪装成精确总价。</p>
              </div>
              <div className="approval-cost-cards">
                <article>
                  <span>采用率</span>
                  <strong>
                    {costSummary?.acceptanceRate === null || !costSummary
                      ? "—"
                      : `${Math.round(costSummary.acceptanceRate * 100)}%`}
                  </strong>
                  <small>
                    {costSummary?.approvedShotCount ?? approvedShots.length} /{" "}
                    {costSummary?.candidateShotCount ?? 0} 个有候选镜头
                  </small>
                </article>
                {(costSummary?.totals ?? []).map((total) => (
                  <article key={total.currency}>
                    <span>{total.currency} 已知支出</span>
                    <strong>{formatMoney(total.knownAmount, total.currency)}</strong>
                    <small>
                      {accuracyLabel(total.accuracy)}
                      {total.unknownRunCount > 0 ? ` · ${total.unknownRunCount} 次未知` : ""}
                    </small>
                  </article>
                ))}
                {(costSummary?.finishedMinuteCosts ?? []).map((cost) => (
                  <article key={`minute-${cost.currency}`}>
                    <span>成片分钟成本</span>
                    <strong>
                      {cost.amountPerMinute === null
                        ? "不可可靠计算"
                        : formatMoney(cost.amountPerMinute, cost.currency)}
                    </strong>
                    <small>
                      {cost.amountPerMinute === null
                        ? "仍有未知成本或尚无采用时长"
                        : accuracyLabel(cost.accuracy)}
                    </small>
                  </article>
                ))}
                {costSummary?.totals.length === 0 ? (
                  <article>
                    <span>运行成本</span>
                    <strong>尚无记录</strong>
                    <small>生成后会按执行端计费配置归集</small>
                  </article>
                ) : null}
                {costError ? (
                  <article>
                    <span>成本账本</span>
                    <strong>暂时不可用</strong>
                    <small>{costError}</small>
                  </article>
                ) : null}
              </div>
            </header>

            <div className="approval-shot-list">
              {orderedShots.map((shot, index) => {
                const candidates = snapshot.takes.filter(
                  (take) =>
                    take.shotId === shot.id &&
                    take.status !== "rejected" &&
                    take.status !== "media_missing",
                );
                const shotCost = costSummary?.shots.find((entry) => entry.shotId === shot.id);
                return (
                  <article className="approval-shot-row" key={shot.id}>
                    <div className="approval-shot-identity">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{shot.label}</strong>
                        <small>
                          {shot.durationSeconds}s · {candidates.length} 个可审批候选
                        </small>
                      </div>
                    </div>
                    <div className="approval-take-strip">
                      {candidates.map((take, takeIndex) => {
                        const asset =
                          snapshot.assets.find((candidate) => candidate.id === take.assetId) ??
                          null;
                        const source =
                          projectKey && asset
                            ? projectApi.assetUrl(projectKey, asset.id, true)
                            : null;
                        const selected = approvalChoices[shot.id] === take.id;
                        const approved = shot.approvedTakeId === take.id;
                        return (
                          <button
                            type="button"
                            className={`${selected ? "selected" : ""} ${approved ? "approved" : ""}`}
                            aria-pressed={selected}
                            disabled={readOnly}
                            onClick={() => {
                              setApprovalPreview(null);
                              setApprovalChoices((current) => {
                                if (current[shot.id] === take.id) {
                                  const next = { ...current };
                                  delete next[shot.id];
                                  return next;
                                }
                                return { ...current, [shot.id]: take.id };
                              });
                            }}
                            key={take.id}
                          >
                            {source && asset?.mediaType === "image" ? (
                              <img src={source} alt="" />
                            ) : source && asset?.mediaType === "video" ? (
                              <video src={source} muted playsInline preload="metadata" />
                            ) : (
                              <span>MEDIA</span>
                            )}
                            <i>{approved ? "当前采用" : `Take ${takeIndex + 1}`}</i>
                            <b>{selected ? "✓" : ""}</b>
                          </button>
                        );
                      })}
                      {candidates.length === 0 ? <p>这个镜头还没有可审批候选</p> : null}
                    </div>
                    <div className="approval-shot-cost">
                      <span>镜头累计</span>
                      <strong>
                        {shotCost?.totals.length
                          ? shotCost.totals
                              .map((total) => formatMoney(total.knownAmount, total.currency))
                              .join(" + ")
                          : "—"}
                      </strong>
                      <small>
                        {shotCost?.totals.some((total) => total.unknownRunCount > 0)
                          ? "含未知成本"
                          : `${shotCost?.runCount ?? 0} 次运行`}
                      </small>
                    </div>
                  </article>
                );
              })}
            </div>

            <footer className="approval-action-bar">
              <div>
                <strong>{approvalDecisions.length} 个镜头待提交</strong>
                <span>先预览替换影响，再以一个原子操作写入全部决策。</span>
              </div>
              {approvalError ? <p role="alert">{approvalError}</p> : null}
              <button
                type="button"
                disabled={readOnly || approvalBusy || approvalDecisions.length === 0}
                onClick={() => void previewApprovals()}
              >
                {approvalBusy ? "正在核对…" : "预览批量批准"}
              </button>
            </footer>

            {approvalPreview ? (
              <div
                className="approval-confirmation"
                role="alertdialog"
                aria-modal="true"
                aria-label="确认批量批准"
              >
                <div>
                  <span>CONFIRM DECISIONS</span>
                  <h3>确认采用 {approvalPreview.decisionCount} 个候选</h3>
                  <p>
                    {approvalPreview.replacementCount > 0
                      ? `其中 ${approvalPreview.replacementCount} 个镜头会替换当前采用版本；旧审批会保留为已撤销历史。`
                      : "不会覆盖已有的其他采用版本。"}
                  </p>
                  <ul>
                    {approvalPreview.decisions.map((decision) => (
                      <li key={decision.shotId}>
                        <strong>{decision.shotTitle}</strong>
                        <span>{decision.replacesTakeId ? "替换当前采用" : "建立采用记录"}</span>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <button
                      type="button"
                      disabled={approvalBusy}
                      onClick={() => setApprovalPreview(null)}
                    >
                      返回调整
                    </button>
                    <button
                      type="button"
                      disabled={approvalBusy}
                      onClick={() => void applyApprovals()}
                    >
                      {approvalBusy ? "正在提交…" : "确认并保存全部决策"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        )}
      </section>
    </div>
  );
}
