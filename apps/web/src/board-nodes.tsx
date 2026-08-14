import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

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
  details?: string[];
  inputSlots?: Array<{
    id: "first_frame" | "last_frame" | "reference";
    label: string;
    connected: boolean;
  }>;
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
    <article className="board-card text-node">
      <Port id="media" type="source" position={Position.Right} />
      <div className="node-heading">
        <span className="node-icon text-icon">文</span>
        <span>{data.eyebrow}</span>
      </div>
      <h3>{data.title}</h3>
      <p>{data.body}</p>
      <footer>剧本资产 · 可作为生成来源</footer>
      {data.selected ? <span className="node-action-hint">双击编辑 · 右键更多</span> : null}
    </article>
  );
}

function EntityNode({ data }: NodeProps<BoardNode>) {
  return (
    <article className="board-card entity-node">
      <Port id="media" type="source" position={Position.Right} />
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
  );
}

function AssetNode({ data }: NodeProps<BoardNode>) {
  return (
    <article className="board-card asset-node">
      <Port id="media" type="source" position={Position.Right} />
      <div className="node-media harbor-art" role="img" aria-label="场景参考图">
        {data.mediaUrl ? (
          <img src={data.mediaUrl} alt="" />
        ) : (
          <>
            <span className="harbor-sun" />
            <span className="harbor-line line-one" />
            <span className="harbor-line line-two" />
            <span className="harbor-boat" />
          </>
        )}
        <span className="asset-label">LOCATION REF</span>
      </div>
      <div className="node-heading compact">
        <span className="node-icon asset-icon">景</span>
        <span>{data.eyebrow}</span>
      </div>
      <h3>{data.title}</h3>
      <NodeFacts details={data.details} />
      {data.selected ? <span className="node-action-hint">双击编辑 · 右键更多</span> : null}
    </article>
  );
}

function ShotNode({ data }: NodeProps<BoardNode>) {
  const statusLabel = {
    draft: "待生成",
    generating: "生成中",
    review: "待选择",
    approved: "已批准",
  }[data.status ?? "draft"];
  return (
    <article className={`board-card shot-node ${data.selected ? "selected" : ""}`}>
      <div className="shot-inputs">
        {(data.inputSlots ?? []).map((slot, index) => (
          <div
            className={`shot-input ${slot.connected ? "connected" : ""}`}
            style={{ top: `${25 + index * 25}%` }}
            key={slot.id}
          >
            <Port
              id={slot.id}
              type="target"
              position={Position.Left}
              className={`slot-${slot.id}`}
            />
            <span>{slot.label}</span>
          </div>
        ))}
      </div>
      <Port type="source" position={Position.Right} />
      <div className="shot-topline">
        <span className="shot-label">{data.title}</span>
        <span className={`shot-status status-${data.status}`}>{statusLabel}</span>
      </div>
      <div className={`shot-preview shot-preview-${data.title.slice(-1)}`}>
        <span className="preview-frame">16:9</span>
        {data.status === "approved" ? <span className="approved-stamp">✓ APPROVED</span> : null}
      </div>
      <p>{data.body}</p>
      <NodeFacts details={data.details} />
      <footer>
        <span>{data.duration} 秒</span>
        <span>{data.takeCount ?? 0} Takes</span>
        <span>{data.engine ?? "I2V"}</span>
      </footer>
      {data.selected ? <span className="node-action-hint">双击编辑 · 右键更多</span> : null}
    </article>
  );
}

function TakeStackNode({ data }: NodeProps<BoardNode>) {
  const takeCount = data.takeCount ?? 0;
  return (
    <article className={`board-card stack-node ${data.selected ? "selected" : ""}`}>
      <Port type="target" position={Position.Left} />
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
  );
}

export const boardNodeTypes = {
  text: TextNode,
  entity: EntityNode,
  asset: AssetNode,
  shot: ShotNode,
  take_stack: TakeStackNode,
};
