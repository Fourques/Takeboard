import type { Asset, CanvasItem, ProjectSnapshot, Run, Shot, Take } from "@takeboard/contracts";
import { resolveGenerationResolution } from "@takeboard/contracts";
import { useEffect, useRef, useState } from "react";
import { projectApi, type WorkflowSummary } from "./api";
import { DetailMedia } from "./detail-media";
import {
  type GenerationProgress,
  type GenerationSettings,
  generationPromptPlaceholder,
  type PromptMention,
} from "./generation-model";
import { GenerationRecord } from "./generation-record";
import type { ModelProfile } from "./model-profiles";
import { NumericInput } from "./numeric-input";
import { type RecoveryAction, recoveryGuidance } from "./recovery-guidance";
import { RecoveryNotice } from "./recovery-notice";
import { openSettings } from "./settings-navigation";
import { VideoThumbnail } from "./video-preview";

const rejectionReasons = ["角色漂移", "运动方向错误", "构图不稳定", "细节异常"];

function CandidateArt({
  source,
  mediaType,
}: {
  source: string | undefined;
  mediaType: Asset["mediaType"] | undefined;
}) {
  return (
    <div className="candidate-art">
      {source && mediaType === "image" ? (
        <img src={source} alt="生成候选" />
      ) : source ? (
        <VideoThumbnail src={source} />
      ) : (
        <span className="candidate-unavailable">暂无预览</span>
      )}
      {mediaType === "video" ? <span className="candidate-play">▶</span> : null}
    </div>
  );
}

type ContextInspectorProps = {
  item: CanvasItem;
  snapshot: ProjectSnapshot;
  projectKey: string | null;
  readOnly: boolean;
  selectedShot: Shot | null;
  onOpenAssets: () => void;
  onUseAsset: (
    assetId: string,
    slot: "firstFrameAssetId" | "lastFrameAssetId" | "referenceAssetId",
  ) => void;
  onSetAssetCustomTags: (assetId: string, tags: string[]) => void;
  onUseText: (body: string) => void;
  onClose: () => void;
};

function formatBytes(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
}

export function NodeContextInspector({
  item,
  snapshot,
  projectKey,
  readOnly,
  selectedShot,
  onOpenAssets,
  onUseAsset,
  onSetAssetCustomTags,
  onUseText,
  onClose,
}: ContextInspectorProps) {
  const [customTagDraft, setCustomTagDraft] = useState("");
  const scene = snapshot.scenes.find((candidate) => candidate.id === item.sceneId);
  const sourceUrl = (asset: Asset, proxy = true) =>
    projectKey ? projectApi.assetUrl(projectKey, asset.id, proxy) : undefined;

  if (item.refType === "text") {
    const text = snapshot.textItems.find((candidate) => candidate.id === item.refId);
    return (
      <aside className="inspector node-context-inspector" aria-label="剧本节点检查器">
        <div className="context-hero context-hero-text">
          <div>
            <h2>{text?.title || "未命名文本"}</h2>
            <p>
              {scene?.label ?? "场景"} · {text?.kind === "script" ? "剧本" : "创作笔记"}
            </p>
          </div>
          <div className="context-hero-actions">
            <InspectorDismiss onClose={onClose} />
          </div>
        </div>
        <section className="context-section">
          <div className="context-section-heading">
            <div>
              <h3>文本内容</h3>
            </div>
            <span>{text?.body.length ?? 0} 字</span>
          </div>
          <div className="context-copy">{text?.body || "这个节点还没有内容。"}</div>
        </section>
        {!readOnly ? (
          <section className="context-action-card">
            <span>用于当前镜头</span>
            <strong>{selectedShot?.label ?? "尚未选择镜头"}</strong>
            <p>将文本追加到镜头提示词中，之后仍可在镜头面板继续编辑。</p>
            <button
              type="button"
              disabled={!selectedShot || !text?.body.trim()}
              onClick={() => text && onUseText(text.body)}
            >
              ＋ 追加到镜头提示词
            </button>
          </section>
        ) : (
          <div className="viewer-context-note">
            只读访问 · 可以查看文本内容，不能改写镜头提示词。
          </div>
        )}
      </aside>
    );
  }

  if (item.refType === "entity") {
    const entity = snapshot.entities.find((candidate) => candidate.id === item.refId);
    const references = snapshot.assets.filter((asset) =>
      entity?.referenceAssetIds.includes(asset.id),
    );
    const firstImage = references.find((asset) => asset.mediaType === "image");
    const firstImageUrl = firstImage ? sourceUrl(firstImage, false) : undefined;
    const typeLabel =
      entity?.kind === "character"
        ? "人物资产"
        : entity?.kind === "location"
          ? "场景资产"
          : "道具资产";
    return (
      <aside className="inspector node-context-inspector" aria-label="实体节点检查器">
        <div className="context-hero context-hero-entity">
          <div>
            <h2>{entity?.name ?? "未命名资产"}</h2>
            <p>
              {typeLabel} · {references.length} 张参考
            </p>
          </div>
          <div className="context-hero-actions">
            <InspectorDismiss onClose={onClose} />
          </div>
        </div>
        {firstImageUrl ? (
          <DetailMedia src={firstImageUrl} kind="image" label={`${entity?.name ?? "资产"}参考图`} />
        ) : null}
        <section className="context-section">
          <div className="context-section-heading">
            <div>
              <h3>设定描述</h3>
            </div>
          </div>
          <div className="context-copy compact">
            {entity?.description || "这个资产还没有补充设定描述。"}
          </div>
          <div className="context-facts">
            <span>
              <small>类型</small>
              {typeLabel}
            </span>
            <span>
              <small>参考</small>
              {references.length} 个文件
            </span>
            <span>
              <small>场景</small>
              {scene?.label ?? "全局"}
            </span>
          </div>
        </section>
        <section className="context-actions-inline">
          <button type="button" className="secondary" onClick={onOpenAssets}>
            打开资产库
          </button>
          {!readOnly ? (
            <button
              type="button"
              disabled={!selectedShot || !firstImage}
              onClick={() => firstImage && onUseAsset(firstImage.id, "referenceAssetId")}
            >
              设为镜头参考
            </button>
          ) : null}
        </section>
      </aside>
    );
  }

  const asset = snapshot.assets.find((candidate) => candidate.id === item.refId);
  const assetUrl = asset ? sourceUrl(asset, false) : undefined;
  const assetCanvasItemIds = new Set(
    snapshot.canvasItems
      .filter((candidate) => candidate.refType === "asset" && candidate.refId === item.refId)
      .map((candidate) => candidate.id),
  );
  const connectedRoles = new Set(
    snapshot.canvasEdges
      .filter((edge) => assetCanvasItemIds.has(edge.sourceItemId) && edge.targetSlot)
      .map((edge) => edge.targetSlot),
  );
  const addCustomTag = () => {
    if (readOnly || !asset) return;
    const tag = customTagDraft.trim();
    if (!tag || asset.customTags.includes(tag)) return;
    onSetAssetCustomTags(asset.id, [...asset.customTags, tag]);
    setCustomTagDraft("");
  };
  return (
    <aside className="inspector node-context-inspector" aria-label="素材节点检查器">
      <div className="context-hero context-hero-asset">
        <div>
          <h2>{asset?.originalName ?? "素材"}</h2>
          <p>
            {asset?.mediaType.toUpperCase() ?? "FILE"} ·{" "}
            {asset ? formatBytes(asset.byteSize) : "未知大小"}
          </p>
        </div>
        <div className="context-hero-actions">
          <InspectorDismiss onClose={onClose} />
        </div>
      </div>
      {assetUrl && asset ? (
        <DetailMedia src={assetUrl} kind={asset.mediaType} label={asset.originalName} />
      ) : null}
      {assetUrl && asset?.mediaType === "image" ? (
        <div className="original-asset-actions">
          <div>
            <a href={assetUrl} target="_blank" rel="noreferrer">
              查看原图 ↗
            </a>
            <a href={assetUrl} download={asset.originalName}>
              下载原图
            </a>
          </div>
        </div>
      ) : null}
      <section className="context-section">
        <div className="context-section-heading">
          <div>
            <h3>素材信息</h3>
          </div>
        </div>
        <div className="context-facts context-facts-wide">
          <span>
            <small>尺寸</small>
            {asset?.width && asset.height ? `${asset.width} × ${asset.height}` : "待识别"}
          </span>
          <span>
            <small>格式</small>
            {asset?.mimeType.split("/").at(-1)?.toUpperCase() ?? "—"}
          </span>
          <span>
            <small>大小</small>
            {asset ? formatBytes(asset.byteSize) : "—"}
          </span>
        </div>
      </section>
      {asset?.mediaType === "image" ? (
        <>
          <section className="context-connection-roles">
            <div>
              <h3>连接用途</h3>
            </div>
            <div className="connection-role-badges">
              {connectedRoles.has("first_frame") ? <span>首帧</span> : null}
              {connectedRoles.has("last_frame") ? <span>尾帧</span> : null}
              {connectedRoles.has("reference") ? <span>参考图</span> : null}
              {connectedRoles.size === 0 ? <em>尚未连接到模型输入</em> : null}
            </div>
          </section>
          <section className="context-custom-tags">
            <div>
              <h3>自定义标签</h3>
            </div>
            {asset.customTags.length ? (
              <div className="custom-tag-list">
                {asset.customTags.map((tag) =>
                  readOnly ? (
                    <span className="viewer-custom-tag" key={tag}>
                      {tag}
                    </span>
                  ) : (
                    <button
                      type="button"
                      key={tag}
                      aria-label={`移除标签 ${tag}`}
                      onClick={() =>
                        onSetAssetCustomTags(
                          asset.id,
                          asset.customTags.filter((candidate) => candidate !== tag),
                        )
                      }
                    >
                      {tag}
                      <span>×</span>
                    </button>
                  ),
                )}
              </div>
            ) : null}
            {!readOnly ? (
              <div className="custom-tag-entry">
                <input
                  aria-label="新增自定义标签"
                  value={customTagDraft}
                  maxLength={40}
                  placeholder="例如：冷色、夜景、定妆"
                  onChange={(event) => setCustomTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCustomTag();
                    }
                  }}
                />
                <button type="button" disabled={!customTagDraft.trim()} onClick={addCustomTag}>
                  添加
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </aside>
  );
}

function InspectorDismiss({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="inspector-dismiss"
      onClick={onClose}
      aria-label="收起检查器"
      title="收起检查器"
    >
      ×
    </button>
  );
}

type InspectorProps = {
  shot: Shot;
  takes: Take[];
  busy: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  canCancel: boolean;
  cancelling: boolean;
  onReject: (takeId: string, reason: string) => void;
  onApprove: (takeId: string) => void;
  onAddTakeToCanvas: (assetId: string) => void;
  assets: Asset[];
  projectKey: string | null;
  isDemo: boolean;
  revealAsset: { assetId: string; requestId: number } | null;
  onLocateAsset: (assetId: string) => void;
  runs: Run[];
  settings: GenerationSettings;
  workflow: WorkflowSummary | null;
  profile: ModelProfile;
  workflows: WorkflowSummary[];
  onSelectWorkflow: (workflow: WorkflowSummary) => void;
  workflowLocked: boolean;
  inputCounts: Record<
    "first_frame" | "last_frame" | "reference" | "reference_video" | "reference_audio",
    number
  >;
  mentions: PromptMention[];
  onSettingsChange: (settings: GenerationSettings) => void;
  onUpdateShot: (input: {
    title: string;
    body: string;
    durationSeconds: number;
    aspectRatio: Shot["aspectRatio"];
  }) => void;
  onOpenAssets: () => void;
  onOpenRecipes: () => void;
  generateDisabledReason: string | null;
  progress: GenerationProgress | null;
  candidateCount: number;
  onCandidateCountChange: (count: number) => void;
  onRetryRun: (run: Run) => void;
  onClose: () => void;
  readOnly: boolean;
};

export function Inspector({
  shot,
  takes,
  busy,
  onGenerate,
  onCancel,
  canCancel,
  cancelling,
  onReject,
  onApprove,
  onAddTakeToCanvas,
  assets,
  projectKey,
  isDemo,
  revealAsset,
  onLocateAsset,
  runs,
  settings,
  workflow,
  profile,
  workflows,
  onSelectWorkflow,
  workflowLocked,
  inputCounts,
  mentions,
  onSettingsChange,
  onUpdateShot,
  onOpenAssets,
  onOpenRecipes,
  generateDisabledReason,
  progress,
  candidateCount,
  onCandidateCountChange,
  onRetryRun,
  onClose,
  readOnly,
}: InspectorProps) {
  const [inspectorTab, setInspectorTab] = useState<"generate" | "results">(() =>
    takes.length ? "results" : "generate",
  );
  const [issueRunId, setIssueRunId] = useState<string | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each view starts at its own heading, not the previous view's scroll offset.
  useEffect(() => {
    if (scrollBodyRef.current) scrollBodyRef.current.scrollTop = 0;
  }, [inspectorTab]);
  const issueRun = runs.find((run) => run.id === issueRunId && run.shotId === shot.id);
  function recover(action: RecoveryAction) {
    if (action === "review") onClose();
    else if (action === "workflows") onOpenRecipes();
    else if (action === "assets") onOpenAssets();
    else if (action === "tasks") window.dispatchEvent(new Event("takeboard:open-tasks"));
    else if (action === "prompt" || action === "parameters") {
      setInspectorTab("generate");
      window.requestAnimationFrame(() => {
        const target =
          action === "prompt"
            ? promptRef.current
            : (document.getElementById("generation-width") ??
              document.querySelector<HTMLElement>(
                ".advanced-generation-settings input, .inspector-model-manage",
              ));
        target?.scrollIntoView({ block: "center" });
        target?.focus();
      });
    } else openSettings(action);
  }
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const revealedTakeId = takes.find((take) => take.assetId === revealAsset?.assetId)?.id;
  const revealRequestId = revealAsset?.requestId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: an explicit navigation request, not background snapshot refreshes, selects the recorded result.
  useEffect(() => {
    if (!revealedTakeId) return;
    setSelectedTakeId(revealedTakeId);
    setInspectorTab("results");
  }, [revealedTakeId, revealRequestId]);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different result starts a fresh, optional review note.
  useEffect(() => {
    setRejecting(false);
    setReason("");
  }, [selectedTakeId]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [shotDraft, setShotDraft] = useState(() => ({
    title: shot.label,
    body: shot.intent,
    durationSeconds: shot.durationSeconds,
    aspectRatio: shot.aspectRatio,
  }));
  useEffect(() => {
    setShotDraft({
      title: shot.label,
      body: shot.intent,
      durationSeconds: shot.durationSeconds,
      aspectRatio: shot.aspectRatio,
    });
  }, [shot.label, shot.intent, shot.durationSeconds, shot.aspectRatio]);
  useEffect(() => {
    const approved = takes.find((take) => take.status === "approved");
    const candidate = takes.find((take) => take.status === "candidate");
    setSelectedTakeId((current) =>
      takes.some((take) => take.id === current)
        ? current
        : (approved?.id ?? candidate?.id ?? takes[0]?.id ?? null),
    );
  }, [takes]);
  const selectedTake = takes.find((take) => take.id === selectedTakeId);
  const selectedTakeRun = runs.find((run) => run.id === selectedTake?.runId);
  const mediaSource = (assetId: string) => {
    const asset = assets.find((candidate) => candidate.id === assetId);
    return projectKey && asset ? projectApi.assetUrl(projectKey, asset.id) : undefined;
  };
  const mediaType = (assetId: string) =>
    assets.find((candidate) => candidate.id === assetId)?.mediaType;
  const selectedMediaUrl = selectedTake ? mediaSource(selectedTake.assetId) : undefined;
  const resolutionPolicy =
    workflow?.execution !== "native"
      ? "exact"
      : profile.family === "qwen_image"
        ? "qwen_image_2512"
        : profile.family === "minimax_h3"
          ? "minimax_h3"
          : profile.family === "ltx23"
            ? "multiple_32"
            : "exact";
  const resolvedResolution = resolveGenerationResolution(
    resolutionPolicy,
    settings.width,
    settings.height,
  );
  const shotRuns = runs.filter((run) => run.shotId === shot.id);
  const latestBatchId = [...shotRuns]
    .reverse()
    .map((run) => run.parameters.candidateBatchId)
    .find((value): value is string => typeof value === "string");
  const latestBatchRuns = latestBatchId
    ? [...shotRuns]
        .filter((run) => run.parameters.candidateBatchId === latestBatchId)
        .reduce<Map<number, Run>>((latestByIndex, run) => {
          const index = run.parameters.candidateIndex;
          if (typeof index === "number") latestByIndex.set(index, run);
          return latestByIndex;
        }, new Map())
    : new Map<number, Run>();
  const orderedBatchRuns = [...latestBatchRuns.entries()].sort(([left], [right]) => left - right);
  const expectedBatchCount =
    orderedBatchRuns.find(([, run]) => typeof run.parameters.candidateCount === "number")?.[1]
      .parameters.candidateCount ?? orderedBatchRuns.length;
  const batchCompleted = orderedBatchRuns.filter(([, run]) => run.status === "completed").length;
  const batchFailed = orderedBatchRuns.filter(([, run]) =>
    ["failed", "orphaned"].includes(run.status),
  ).length;
  const batchStopped = orderedBatchRuns.filter(([, run]) => run.status === "cancelled").length;

  return (
    <aside className="inspector shot-inspector" aria-label="镜头候选检查器">
      <div className="inspector-heading">
        <div>
          <span className="section-kicker">镜头详情</span>
          <input
            className="shot-title-input"
            aria-label="镜头名称"
            value={shotDraft.title}
            maxLength={80}
            disabled={readOnly}
            onChange={(event) =>
              setShotDraft((current) => ({ ...current, title: event.target.value }))
            }
          />
        </div>
        <div className="inspector-heading-actions">
          {shotDraft.title !== shot.label ||
          shotDraft.body !== shot.intent ||
          shotDraft.durationSeconds !== shot.durationSeconds ||
          shotDraft.aspectRatio !== shot.aspectRatio ? (
            <button
              type="button"
              disabled={readOnly || busy}
              onClick={() => onUpdateShot(shotDraft)}
            >
              保存镜头
            </button>
          ) : null}
          <span className={`large-status status-${shot.status}`}>
            {shot.status === "approved"
              ? "已采用"
              : shot.status === "review"
                ? "待选择"
                : shot.status === "generating"
                  ? "生成中"
                  : "待生成"}
          </span>
          <InspectorDismiss onClose={onClose} />
        </div>
      </div>
      {readOnly ? (
        <div className="viewer-mode-note">Viewer 模式 · 可以查看素材与候选，但不能修改或生成</div>
      ) : null}
      <div className="inspector-tabs" role="tablist" aria-label="镜头详情视图">
        {(["generate", "results"] as const).map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab}
            id={`inspector-tab-${tab}`}
            aria-selected={inspectorTab === tab}
            aria-controls={`inspector-panel-${tab}`}
            tabIndex={inspectorTab === tab ? 0 : -1}
            onClick={() => setInspectorTab(tab)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "generate"
                  : event.key === "End"
                    ? "results"
                    : tab === "generate"
                      ? "results"
                      : "generate";
              setInspectorTab(next);
              document.getElementById(`inspector-tab-${next}`)?.focus();
            }}
          >
            {tab === "generate" ? "生成" : "结果"}
            {tab === "results" && takes.length > 0 ? <span>{takes.length}</span> : null}
          </button>
        ))}
      </div>
      <div className="inspector-scroll-body" ref={scrollBodyRef}>
        <div
          role="tabpanel"
          id="inspector-panel-generate"
          aria-labelledby="inspector-tab-generate"
          hidden={inspectorTab !== "generate"}
        >
          <fieldset className="inspector-editable-zone" disabled={readOnly}>
            {!isDemo ? (
              <section className="inspector-section" aria-label="生成设置">
                <section className="generation-console">
                  <label className="inspector-model-picker">
                    <span>生成类型</span>
                    <select
                      aria-label="生成类型"
                      disabled={workflowLocked || busy}
                      value={workflow?.capability ?? ""}
                      onChange={(event) => {
                        const next = workflows.find(
                          (item) => item.capability === event.target.value,
                        );
                        if (next) onSelectWorkflow(next);
                      }}
                    >
                      {!workflow ? (
                        <option value="" disabled>
                          选择生成类型
                        </option>
                      ) : null}
                      {Array.from(
                        new Map(
                          [...workflows, ...(workflow ? [workflow] : [])].map((item) => [
                            item.capability,
                            item.capabilityLabel,
                          ]),
                        ),
                      ).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="inspector-model-picker">
                    <div className="model-picker-heading">
                      <label htmlFor="inspector-generation-model">
                        模型 {workflowLocked ? <small>已锁定</small> : null}
                      </label>
                      <button
                        className="inspector-model-manage"
                        type="button"
                        onClick={onOpenRecipes}
                        aria-label="管理工作流"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          aria-hidden="true"
                        >
                          <rect x="3" y="3" width="7" height="7" rx="1.5" />
                          <rect x="14" y="3" width="7" height="7" rx="1.5" />
                          <rect x="3" y="14" width="7" height="7" rx="1.5" />
                          <path d="M14 17.5h7m-3.5-3.5v7" />
                        </svg>
                        工作流库
                      </button>
                    </div>
                    <select
                      id="inspector-generation-model"
                      aria-label="生成模型"
                      disabled={workflowLocked || busy}
                      value={workflow?.path ?? ""}
                      onChange={(event) => {
                        const next = workflows.find((item) => item.path === event.target.value);
                        if (next) onSelectWorkflow(next);
                      }}
                    >
                      {!workflow ? (
                        <option value="" disabled>
                          选择模型
                        </option>
                      ) : null}
                      {workflow && !workflows.some((item) => item.path === workflow.path) ? (
                        <option value={workflow.path} disabled>
                          {workflow.name} · 暂不可选
                        </option>
                      ) : null}
                      {workflows
                        .filter((item) => !workflow || item.capability === workflow.capability)
                        .map((item) => (
                          <option key={item.path} value={item.path}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <label className="prompt-field prompt-with-mentions">
                    <span>
                      镜头提示词 <small>{settings.prompt.length}/20000</small>
                    </span>
                    <textarea
                      ref={promptRef}
                      value={settings.prompt}
                      onChange={(event) => {
                        onSettingsChange({ ...settings, prompt: event.target.value });
                        setMentionOpen(/@[^\s，。；：,.!?]*$/.test(event.target.value));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "@" && mentions.length > 0) setMentionOpen(true);
                        if (event.key === "Escape") setMentionOpen(false);
                      }}
                      placeholder={generationPromptPlaceholder(
                        profile.family,
                        workflow?.capability,
                        mentions.length > 0,
                      )}
                    />
                    {mentions.length ? (
                      <div className={`prompt-mention-menu ${mentionOpen ? "open" : ""}`}>
                        {mentions.map((mention) => (
                          <button
                            type="button"
                            key={`${mention.assetId}-${mention.alias}`}
                            onClick={() => {
                              const textarea = promptRef.current;
                              const cursor = textarea?.selectionStart ?? settings.prompt.length;
                              const before = settings.prompt
                                .slice(0, cursor)
                                .replace(/@[^\s，。；：,.!?]*$/, "");
                              const after = settings.prompt.slice(cursor);
                              const token = `@${mention.alias}`;
                              onSettingsChange({
                                ...settings,
                                prompt: `${before}${token}${after}`,
                              });
                              setMentionOpen(false);
                              window.requestAnimationFrame(() => {
                                textarea?.focus();
                                const nextCursor = before.length + token.length;
                                textarea?.setSelectionRange(nextCursor, nextCursor);
                              });
                            }}
                          >
                            {mention.thumbnailUrl ? (
                              <img src={mention.thumbnailUrl} alt="" />
                            ) : (
                              <span>图</span>
                            )}
                            <strong>@{mention.alias}</strong>
                            <small>{mention.role}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {mentions.length ? (
                      <div className="prompt-mention-chips">
                        {mentions.map((mention) => (
                          <button
                            type="button"
                            key={mention.alias}
                            title={mention.canonicalToken}
                            onClick={() => setMentionOpen(true)}
                          >
                            @{mention.alias}
                            <small>{mention.role}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </label>
                  {workflow?.inputs.includes("negative_prompt") ? (
                    <label className="negative-field">
                      <span>负面提示词</span>
                      <input
                        value={settings.negativePrompt}
                        onChange={(event) =>
                          onSettingsChange({ ...settings, negativePrompt: event.target.value })
                        }
                        placeholder="不希望出现的内容"
                      />
                    </label>
                  ) : null}
                  {profile.slots.length > 0 ? (
                    <div className="frame-slots model-driven-slots">
                      {profile.slots.map((slot) => {
                        const connectedCount = inputCounts[slot.id];
                        return (
                          <button
                            type="button"
                            className={connectedCount > 0 ? "filled" : ""}
                            onClick={onOpenAssets}
                            key={slot.id}
                          >
                            <span>{connectedCount > 0 ? connectedCount : "+"}</span>
                            <div>
                              <small>
                                {slot.required ? "必需" : "可选"} · {connectedCount}/{slot.maxCount}
                              </small>
                              <strong>{slot.label}</strong>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <section className="advanced-generation-settings" aria-label="生成参数">
                    <h3>生成参数</h3>
                    {workflow?.inputs.includes("resolution") ? (
                      <div className="parameter-grid">
                        <label htmlFor="generation-width">
                          <span>宽度</span>
                          <NumericInput
                            id="generation-width"
                            min={256}
                            max={2048}
                            step={32}
                            value={settings.width}
                            onValueChange={(width) => onSettingsChange({ ...settings, width })}
                          />
                        </label>
                        <label htmlFor="generation-height">
                          <span>高度</span>
                          <NumericInput
                            id="generation-height"
                            min={256}
                            max={2048}
                            step={32}
                            value={settings.height}
                            onValueChange={(height) => onSettingsChange({ ...settings, height })}
                          />
                        </label>
                        {workflow.inputs.includes("fps") && profile.family !== "minimax_h3" ? (
                          <label htmlFor="generation-fps">
                            <span>帧率</span>
                            <div>
                              <NumericInput
                                id="generation-fps"
                                min={8}
                                max={60}
                                step={1}
                                value={settings.fps}
                                onValueChange={(fps) => onSettingsChange({ ...settings, fps })}
                              />
                              <i>fps</i>
                            </div>
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                    {workflow?.inputs.includes("resolution") && resolvedResolution.changed ? (
                      <div className="effective-resolution" role="status">
                        <span>实际输出</span>
                        <strong>
                          {resolvedResolution.effective.width} ×{" "}
                          {resolvedResolution.effective.height}
                        </strong>
                        <small>
                          输入 {resolvedResolution.requested.width} ×{" "}
                          {resolvedResolution.requested.height}；{resolvedResolution.reason}
                        </small>
                      </div>
                    ) : null}
                    {workflow?.inputs.includes("seed") ? (
                      <label className="seed-field" htmlFor="generation-seed">
                        <span>种子</span>
                        <NumericInput
                          id="generation-seed"
                          min={0}
                          max={2_147_483_647}
                          step={1}
                          value={settings.seed}
                          onValueChange={(seed) => onSettingsChange({ ...settings, seed })}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onSettingsChange({
                              ...settings,
                              seed: Math.floor(Math.random() * 2_147_483_647),
                            })
                          }
                        >
                          随机
                        </button>
                      </label>
                    ) : null}
                    {workflow?.inputs.includes("steps") ? (
                      <label className="seed-field" htmlFor="generation-steps">
                        <span>采样步数</span>
                        <NumericInput
                          id="generation-steps"
                          min={profile.family === "wan22" ? 8 : 1}
                          max={profile.family === "wan22" ? 40 : 100}
                          step={1}
                          value={settings.steps}
                          onValueChange={(steps) => onSettingsChange({ ...settings, steps })}
                        />
                      </label>
                    ) : null}
                    {profile.family === "minimax_h3" &&
                    workflow?.capability === "reference_video" ? (
                      <label className="seed-field">
                        <input
                          type="checkbox"
                          checked={settings.referenceVideoAudio}
                          onChange={(event) =>
                            onSettingsChange({
                              ...settings,
                              referenceVideoAudio: event.target.checked,
                            })
                          }
                        />
                        <span>同时参考视频原声</span>
                      </label>
                    ) : null}
                    {profile.family === "minimax_h3" &&
                    workflow?.capability === "reference_video" ? (
                      <label className="seed-field" htmlFor="generation-reference-fidelity">
                        <span>参考图精度</span>
                        <select
                          id="generation-reference-fidelity"
                          value={settings.referenceImageSize}
                          onChange={(event) =>
                            onSettingsChange({
                              ...settings,
                              referenceImageSize: event.target.value === "max" ? "max" : "match",
                            })
                          }
                        >
                          <option value="match">匹配输出尺寸</option>
                          <option value="max">保留原图细节</option>
                        </select>
                      </label>
                    ) : null}
                    {workflow?.inputs.includes("denoise") ? (
                      <label className="seed-field" htmlFor="generation-denoise">
                        <span>重绘强度</span>
                        <NumericInput
                          id="generation-denoise"
                          min={0.05}
                          max={1}
                          step={0.05}
                          value={settings.denoise}
                          onValueChange={(denoise) => onSettingsChange({ ...settings, denoise })}
                        />
                        <small>0.35 保守 · 0.65 平衡 · 1.0 重构</small>
                      </label>
                    ) : null}
                  </section>
                  {workflow?.execution === "comfy_only" ? (
                    <div className="comfy-only-note">这个 JSON 目前从 ComfyUI 打开运行。</div>
                  ) : null}
                </section>
              </section>
            ) : null}
            <section className="inspector-section shot-information" aria-label="镜头信息">
              <h3>镜头信息</h3>
              <div className="shot-quick-edit">
                <textarea
                  aria-label="镜头备注"
                  value={shotDraft.body}
                  placeholder="添加镜头备注"
                  onChange={(event) =>
                    setShotDraft((current) => ({ ...current, body: event.target.value }))
                  }
                />
                <div>
                  <label>
                    <span>画幅</span>
                    <select
                      aria-label="镜头画幅"
                      value={shotDraft.aspectRatio}
                      onChange={(event) =>
                        setShotDraft((current) => ({
                          ...current,
                          aspectRatio: event.target.value as Shot["aspectRatio"],
                        }))
                      }
                    >
                      {(["16:9", "9:16", "1:1", "4:5", "2.35:1"] as const).map((ratio) => (
                        <option key={ratio}>{ratio}</option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="inspector-shot-duration">
                    <span>时长</span>
                    <NumericInput
                      id="inspector-shot-duration"
                      aria-label="镜头时长"
                      min={0.5}
                      max={300}
                      step={0.5}
                      value={shotDraft.durationSeconds}
                      onValueChange={(durationSeconds) =>
                        setShotDraft((current) => ({
                          ...current,
                          durationSeconds,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            </section>
          </fieldset>
        </div>
        <div
          role="tabpanel"
          id="inspector-panel-results"
          aria-labelledby="inspector-tab-results"
          hidden={inspectorTab !== "results"}
        >
          <div className="candidate-title-row">
            <h3>生成结果</h3>
            <p>{takes.length ? `${takes.length} 个结果` : "尚未生成"}</p>
          </div>
          {takes.length === 0 ? (
            <div className="empty-candidates">
              <strong>还没有生成结果</strong>
              <button type="button" onClick={() => setInspectorTab("generate")}>
                前往生成
              </button>
            </div>
          ) : (
            <>
              <div className="candidate-grid">
                {takes.map((take, index) => (
                  <button
                    className={`candidate-card ${selectedTakeId === take.id ? "selected" : ""} status-${take.status}`}
                    key={take.id}
                    type="button"
                    draggable={!readOnly && !isDemo && take.status !== "media_missing"}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/x-takeboard-asset", take.assetId);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setSelectedTakeId(take.id)}
                    aria-label={`选择候选 ${index + 1}`}
                  >
                    <CandidateArt
                      source={
                        take.status === "media_missing" ? undefined : mediaSource(take.assetId)
                      }
                      mediaType={mediaType(take.assetId)}
                    />
                    <div className="candidate-meta">
                      <span>结果 {index + 1}</span>
                      <span className={`take-state state-${take.status}`}>
                        {take.status === "approved"
                          ? "已采用"
                          : take.status === "rejected"
                            ? "未采用"
                            : take.status === "media_missing"
                              ? "文件缺失"
                              : "待选择"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {selectedTake ? (
                <>
                  {selectedTake.status !== "media_missing" && selectedMediaUrl ? (
                    <DetailMedia
                      src={selectedMediaUrl}
                      kind={mediaType(selectedTake.assetId) ?? "image"}
                      label="当前生成结果"
                    />
                  ) : null}
                  <div className="decision-panel">
                    <div className="decision-id">
                      <span>当前选择</span>
                      <strong>结果 {takes.indexOf(selectedTake) + 1}</strong>
                    </div>
                    {rejecting ? (
                      <div className="rejection-note">
                        <small>备注（选填）</small>
                        <select
                          aria-label="不采用的备注"
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        >
                          <option value="">不填写原因</option>
                          {rejectionReasons.map((item) => (
                            <option key={item}>{item}</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => setRejecting(false)}>
                          取消
                        </button>
                      </div>
                    ) : null}
                    <button
                      className="reject-button"
                      type="button"
                      disabled={readOnly || busy || selectedTake.status === "media_missing"}
                      onClick={() => {
                        if (!rejecting) setRejecting(true);
                        else {
                          onReject(selectedTake.id, reason || "未选用");
                          setRejecting(false);
                        }
                      }}
                    >
                      {rejecting ? "确认不采用" : "不采用"}
                    </button>
                    <button
                      className="approve-button"
                      type="button"
                      disabled={
                        readOnly ||
                        busy ||
                        selectedTake.status === "approved" ||
                        selectedTake.status === "media_missing"
                      }
                      onClick={() => onApprove(selectedTake.id)}
                    >
                      {selectedTake.status === "approved" ? "已采用" : "采用此结果"}
                    </button>
                  </div>
                  {!isDemo ? (
                    <button
                      type="button"
                      className="take-to-canvas"
                      disabled={readOnly || busy || selectedTake.status === "media_missing"}
                      onClick={() => onAddTakeToCanvas(selectedTake.assetId)}
                    >
                      加入画布
                    </button>
                  ) : null}
                </>
              ) : null}
              {selectedTakeRun ? (
                <GenerationRecord
                  run={selectedTakeRun}
                  assets={assets}
                  workflows={workflows}
                  onLocateAsset={onLocateAsset}
                  projectKey={projectKey}
                  outputType={selectedTake ? mediaType(selectedTake.assetId) : undefined}
                />
              ) : null}
            </>
          )}
          {orderedBatchRuns.length > 1 || batchFailed > 0 ? (
            <section className="candidate-batch-status" aria-label="最近一批候选的运行状态">
              <div className="candidate-batch-heading">
                <div>
                  <span>最近一批</span>
                  <strong>
                    {batchCompleted}/{String(expectedBatchCount)} 已完成
                  </strong>
                </div>
                <small>
                  {[
                    batchStopped > 0 ? `${batchStopped} 个已停止` : "",
                    batchFailed > 0 ? `${batchFailed} 个异常` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              <div className="candidate-batch-runs">
                {orderedBatchRuns.map(([index, run]) => {
                  const retryable = ["failed", "cancelled", "orphaned"].includes(run.status);
                  const statusLabel =
                    run.status === "completed"
                      ? "已完成"
                      : run.status === "failed"
                        ? "失败"
                        : run.status === "cancelled"
                          ? "已停止"
                          : run.status === "orphaned"
                            ? "待核对"
                            : run.status === "queued"
                              ? "排队中"
                              : "生成中";
                  const retryDirectly =
                    run.status === "cancelled" &&
                    !readOnly &&
                    recoveryGuidance(run.errorMessage ?? "", run.errorCode ?? "").action !==
                      "tasks";
                  return (
                    <div className={`candidate-run-state status-${run.status}`} key={run.id}>
                      <span>{String(index).padStart(2, "0")}</span>
                      <div>
                        <strong>{statusLabel}</strong>
                        <small title={run.execution?.workerName}>
                          种子 {String(run.parameters.seed ?? "—")}
                        </small>
                      </div>
                      {retryable ? (
                        <button
                          type="button"
                          disabled={retryDirectly && busy}
                          title={retryDirectly ? "使用此任务的原始参数重试" : "查看原因与处理方式"}
                          onClick={() => (retryDirectly ? onRetryRun(run) : setIssueRunId(run.id))}
                        >
                          {retryDirectly ? "重试" : "查看原因"}
                        </button>
                      ) : (
                        <i />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {issueRun && ["failed", "cancelled", "orphaned"].includes(issueRun.status) ? (
            <RecoveryNotice
              message={issueRun.errorMessage ?? "任务状态需要核对"}
              code={
                issueRun.errorCode ??
                (issueRun.status === "orphaned" ? "WORKER_TASK_MISSING" : undefined)
              }
              onAction={recover}
              onRetry={
                !readOnly &&
                !busy &&
                issueRun.status === "failed" &&
                recoveryGuidance(issueRun.errorMessage ?? "", issueRun.errorCode ?? "").action !==
                  "tasks"
                  ? () => onRetryRun(issueRun)
                  : undefined
              }
            />
          ) : null}
        </div>
      </div>
      <footer className="inspector-generation-footer">
        {progress ? (
          <section className="generation-progress" aria-live="polite">
            <div className="generation-progress-head">
              <div>
                <i />
                <span>{progress.label}</span>
              </div>
              <strong>{progress.percent === null ? "实时" : `${progress.percent}%`}</strong>
            </div>
            <div
              className={`generation-progress-track ${progress.percent === null ? "indeterminate" : ""}`}
            >
              <span
                style={progress.percent === null ? undefined : { width: `${progress.percent}%` }}
              />
            </div>
            <div className="generation-progress-detail">
              <span>{progress.detail}</span>
              <span>{progress.elapsedSeconds}s</span>
            </div>
            {canCancel ? (
              <button
                className="cancel-generation-button"
                type="button"
                disabled={readOnly || cancelling}
                onClick={onCancel}
              >
                {cancelling ? "正在停止并清理…" : "■ 停止生成并清理任务"}
              </button>
            ) : null}
          </section>
        ) : null}

        {!progress && canCancel ? (
          <section className="generation-cancel-strip">
            <span>
              <i /> 检测到这个镜头有运行中的任务
            </span>
            <button type="button" disabled={readOnly || cancelling} onClick={onCancel}>
              {cancelling ? "停止中…" : "停止并清理"}
            </button>
          </section>
        ) : null}

        {inspectorTab === "results" && !isDemo ? (
          <button
            type="button"
            className="generate-button"
            disabled={readOnly || busy}
            onClick={() => setInspectorTab("generate")}
          >
            继续生成
          </button>
        ) : (
          <div className="inspector-generate-actions">
            <div className="candidate-generation-actions">
              {!isDemo && workflow?.execution !== "comfy_only" ? (
                <fieldset className="candidate-count-control" aria-label="每批候选数量">
                  {[1, 2, 3, 4].map((count) => (
                    <button
                      type="button"
                      className={candidateCount === count ? "active" : ""}
                      aria-pressed={candidateCount === count}
                      disabled={readOnly || busy}
                      onClick={() => onCandidateCountChange(count)}
                      key={count}
                    >
                      {count}
                    </button>
                  ))}
                </fieldset>
              ) : null}
              <button
                className="generate-button"
                type="button"
                onClick={onGenerate}
                disabled={readOnly || busy || !!generateDisabledReason}
                title={generateDisabledReason ?? undefined}
              >
                {busy ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">✦</span>
                )}
                {busy
                  ? progress
                    ? `${progress.label}${progress.percent === null ? "" : ` · ${progress.percent}%`}`
                    : "处理中…"
                  : isDemo
                    ? takes.length > 0
                      ? "再抽 4 个"
                      : "开始生成"
                    : workflow?.execution === "comfy_only"
                      ? "在 ComfyUI 中打开"
                      : `生成 ${candidateCount} 个`}
              </button>
            </div>
          </div>
        )}
        {!isDemo && inspectorTab === "generate" && generateDisabledReason ? (
          <div className="generation-validation" role="status">
            <span>{generateDisabledReason}</span>
            <button
              type="button"
              onClick={() => recover(recoveryGuidance(generateDisabledReason).action)}
            >
              {recoveryGuidance(generateDisabledReason).label}
            </button>
          </div>
        ) : null}
      </footer>
    </aside>
  );
}
