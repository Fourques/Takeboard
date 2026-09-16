import { useEffect, useRef, useState } from "react";
import {
  type GenerationConnection,
  type GenerationConnectionTarget,
  generationConnectionApi,
  projectApi,
  type WorkerStatus,
  workerApi,
} from "./api";
import { useAuth } from "./auth-ui";
import { RemoteDeviceSummary } from "./remote-device-summary";
import { openSettings } from "./settings-navigation";
import "./generation-connection-panel.css";

export function GenerationConnectionPanel({ manage = false }: { manage?: boolean }) {
  const auth = useAuth();
  const [connection, setConnection] = useState<GenerationConnection | null>(null);
  const [fleet, setFleet] = useState<NonNullable<WorkerStatus["fleet"]> | null>(null);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [allow, setAllow] = useState(true);
  const [confirmMedia, setConfirmMedia] = useState(false);
  const editor = useRef<HTMLFormElement>(null);
  const deleteConfirmation = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (removing) deleteConfirmation.current?.scrollIntoView({ block: "nearest" });
  }, [removing]);
  useEffect(() => {
    if (adding || editing) editor.current?.scrollIntoView({ block: "nearest" });
  }, [adding, editing]);
  const [kind, setKind] = useState<"ssh" | "url">("ssh");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("8188");
  const [service, setService] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = !auth.enabled || auth.local || auth.user?.instanceRole === "admin";
  const refresh = async () => {
    const [next, pool, status] = await Promise.all([
      generationConnectionApi.status(),
      workerApi.fleet(),
      projectApi.worker(),
    ]);
    setConnection(next);
    setFleet(pool);
    setWorker(status);
  };
  useEffect(() => {
    let active = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const [next, pool, status] = await Promise.all([
          generationConnectionApi.status(),
          workerApi.fleet(),
          projectApi.worker(),
        ]);
        if (active) {
          setConnection(next);
          setFleet(pool);
          setWorker(status);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取设备");
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 5000);
    const changed = () => void read();
    window.addEventListener("takeboard:generation-connection-changed", changed);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("takeboard:generation-connection-changed", changed);
    };
  }, []);
  const operate = async (
    action: () => Promise<unknown>,
    message: string,
    changesConnection = true,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (changesConnection) await refresh();
      setNotice(message);
      if (changesConnection)
        window.dispatchEvent(new Event("takeboard:generation-connection-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接失败，原设备未切换");
      if (changesConnection) await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  const connect = (target: GenerationConnectionTarget | { workerId: string }) =>
    operate(() => generationConnectionApi.connect(target), "已切换设备");
  const edit = (id: string, target: GenerationConnectionTarget) => {
    setEditing(id);
    setAdding(true);
    setRemoving(null);
    setKind(target.kind);
    setAddress(target.kind === "ssh" ? target.host : target.url);
    setPort(String(target.kind === "ssh" ? target.port : 8188));
    setService(target.kind === "ssh" ? (target.service ?? "") : "");
    setName(target.name);
    const definition = fleet?.workers.find((entry) => entry.worker.id === id)?.worker;
    setEnabled(definition?.enabled ?? true);
    setAllow(definition?.allowSensitiveInputs ?? false);
    setConfirmMedia(false);
    setError("");
    setNotice("");
  };
  const deviceActions = (id: string, target: GenerationConnectionTarget) =>
    manage && canManage ? (
      <fieldset className="generation-device-actions" aria-label={`${target.name}的操作`}>
        <button type="button" disabled={busy} onClick={() => edit(id, target)}>
          编辑
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRemoving({ id, name: target.name });
            setAdding(false);
            setError("");
            setNotice("");
          }}
        >
          删除
        </button>
      </fieldset>
    ) : null;
  const profiles = connection?.profiles ?? [];
  const selectedProfile = profiles.find((profile) => profile.workerId === connection?.workerId);
  const selectedTarget = selectedProfile?.target;
  const device = selectedProfile?.device;
  const remoteStart = selectedTarget?.kind === "ssh" && Boolean(selectedTarget.service);
  const reconnectService = device?.connection === "connected" && device.service === "running";
  const canStart = remoteStart
    ? device?.startup.allowed === true
    : Boolean(worker?.startup?.canStart);
  const serviceLabel =
    worker?.status === "ready"
      ? "已就绪"
      : selectedProfile?.serviceState === "starting" || device?.service === "starting"
        ? "启动中"
        : device?.connection && device.connection !== "connected"
          ? "等待设备连接"
          : device?.service === "stopped"
            ? "未运行"
            : device?.service === "failed"
              ? "异常退出"
              : device?.service === "running"
                ? "运行中 · 连接待恢复"
                : device?.connection === "connected"
                  ? "未就绪"
                  : "尚未连接";
  const startupReason = device?.startup.reason;
  const operationError = error === startupReason ? "" : error;
  const savedIds = new Set(profiles.map((item) => item.workerId));
  const legacy =
    fleet?.workers.filter(
      (entry) =>
        !savedIds.has(entry.worker.id) &&
        (entry.status === "ready" ||
          (manage && (entry.worker.id !== connection?.localWorkerId || !entry.worker.enabled))),
    ) ?? [];
  return (
    <section className="generation-connection-panel" aria-label="生成设备">
      <div className="generation-device-list">
        {profiles.map((profile) => {
          const status = fleet?.workers.find((entry) => entry.worker.id === profile.workerId);
          const current = connection?.workerId === profile.workerId;
          const online = profile.device
            ? profile.device.connection === "connected"
            : status?.status === "ready";
          const disabled = status?.worker.enabled === false;
          return (
            <div className="generation-device-item" key={profile.workerId}>
              <button
                type="button"
                className="generation-device-row"
                aria-pressed={current && online}
                disabled={busy || !canManage || disabled || (current && online)}
                onClick={() =>
                  void operate(() => generationConnectionApi.configure(profile.target), "")
                }
              >
                <i data-online={online} />
                <span>
                  <strong>{profile.target.name}</strong>
                  <small>
                    {profile.target.kind === "ssh" ? profile.target.host : profile.target.url}
                  </small>
                </span>
                <em>
                  {disabled
                    ? "已停用"
                    : profile.device
                      ? profile.device.connection === "connected"
                        ? "已连接"
                        : profile.device.connection === "ssh_unavailable"
                          ? "SSH 不可用"
                          : "无法连接"
                      : profile.serviceState === "starting"
                        ? "启动中"
                        : profile.serviceState === "recovering"
                          ? "恢复中"
                          : profile.serviceState === "connecting"
                            ? "连接中"
                            : online
                              ? current
                                ? "使用中"
                                : "可连接"
                              : profile.serviceState === "service_unavailable"
                                ? "服务未就绪"
                                : profile.serviceState === "disconnected"
                                  ? "已断开"
                                  : status?.status === "offline" && current
                                    ? "离线"
                                    : "未连接"}
                </em>
              </button>
              {deviceActions(profile.workerId, profile.target)}
            </div>
          );
        })}
        {legacy.map((entry) => (
          <div className="generation-device-item" key={entry.worker.id}>
            <button
              type="button"
              className="generation-device-row"
              disabled={
                busy ||
                !canManage ||
                !entry.worker.enabled ||
                entry.worker.id === connection?.workerId
              }
              aria-pressed={entry.worker.id === connection?.workerId && entry.status === "ready"}
              onClick={() => void connect({ workerId: entry.worker.id })}
            >
              <i data-online={entry.status === "ready"} />
              <span>
                <strong>{entry.worker.name}</strong>
                <small>{entry.worker.endpoint}</small>
              </span>
              <em>
                {!entry.worker.enabled
                  ? "已停用"
                  : entry.status === "ready"
                    ? entry.worker.id === connection?.workerId
                      ? "使用中"
                      : "可连接"
                    : "离线"}
              </em>
            </button>
            {deviceActions(entry.worker.id, {
              kind: "url",
              url: entry.worker.endpoint,
              name: entry.worker.name,
            })}
          </div>
        ))}
        {connection && profiles.length + legacy.length === 0 ? (
          <p className="generation-empty">尚未添加设备</p>
        ) : null}
        {!connection && !error ? <p>读取设备…</p> : null}
      </div>
      {!manage ? (
        <button
          className="generation-manage-link"
          type="button"
          onClick={() => openSettings("connections")}
        >
          管理设备
        </button>
      ) : (
        <>
          <div className="settings-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void operate(refresh, "设备状态已更新", false)}
            >
              刷新状态
            </button>
            {canManage ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAdding(!adding);
                  setEditing(null);
                  setRemoving(null);
                  setAddress("");
                  setName("");
                  setPort("8188");
                  setService("");
                  setKind("ssh");
                  setError("");
                  setConfirmMedia(false);
                }}
              >
                {adding ? "取消编辑" : "添加设备"}
              </button>
            ) : null}
          </div>
          {removing ? (
            <fieldset
              ref={deleteConfirmation}
              className="generation-delete-confirm"
              aria-label="确认删除设备"
              disabled={busy}
            >
              <strong>删除“{removing.name}”？</strong>
              <small>
                仅删除连接配置，保留项目和生成历史，不会停止 ComfyUI。
                {removing.id === connection?.workerId ? "删除后需重新选择生成设备。" : ""}
              </small>
              <div className="settings-actions">
                <button type="button" onClick={() => setRemoving(null)}>
                  取消
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void operate(async () => {
                      await generationConnectionApi.remove(removing.id);
                      setRemoving(null);
                    }, "设备已删除")
                  }
                >
                  确认删除
                </button>
              </div>
            </fieldset>
          ) : null}
          {adding && canManage ? (
            <form
              aria-label={editing ? "编辑设备" : "添加设备"}
              ref={editor}
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  kind === "ssh" &&
                  (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
                ) {
                  setError("端口需要是 1–65535 的整数");
                  return;
                }
                const target: GenerationConnectionTarget =
                  kind === "ssh"
                    ? {
                        kind,
                        host: address.trim(),
                        port: Number(port),
                        name,
                        ...(service.trim() ? { service: service.trim() } : {}),
                      }
                    : { kind, url: address.trim(), name };
                const previous = fleet?.workers.find(
                  (entry) => entry.worker.id === editing,
                )?.worker;
                if (editing && allow && previous?.allowSensitiveInputs === false && !confirmMedia) {
                  setConfirmMedia(true);
                  return;
                }
                void operate(
                  async () => {
                    if (editing)
                      await generationConnectionApi.edit(editing, {
                        ...target,
                        enabled,
                        allowSensitiveInputs: allow,
                        confirmMedia,
                      });
                    else await generationConnectionApi.configure(target);
                    setAdding(false);
                    setEditing(null);
                  },
                  editing ? "设备设置已保存" : "设备已保存",
                );
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  连接方式
                  <select
                    disabled={editing === connection?.localWorkerId}
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value as "ssh" | "url");
                      setAddress("");
                    }}
                  >
                    <option value="ssh">SSH</option>
                    <option value="url">ComfyUI 地址</option>
                  </select>
                </label>
                <label>
                  {kind === "ssh" ? "IP 或 SSH 名称" : "服务地址"}
                  <input
                    readOnly={editing === connection?.localWorkerId}
                    required
                    value={address}
                    autoComplete="off"
                    placeholder={
                      kind === "ssh" ? "user@server 或 SSH 别名" : "https://comfy.example.com"
                    }
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </label>
                <label>
                  设备名称（选填）
                  <input
                    value={name}
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                {kind === "ssh" ? (
                  <label>
                    ComfyUI 端口
                    <input
                      value={port}
                      inputMode="numeric"
                      onChange={(event) => setPort(event.target.value)}
                    />
                  </label>
                ) : null}
                {kind === "ssh" ? (
                  <details>
                    <summary>远程启动设置（可选）</summary>
                    <label>
                      Linux 用户服务名
                      <input
                        value={service}
                        onChange={(event) => setService(event.target.value)}
                        placeholder="服务器上已配置的 .service 名称"
                      />
                    </label>
                    <small>
                      当前支持 Linux systemd 用户服务及单卡 NVIDIA
                      预检；其他远端可连接和释放显存，但需先在设备上启动。
                    </small>
                  </details>
                ) : null}
                {editing ? (
                  <>
                    <label className="generation-checkbox">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => setEnabled(event.target.checked)}
                      />
                      启用设备
                    </label>
                    <label className="generation-checkbox">
                      <input
                        type="checkbox"
                        checked={allow}
                        onChange={(event) => {
                          setAllow(event.target.checked);
                          setConfirmMedia(false);
                        }}
                      />
                      允许向此设备发送素材
                    </label>
                  </>
                ) : null}
                {confirmMedia ? (
                  <p role="status">请确认这是你信任的设备，允许它接收项目中的图片、视频和音频。</p>
                ) : null}
                <small>
                  {kind === "ssh"
                    ? "使用项目所在设备的 SSH 配置与可信主机记录，不依赖 VS Code。"
                    : "远程使用 HTTPS；HTTP 回环地址也可用于已有隧道。"}
                </small>
                <button type="submit">
                  {busy
                    ? "保存中…"
                    : confirmMedia
                      ? "确认授权并保存"
                      : editing
                        ? "保存设备设置"
                        : "保存设备"}
                </button>
              </fieldset>
            </form>
          ) : null}
          {worker && canManage && connection ? (
            <section className="generation-service-control" aria-label="生成服务">
              {device ? <RemoteDeviceSummary device={device} /> : null}
              <div className="generation-service-heading">
                <strong>ComfyUI</strong>
                <span>{serviceLabel}</span>
              </div>
              <div className="settings-actions">
                {worker.status === "ready" ? (
                  <button
                    type="button"
                    disabled={busy}
                    title="卸载空闲模型，保持服务连接"
                    onClick={() =>
                      void operate(
                        () => projectApi.releaseWorkerMemory(connection.workerId),
                        "已请求释放空闲显存，服务保持连接",
                      )
                    }
                  >
                    释放显存
                  </button>
                ) : null}
                {worker.status !== "ready" ? (
                  <button
                    type="button"
                    disabled={busy || (!canStart && !reconnectService)}
                    onClick={() =>
                      void operate(
                        () =>
                          reconnectService && selectedTarget
                            ? generationConnectionApi.connect(selectedTarget)
                            : remoteStart && selectedTarget
                              ? generationConnectionApi.start(selectedTarget)
                              : projectApi.startWorker(),
                        "生成服务已就绪",
                      )
                    }
                  >
                    {reconnectService ? "重新连接服务" : "启动 ComfyUI"}
                  </button>
                ) : null}
                {worker.control?.canStop ? (
                  <button type="button" disabled={busy} onClick={() => setStopping(true)}>
                    停止 ComfyUI
                  </button>
                ) : null}
              </div>
              {worker.status !== "ready" &&
              !canStart &&
              !operationError &&
              startupReason &&
              startupReason !== "GPU 状态读取失败" &&
              startupReason !== "服务已经运行" &&
              startupReason !== "服务正在启动" ? (
                <p className="generation-start-reason">{startupReason}</p>
              ) : null}
              {!device && !canStart && worker.status !== "ready" ? (
                <p>{selectedTarget?.kind === "ssh" ? "正在检查设备" : "尚未配置启动方式"}</p>
              ) : null}
              {stopping ? (
                <fieldset aria-label="确认停止 ComfyUI">
                  <p>停止当前服务？有生成任务或无法确认归属时不会停止。</p>
                  <button type="button" disabled={busy} onClick={() => setStopping(false)}>
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void operate(async () => {
                        await projectApi.stopWorker();
                        setStopping(false);
                      }, "服务已停止")
                    }
                  >
                    确认停止
                  </button>
                </fieldset>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      {operationError ? <p role="alert">{operationError}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
