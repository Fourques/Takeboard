import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type DeviceInfo, type DeviceSettings, deviceApi } from "./api";
import { readConnectionDisplay } from "./device-context";
import { DisplaySettings } from "./display-settings";
import { type ProjectLocationChoice, ProjectLocationPicker } from "./project-location-picker";
import { ThemeSwitcher } from "./theme-switcher";
import "./settings-center.css";

export function SettingsButton() {
  const [update, setUpdate] = useState(() =>
    Boolean(
      (window as unknown as { __takeboardUpdateAvailable?: boolean }).__takeboardUpdateAvailable,
    ),
  );
  useEffect(() => {
    const notice = (event: Event) => setUpdate((event as CustomEvent<boolean>).detail === true);
    window.addEventListener("takeboard:update-available", notice);
    return () => window.removeEventListener("takeboard:update-available", notice);
  }, []);
  return (
    <button
      type="button"
      className="settings-entry"
      onClick={() => window.dispatchEvent(new Event("takeboard:open-settings"))}
    >
      {update ? "设置 · 有新版本" : "设置"}
    </button>
  );
}

// The host outlives temporary menus; clicking the modal must not unmount it when
// the workspace options menu closes on an outside pointerdown.
export function SettingsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("takeboard:open-settings", show);
    return () => window.removeEventListener("takeboard:open-settings", show);
  }, []);
  return open
    ? createPortal(<SettingsCenter onClose={() => setOpen(false)} />, document.body)
    : null;
}

function SettingsCenter({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [choice, setChoice] = useState<ProjectLocationChoice | null>(null);
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [connection] = useState(readConnectionDisplay);
  const desktop = "__TAURI__" in window;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let active = true;
    void Promise.all([deviceApi.status(), deviceApi.settings()])
      .then(([info, value]) => {
        if (active) {
          setDevice(info);
          setSettings(value);
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取设置");
      });
    return () => {
      active = false;
      element?.close();
    };
  }, []);
  const save = async (location: ProjectLocationChoice) => {
    if (!settings || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await deviceApi.saveSettings(settings.revision, location);
      setSettings(await deviceApi.settings());
      setMessage("默认位置已保存。已有项目保持原位置。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="settings-center"
      aria-labelledby="settings-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <h2 id="settings-title">设置</h2>
          <p>外观留在当前浏览器，项目设置保存在连接的设备。</p>
        </div>
        <button type="button" aria-label="关闭设置" disabled={busy} onClick={onClose}>
          ×
        </button>
      </header>
      <section>
        <h3>外观与可读性</h3>
        <p>不改变素材和生成分辨率；立即生效。</p>
        <div className="settings-actions">
          <ThemeSwitcher />
          <DisplaySettings />
        </div>
      </section>
      <section>
        <h3>
          项目与存储{" "}
          <small>· {connection?.name || connection?.address || device?.name || "当前设备"}</small>
        </h3>
        <p>
          默认位置用于这台设备上新建的项目，所有获准创建项目的用户共同使用。单次选择其他位置不修改默认值。
        </p>
        {settings?.canManage ? (
          <>
            <fieldset disabled={busy}>
              <ProjectLocationPicker
                key={settings.revision}
                initialChoice={settings.projectLocation ?? undefined}
                label="默认项目位置"
                onChange={setChoice}
                onValid={setValid}
              />
            </fieldset>
            <div className="settings-actions">
              <button
                type="button"
                disabled={
                  !valid ||
                  !choice ||
                  busy ||
                  (choice.storageRootId === settings.projectLocation?.storageRootId &&
                    choice.storageFolder === settings.projectLocation.storageFolder)
                }
                onClick={() => choice && void save(choice)}
              >
                保存默认位置
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  (settings.projectLocation?.storageRootId === "instance" &&
                    settings.projectLocation.storageFolder === "")
                }
                onClick={() => void save({ storageRootId: "instance", storageFolder: "" })}
              >
                恢复内置位置
              </button>
            </div>
            <details>
              <summary>服务数据目录</summary>
              <code>{device?.projectsDirectory}</code>
              <p>
                账号、项目索引与系统配置仍留在此目录。更改默认项目位置不会迁移这些数据或已有项目。
              </p>
            </details>
          </>
        ) : settings ? (
          <p>
            {settings.available
              ? "使用设备管理员设置的默认位置。"
              : "默认位置不可用，请联系设备管理员。"}
          </p>
        ) : (
          <p>{error ? "暂时无法读取设备设置，请关闭后重试。" : "正在读取设备设置…"}</p>
        )}
      </section>
      <section>
        <h3>设备与连接</h3>
        <p>{connection?.address || window.location.origin}</p>
        <p>
          项目与生成结果保存在当前连接设备，下载的副本保存在这台电脑。ComfyUI
          的连接与启停仍在顶栏服务面板中管理。
        </p>
        {desktop ? (
          <a href="takeboard-desktop://connections">管理连接设备</a>
        ) : (
          <p>使用桌面 App 可管理 SSH、HTTPS 和 Portal 连接。</p>
        )}
      </section>
      <section>
        <h3>版本与更新</h3>
        <p>检查当前电脑上的 App，不会更新或重启远程 TakeBoard，也不会中断生成。</p>
        {desktop ? (
          <a href="takeboard-desktop://updates">检查更新与提醒设置</a>
        ) : (
          <a href="https://github.com/Fourques/Takeboard/releases" target="_blank" rel="noreferrer">
            查看官方发布 · 浏览器不能安装更新
          </a>
        )}
      </section>
      {error ? <p role="alert">{error}</p> : null}
      <p role="status">{message}</p>
    </dialog>
  );
}
