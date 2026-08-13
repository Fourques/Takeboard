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
};

export type BoardNode = Node<BoardNodeData>;

function Port({ type, position }: { type: "source" | "target"; position: Position }) {
  return <Handle type={type} position={position} className="board-handle" />;
}

function TextNode({ data }: NodeProps<BoardNode>) {
  return (
    <article className="board-card text-node">
      <Port type="source" position={Position.Right} />
      <div className="node-heading">
        <span className="node-icon text-icon">文</span>
        <span>{data.eyebrow}</span>
      </div>
      <h3>{data.title}</h3>
      <p>{data.body}</p>
      <footer>剧本资产 · 可作为生成来源</footer>
    </article>
  );
}

function EntityNode({ data }: NodeProps<BoardNode>) {
  return (
    <article className="board-card entity-node">
      <Port type="source" position={Position.Right} />
      <div className="node-media portrait-art" role="img" aria-label="林夏角色参考图">
        <div className="portrait-silhouette" />
        <span>CHARACTER REF</span>
      </div>
      <div className="node-heading compact">
        <span className="node-icon entity-icon">角</span>
        <span>{data.eyebrow}</span>
      </div>
      <h3>{data.title}</h3>
      <p>{data.body}</p>
    </article>
  );
}

function AssetNode({ data }: NodeProps<BoardNode>) {
  return (
    <article className="board-card asset-node">
      <Port type="source" position={Position.Right} />
      <div className="node-media harbor-art" role="img" aria-label="雾港场景参考图">
        <span className="harbor-sun" />
        <span className="harbor-line line-one" />
        <span className="harbor-line line-two" />
        <span className="harbor-boat" />
        <span className="asset-label">LOCATION REF</span>
      </div>
      <div className="node-heading compact">
        <span className="node-icon asset-icon">景</span>
        <span>{data.eyebrow}</span>
      </div>
      <h3>{data.title}</h3>
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
      <Port type="target" position={Position.Left} />
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
      <footer>
        <span>{data.duration} 秒</span>
        <span>{data.takeCount ?? 0} Takes</span>
        <span>Fake I2V</span>
      </footer>
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
