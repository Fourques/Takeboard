import { useCallback, useEffect, useRef, useState } from "react";
import { projectApi, type WorkerStatus, type WorkflowSummary, workflowApi } from "./api";

/** Generation inventory has no dependency on a project or its navigation. */
export function useGenerationEnvironment(
  onError: (message: string) => void,
  onNotice: (message: string) => void,
) {
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [workerBusy, setWorkerBusy] = useState(false);
  const [inventory, setInventory] = useState<{
    workflows: WorkflowSummary[];
    warnings: string[];
    editorUrl: string;
  }>({ workflows: [], warnings: [], editorUrl: "http://127.0.0.1:8188" });
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const epoch = useRef(0);
  const inventoryRequest = useRef(0);
  const statusRequest = useRef(0);
  const workerPending = useRef(0);
  const previousWorker = useRef("");
  const refreshInventory = useCallback(async () => {
    const ticket = ++inventoryRequest.current;
    const scope = epoch.current;
    setInventoryBusy(true);
    try {
      const detected = await workflowApi.list();
      if (scope !== epoch.current || ticket !== inventoryRequest.current) return;
      setInventory({
        workflows: detected.workflows,
        editorUrl: detected.editorUrl,
        warnings: [
          ...(detected.warnings ?? []),
          ...(detected.diagnostics ?? []).map(
            (item) => `${item.code} · ${item.path}：${item.message}`,
          ),
        ],
      });
      return detected;
    } catch (cause) {
      if (scope === epoch.current && ticket === inventoryRequest.current) throw cause;
    } finally {
      if (scope === epoch.current && ticket === inventoryRequest.current) setInventoryBusy(false);
    }
  }, []);
  const refreshWorker = useCallback(
    async (discover = true) => {
      const ticket = ++statusRequest.current;
      const scope = epoch.current;
      workerPending.current++;
      setWorkerBusy(true);
      try {
        const next = await projectApi.worker();
        if (scope !== epoch.current || ticket !== statusRequest.current) return;
        setWorker(next);
        const key = `${next.fleet?.defaultWorkerId ?? ""}:${next.status}`;
        if (discover && next.status === "ready" && key !== previousWorker.current)
          void refreshInventory().catch((cause: unknown) =>
            onError(cause instanceof Error ? cause.message : "工作流检测失败"),
          );
        previousWorker.current = key;
      } catch (cause) {
        if (scope === epoch.current && ticket === statusRequest.current)
          setWorker({
            status: "offline",
            engine: "ComfyUI",
            error: cause instanceof Error ? cause.message : "无法检测 ComfyUI",
          });
      } finally {
        if (scope === epoch.current) setWorkerBusy(--workerPending.current > 0);
      }
    },
    [onError, refreshInventory],
  );
  useEffect(() => {
    const changed = () => {
      epoch.current++;
      workerPending.current = 0;
      previousWorker.current = "";
      setWorker(null);
      setInventory({ workflows: [], warnings: [], editorUrl: "http://127.0.0.1:8188" });
      void refreshWorker(false);
      void refreshInventory().catch((cause: unknown) =>
        onError(cause instanceof Error ? cause.message : "工作流检测失败"),
      );
    };
    changed();
    window.addEventListener("takeboard:generation-connection-changed", changed);
    let polling = false;
    const heartbeat = async () => {
      if (polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        await refreshWorker();
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void heartbeat(), 15_000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      epoch.current++;
      window.clearInterval(timer);
      window.removeEventListener("takeboard:generation-connection-changed", changed);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, [onError, refreshInventory, refreshWorker]);
  const startWorker = useCallback(async () => {
    const scope = epoch.current;
    if (workerPending.current > 0) return;
    statusRequest.current++;
    workerPending.current++;
    setWorkerBusy(true);
    try {
      const started = await projectApi.startWorker();
      if (scope !== epoch.current) return;
      setWorker(started);
      await refreshWorker();
    } catch (cause) {
      if (scope === epoch.current)
        onError(cause instanceof Error ? cause.message : "ComfyUI 启动失败");
    } finally {
      if (scope === epoch.current) setWorkerBusy(--workerPending.current > 0);
    }
  }, [onError, refreshWorker]);
  const refreshWorkflows = useCallback(async () => {
    try {
      const detected = await refreshInventory();
      if (detected) onNotice(`已检测 ${detected.workflows.length} 个 ComfyUI Workflow`);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "工作流检测失败");
    }
  }, [onError, onNotice, refreshInventory]);
  const importWorkflow = useCallback(
    async (file: File) => {
      const scope = epoch.current;
      try {
        const imported = await workflowApi.import(file);
        if (scope === epoch.current) {
          await refreshInventory();
          if (scope === epoch.current)
            onNotice(`已导入：${imported.name} · 完成映射确认后即可用于镜头`);
        }
        return imported;
      } catch (cause) {
        if (scope === epoch.current)
          onError(cause instanceof Error ? cause.message : "Workflow 导入失败");
        throw cause;
      }
    },
    [onError, onNotice, refreshInventory],
  );
  return {
    worker,
    workerBusy,
    inventoryBusy,
    workflows: inventory.workflows,
    workflowWarnings: inventory.warnings,
    comfyEditorUrl: inventory.editorUrl,
    refreshWorker,
    startWorker,
    refreshWorkflows,
    importWorkflow,
  };
}
