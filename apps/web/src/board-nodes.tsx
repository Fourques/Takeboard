import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { NumericInput } from "./numeric-input";

export type BoardNodeData = {
  kind: "text" | "entity" | "asset" | "shot" | "take_stack";
  eyebrow: string;
  title: string;
  body: string;
  status?: "draft" | "generating" | "review" | "approved" | undefined;
  duration?: number | undefined;
  takeCount?: number;
  rejectedCount?: number;
  selected?: boolean;
  engine?: string;
  mediaUrl?: string | undefined;
  mediaType?: "image" | "video" | "audio" | undefined;
  mediaWidth?: number | undefined;
  mediaHeight?: number | undefined;
  aspectRatio?: string | undefined;
  details?: string[];
  inputSlots?: Array<{
    id: "first_frame" | "last_frame" | "reference" | "reference_video" | "reference_audio";
    label: string;
    connectedCount: number;
    maxCount: number;
    required: boolean;
    mediaType: "image" | "video" | "audio";
  }>;
  inlineControls?: {
    workflowPath: string;
    workflows: Array<{
      path: string;
      name: string;
      capability: string;
      capabilityLabel: string;
    }>;
    workflowLocked: boolean;
    prompt: string;
    width: number;
    height: number;
    durationSeconds: number;
    seed: number;
    outputLabel: "图片" | "视频";
    mentionAliases: string[];
    busy: boolean;
    progress: {
      phase: "preparing" | "queued" | "running" | "collecting";
      label: string;
      detail: string;
      percent: number | null;
      elapsedSeconds: number;
    } | null;
    disabledReason: string | null;
    onWorkflowChange: (path: string) => void;
    onSettingsChange: (input: {
      prompt?: string;
      width?: number;
      height?: number;
      durationSeconds?: number;
      seed?: number;
    }) => void;
    onGenerate: (input: {
      prompt: string;
      width: number;
      height: number;
      durationSeconds: number;
      seed: number;
    }) => void;
    onOpenDetails: () => void;
    onCommitTitle: (title: string) => void;
  };
};

export type BoardNode = Node<BoardNodeData>;

function Port({
  type,
  position,
  id,
  className = "",
}: {
  type: "source" | "target";
  position: Position;
  id?: string | null;
  className?: string;
}) {
  return (
    <Handle
      id={id ?? null}
      type={type}
      position={position}
      className={`board-handle ${className}`}
    />
  );
}

function NodeShell({
  children,
  selected,
  output = true,
}: {
  children: ReactNode;
  selected: boolean | undefined;
  output?: boolean;
}) {
  return (
    <div className={`board-node-shell ${selected ? "selected" : ""}`}>
      {output ? (
        <Port id="media" type="source" position={Position.Right} className="board-output-handle" />
      ) : null}
      {children}
    </div>
  );
}

function NodeFacts({ details }: { details: string[] | undefined }) {
  return details?.length ? (
    <div className="node-facts">
      {details.map((detail) => (
        <span key={detail}>{detail}</span>
      ))}
    </div>
  ) : null;
}

function TextNode({ data }: NodeProps<BoardNode>) {
  return (
    <NodeShell selected={data.selected}>
      <article className="board-card text-node">
        <div className="node-heading">
          <span className="node-icon text-icon">文</span>
          <span>{data.eyebrow}</span>
        </div>
        <h3>{data.title}</h3>
        <p>{data.body}</p>
        <footer>剧本资产 · 可作为生成来源</footer>
        {data.selected ? <span className="node-action-hint">双击编辑 · 右键更多</span> : null}
      </article>
    </NodeShell>
  );
}

function EntityNode({ data }: NodeProps<BoardNode>) {
  return (
    <NodeShell selected={data.selected}>
      <article className="board-card entity-node">
        <div className="node-media portrait-art" role="img" aria-label="人物或场景参考图">
          {data.mediaUrl ? (
            <img src={data.mediaUrl} alt="" />
          ) : (
            <div className="portrait-silhouette" />
          )}
          <span>CHARACTER REF</span>
        </div>
        <div className="node-heading compact">
          <span className="node-icon entity-icon">角</span>
          <span>{data.eyebrow}</span>
        </div>
        <h3>{data.title}</h3>
        <p>{data.body}</p>
        <NodeFacts details={data.details} />
        {data.selected ? <span className="node-action-hint">双击编辑 · 右键更多</span> : null}
      </article>
    </NodeShell>
  );
}

function AssetNode({ data }: NodeProps<BoardNode>) {
  const mediaStyle =
    data.mediaWidth && data.mediaHeight
      ? { aspectRatio: `${data.mediaWidth} / ${data.mediaHeight}` }
      : undefined;
  return (
    <NodeShell selected={data.selected}>
      <article className="board-card asset-node">
        <div
          className="node-media harbor-art"
          role="img"
          aria-label={`完整原图：${data.title}`}
          style={mediaStyle}
        >
          {data.mediaUrl && data.mediaType === "video" ? (
            <video src={data.mediaUrl} muted loop playsInline controls preload="metadata" />
          ) : data.mediaUrl && data.mediaType === "audio" ? (
            <div className="asset-audio-preview">
              <span aria-hidden="true">♪</span>
              {/* biome-ignore lint/a11y/useMediaCaption: raw reference audio has no authored caption track */}
              <audio src={data.mediaUrl} controls preload="metadata" />
            </div>
          ) : data.mediaUrl ? (
            <img src={data.mediaUrl} alt={data.title} />
          ) : (
            <>
              <span className="harbor-sun" />
              <span className="harbor-line line-one" />
              <span className="harbor-line line-two" />
              <span className="harbor-boat" />
            </>
          )}
          <span className="asset-label">SOURCE</span>
        </div>
      </article>
    </NodeShell>
  );
}

function ShotNode({ data, id }: NodeProps<BoardNode>) {
  const [titleDraft, setTitleDraft] = useState(data.title);
  const [failedMediaUrl, setFailedMediaUrl] = useState<string | null>(null);
  const [loadedMediaUrl, setLoadedMediaUrl] = useState<string | null>(null);
  const quickSettingsId = useId();
  useEffect(() => setTitleDraft(data.title), [data.title]);
  const mediaFailed = Boolean(data.mediaUrl && failedMediaUrl === data.mediaUrl);
  const mediaLoading = Boolean(
    data.mediaType === "video" && data.mediaUrl && loadedMediaUrl !== data.mediaUrl && !mediaFailed,
  );
  const [settingsDraft, setSettingsDraft] = useState(() => ({
    prompt: data.inlineControls?.prompt ?? "",
    width: data.inlineControls?.width ?? 1024,
    height: data.inlineControls?.height ?? 1024,
    durationSeconds: data.inlineControls?.durationSeconds ?? 5,
    seed: data.inlineControls?.seed ?? 0,
  }));
  const [numericDraftValidity, setNumericDraftValidity] = useState({
    width: true,
    height: true,
    duration: true,
    seed: true,
  });
  const updateNumericDraftValidity = (field: keyof typeof numericDraftValidity, valid: boolean) => {
    setNumericDraftValidity((current) =>
      current[field] === valid ? current : { ...current, [field]: valid },
    );
  };
  const settingsDraftRef = useRef(settingsDraft);
  settingsDraftRef.current = settingsDraft;
  const updateSettingsDraft = (input: Partial<typeof settingsDraft>) => {
    const next = { ...settingsDraftRef.current, ...input };
    settingsDraftRef.current = next;
    setSettingsDraft(next);
  };
  const inlinePrompt = data.inlineControls?.prompt;
  const inlineWidth = data.inlineControls?.width;
  const inlineHeight = data.inlineControls?.height;
  const inlineDurationSeconds = data.inlineControls?.durationSeconds;
  const inlineSeed = data.inlineControls?.seed;
  useEffect(() => {
    if (
      inlinePrompt === undefined ||
      inlineWidth === undefined ||
      inlineHeight === undefined ||
      inlineDurationSeconds === undefined ||
      inlineSeed === undefined
    ) {
      return;
    }
    const next = {
      prompt: inlinePrompt,
      width: inlineWidth,
      height: inlineHeight,
      durationSeconds: inlineDurationSeconds,
      seed: inlineSeed,
    };
    settingsDraftRef.current = next;
    setSettingsDraft(next);
  }, [inlineDurationSeconds, inlineHeight, inlinePrompt, inlineSeed, inlineWidth]);
  const statusLabel = {
    draft: "待生成",
    generating: "生成中",
    review: "待选择",
    approved: "已批准",
  }[data.status ?? "draft"];
  const generatedStyle =
    data.mediaWidth && data.mediaHeight
      ? { aspectRatio: `${data.mediaWidth} / ${data.mediaHeight}` }
      : data.aspectRatio?.includes(":")
        ? { aspectRatio: data.aspectRatio.replace(":", " / ") }
        : undefined;
  const currentWorkflow = data.inlineControls?.workflows.find(
    (workflow) => workflow.path === data.inlineControls?.workflowPath,
  );
  const capabilityGroups = Array.from(
    new Map(
      data.inlineControls?.workflows.map((workflow) => [
        workflow.capability,
        workflow.capabilityLabel,
      ]) ?? [],
    ),
  );
  const visibleWorkflows = currentWorkflow
    ? (data.inlineControls?.workflows.filter(
        (workflow) => workflow.capability === currentWorkflow.capability,
      ) ?? [])
    : (data.inlineControls?.workflows ?? []);
  const draftParameterInvalid =
    !numericDraftValidity.width ||
    !numericDraftValidity.height ||
    !numericDraftValidity.seed ||
    (data.inlineControls?.outputLabel === "视频" && !numericDraftValidity.duration) ||
    !Number.isFinite(settingsDraft.width) ||
    settingsDraft.width < 256 ||
    settingsDraft.width > 2048 ||
    !Number.isFinite(settingsDraft.height) ||
    settingsDraft.height < 256 ||
    settingsDraft.height > 2048 ||
    !Number.isSafeInteger(settingsDraft.seed) ||
    settingsDraft.seed < 0 ||
    (data.inlineControls?.outputLabel === "视频" &&
      (!Number.isFinite(settingsDraft.durationSeconds) ||
        settingsDraft.durationSeconds <
          (currentWorkflow?.name.toLowerCase().includes("minimax") ? 4 : 1) ||
        settingsDraft.durationSeconds > 15));
  const draftDisabledReason = !settingsDraft.prompt.trim()
    ? "请先输入镜头提示词"
    : draftParameterInvalid
      ? "请检查分辨率、时长和 Seed"
      : data.inlineControls?.disabledReason === "请先输入镜头提示词"
        ? null
        : data.inlineControls?.disabledReason;
  return (
    <NodeShell selected={data.selected}>
      <Port type="target" position={Position.Left} className="board-provenance-handle" />
      <div className="shot-inputs">
        {(data.inputSlots ?? []).map((slot, index) => (
          <div
            className={`shot-input ${slot.connectedCount > 0 ? "connected" : ""}`}
            style={{ top: `${((index + 1) / ((data.inputSlots?.length ?? 0) + 1)) * 100}%` }}
            key={slot.id}
          >
            <Port
              id={slot.id}
              type="target"
              position={Position.Left}
              className={`slot-${slot.id}`}
            />
            <span>
              {slot.label} {slot.connectedCount}/{slot.maxCount}
              {slot.required ? <i>必需</i> : null}
            </span>
          </div>
        ))}
      </div>
      <article
        className={`board-card shot-node ${data.mediaUrl ? "has-generated-media" : "is-planning"} ${data.selected ? "selected" : ""}`}
      >
        {data.mediaUrl ? (
          <div
            className={`shot-generated-media ${data.mediaType === "video" ? "is-video" : ""}`}
            style={generatedStyle}
          >
            {data.mediaType === "video" ? (
              <video
                className="nodrag nopan nowheel"
                src={data.mediaUrl}
                autoPlay
                controls
                muted
                loop
                playsInline
                preload="metadata"
                aria-label={`${data.title} 生成视频`}
                onError={() => setFailedMediaUrl(data.mediaUrl ?? null)}
                onLoadedData={() => {
                  setFailedMediaUrl(null);
                  setLoadedMediaUrl(data.mediaUrl ?? null);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              />
            ) : (
              <img src={data.mediaUrl} alt={`${data.title} 生成画面`} />
            )}
            {mediaLoading ? (
              <div className="shot-video-loading" role="status">
                <span aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <strong>正在读取视频预览</strong>
                <small>原文件已安全保留</small>
              </div>
            ) : null}
            {mediaFailed ? (
              <div className="shot-video-fallback">
                <strong>浏览器无法直接播放这个视频</strong>
                <a href={data.mediaUrl} target="_blank" rel="noreferrer">
                  打开原视频
                </a>
              </div>
            ) : null}
            <div className="shot-generated-overlay">
              <span className="shot-label">{data.title}</span>
              <span className="shot-generated-facts">
                <strong>{data.engine}</strong>
                <i>
                  {data.duration} 秒 · {data.mediaType === "image" ? "图片" : "视频"}
                </i>
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="shot-topline">
              <span className="shot-label">{data.title}</span>
              <span className={`shot-status status-${data.status}`}>{statusLabel}</span>
            </div>
            <div className="shot-planning-surface">
              <span className="shot-planning-mark" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <div>
                <strong>{data.body.trim() ? "提示已就绪" : "等待创作"}</strong>
                <p>{data.body.trim() || "写下镜头，或连接一张参考素材。"}</p>
              </div>
            </div>
            <NodeFacts details={data.details} />
            <footer>
              <span>{data.duration} 秒</span>
              <span>{data.takeCount ?? 0} Takes</span>
              <span>{data.engine ?? "I2V"}</span>
            </footer>
            {data.selected ? <span className="node-action-hint">在右侧编辑镜头</span> : null}
          </>
        )}
      </article>
      {data.selected && data.inlineControls ? (
        <fieldset
          className="shot-inline-console nodrag nopan nowheel"
          aria-label="画布镜头快速设置"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return;
            window.requestAnimationFrame(() =>
              data.inlineControls?.onSettingsChange(settingsDraftRef.current),
            );
          }}
        >
          <div className="shot-inline-title-row">
            <input
              aria-label="画布镜头名称"
              value={titleDraft}
              maxLength={80}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => {
                const title = titleDraft.trim();
                if (title && title !== data.title) data.inlineControls?.onCommitTitle(title);
              }}
            />
            <button
              type="button"
              onClick={() => {
                data.inlineControls?.onSettingsChange(settingsDraftRef.current);
                data.inlineControls?.onOpenDetails();
              }}
            >
              详细设置
            </button>
          </div>
          <div className="shot-inline-workflow-row">
            <select
              aria-label="画布生成方式"
              value={currentWorkflow?.capability ?? ""}
              disabled={data.inlineControls.workflowLocked}
              onChange={(event) => {
                data.inlineControls?.onSettingsChange(settingsDraftRef.current);
                const workflow = data.inlineControls?.workflows.find(
                  (candidate) => candidate.capability === event.target.value,
                );
                if (workflow) data.inlineControls?.onWorkflowChange(workflow.path);
              }}
            >
              {capabilityGroups.map(([capability, label]) => (
                <option value={capability} key={capability}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="画布工作流"
              value={data.inlineControls.workflowPath}
              disabled={data.inlineControls.workflowLocked}
              onChange={(event) => {
                data.inlineControls?.onSettingsChange(settingsDraftRef.current);
                data.inlineControls?.onWorkflowChange(event.target.value);
              }}
            >
              {visibleWorkflows.map((workflow) => (
                <option value={workflow.path} key={workflow.path}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            aria-label="画布提示词"
            value={settingsDraft.prompt}
            placeholder={
              currentWorkflow?.name.toLowerCase().includes("minimax")
                ? "按时间线描述画面、对白、环境声和配乐"
                : "描述一个主要动作、运镜与光线；@ 引用素材"
            }
            onChange={(event) => updateSettingsDraft({ prompt: event.target.value })}
          />
          {data.inlineControls.mentionAliases.length ? (
            <div className="shot-inline-mentions">
              {data.inlineControls.mentionAliases.map((alias) => (
                <button
                  type="button"
                  key={alias}
                  onClick={() => {
                    const prompt = settingsDraftRef.current.prompt;
                    updateSettingsDraft({
                      prompt: `${prompt}${prompt && !/\s$/.test(prompt) ? " " : ""}@${alias}`,
                    });
                  }}
                >
                  @{alias}
                </button>
              ))}
            </div>
          ) : null}
          <div className="shot-inline-parameters">
            <label htmlFor={`${quickSettingsId}-width`}>
              <span>尺寸</span>
              <div>
                <NumericInput
                  id={`${quickSettingsId}-width`}
                  draftKey={`${id}:${data.inlineControls.workflowPath}:width`}
                  aria-label="画布宽度"
                  min={256}
                  max={2048}
                  step={32}
                  value={settingsDraft.width}
                  preserveEmptyOnBlur
                  onDraftValidityChange={(valid) => updateNumericDraftValidity("width", valid)}
                  onValueChange={(width) => updateSettingsDraft({ width })}
                />
                <i>×</i>
                <NumericInput
                  id={`${quickSettingsId}-height`}
                  draftKey={`${id}:${data.inlineControls.workflowPath}:height`}
                  aria-label="画布高度"
                  min={256}
                  max={2048}
                  step={32}
                  value={settingsDraft.height}
                  preserveEmptyOnBlur
                  onDraftValidityChange={(valid) => updateNumericDraftValidity("height", valid)}
                  onValueChange={(height) => updateSettingsDraft({ height })}
                />
              </div>
            </label>
            {data.inlineControls.outputLabel === "视频" ? (
              <label htmlFor={`${quickSettingsId}-duration`}>
                <span>时长</span>
                <NumericInput
                  id={`${quickSettingsId}-duration`}
                  draftKey={`${id}:${data.inlineControls.workflowPath}:duration`}
                  aria-label="画布时长"
                  min={currentWorkflow?.name.toLowerCase().includes("minimax") ? 4 : 1}
                  max={15}
                  step={0.5}
                  value={settingsDraft.durationSeconds}
                  preserveEmptyOnBlur
                  onDraftValidityChange={(valid) => updateNumericDraftValidity("duration", valid)}
                  onValueChange={(durationSeconds) => updateSettingsDraft({ durationSeconds })}
                />
              </label>
            ) : null}
            <label htmlFor={`${quickSettingsId}-seed`}>
              <span>Seed</span>
              <NumericInput
                id={`${quickSettingsId}-seed`}
                draftKey={`${id}:${data.inlineControls.workflowPath}:seed`}
                aria-label="画布 Seed"
                min={0}
                max={2_147_483_647}
                step={1}
                value={settingsDraft.seed}
                preserveEmptyOnBlur
                onDraftValidityChange={(valid) => updateNumericDraftValidity("seed", valid)}
                onValueChange={(seed) => updateSettingsDraft({ seed })}
              />
            </label>
          </div>
          <button
            className="shot-inline-generate"
            type="button"
            disabled={data.inlineControls.busy || Boolean(draftDisabledReason)}
            title={draftDisabledReason ?? ""}
            onClick={() => {
              data.inlineControls?.onSettingsChange(settingsDraftRef.current);
              data.inlineControls?.onGenerate(settingsDraftRef.current);
            }}
          >
            <span>
              {data.inlineControls.busy
                ? (data.inlineControls.progress?.label ?? "生成中…")
                : `生成${data.inlineControls.outputLabel === "图片" ? "图片" : "镜头"}`}
            </span>
            {data.inlineControls.progress ? (
              <>
                <b>
                  {data.inlineControls.progress.percent === null
                    ? "实时"
                    : `${data.inlineControls.progress.percent}%`}
                </b>
                <i
                  className={`shot-inline-progress-track ${data.inlineControls.progress.percent === null ? "indeterminate" : ""}`}
                  aria-hidden="true"
                >
                  <i
                    style={
                      data.inlineControls.progress.percent === null
                        ? undefined
                        : { width: `${data.inlineControls.progress.percent}%` }
                    }
                  />
                </i>
              </>
            ) : null}
          </button>
          {data.inlineControls.progress ? (
            <small className="shot-inline-progress-detail" aria-live="polite">
              {data.inlineControls.progress.detail} · {data.inlineControls.progress.elapsedSeconds}s
            </small>
          ) : draftDisabledReason ? (
            <small>{draftDisabledReason}</small>
          ) : null}
        </fieldset>
      ) : null}
    </NodeShell>
  );
}

function TakeStackNode({ data }: NodeProps<BoardNode>) {
  const takeCount = data.takeCount ?? 0;
  return (
    <NodeShell selected={data.selected}>
      <Port type="target" position={Position.Left} />
      <article className={`board-card stack-node ${data.selected ? "selected" : ""}`}>
        <div className="node-heading">
          <span className="node-icon stack-icon">选</span>
          <span>TAKE STACK</span>
          <span className="stack-count">{takeCount}</span>
        </div>
        <h3>{data.title} 候选</h3>
        <div className="stack-grid">
          {[1, 2, 3, 4].slice(0, Math.min(takeCount, 4)).map((slot) => (
            <span className={`mini-take mini-take-${slot}`} key={`take-slot-${slot}`}>
              {slot}
            </span>
          ))}
        </div>
        <footer>
          <span>{data.rejectedCount ?? 0} 已淘汰</span>
          <span>{data.status === "approved" ? "1 已批准" : "等待选择"}</span>
        </footer>
        {data.selected ? <span className="node-action-hint">右键复制或移除</span> : null}
      </article>
    </NodeShell>
  );
}

export const boardNodeTypes = {
  text: TextNode,
  entity: EntityNode,
  asset: AssetNode,
  shot: ShotNode,
  take_stack: TakeStackNode,
};
