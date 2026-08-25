import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { type ReactNode, useEffect, useState } from "react";

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
    id: "first_frame" | "last_frame" | "reference" | "reference_video";
    label: string;
    connectedCount: number;
    maxCount: number;
    required: boolean;
    mediaType: "image" | "video";
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

function ShotNode({ data }: NodeProps<BoardNode>) {
  const [titleDraft, setTitleDraft] = useState(data.title);
  useEffect(() => setTitleDraft(data.title), [data.title]);
  const [settingsDraft, setSettingsDraft] = useState(() => ({
    prompt: data.inlineControls?.prompt ?? "",
    width: data.inlineControls?.width ?? 1024,
    height: data.inlineControls?.height ?? 1024,
    durationSeconds: data.inlineControls?.durationSeconds ?? 5,
    seed: data.inlineControls?.seed ?? 0,
  }));
  useEffect(() => {
    if (!data.inlineControls) return;
    setSettingsDraft({
      prompt: data.inlineControls.prompt,
      width: data.inlineControls.width,
      height: data.inlineControls.height,
      durationSeconds: data.inlineControls.durationSeconds,
      seed: data.inlineControls.seed,
    });
  }, [data.inlineControls]);
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
        settingsDraft.durationSeconds < 1 ||
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
        className={`board-card shot-node ${data.mediaUrl ? "has-generated-media" : ""} ${data.selected ? "selected" : ""}`}
      >
        {data.mediaUrl ? (
          <div className="shot-generated-media" style={generatedStyle}>
            {data.mediaType === "video" ? (
              <video src={data.mediaUrl} autoPlay muted loop playsInline preload="metadata" />
            ) : (
              <img src={data.mediaUrl} alt={`${data.title} 生成画面`} />
            )}
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
            <div className={`shot-preview shot-preview-${data.title.slice(-1)}`}>
              <span className="preview-frame">{data.details?.[0] ?? "自由画幅"}</span>
            </div>
            <p>{data.body}</p>
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
            data.inlineControls?.onSettingsChange(settingsDraft);
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
                data.inlineControls?.onSettingsChange(settingsDraft);
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
                data.inlineControls?.onSettingsChange(settingsDraft);
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
                data.inlineControls?.onSettingsChange(settingsDraft);
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
            placeholder="描述画面；输入或点击 @素材名 引用已连接素材"
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, prompt: event.target.value }))
            }
          />
          {data.inlineControls.mentionAliases.length ? (
            <div className="shot-inline-mentions">
              {data.inlineControls.mentionAliases.map((alias) => (
                <button
                  type="button"
                  key={alias}
                  onClick={() =>
                    setSettingsDraft((current) => ({
                      ...current,
                      prompt: `${current.prompt}${current.prompt && !/\s$/.test(current.prompt) ? " " : ""}@${alias}`,
                    }))
                  }
                >
                  @{alias}
                </button>
              ))}
            </div>
          ) : null}
          <div className="shot-inline-parameters">
            <label>
              <span>尺寸</span>
              <div>
                <input
                  aria-label="画布宽度"
                  type="number"
                  min={256}
                  max={2048}
                  step={32}
                  value={settingsDraft.width}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      width: Number(event.target.value),
                    }))
                  }
                />
                <i>×</i>
                <input
                  aria-label="画布高度"
                  type="number"
                  min={256}
                  max={2048}
                  step={32}
                  value={settingsDraft.height}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      height: Number(event.target.value),
                    }))
                  }
                />
              </div>
            </label>
            {data.inlineControls.outputLabel === "视频" ? (
              <label>
                <span>时长</span>
                <input
                  aria-label="画布时长"
                  type="number"
                  min={1}
                  max={15}
                  step={0.5}
                  value={settingsDraft.durationSeconds}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      durationSeconds: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ) : null}
            <label>
              <span>Seed</span>
              <input
                aria-label="画布 Seed"
                type="number"
                min={0}
                value={settingsDraft.seed}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    seed: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>
          <button
            className="shot-inline-generate"
            type="button"
            disabled={data.inlineControls.busy || Boolean(draftDisabledReason)}
            title={draftDisabledReason ?? ""}
            onClick={() => {
              data.inlineControls?.onSettingsChange(settingsDraft);
              data.inlineControls?.onGenerate(settingsDraft);
            }}
          >
            {data.inlineControls.busy
              ? "生成中…"
              : `生成${data.inlineControls.outputLabel === "图片" ? "图片" : "镜头"}`}
          </button>
          {draftDisabledReason ? <small>{draftDisabledReason}</small> : null}
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
