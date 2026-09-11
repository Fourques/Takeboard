import { useEffect, useRef, useState } from "react";
import { requestDesktopData } from "./desktop-actions";
import { readConnectionDisplay } from "./device-context";

type Target = {
  kind: "ssh" | "https" | "portal";
  address: string;
  name?: string;
  port: number | null;
  platform?: string;
  allowStart?: boolean;
  instanceId?: string;
};
type Status = {
  state: "idle" | "connecting" | "ready" | "failed";
  recent?: Target[];
  target?: Target;
  message?: string;
  code?: string;
  preferencesError?: string;
};
const call = (operation: string, input: unknown = {}) =>
  requestDesktopData<Status>("remote-project", { operation, input: JSON.stringify(input) }, 15000);

export default function RemoteProjectSettings() {
  const [available] = useState(
    () =>
      Boolean(
        (window as unknown as { __takeboardRemoteProjects?: boolean }).__takeboardRemoteProjects,
      ) &&
      (!readConnectionDisplay() || readConnectionDisplay()?.kind === "local"),
  );
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [kind, setKind] = useState<Target["kind"]>("ssh");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("");
  const [platform, setPlatform] = useState("auto");
  const [allowStart, setAllowStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    operation: "connect" | "disconnect" | "forget";
    target?: Target;
  } | null>(null);
  const alive = useRef(true);
  const revision = useRef(0);
  const mutating = useRef(false);
  const automaticOpen = useRef(false);
  useEffect(() => {
    alive.current = true;
    if (!available) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = revision.current;
      try {
        if (!mutating.current) {
          const value = await call("status");
          if (stopped || current !== revision.current) return;
          setStatus(value);
          if (value.state === "failed") automaticOpen.current = false;
          if (value.state === "ready" && automaticOpen.current) {
            automaticOpen.current = false;
            await call("open");
          }
        }
      } catch (cause) {
        if (!stopped && current === revision.current)
          setError(cause instanceof Error ? cause.message : "无法读取连接");
      } finally {
        if (!stopped) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => {
      stopped = true;
      alive.current = false;
      clearTimeout(timer);
    };
  }, [available]);

  async function run(operation: string, target?: Target) {
    if (mutating.current) return;
    mutating.current = true;
    revision.current += 1;
    setBusy(true);
    setError("");
    setConfirmation(null);
    if (operation === "connect") automaticOpen.current = true;
    if (operation === "disconnect") automaticOpen.current = false;
    try {
      const value = await call(operation, target);
      if (alive.current) setStatus(value);
    } catch (cause) {
      automaticOpen.current = false;
      if (alive.current) setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      mutating.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function connect(target: Target) {
    if (status.state === "ready") setConfirmation({ operation: "connect", target });
    else void run("connect", target);
  }
  const migrationFailed =
    new URLSearchParams(window.location.hash.slice(1)).get("tb-connection-migration") === "failed";
  if (!available)
    return (
      <section>
        <h3>远程项目</h3>
        <p>请在此电脑的新版桌面 App 设置中管理连接。</p>
      </section>
    );
  return (
    <section className="remote-project-settings" aria-label="远程项目连接">
      <h3>远程项目</h3>
      <p>打开另一台 TakeBoard 的项目，文件保留在那台设备。</p>
      {migrationFailed ? (
        <p role="alert">旧连接记录未能迁移，原记录仍保留。请重新启动 App 后重试。</p>
      ) : null}
      {status.preferencesError ? <p role="alert">{status.preferencesError}</p> : null}
      <div className="remote-project-status" role="status">
        <strong>
          {status.state === "ready"
            ? status.target?.name || status.target?.address || "已连接"
            : status.state === "connecting"
              ? "正在验证连接…"
              : status.state === "failed"
                ? "连接未完成"
                : "尚未连接"}
        </strong>
        {status.state === "ready" ? <span>{status.target?.address}</span> : null}
        {status.message ? <span>{status.message}</span> : null}
        <div className="settings-actions">
          {status.state === "ready" ? (
            <button type="button" disabled={busy} onClick={() => void run("open")}>
              打开项目窗口
            </button>
          ) : null}
          {status.state === "ready" || status.state === "connecting" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                status.state === "ready"
                  ? setConfirmation({ operation: "disconnect" })
                  : void run("disconnect")
              }
            >
              {status.state === "connecting" ? "取消连接" : "断开连接"}
            </button>
          ) : null}
        </div>
      </div>
      {(status.recent?.length ?? 0) > 0 ? (
        <ul className="remote-project-recents" aria-label="已保存的项目设备">
          {status.recent?.map((target) => (
            <li key={`${target.kind}:${target.address}`}>
              <div>
                <strong>{target.name || target.address}</strong>
                <small>
                  {target.kind === "ssh" ? "SSH" : target.kind === "portal" ? "Portal" : "HTTPS"} ·{" "}
                  {target.address}
                </small>
              </div>
              <div className="settings-actions">
                <button
                  type="button"
                  disabled={busy || status.state === "connecting"}
                  onClick={() => connect(target)}
                >
                  连接
                </button>
                <button
                  type="button"
                  disabled={busy || status.state === "connecting"}
                  onClick={() => {
                    setKind(target.kind);
                    setAddress(target.address);
                    setName(target.name ?? "");
                    setPort(target.port === null ? "" : String(target.port));
                    setPlatform(target.platform ?? "auto");
                    setAllowStart(target.allowStart === true);
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmation({ operation: "forget", target })}
                >
                  移除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {confirmation ? (
        <fieldset className="remote-project-confirm">
          <legend>
            {confirmation.operation === "forget"
              ? "移除这条连接记录？"
              : confirmation.operation === "connect"
                ? "切换远程项目连接？"
                : "断开并关闭远程项目窗口？"}
          </legend>
          <p>
            {confirmation.operation === "forget"
              ? "只移除本机记录，不删除服务器项目。"
              : "请先保存远程窗口中的编辑。服务器生成任务不会停止。"}
          </p>
          <div className="settings-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(confirmation.operation, confirmation.target)}
            >
              确认
            </button>
            <button type="button" onClick={() => setConfirmation(null)}>
              取消
            </button>
          </div>
        </fieldset>
      ) : null}
      <form
        className="account-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || status.state === "connecting") return;
          const numericPort = kind === "ssh" && port.trim() ? Number(port) : null;
          if (
            numericPort !== null &&
            (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535)
          )
            return setError("服务端口应为 1–65535，或留空自动检测。");
          const previous = status.recent?.find(
            (item) => item.kind === kind && item.address === address.trim(),
          );
          connect({
            kind,
            address: address.trim(),
            name: name.trim(),
            port: numericPort,
            platform,
            allowStart: kind === "ssh" && allowStart,
            ...(previous?.instanceId ? { instanceId: previous.instanceId } : {}),
          });
        }}
      >
        <fieldset disabled={busy || status.state === "connecting"}>
          <label>
            设备名称
            <input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="可选"
            />
          </label>
          <label>
            连接方式
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as Target["kind"]);
                setAllowStart(false);
              }}
            >
              <option value="ssh">SSH · IP 或主机别名</option>
              <option value="https">TakeBoard 地址</option>
              <option value="portal">Portal 门户</option>
            </select>
          </label>
          <label>
            {kind === "ssh" ? "SSH 主机" : "服务地址"}
            <input
              required
              value={address}
              maxLength={2048}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={
                kind === "ssh" ? "user@192.168.1.10 或 SSH 别名" : "https://takeboard.example.com"
              }
            />
          </label>
          {kind === "ssh" ? (
            <details>
              <summary>SSH 连接选项</summary>
              <p>使用系统 SSH 配置与可信主机记录，不保存密码。</p>
              <label>
                TakeBoard 服务端口
                <input
                  inputMode="numeric"
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  placeholder="自动检测"
                />
              </label>
              <label>
                远端系统
                <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                  <option value="auto">自动检测</option>
                  <option value="posix">Linux / macOS</option>
                  <option value="windows">Windows</option>
                </select>
              </label>
            </details>
          ) : null}
          {kind === "ssh" ? (
            <label className="remote-start-choice auth-remember">
              <input
                type="checkbox"
                checked={allowStart}
                onChange={(event) => setAllowStart(event.target.checked)}
              />
              允许启动远端已安装的 TakeBoard
            </label>
          ) : null}
          {status.code === "START_REQUIRED" ? (
            <p>远端尚未启动。可勾选上方授权后重新连接；不会安装软件或启动 ComfyUI。</p>
          ) : null}
          <button type="submit">{status.state === "connecting" ? "连接中…" : "连接并打开"}</button>
        </fieldset>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
