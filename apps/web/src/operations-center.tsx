import type {
  OperationsStorage,
  OperationsTaskCenter,
  OperationTask,
  RunStatus,
} from "@takeboard/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { projectApi } from "./api";
import { optionalLocalStorage } from "./browser-storage";

const operationsCss = `.operations-control {
  position: relative;
  z-index: 32;
}

.operations-pill,
.operations-panel button {
  border: 1px solid var(--line);
  color: var(--text-1);
  background: var(--surface-2);
  cursor: pointer;
}

.operations-pill {
  display: flex;
  min-width: 132px;
  height: 42px;
  align-items: center;
  padding: 0 11px;
  border-radius: 10px;
  gap: 9px;
}

.operations-control.is-compact .operations-pill {
  width: auto;
  min-width: 108px;
  justify-content: center;
  padding: 0 12px;
  border-radius: 11px;
}

.operations-control.is-compact .operations-pill > div {
  display: none;
}

.operations-compact-label {
  font-size: calc(11px * var(--ui-scale));
  font-weight: 590;
  letter-spacing: 0.01em;
}

.operations-pill:hover,
.operations-pill[aria-expanded="true"] {
  border-color: var(--accent);
}

.operations-pill > div,
.operations-panel > header > div,
.operations-empty {
  display: grid;
  gap: 3px;
}

.operations-pill :is(strong, small),
.operation-task-main > :is(strong, small, em) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operations-pill strong {
  font-size: calc(11px * var(--ui-scale));
}

.operations-pill small,
.operations-panel small,
.operations-panel em {
  color: var(--text-2);
  font-size: calc(10px * var(--ui-scale));
}

.operations-mark {
  position: relative;
  display: grid;
  width: 17px;
  height: 17px;
  place-items: center;
  flex: none;
}

.operations-mark svg {
  width: 100%;
  height: 100%;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.45;
}

.operations-pulse {
  position: absolute;
  right: -2px;
  bottom: -1px;
  width: 5px;
  height: 5px;
  border: 1px solid var(--surface-2);
  border-radius: 50%;
  background: var(--text-2);
}

.operations-pill.has-active .operations-pulse {
  border-color: var(--surface-2);
  background: var(--green);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 15%, transparent);
  animation: operations-pulse 1.8s ease-in-out infinite;
}

@keyframes operations-pulse {
  50% {
    opacity: 0.45;
  }
}

.operations-panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  display: flex;
  flex-direction: column;
  width: min(460px, calc(100vw - 28px));
  max-height: calc(100dvh - 88px);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  color: var(--text-1);
  background: color-mix(in srgb, var(--surface-1) 97%, transparent);
  box-shadow: 0 30px 100px rgb(0 0 0 / 42%);
  backdrop-filter: blur(24px);
}

.operations-panel > header,
.operations-tabs,
.operations-view-actions,
.operations-view-actions > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.operations-panel > header {
  flex: none;
  padding: 16px 18px 12px;
}

.operations-panel > header span {
  color: var(--accent-strong);
  font-size: calc(9px * var(--ui-scale));
  letter-spacing: 0.16em;
}

.operations-panel > header strong {
  font-size: calc(18px * var(--ui-scale));
}

.operations-panel > header button {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
}

.operations-tabs {
  flex: none;
  justify-content: flex-start;
  padding: 0 18px;
  border-bottom: 1px solid var(--line);
  gap: 18px;
}

.operations-tabs button {
  min-height: 36px;
  padding: 0;
  border: 0;
  color: var(--text-2);
  background: transparent;
  font-size: calc(11px * var(--ui-scale));
}

.operations-tabs button.active {
  color: var(--text-1);
  box-shadow: inset 0 -2px var(--accent);
}

.operations-tabs b {
  margin-left: 4px;
  color: var(--green);
}

.operations-error {
  flex: none;
  margin: 10px 18px 0;
  padding: 8px;
  border: 1px solid var(--red);
  border-radius: 7px;
  color: var(--red);
  font-size: calc(10px * var(--ui-scale));
}

.operations-task-view,
.operations-storage-view {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px 18px 18px;
}

.operations-view-actions {
  color: var(--text-2);
  font-size: calc(10px * var(--ui-scale));
  gap: 8px;
}

.operations-view-actions button {
  min-height: 27px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: calc(10px * var(--ui-scale));
}

.operations-task-list {
  display: grid;
  margin-top: 10px;
  gap: 7px;
}

.operation-task {
  display: grid;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: color-mix(in srgb, var(--surface-2) 58%, transparent);
  grid-template-columns: minmax(0, 1fr) auto;
}

.operation-task-main {
  display: grid;
  min-width: 0;
  padding: 11px 12px;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  gap: 4px;
}

.operation-task-state {
  color: var(--text-2);
  font-size: calc(10px * var(--ui-scale));
}

.operation-task-state i,
.storage-capacity-card > i {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--faint);
}

:is(.task-running, .task-queued, .task-reconciling, .task-collecting_outputs)
  .operation-task-state
  i,
.storage-capacity-card > i {
  background: var(--green);
}

:is(.task-failed, .task-orphaned) .operation-task-state i,
.storage-capacity-card > i.blocked {
  background: var(--red);
}

.operation-task-main > strong {
  font-size: calc(12px * var(--ui-scale));
}

.operation-task-main > em {
  color: var(--red);
  font-style: normal;
}

.operation-stop {
  align-self: center;
  height: 30px;
  margin-right: 10px;
  border-color: var(--red) !important;
  border-radius: 6px;
  color: var(--red) !important;
  font-size: calc(10px * var(--ui-scale));
}

.operation-progress {
  height: 2px;
  margin-top: 3px;
  overflow: hidden;
  border-radius: 9px;
  background: var(--line);
}

.operation-progress i {
  display: block;
  height: 100%;
  background: var(--green);
}

.operation-progress.indeterminate i {
  width: 36%;
  animation: operation-indeterminate 1.45s ease-in-out infinite;
}

@keyframes operation-indeterminate {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(380%);
  }
}

.operations-empty {
  min-height: 120px;
  place-content: center;
  color: var(--text-2);
  text-align: center;
}

.storage-capacity-card {
  position: relative;
  display: grid;
  padding: 15px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
}

.storage-capacity-card > strong {
  font-size: 23px;
}

.storage-capacity-card > i {
  position: absolute;
  top: 16px;
  right: 16px;
}

.storage-breakdown {
  display: grid;
  margin-top: 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  grid-template-columns: 1fr 1fr;
}

.storage-breakdown > div {
  display: flex;
  justify-content: space-between;
  padding: 9px;
  border-bottom: 1px solid var(--line);
  font-size: calc(10px * var(--ui-scale));
}

.storage-breakdown span {
  color: var(--text-2);
}

.storage-breakdown + .operations-view-actions {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}
.storage-safety-note {
  color: var(--text-2);
  font-size: calc(10px * var(--ui-scale));
  line-height: 1.5;
}

@media (max-width: 700px) {
  .operations-pill {
    min-width: 42px;
    justify-content: center;
  }

  .operations-pill > div {
    display: none;
  }

  .operations-panel {
    top: calc(100% + 8px);
    right: 0;
    left: auto;
    width: min(460px, calc(100vw - 16px));
    max-height: calc(100dvh - 74px);
  }
}

@media (max-height: 620px) {
  .operations-panel {
    max-height: calc(100dvh - 72px);
  }

  .operations-panel > header {
    padding: 10px 14px 8px;
  }

  .operations-panel > header strong {
    font-size: calc(15px * var(--ui-scale));
  }

  .operations-tabs {
    padding-inline: 14px;
  }

  .operations-task-view,
  .operations-storage-view {
    padding: 9px 14px 14px;
  }
}
`;

const activeStatuses = new Set<RunStatus>([
  "draft",
  "validating",
  "uploading_inputs",
  "queued",
  "running",
  "collecting_outputs",
  "reconciling",
]);

const operationsTabs = ["tasks", "storage"] as const;

const statusLabel: Record<RunStatus, string> = {
  draft: "准备中",
  validating: "正在检查",
  uploading_inputs: "上传素材",
  queued: "等待执行",
  running: "正在生成",
  collecting_outputs: "整理结果",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
  orphaned: "需要核对",
  reconciling: "正在恢复",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function recipeName(path: string | null) {
  if (!path) return "未命名工作流";
  return (
    path
      .split("/")
      .at(-1)
      ?.replace(/\.json$/i, "") || path
  );
}

function taskIdentity(task: OperationTask) {
  return `${task.projectTitle} · ${task.shotLabel}`;
}

function notifyFinishedTasks(
  previous: Map<string, RunStatus> | null,
  tasks: OperationTask[],
  enabled: boolean,
) {
  if (!previous || !enabled || !("Notification" in window)) return;
  for (const task of tasks) {
    const prior = previous.get(task.runId);
    if (!prior || !activeStatuses.has(prior) || activeStatuses.has(task.status)) continue;
    if (Notification.permission === "granted") {
      new Notification(
        task.status === "completed" ? "TakeBoard 生成完成" : "TakeBoard 任务已结束",
        {
          body: `${taskIdentity(task)} · ${statusLabel[task.status]}`,
          tag: task.runId,
        },
      );
    }
  }
}

export function OperationsCenter({
  onOpenProject,
  compact = false,
}: {
  onOpenProject: (key: string) => Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"tasks" | "storage">("tasks");
  const [center, setCenter] = useState<OperationsTaskCenter | null>(null);
  const [storage, setStorage] = useState<OperationsStorage | null>(null);
  const [progress, setProgress] = useState<Record<string, number | null>>({});
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageLoading, setStorageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => optionalLocalStorage.getItem("takeboard.task-notifications") === "1",
  );
  const previousStatuses = useRef<Map<string, RunStatus> | null>(null);
  const shell = useRef<HTMLDivElement>(null);

  const refreshTasks = useCallback(async () => {
    try {
      const payload = await projectApi.tasks();
      const previous = previousStatuses.current;
      notifyFinishedTasks(previous, payload.tasks, notificationsEnabled);
      previousStatuses.current = new Map(payload.tasks.map((task) => [task.runId, task.status]));
      setCenter(payload);
      setError(null);
      const active = payload.tasks.filter((task) => activeStatuses.has(task.status));
      if (open && active.length > 0) {
        const details = await Promise.allSettled(
          active.map((task) => projectApi.run(task.projectKey, task.runId)),
        );
        const nextProgress: Record<string, number | null> = {};
        let reachedTerminal = false;
        details.forEach((result, index) => {
          if (result.status !== "fulfilled") return;
          const task = active[index];
          if (!task) return;
          nextProgress[task.runId] = result.value.progress?.percent ?? null;
          if (!activeStatuses.has(result.value.status as RunStatus)) reachedTerminal = true;
        });
        setProgress(nextProgress);
        if (reachedTerminal) {
          const reconciled = await projectApi.tasks();
          notifyFinishedTasks(previousStatuses.current, reconciled.tasks, notificationsEnabled);
          previousStatuses.current = new Map(
            reconciled.tasks.map((task) => [task.runId, task.status]),
          );
          setCenter(reconciled);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取生成任务");
    } finally {
      setLoading(false);
    }
  }, [notificationsEnabled, open]);

  const refreshStorage = useCallback(async () => {
    setStorageLoading(true);
    try {
      setStorage(await projectApi.storage());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取存储空间");
    } finally {
      setStorageLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTasks();
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void refreshTasks();
      },
      center?.activeCount ? 5_000 : 15_000,
    );
    return () => window.clearInterval(timer);
  }, [center?.activeCount, refreshTasks]);

  useEffect(() => {
    if (open && tab === "storage" && !storage) void refreshStorage();
  }, [open, refreshStorage, storage, tab]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && shell.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [open]);

  const toggleNotifications = async () => {
    if (!("Notification" in window)) return;
    if (!notificationsEnabled) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("浏览器没有允许系统通知；任务中心仍会正常显示状态");
        return;
      }
    }
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    optionalLocalStorage.setItem("takeboard.task-notifications", next ? "1" : "0");
  };

  const cancelTask = async (task: OperationTask) => {
    setBusyRunId(task.runId);
    try {
      await projectApi.cancelRun(task.projectKey, task.runId);
      await refreshTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "停止任务失败");
    } finally {
      setBusyRunId(null);
    }
  };

  return (
    <div className={`operations-control ${compact ? "is-compact" : ""}`} ref={shell}>
      <style>{operationsCss}</style>
      <button
        className={`operations-pill ${center?.activeCount ? "has-active" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="打开生成任务与存储空间"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="operations-mark" aria-hidden="true">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 5.5h1.5M8 5.5h8M4 10h1.5M8 10h8M4 14.5h1.5M8 14.5h5" />
          </svg>
          <i className="operations-pulse" />
        </span>
        {compact ? (
          <strong className="operations-compact-label">
            {center?.activeCount ? `${center.activeCount} 项进行中` : "运行中心"}
          </strong>
        ) : (
          <div>
            <strong>
              {center?.activeCount ? `${center.activeCount} 个任务运行中` : "任务中心"}
            </strong>
            <small>
              {center?.failedCount ? `${center.failedCount} 项需要检查` : "生成 · 存储"}
            </small>
          </div>
        )}
      </button>
      {open ? (
        <aside className="operations-panel" role="dialog" aria-label="生成任务与存储空间">
          <header>
            <div>
              <span>PRODUCTION STATUS</span>
              <strong>运行中心</strong>
            </div>
            <button type="button" aria-label="关闭任务中心" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <div
            className="operations-tabs"
            role="tablist"
            aria-label="任务中心分类"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const currentIndex = operationsTabs.indexOf(tab);
              const nextIndex =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? operationsTabs.length - 1
                    : (currentIndex +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        operationsTabs.length) %
                      operationsTabs.length;
              const nextTab = operationsTabs[nextIndex];
              if (!nextTab) return;
              setTab(nextTab);
              window.requestAnimationFrame(() =>
                document.getElementById(`operations-tab-${nextTab}`)?.focus(),
              );
            }}
          >
            <button
              type="button"
              role="tab"
              id="operations-tab-tasks"
              aria-controls="operations-panel-tasks"
              aria-selected={tab === "tasks"}
              tabIndex={tab === "tasks" ? 0 : -1}
              className={tab === "tasks" ? "active" : ""}
              onClick={() => setTab("tasks")}
            >
              生成任务 {center?.activeCount ? <b>{center.activeCount}</b> : null}
            </button>
            <button
              type="button"
              role="tab"
              id="operations-tab-storage"
              aria-controls="operations-panel-storage"
              aria-selected={tab === "storage"}
              tabIndex={tab === "storage" ? 0 : -1}
              className={tab === "storage" ? "active" : ""}
              onClick={() => setTab("storage")}
            >
              存储空间
            </button>
          </div>
          {error ? <p className="operations-error">{error}</p> : null}
          {tab === "tasks" ? (
            <div
              className="operations-task-view"
              role="tabpanel"
              id="operations-panel-tasks"
              aria-labelledby="operations-tab-tasks"
            >
              <div className="operations-view-actions">
                <span>
                  {loading ? "正在读取任务…" : `最近 ${center?.tasks.length ?? 0} 条运行`}
                </span>
                <div>
                  {"Notification" in window ? (
                    <button
                      type="button"
                      aria-pressed={notificationsEnabled}
                      onClick={() => void toggleNotifications()}
                    >
                      {notificationsEnabled ? "提醒已开" : "完成提醒"}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void refreshTasks()}>
                    刷新
                  </button>
                </div>
              </div>
              <div className="operations-task-list">
                {center?.tasks.map((task) => {
                  const active = activeStatuses.has(task.status);
                  const percent = progress[task.runId] ?? task.progress;
                  return (
                    <article className={`operation-task task-${task.status}`} key={task.runId}>
                      <button
                        className="operation-task-main"
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          void onOpenProject(task.projectKey);
                        }}
                      >
                        <span className="operation-task-state">
                          <i /> {statusLabel[task.status]}
                        </span>
                        <strong>{taskIdentity(task)}</strong>
                        <small>
                          {recipeName(task.recipePath)} ·{" "}
                          {task.outputMediaType === "image"
                            ? "图片"
                            : task.outputMediaType === "video"
                              ? "视频"
                              : "生成结果"}
                        </small>
                        {active ? (
                          <span
                            className={`operation-progress ${percent === null ? "indeterminate" : ""}`}
                          >
                            <i style={percent === null ? undefined : { width: `${percent}%` }} />
                          </span>
                        ) : null}
                        {task.errorMessage ? <em>{task.errorMessage}</em> : null}
                      </button>
                      {active && task.canCancel ? (
                        <button
                          className="operation-stop"
                          type="button"
                          disabled={busyRunId === task.runId}
                          onClick={() => void cancelTask(task)}
                        >
                          {busyRunId === task.runId ? "停止中…" : "停止"}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
                {!loading && !center?.tasks.length ? (
                  <div className="operations-empty">
                    <strong>没有生成任务</strong>
                    <span>从任意镜头开始生成后，会集中显示在这里。</span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div
              className="operations-storage-view"
              role="tabpanel"
              id="operations-panel-storage"
              aria-labelledby="operations-tab-storage"
            >
              <div className="storage-capacity-card">
                <span>当前磁盘可用</span>
                <strong>
                  {storage?.filesystem
                    ? formatBytes(storage.filesystem.availableBytes)
                    : "无法读取"}
                </strong>
                <small>
                  {storage?.filesystem
                    ? `TakeBoard 保留 ${formatBytes(storage.filesystem.reserveBytes)} 安全余量`
                    : "当前平台没有提供文件系统容量信息"}
                </small>
                <i
                  className={storage?.filesystem?.generationReady === false ? "blocked" : "ready"}
                />
              </div>
              <div className="storage-breakdown">
                <div>
                  <span>项目占用</span>
                  <strong>
                    {storage
                      ? formatBytes(
                          storage.projects.reduce((total, item) => total + item.totalBytes, 0),
                        )
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>回收区</span>
                  <strong>{storage ? formatBytes(storage.trashBytes) : "—"}</strong>
                </div>
              </div>
              <div className="operations-view-actions">
                <button
                  type="button"
                  disabled={storageLoading}
                  onClick={() => void refreshStorage()}
                >
                  {storageLoading ? "扫描中…" : "刷新空间"}
                </button>
              </div>
              <p className="storage-safety-note">空间不足时会暂停提交，不影响已有作品。</p>
            </div>
          )}
        </aside>
      ) : null}
    </div>
  );
}
