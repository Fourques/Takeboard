import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type DeviceInfo, deviceApi } from "./api";
import { DesktopActionButton } from "./desktop-actions";
import { readConnectionDisplay } from "./device-context";
import "./device-indicator.css";

export function DeviceIndicator({ projectKey }: { projectKey?: string | undefined }) {
  const [connection] = useState(readConnectionDisplay);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [directory, setDirectory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const menu = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 64 });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = menu.current?.getBoundingClientRect();
      if (!anchor) return;
      const top = Math.min(anchor.bottom + 8, window.innerHeight - 120);
      setPosition({
        left: Math.max(16, Math.min(anchor.left, window.innerWidth - 376)),
        top: Math.max(16, top),
      });
    };
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !panel.current?.contains(target) && menu.current)
        menu.current.open = false;
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current) {
        event.stopPropagation();
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly requests a fresh status check.
  useEffect(() => {
    let active = true;
    setDirectory(null);
    let pending = false;
    const refresh = () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      void Promise.all([
        deviceApi.status(),
        projectKey ? deviceApi.projectLocation(projectKey) : Promise.resolve(null),
      ])
        .then(([current, location]) => {
          if (!active) return;
          setDevice(current);
          setDirectory(location?.directory ?? current.projectsDirectory);
          setError(
            connection?.instanceId &&
              connection.kind !== "portal" &&
              connection.instanceId !== current.instanceId
              ? "设备身份与连接记录不同，请断开并重新核实连接。"
              : null,
          );
        })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : "无法读取设备状态");
        })
        .finally(() => {
          pending = false;
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [connection, projectKey, revision]);

  if (connection?.kind === "local" && !projectKey) return null;
  const label =
    connection?.kind === "local"
      ? "项目文件"
      : connection?.kind === "portal"
        ? device?.name || "远程设备"
        : connection?.name ||
          (connection?.kind === "ssh" ? connection.address : null) ||
          device?.name ||
          "当前设备";
  const address =
    connection?.kind === "local" ? "本机 TakeBoard" : connection?.address || window.location.host;
  return (
    <details
      className="device-indicator"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary title={`${label} · ${address}`} aria-label={`当前设备：${label}`}>
        <span
          className={`device-indicator-dot ${error ? "unavailable" : !device ? "pending" : ""}`}
        />
        <span>{label}</span>
        <span aria-hidden="true">⌄</span>
      </summary>
      {open
        ? createPortal(
            <div
              ref={panel}
              className="device-indicator-panel"
              role="dialog"
              aria-label="项目文件位置"
              style={
                {
                  "--device-left": `${position.left}px`,
                  "--device-top": `${position.top}px`,
                } as CSSProperties
              }
            >
              <strong>{label}</strong>
              <span>
                {error
                  ? "需要检查连接"
                  : connection?.kind === "local"
                    ? "保存在此电脑，不随生成服务切换"
                    : device
                      ? "远程项目"
                      : "正在读取项目位置…"}
              </span>
              <dl>
                <dt>{connection?.kind === "portal" ? "门户入口" : "连接地址"}</dt>
                <dd>{address}</dd>
                {device ? (
                  <>
                    <dt>设备名称</dt>
                    <dd>{device.name}</dd>
                  </>
                ) : null}
                {device?.instanceId ? (
                  <>
                    <dt>实例标识</dt>
                    <dd>{device.instanceId}</dd>
                  </>
                ) : null}
                {directory ? (
                  <>
                    <dt>{projectKey ? "项目文件夹" : "默认项目位置"}</dt>
                    <dd>{directory}</dd>
                  </>
                ) : null}
              </dl>
              {directory ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!navigator.clipboard) {
                      setNotice("当前连接不支持自动复制，请选择上方路径手动复制。");
                      return;
                    }
                    void navigator.clipboard
                      .writeText(directory)
                      .then(() => setNotice("路径已复制"))
                      .catch(() => setNotice("无法自动复制，请选择上方路径手动复制。"));
                  }}
                >
                  复制文件夹路径
                </button>
              ) : null}
              <p>文件保存在上述设备。下载会在当前电脑保存副本，不会删除服务器原文件。</p>
              {error ? (
                <>
                  <p role="alert">{error}</p>
                  <button type="button" onClick={() => setRevision((value) => value + 1)}>
                    重新检测
                  </button>
                </>
              ) : null}
              {notice ? <p role="status">{notice}</p> : null}
              {"__TAURI__" in window ? (
                <DesktopActionButton action="connections">
                  打开远程项目 / 管理连接
                </DesktopActionButton>
              ) : (
                <p>桌面应用中可从“连接 → 连接设备”切换或断开远程连接。</p>
              )}
              {directory && connection?.kind === "local" && "__TAURI__" in window ? (
                <DesktopActionButton action="reveal-folder" parameters={{ path: directory }}>
                  在文件夹中显示
                </DesktopActionButton>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </details>
  );
}
