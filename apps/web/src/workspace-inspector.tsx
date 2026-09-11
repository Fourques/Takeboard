import type { Asset, CanvasItem, ProjectSnapshot, Run, Shot, Take } from "@takeboard/contracts";
import { resolveGenerationResolution } from "@takeboard/contracts";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { projectApi, type WorkflowSummary } from "./api";
import type { GenerationProgress, GenerationSettings, PromptMention } from "./generation-model";
import type { ModelProfile } from "./model-profiles";
import { NumericInput } from "./numeric-input";
import { seekPreviewFrame, VideoThumbnail } from "./video-preview";

const rejectionReasons = ["角色漂移", "运动方向错误", "构图不稳定", "细节异常"];
const ExecutionProvenance = lazy(() =>
  import("./execution-provenance").then((module) => ({ default: module.ExecutionProvenance })),
);

function CandidateArt({
  index,
  source,
  mediaType,
}: {
  index: number;
  source: string | undefined;
  mediaType: Asset["mediaType"] | undefined;
}) {
  return (
    <div className={`candidate-art candidate-${index + 1}`}>
      {source && mediaType === "image" ? (
        <img src={source} alt="生成候选" />
      ) : source ? (
        <VideoThumbnail src={source} />
      ) : (
        <>
          <span className="candidate-fog fog-a" />
          <span className="candidate-fog fog-b" />
          <span className="candidate-person" />
          <span className="candidate-pier" />
        </>
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
          <div className="context-icon">文</div>
          <div>
            <span className="section-kicker">SCRIPT SOURCE</span>
            <h2>{text?.title || "未命名文本"}</h2>
            <p>
              {scene?.label ?? "场景"} · {text?.kind === "script" ? "剧本" : "创作笔记"}
            </p>
          </div>
          <div className="context-hero-actions">
            <span className="context-type-pill">TEXT</span>
            <InspectorDismiss onClose={onClose} />
          </div>
        </div>
        <section className="context-section">
          <div className="context-section-heading">
            <div>
              <span className="section-kicker">CONTENT</span>
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
        <ContextSelectionHint />
      </aside>
    );
  }

  if (item.refType === "entity") {
    const entity = snapshot.entities.find((candidate) => candidate.id === item.refId);
    const references = snapshot.assets.filter((asset) =>
      entity?.referenceAssetIds.includes(asset.id),
    );
    const firstImage = references.find((asset) => asset.mediaType === "image");
    const typeLabel =
      entity?.kind === "character"
        ? "人物资产"
        : entity?.kind === "location"
          ? "场景资产"
          : "道具资产";
    return (
      <aside className="inspector node-context-inspector" aria-label="实体节点检查器">
        <div className="context-hero context-hero-entity">
          <div className="context-icon">
            {entity?.kind === "character" ? "角" : entity?.kind === "location" ? "景" : "物"}
          </div>
          <div>
            <span className="section-kicker">ASSET IDENTITY</span>
            <h2>{entity?.name ?? "未命名资产"}</h2>
            <p>
              {typeLabel} · {references.length} 张参考
            </p>
          </div>
          <div className="context-hero-actions">
            <span className="context-type-pill">ENTITY</span>
            <InspectorDismiss onClose={onClose} />
          </div>
        </div>
        {firstImage && sourceUrl(firstImage) ? (
          <div className="context-media context-media-portrait">
            <img src={sourceUrl(firstImage)} alt={`${entity?.name ?? "资产"}参考图`} />
            <span>PRIMARY REFERENCE</span>
          </div>
        ) : (
          <div className="context-media context-media-empty">
            <span>{entity?.kind === "character" ? "人物参考位" : "视觉参考位"}</span>
            <small>可从资产库补充参考图片</small>
          </div>
        )}
        <section className="context-section">
          <div className="context-section-heading">
            <div>
              <span className="section-kicker">PROFILE</span>
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
        <ContextSelectionHint />
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
        <div className="context-icon">素</div>
        <div>
          <span className="section-kicker">SOURCE ASSET</span>
          <h2>{asset?.originalName ?? "素材"}</h2>
          <p>
            {asset?.mediaType.toUpperCase() ?? "FILE"} ·{" "}
            {asset ? formatBytes(asset.byteSize) : "未知大小"}
          </p>
        </div>
        <div className="context-hero-actions">
          <span className="context-type-pill">ASSET</span>
          <InspectorDismiss onClose={onClose} />
        </div>
      </div>
      <div className="context-media context-media-asset">
        {assetUrl && asset?.mediaType === "image" ? (
          <img src={assetUrl} alt={asset.originalName} />
        ) : assetUrl && asset?.mediaType === "video" ? (
          <video src={assetUrl} controls muted playsInline />
        ) : assetUrl && asset?.mediaType === "audio" ? (
          <div className="context-audio-preview">
            <span aria-hidden="true">♪</span>
            {/* biome-ignore lint/a11y/useMediaCaption: raw reference audio has no authored caption track */}
            <audio src={assetUrl} controls preload="metadata" />
          </div>
        ) : (
          <div className="context-media-empty">
            <span>{asset?.mediaType === "audio" ? "音频素材" : "素材预览"}</span>
            <small>{projectKey ? "暂时无法生成预览" : "Demo 不读取本地文件"}</small>
          </div>
        )}
        <span className="context-media-label">{asset?.mimeType ?? "MEDIA"}</span>
      </div>
      {assetUrl && asset?.mediaType === "image" ? (
        <div className="original-asset-actions">
          <span>原始文件只读保存；后续裁切、扩图或重绘将创建新的衍生节点。</span>
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
            <span className="section-kicker">METADATA</span>
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
              <span className="section-kicker">CONNECTED AS</span>
              <h3>连接用途</h3>
            </div>
            <div className="connection-role-badges">
              {connectedRoles.has("first_frame") ? <span>首帧</span> : null}
              {connectedRoles.has("last_frame") ? <span>尾帧</span> : null}
              {connectedRoles.has("reference") ? <span>参考图</span> : null}
              {connectedRoles.size === 0 ? <em>尚未连接到模型输入</em> : null}
            </div>
            <p>从照片右侧端口拖到模型输入，系统会自动记录用途并占用对应输入。</p>
          </section>
          <section className="context-custom-tags">
            <div>
              <span className="section-kicker">CUSTOM TAGS</span>
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
            <p>
              {readOnly
                ? "标签由项目编辑者维护。"
                : "自定义标签只用于整理与检索，不会改变模型输入。"}
            </p>
          </section>
        </>
      ) : null}
      <ContextSelectionHint />
    </aside>
  );
}

function ContextSelectionHint() {
  return (
    <div className="context-selection-hint">
      <span>⌁</span>
      <p>
        <strong>节点已选中</strong>点击其他卡片切换内容；点击画布空白处即可收起。
      </p>
    </div>
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
  runs: Run[];
  settings: GenerationSettings;
  workflow: WorkflowSummary | null;
  profile: ModelProfile;
  workflowDetected: boolean;
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
  runs,
  settings,
  workflow,
  profile,
  workflowDetected,
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
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
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
  const modelCheckLabel =
    workflow?.modelStatus === "ready"
      ? "所需模型已在当前 ComfyUI 检测"
      : workflow?.modelStatus === "missing"
        ? `缺少 ${workflow.missingModels?.length ?? 0} 个模型文件`
        : workflowDetected
          ? "Workflow 已检测，模型清单待确认"
          : "本地参考配置";
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
    ["failed", "cancelled", "orphaned"].includes(run.status),
  ).length;

  return (
    <aside className="inspector" aria-label="镜头候选检查器">
      <div className="inspector-heading">
        <div>
          <span className="section-kicker">镜头详情</span>
          <input
            className="shot-title-input"
            aria-label="镜头名称"
            value={shotDraft.title}
            maxLength={80}
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
      <fieldset className="inspector-editable-zone" disabled={readOnly}>
        <details className="inspector-section">
          <summary>镜头信息</summary>
          <div className="shot-quick-edit">
            <textarea
              aria-label="镜头备注"
              value={shotDraft.body}
              placeholder="一句话记录镜头意图（可留空）"
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
        </details>

        {!isDemo ? (
          <details className="inspector-section" open={takes.length === 0}>
            <summary>生成设置</summary>
            <section className="generation-console">
              <button
                className={`recipe-selector ${workflowLocked ? "locked" : ""}`}
                type="button"
                disabled={workflowLocked}
                onClick={onOpenRecipes}
              >
                <span className="recipe-selector-icon">⌘</span>
                <span>
                  <small>工作流</small>
                  <strong>{workflow?.name ?? "选择工作流"}</strong>
                </span>
                <i>{workflowLocked ? "已随镜头锁定" : `${workflow?.capabilityLabel ?? "选择"}⌄`}</i>
              </button>
              <div
                className={`model-profile-summary ${workflow?.modelStatus === "missing" ? "is-missing" : workflowDetected ? "is-detected" : "is-fallback"}`}
              >
                <div>
                  <strong>{profile.outputLabel}</strong>
                </div>
                <small>{modelCheckLabel}</small>
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
                  placeholder={
                    profile.family === "minimax_h3"
                      ? "按时间线描述画面与声音，例如 [0s-2s] 动作、运镜、对白与环境声…"
                      : mentions.length
                        ? "输入 @ 引用已连接画面…"
                        : "描述一个主要动作、运镜、速度和光线连续性…"
                  }
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
                          onSettingsChange({ ...settings, prompt: `${before}${token}${after}` });
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
                        onClick={() => setMentionOpen(true)}
                      >
                        @{mention.alias}
                        <small>{mention.role}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>
              {mentions.length ? (
                <details className="h3-prompt-guide">
                  <summary>本次输入 · {mentions.length} 个素材</summary>
                  {mentions.map((mention) => (
                    <p key={`${mention.assetId}-${mention.alias}`}>
                      {mention.alias} · {mention.role}
                      {profile.family === "minimax_h3" ? (
                        <small> {mention.canonicalToken}</small>
                      ) : null}
                    </p>
                  ))}
                  {workflow?.capability === "reference_video" &&
                  profile.family === "minimax_h3" &&
                  inputCounts.reference_video > 0 ? (
                    <p>{settings.referenceVideoAudio ? "参考视频画面与原声" : "仅参考视频画面"}</p>
                  ) : null}
                </details>
              ) : null}
              {profile.family === "minimax_h3" ? (
                <details className="h3-prompt-guide">
                  <summary>H3 音画提示词结构</summary>
                  {workflow?.capability === "reference_video" ? (
                    <p>
                      先定义参考素材提供的人物、场景、动作或声线，再按播放顺序写镜头。使用上方的
                      @素材名；提交时会自动转换为 H3 所需的 Picture / Video / Audio 标签。
                    </p>
                  ) : (
                    <p>
                      按镜头时间线描述画面、动作、运镜、对白和同步声音；最后分别说明整体环境声与非画内配乐。
                    </p>
                  )}
                  <code>
                    {workflow?.capability === "reference_video"
                      ? "subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music"
                      : "integrated_multimodal_description → overall_soundscape → non_diegetic_music"}
                  </code>
                </details>
              ) : null}
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
                          <em>
                            {slot.maxCount > 1
                              ? `最多 ${slot.maxCount} ${slot.mediaType === "image" ? "张" : "段"}`
                              : slot.hint}
                          </em>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <details className="advanced-generation-settings">
                <summary>
                  生成参数 <span>分辨率、Seed 与采样</span>
                </summary>
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
                      {resolvedResolution.effective.width} × {resolvedResolution.effective.height}
                    </strong>
                    <small>
                      输入 {resolvedResolution.requested.width} ×{" "}
                      {resolvedResolution.requested.height}；{resolvedResolution.reason}
                    </small>
                  </div>
                ) : null}
                {workflow?.inputs.includes("seed") ? (
                  <label className="seed-field" htmlFor="generation-seed">
                    <span>Seed</span>
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
                    <span>Steps</span>
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
                {profile.family === "minimax_h3" && workflow?.capability === "reference_video" ? (
                  <label className="seed-field">
                    <input
                      type="checkbox"
                      checked={settings.referenceVideoAudio}
                      onChange={(event) =>
                        onSettingsChange({ ...settings, referenceVideoAudio: event.target.checked })
                      }
                    />
                    <span>同时参考视频原声</span>
                  </label>
                ) : null}
                {profile.family === "minimax_h3" && workflow?.capability === "reference_video" ? (
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
                      <option value="match">平衡 · 匹配输出尺寸</option>
                      <option value="max">身份优先 · 保留更多参考细节</option>
                    </select>
                    <small>
                      “身份优先”会显著增加显存与采样时间，24 GB 显存建议少量参考图使用。
                    </small>
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
              </details>
              {workflow?.execution === "comfy_only" ? (
                <div className="comfy-only-note">这个 JSON 目前从 ComfyUI 打开运行。</div>
              ) : null}
            </section>
          </details>
        ) : null}
      </fieldset>

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
          <div className="generation-phases">
            {(["preparing", "queued", "running", "collecting"] as const).map((phase) => (
              <i className={phase === progress.phase ? "active" : ""} key={phase} />
            ))}
          </div>
          <small>
            {progress.label.startsWith("候选结果")
              ? "批次进度表示已保存的候选数量，不混合各节点的采样百分比。"
              : "百分比来自当前执行节点或文件传输；不提供步进时只显示实时状态。"}
          </small>
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

      {orderedBatchRuns.length > 1 || batchFailed > 0 ? (
        <section className="candidate-batch-status" aria-label="最近一批候选的运行状态">
          <div className="candidate-batch-heading">
            <div>
              <span>LATEST BATCH</span>
              <strong>
                {batchCompleted}/{String(expectedBatchCount)} 已完成
              </strong>
            </div>
            {batchFailed > 0 ? <small>{batchFailed} 个需要处理</small> : null}
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
              return (
                <div className={`candidate-run-state status-${run.status}`} key={run.id}>
                  <span>{String(index).padStart(2, "0")}</span>
                  <div>
                    <strong>{statusLabel}</strong>
                    <small>
                      seed {String(run.parameters.seed ?? "—")}
                      {run.execution ? ` · ${run.execution.workerName}` : ""}
                    </small>
                    {run.execution ? (
                      <em title={run.execution.selectionReason}>调度依据可追溯</em>
                    ) : null}
                  </div>
                  {retryable && !readOnly ? (
                    <button type="button" disabled={busy} onClick={() => onRetryRun(run)}>
                      同参数重试
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

      <div className="candidate-title-row">
        <div>
          <h3>生成结果</h3>
          <p>{takes.length > 0 ? `${takes.length} 个结果` : "尚未生成"}</p>
        </div>
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

      {!isDemo && generateDisabledReason ? (
        <div className="generation-validation">{generateDisabledReason}</div>
      ) : null}

      {takes.length === 0 ? (
        <div className="empty-candidates">
          <strong>这个镜头还没有生成结果</strong>
          <p>生成后可在这里预览、比较和采用结果。</p>
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
                  index={index % 4}
                  source={mediaSource(take.assetId)}
                  mediaType={mediaType(take.assetId)}
                />
                <div className="candidate-meta">
                  <span>结果 {index + 1}</span>
                  <span className={`take-state state-${take.status}`}>
                    {take.status === "approved"
                      ? "已采用"
                      : take.status === "rejected"
                        ? "未采用"
                        : "待选择"}
                  </span>
                </div>
              </button>
            ))}
          </div>
          {selectedTake ? (
            <>
              {mediaType(selectedTake.assetId) === "video" ? (
                <div className="selected-take-preview">
                  <video
                    src={mediaSource(selectedTake.assetId)}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    aria-label="当前生成结果"
                    onLoadedMetadata={(event) => seekPreviewFrame(event.currentTarget)}
                    onLoadedData={(event) => seekPreviewFrame(event.currentTarget)}
                  />
                </div>
              ) : null}
              <div className="decision-panel">
                <div className="decision-id">
                  <span>当前选择</span>
                  <strong>结果 {takes.indexOf(selectedTake) + 1}</strong>
                </div>
                {rejecting ? (
                  <div className="rejection-note">
                    <small>筛选备注（选填），不是系统检测结论</small>
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
                  disabled={readOnly || busy || selectedTake.status === "approved"}
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
            <details className="inspector-section">
              <summary>生成记录</summary>
              <div className="context-facts context-facts-wide">
                <span>
                  <small>工作流</small>
                  {String(selectedTakeRun.parameters.recipePath ?? selectedTakeRun.recipeId)}
                </span>
                <span>
                  <small>模型文件</small>
                  {Array.isArray(selectedTakeRun.parameters.models) &&
                  selectedTakeRun.parameters.models.length
                    ? selectedTakeRun.parameters.models.join(" · ")
                    : "未记录"}
                </span>
                <span>
                  <small>工作流版本</small>
                  {selectedTakeRun.recipeVersion}
                </span>
                <span>
                  <small>种子</small>
                  {String(selectedTakeRun.parameters.seed ?? "未记录")}
                </span>
                <span>
                  <small>尺寸</small>
                  {String(selectedTakeRun.parameters.width ?? "—")} ×{" "}
                  {String(selectedTakeRun.parameters.height ?? "—")}
                </span>
                <span>
                  <small>时长 / 帧率</small>
                  {String(selectedTakeRun.parameters.durationSeconds ?? "—")} s ·{" "}
                  {String(selectedTakeRun.parameters.fps ?? "—")} fps
                </span>
                <span>
                  <small>步数</small>
                  {String(selectedTakeRun.parameters.steps ?? "—")}
                </span>
                <span>
                  <small>生成时间</small>
                  {new Date(selectedTakeRun.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="run-prompt">
                <small>提示词</small>
                <pre>{String(selectedTakeRun.parameters.prompt ?? "未记录")}</pre>
              </div>
              {selectedTakeRun.parameters.negativePrompt ||
              selectedTakeRun.parameters.negative_prompt ? (
                <div className="run-prompt">
                  <small>负向提示词</small>
                  <pre>
                    {String(
                      selectedTakeRun.parameters.negativePrompt ??
                        selectedTakeRun.parameters.negative_prompt,
                    )}
                  </pre>
                </div>
              ) : null}
              <details className="run-raw">
                <summary>完整参数与输入</summary>
                <pre>
                  {JSON.stringify(
                    {
                      parameters: selectedTakeRun.parameters,
                      inputs: selectedTakeRun.inputs,
                      workflowSha256: selectedTakeRun.workflowSha256,
                      promptId: selectedTakeRun.promptId,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              {selectedTakeRun.execution ? (
                <Suspense fallback={null}>
                  <ExecutionProvenance run={selectedTakeRun} />
                </Suspense>
              ) : null}
            </details>
          ) : null}
        </>
      )}
    </aside>
  );
}
