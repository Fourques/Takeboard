import { useEffect, useState } from "react";
import { type GpuPoolStatus, generationConnectionApi, gpuPoolApi, TakeBoardApiError } from "./api";
import { useAuth } from "./auth-ui";

export default function GpuPoolSettings() {
  const auth = useAuth();
  const canManage = !auth.enabled || auth.local || auth.user?.instanceRole === "admin";
  const [status, setStatus] = useState<GpuPoolStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!canManage) return;
    let disposed = false;
    let denied = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await gpuPoolApi.status();
        if (!disposed) setStatus(next);
      } catch (cause) {
        if (cause instanceof TakeBoardApiError && [401, 403].includes(cause.status)) denied = true;
        if (!disposed && status?.configured) setError("暂时无法读取执行池状态");
      } finally {
        if (!disposed && !denied) timer = setTimeout(refresh, 3000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [canManage, status?.configured]);
  if (!canManage || !status?.configured) return null;
  const operate = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setStatus(await gpuPoolApi.status());
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-subsection" aria-label="单卡并行">
      <h3>单卡并行</h3>
      <p>
        {status.instances?.length ?? 0} 个独立实例 · 每实例{" "}
        {((status.instanceMemoryMiB ?? 0) / 1024).toFixed(1)} GiB · 预留{" "}
        {((status.headroomMiB ?? 0) / 1024).toFixed(1)} GiB
      </p>
      <p aria-live="polite">
        {status.running ?? 0} 个生成中 · {status.queued ?? 0} 个等待
      </p>
      {status.paused || status.waiting ? (
        <p role="status">{status.paused || status.waiting}</p>
      ) : null}
      <div className="settings-actions">
        <button
          type="button"
          disabled={busy || status.poisoned || (status.enabled && !status.paused)}
          onClick={() => void operate(gpuPoolApi.start, "执行实例已就绪")}
        >
          {busy ? "正在处理…" : status.paused ? "检查并继续" : "启动实例"}
        </button>
        {!status.remote ? (
          <button
            type="button"
            disabled={busy || !status.enabled || !status.endpoint}
            onClick={() =>
              void operate(async () => {
                if (!status.endpoint) return;
                await generationConnectionApi.connect({
                  kind: "url",
                  url: status.endpoint,
                  name: "单卡执行池",
                });
                window.dispatchEvent(new Event("takeboard:generation-connection-changed"));
              }, "已切换到单卡执行池")
            }
          >
            使用此执行池
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || Boolean(status.reserved)}
          onClick={() => void operate(gpuPoolApi.stop, "实例已停止，输出文件保留")}
        >
          停止实例
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
