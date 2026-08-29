import type { CommandAuditEntry } from "@takeboard/contracts";

type CommandHistoryProps = {
  busy: boolean;
  entries: CommandAuditEntry[];
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onUndo: (commandId: string) => void;
  open: boolean;
};

const effectWords = {
  create: "新增",
  update: "更新",
  remove: "移除",
  connect: "连接",
  disconnect: "断开",
} as const;

export function CommandHistory({
  busy,
  entries,
  error,
  onClose,
  onRefresh,
  onUndo,
  open,
}: CommandHistoryProps) {
  if (!open) return null;
  return (
    <aside className="command-history" aria-label="项目操作记录">
      <header>
        <div>
          <span>PROJECT HISTORY</span>
          <strong>操作记录</strong>
          <small>项目修改与生成任务彼此独立记录</small>
        </div>
        <button type="button" aria-label="关闭操作记录" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="command-history-tools">
        <span>{entries.length} 条最近操作</span>
        <button type="button" disabled={busy} onClick={onRefresh}>
          刷新
        </button>
      </div>
      {error ? <p className="command-history-error">{error}</p> : null}
      <div className="command-history-list">
        {entries.map((entry) => (
          <article className={entry.status === "undone" ? "is-undone" : ""} key={entry.id}>
            <div className="command-history-entry-head">
              <div>
                <strong>{entry.summary}</strong>
                <time dateTime={entry.createdAt}>
                  {new Intl.DateTimeFormat("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(entry.createdAt))}
                </time>
              </div>
              <span>{entry.status === "undone" ? "已撤销" : `r${entry.appliedRevision}`}</span>
            </div>
            {entry.effects.length > 0 ? (
              <ul>
                {entry.effects.slice(0, 4).map((item) => (
                  <li key={`${entry.id}:${item.action}:${item.entityId ?? item.label}`}>
                    <i>{effectWords[item.action]}</i>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>状态没有发生额外变化</p>
            )}
            {entry.status === "applied" && entry.undoable ? (
              <button
                className="command-history-undo"
                type="button"
                disabled={busy}
                onClick={() => onUndo(entry.id)}
              >
                撤销此操作
              </button>
            ) : null}
          </article>
        ))}
        {entries.length === 0 && !busy ? (
          <div className="command-history-empty">新的画布操作会从这里开始记录。</div>
        ) : null}
        {busy ? <div className="command-history-loading">正在读取操作记录…</div> : null}
      </div>
    </aside>
  );
}
