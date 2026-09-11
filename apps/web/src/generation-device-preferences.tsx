import type { WorkerDefinition } from "@takeboard/contracts";
import { useState } from "react";
import { workerApi } from "./api";

/** Scheduling metadata is optional, and never mixed into the homepage switcher. */
export function GenerationDevicePreferences({
  worker,
  onChanged,
  canRemove = false,
}: {
  worker: WorkerDefinition;
  onChanged: () => Promise<void>;
  canRemove?: boolean;
}) {
  const [tier, setTier] = useState(worker.qualityTier);
  const [rate, setRate] = useState(worker.hourlyRate?.toString() ?? "");
  const [currency, setCurrency] = useState(worker.currency);
  const [enabled, setEnabled] = useState(worker.enabled);
  const [allow, setAllow] = useState(worker.allowSensitiveInputs);
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (busy) return;
    if (rate.trim() && (!/^\d+(\.\d+)?$/.test(rate.trim()) || !Number.isFinite(Number(rate)))) {
      setError("费用请留空，或填写非负数字");
      return;
    }
    if (allow && !worker.allowSensitiveInputs && !confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await workerApi.update(worker.id, {
        qualityTier: tier,
        hourlyRate: rate.trim() ? Number(rate) : null,
        currency,
        enabled,
        allowSensitiveInputs: allow,
      });
      await onChanged();
      setConfirm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存设备设置");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="generation-service-control">
      <summary>{worker.name}</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <label>
            调度用途
            <select
              value={tier}
              onChange={(event) => setTier(event.target.value as WorkerDefinition["qualityTier"])}
            >
              <option value="draft">预览</option>
              <option value="balanced">日常</option>
              <option value="final">终稿</option>
            </select>
          </label>
          <label>
            每小时估算费用（选填）
            <input
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          </label>
          <label>
            币种
            <input
              maxLength={3}
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            参与调度
            <select
              value={String(enabled)}
              onChange={(event) => setEnabled(event.target.value === "true")}
            >
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </label>
          <label>
            素材发送权限
            <select
              value={String(allow)}
              onChange={(event) => {
                setAllow(event.target.value === "true");
                setConfirm(false);
              }}
            >
              <option value="false">不发送图片、视频、音频</option>
              <option value="true">允许发送到此设备</option>
            </select>
          </label>
          {confirm ? (
            <fieldset aria-label="确认素材发送权限">
              <p>允许 {worker.name} 接收项目素材？请确认这是你信任的设备。</p>
              <button
                type="button"
                onClick={() => {
                  setConfirm(false);
                  setAllow(false);
                }}
              >
                取消授权
              </button>
            </fieldset>
          ) : null}
          <button type="submit">
            {busy ? "保存中…" : confirm ? "确认授权并保存" : "保存设备设置"}
          </button>
        </fieldset>
        {error ? <p role="alert">{error}</p> : null}
      </form>
      {canRemove ? (
        <fieldset disabled={busy} aria-label="移除设备">
          {removing ? (
            <>
              <p>移除 {worker.name} 的调度配置？项目和生成历史保留，不会停止服务。</p>
              <button type="button" onClick={() => setRemoving(false)}>
                取消移除
              </button>
              <button
                type="button"
                onClick={() => {
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  void workerApi
                    .remove(worker.id)
                    .then(onChanged)
                    .catch((cause) =>
                      setError(cause instanceof Error ? cause.message : "无法移除设备"),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                确认移除
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setRemoving(true)}>
              移除设备
            </button>
          )}
        </fieldset>
      ) : null}
    </details>
  );
}
