import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type DeviceInfo, type DeviceSettings, deviceApi } from "./api";
import { DesktopActionButton } from "./desktop-actions";
import { readConnectionDisplay } from "./device-context";
import { DisplaySettings } from "./display-settings";
import { type ProjectLocationChoice, ProjectLocationPicker } from "./project-location-picker";
import { RuntimeDiagnostics } from "./runtime-diagnostics";
import { openSettings, type SettingsSection } from "./settings-navigation";
import { ThemeSwitcher } from "./theme-switcher";
import "./settings-center.css";

const GenerationConnectionPanel = lazy(() =>
  import("./generation-connection-panel").then((module) => ({
    default: module.GenerationConnectionPanel,
  })),
);

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
    <button type="button" className="settings-entry" onClick={() => openSettings()}>
      {update ? "设置 · 有新版本" : "设置"}
    </button>
  );
}

// The host outlives temporary menus; clicking the modal must not unmount it when
// the workspace options menu closes on an outside pointerdown.
export function SettingsHost() {
  const [section, setSection] = useState<SettingsSection | null>(null);
  useEffect(() => {
    const show = (event: Event) => {
      const requested = (event as CustomEvent).detail;
      setSection(
        ["appearance", "storage", "connections", "diagnostics", "about"].includes(requested)
          ? requested
          : "appearance",
      );
    };
    window.addEventListener("takeboard:open-settings", show);
    return () => window.removeEventListener("takeboard:open-settings", show);
  }, []);
  return section
    ? createPortal(
        <SettingsCenter initialSection={section} onClose={() => setSection(null)} />,
        document.body,
      )
    : null;
}

function SettingsCenter({
  onClose,
  initialSection,
}: {
  onClose: () => void;
  initialSection: SettingsSection;
}) {
  const [section, setSection] = useState(initialSection);
  useEffect(() => setSection(initialSection), [initialSection]);
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
      const next = await deviceApi.settings();
      setChoice(next.projectLocation);
      setSettings(next);
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
      <header className="settings-heading">
        <div>
          <h2 id="settings-title">设置</h2>
          <p>按你的创作习惯调整 TakeBoard</p>
        </div>
        <button type="button" aria-label="关闭设置" disabled={busy} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {(
            [
              ["appearance", "外观"],
              ["storage", "项目与存储"],
              ["connections", "设备连接"],
              ["diagnostics", "运行诊断"],
              ["about", "关于与更新"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              disabled={busy}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {section === "appearance" ? (
            <section>
              <h3>外观</h3>
              <p>主题与显示偏好保留在当前设备。</p>
              <ThemeSwitcher />
              <DisplaySettings inline />
            </section>
          ) : null}
          {section === "storage" ? (
            <>
              {" "}
              <section>
                <h3>
                  项目与存储{" "}
                  <small>
                    · {connection?.name || connection?.address || device?.name || "当前设备"}
                  </small>
                </h3>
                <p>
                  默认位置用于这台设备上新建的项目，所有获准创建项目的用户共同使用。单次选择其他位置不修改默认值。
                </p>
                {settings?.canManage ? (
                  <>
                    <fieldset disabled={busy}>
                      <ProjectLocationPicker
                        key={settings.revision}
                        initialChoice={choice ?? settings.projectLocation ?? undefined}
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
            </>
          ) : null}
          {section === "connections" ? (
            <section>
              <h3>生成设备</h3>
              <p>连接 ComfyUI，生成结果保存在当前项目。</p>
              <Suspense fallback={<p>读取设备…</p>}>
                <GenerationConnectionPanel manage />
              </Suspense>
              <div className="settings-subsection">
                <h3>远程项目</h3>
                <p>打开另一台 TakeBoard 上的项目。项目与素材保存在那台设备。</p>
                {desktop ? (
                  <DesktopActionButton action="connections">管理远程项目连接</DesktopActionButton>
                ) : (
                  <p>在桌面 App 的“连接”菜单管理远程项目。</p>
                )}
              </div>
            </section>
          ) : null}
          {section === "diagnostics" ? <RuntimeDiagnostics /> : null}
          {section === "about" ? (
            <section>
              <h3>TakeBoard</h3>
              <p>项目设备 · {device?.name ?? "读取中"}</p>
              {desktop ? (
                <DesktopActionButton action="updates">检查 App 更新</DesktopActionButton>
              ) : (
                <a
                  href="https://github.com/Fourques/Takeboard/releases"
                  target="_blank"
                  rel="noreferrer"
                >
                  下载桌面 App
                </a>
              )}
              <p>更新当前电脑上的 App，不会重启远程服务。</p>
            </section>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {message ? <p role="status">{message}</p> : null}
        </div>
      </div>
    </dialog>
  );
}
