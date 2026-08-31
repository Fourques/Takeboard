import type {
  OperationsDiagnostics,
  OperationsStorage,
  OperationsTaskCenter,
  OperationTask,
  RunStatus,
} from "@takeboard/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { projectApi } from "./api";

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
.operations-view-actions > div,
.storage-project-list > div,
.storage-project-list > button {
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
.operations-storage-view,
.operations-diagnostic-view {
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

.operations-view-actions button,
.storage-project-list button {
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

.storage-project-list {
  margin-top: 14px;
}

.storage-project-list > div {
  margin-bottom: 7px;
}

.storage-project-list > button {
  width: 100%;
  margin-top: 5px;
  text-align: left;
}

.storage-safety-note {
  color: var(--text-2);
  font-size: calc(10px * var(--ui-scale));
  line-height: 1.5;
}

.operations-diagnostic-summary {
  display: grid;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-2);
  gap: 5px;
}

.operations-diagnostic-summary strong {
  font-size: calc(15px * var(--ui-scale));
}

.operations-diagnostic-summary span,
.operations-diagnostic-summary small {
  color: var(--text-2);
  font-size: calc(10px * var(--ui-scale));
  line-height: 1.5;
}

.operations-diagnostic-actions {
  display: flex;
  flex-wrap: wrap;
  margin-top: 10px;
  gap: 7px;
}

.operations-diagnostic-actions button {
  min-height: 31px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: calc(10px * var(--ui-scale));
}

.operations-diagnostic-list {
  display: grid;
  margin-top: 12px;
  gap: 7px;
}

.operations-diagnostic-check {
  display: grid;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: color-mix(in srgb, var(--surface-2) 58%, transparent);
  grid-template-columns: 9px minmax(0, 1fr);
  gap: 9px;
}

.operations-diagnostic-check > i {
  width: 8px;
  height: 8px;
  margin-top: 3px;
  border-radius: 50%;
  background: var(--green);
}

.operations-diagnostic-check.warning > i {
  background: var(--accent);
}

.operations-diagnostic-check.blocked > i {
  background: var(--red);
}

.operations-diagnostic-check > div {
  display: grid;
  gap: 3px;
}

.operations-diagnostic-check strong {
  font-size: calc(11px * var(--ui-scale));
}

.operations-diagnostic-check span,
.operations-diagnostic-check small,
.operations-report-notice {
  color: var(--text-2);
  font-size: calc(10px * var(--ui-scale));
  line-height: 1.5;
}

.operations-diagnostic-check small {
  color: var(--accent-strong);
}

.operations-report-notice {
  margin: 9px 0 0;
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
  .operations-storage-view,
  .operations-diagnostic-view {
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

const operationsTabs = ["tasks", "storage", "diagnostics"] as const;

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

function supportReportWithClient(report: OperationsDiagnostics) {
  return {
    ...report,
    client: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      displayScale: window.localStorage.getItem("takeboard.display-scale") ?? "default",
      theme: document.documentElement.dataset.theme ?? "noir",
      online: navigator.onLine,
    },
  };
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
  const [tab, setTab] = useState<"tasks" | "storage" | "diagnostics">("tasks");
  const [center, setCenter] = useState<OperationsTaskCenter | null>(null);
  const [storage, setStorage] = useState<OperationsStorage | null>(null);
  const [diagnostics, setDiagnostics] = useState<OperationsDiagnostics | null>(null);
  const [progress, setProgress] = useState<Record<string, number | null>>({});
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageLoading, setStorageLoading] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => window.localStorage.getItem("takeboard.task-notifications") === "1",
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

  const refreshDiagnostics = useCallback(async () => {
    setDiagnosticsLoading(true);
    setReportNotice(null);
    try {
      setDiagnostics(await projectApi.diagnostics());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法完成运行诊断");
    } finally {
      setDiagnosticsLoading(false);
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
    if (open && tab === "diagnostics" && !diagnostics) void refreshDiagnostics();
  }, [diagnostics, open, refreshDiagnostics, tab]);

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

  const categories = useMemo(() => {
    if (!storage) return [];
    const sum = (key: keyof OperationsStorage["projects"][number]["categories"]) =>
      storage.projects.reduce((total, project) => total + project.categories[key], 0);
    return [
      ["原始素材", sum("originals")],
      ["生成结果", sum("renders")],
      ["代理文件", sum("proxies")],
      ["Recipe 与工作流", sum("recipes")],
      ["项目备份", sum("backups")],
      ["其他项目数据", sum("runData") + sum("exports") + sum("other")],
    ] as const;
  }, [storage]);

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
    window.localStorage.setItem("takeboard.task-notifications", next ? "1" : "0");
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

  const diagnosticCounts = diagnostics?.checks.reduce(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    { pass: 0, warning: 0, blocked: 0 },
  );

  const copySupportReport = async () => {
    if (!diagnostics) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(supportReportWithClient(diagnostics), null, 2),
      );
      setError(null);
      setReportNotice("诊断报告已复制；可以直接粘贴到 GitHub Issue。报告不含素材和账号信息。");
    } catch {
      setError("浏览器没有允许复制诊断报告；请使用“下载报告”。");
    }
  };

  const downloadSupportReport = () => {
    if (!diagnostics) return;
    const content = JSON.stringify(supportReportWithClient(diagnostics), null, 2);
    const url = URL.createObjectURL(new Blob([`${content}\n`], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `takeboard-support-${diagnostics.generatedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setError(null);
    setReportNotice("诊断报告已下载。发送前仍可自行打开检查内容。");
  };

  return (
    <div className={`operations-control ${compact ? "is-compact" : ""}`} ref={shell}>
      <style>{operationsCss}</style>
      <button
        className={`operations-pill ${center?.activeCount ? "has-active" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="打开生成任务、存储与诊断中心"
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
            {center?.activeCount ? `${center.activeCount} 项进行中` : "制作进度"}
          </strong>
        ) : (
          <div>
            <strong>
              {center?.activeCount ? `${center.activeCount} 个任务运行中` : "任务中心"}
            </strong>
            <small>
              {center?.failedCount ? `${center.failedCount} 项需要检查` : "生成 · 存储 · 诊断"}
            </small>
          </div>
        )}
      </button>
      {open ? (
        <aside className="operations-panel" role="dialog" aria-label="生成任务、存储与诊断中心">
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
            <button
              type="button"
              role="tab"
              id="operations-tab-diagnostics"
              aria-controls="operations-panel-diagnostics"
              aria-selected={tab === "diagnostics"}
              tabIndex={tab === "diagnostics" ? 0 : -1}
              className={tab === "diagnostics" ? "active" : ""}
              onClick={() => setTab("diagnostics")}
            >
              运行诊断
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
          ) : tab === "storage" ? (
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
                {categories.map(([label, bytes]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{formatBytes(bytes)}</strong>
                  </div>
                ))}
                <div>
                  <span>回收区</span>
                  <strong>{storage ? formatBytes(storage.trashBytes) : "—"}</strong>
                </div>
                {storage?.systemBytes != null ? (
                  <div>
                    <span>账号、备份与系统数据</span>
                    <strong>{storage ? formatBytes(storage.systemBytes ?? 0) : "—"}</strong>
                  </div>
                ) : null}
              </div>
              <section className="storage-project-list">
                <div>
                  <strong>项目占用</strong>
                  <button
                    type="button"
                    disabled={storageLoading}
                    onClick={() => void refreshStorage()}
                  >
                    {storageLoading ? "扫描中…" : "重新扫描"}
                  </button>
                </div>
                {storage?.projects.slice(0, 8).map((project) => (
                  <button
                    type="button"
                    key={project.projectKey}
                    onClick={() => {
                      setOpen(false);
                      void onOpenProject(project.projectKey);
                    }}
                  >
                    <span>{project.projectTitle}</span>
                    <strong>{formatBytes(project.totalBytes)}</strong>
                  </button>
                ))}
              </section>
              <p className="storage-safety-note">
                生成前会检查项目盘与 ComfyUI 输出盘；空间不足时不会上传素材或强行排队。
              </p>
            </div>
          ) : (
            <div
              className="operations-diagnostic-view"
              role="tabpanel"
              id="operations-panel-diagnostics"
              aria-labelledby="operations-tab-diagnostics"
              aria-busy={diagnosticsLoading}
            >
              <section className="operations-diagnostic-summary">
                <span>SUPPORT REPORT · v{diagnostics?.application.version ?? "—"}</span>
                <strong>
                  {diagnosticsLoading
                    ? "正在核对当前环境…"
                    : diagnosticCounts?.blocked
                      ? `${diagnosticCounts.blocked} 项会阻止正常使用`
                      : diagnosticCounts?.warning
                        ? `${diagnosticCounts.warning} 项建议处理`
                        : diagnostics
                          ? "当前基础环境正常"
                          : "尚未运行诊断"}
                </strong>
                <small>
                  {diagnostics
                    ? `${diagnostics.workload.visibleProjects} 个可见项目 · ${diagnostics.workload.activeRuns} 个运行中任务 · ${diagnostics.application.platform}/${diagnostics.application.architecture}`
                    : "只检查运行环境与汇总状态，不读取素材、提示词或账号内容。"}
                </small>
              </section>
              <div className="operations-diagnostic-actions">
                <button
                  type="button"
                  disabled={diagnosticsLoading}
                  onClick={() => void refreshDiagnostics()}
                >
                  {diagnosticsLoading ? "检查中…" : "重新检查"}
                </button>
                <button
                  type="button"
                  disabled={!diagnostics}
                  onClick={() => void copySupportReport()}
                >
                  复制报告
                </button>
                <button type="button" disabled={!diagnostics} onClick={downloadSupportReport}>
                  下载报告
                </button>
              </div>
              {reportNotice ? (
                <p className="operations-report-notice" role="status">
                  {reportNotice}
                </p>
              ) : null}
              <div className="operations-diagnostic-list">
                {diagnostics?.checks.map((check) => (
                  <article className={`operations-diagnostic-check ${check.status}`} key={check.id}>
                    <i aria-hidden="true" />
                    <div>
                      <strong>{check.title}</strong>
                      <span>{check.detail}</span>
                      {check.action ? <small>下一步：{check.action}</small> : null}
                    </div>
                  </article>
                ))}
              </div>
              {diagnostics ? <p className="storage-safety-note">{diagnostics.privacy}</p> : null}
            </div>
          )}
        </aside>
      ) : null}
    </div>
  );
}
