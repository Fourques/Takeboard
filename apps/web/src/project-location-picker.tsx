import { useEffect, useState } from "react";
import { type DeviceInfo, deviceApi } from "./api";
import { readConnectionDisplay } from "./device-context";

export type ProjectLocationChoice = { storageRootId: string; storageFolder: string };

export function ProjectLocationPicker({
  onChange,
  onValid,
  initialChoice,
  label = "创建到",
}: {
  onChange: (value: ProjectLocationChoice | null) => void;
  onValid: (value: boolean) => void;
  initialChoice?: ProjectLocationChoice | undefined;
  label?: string;
}) {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [roots, setRoots] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [choice, setChoice] = useState<ProjectLocationChoice>({
    storageRootId: "instance",
    storageFolder: "",
  });
  const [listing, setListing] = useState<{ path: string; folders: string[] } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const [newRoot, setNewRoot] = useState("");
  const [connection] = useState(readConnectionDisplay);
  const [folderRequest] = useState(() => `folder-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    let active = true;
    const picked = (event: Event) => {
      const detail = (event as CustomEvent<{ request: string; path: string | null }>).detail;
      if (detail?.request !== folderRequest || typeof detail.path !== "string") return;
      setBusy(true);
      onValid(false);
      setError("");
      void deviceApi
        .addStorageRoot(detail.path, "自定义位置")
        .then(({ root }) => {
          if (!active) return;
          setRoots((items) => [...items.filter((item) => item.id !== root.id), root]);
          setChoice({ storageRootId: root.id, storageFolder: "" });
        })
        .catch((cause) => {
          if (!active) return;
          setError(cause instanceof Error ? cause.message : "无法使用所选文件夹");
          setChoice((previous) => ({ ...previous })); // Revalidate the previous folder.
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    };
    window.addEventListener("takeboard:folder-picked", picked);
    return () => {
      active = false;
      window.removeEventListener("takeboard:folder-picked", picked);
    };
  }, [folderRequest, onValid]);
  useEffect(() => {
    let active = true;
    onValid(false);
    void deviceApi
      .status()
      .then(async (current) => {
        if (!active) return;
        setDevice(current);
        const settings = await deviceApi.settings();
        if (!active) return;
        if (!current.canManage) {
          onChange(null);
          onValid(settings.available);
          if (!settings.available) setError("设备默认项目位置不可用，请联系设备管理员");
          return;
        }
        const result = await deviceApi.storageRoots();
        if (!active) return;
        setChoice(
          initialChoice ??
            settings.projectLocation ?? { storageRootId: "instance", storageFolder: "" },
        );
        setRoots(result.roots);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取项目位置");
      });
    return () => {
      active = false;
    };
  }, [onChange, onValid, initialChoice]);

  useEffect(() => {
    if (!device?.canManage || !roots.length) return;
    let active = true;
    onValid(false);
    setListing(null);
    setError("");
    void deviceApi
      .folders(choice.storageRootId, choice.storageFolder)
      .then((result) => {
        if (!active) return;
        setListing(result);
        onChange(choice);
        onValid(true);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "位置不可用，请重新选择");
      });
    return () => {
      active = false;
    };
  }, [choice, device, roots, onChange, onValid]);

  return (
    <section className="project-location-picker">
      <span>
        {label} ·{" "}
        {connection?.kind === "local"
          ? "此电脑"
          : connection?.name || connection?.address || device?.name || "当前设备"}
      </span>
      <div className="project-location-summary">
        <code>
          {listing?.path ||
            (error ? "位置不可用" : device?.canManage ? "正在读取保存位置…" : "设备默认项目位置")}
        </code>
        {device?.canManage ? (
          connection?.kind === "local" && "__TAURI__" in window ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                window.location.href = `takeboard-desktop://choose-folder?${new URLSearchParams({ request: folderRequest })}`;
              }}
            >
              选择文件夹
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setExpanded((value) => !value)}>
              {expanded ? "收起" : "选择文件夹"}
            </button>
          )
        ) : null}
      </div>
      <small>
        在此位置新建独立项目文件夹。素材和生成结果保存在这台设备，下载时另存到当前电脑。
      </small>
      {expanded ? (
        <div className="project-folder-browser">
          <label>
            允许的项目位置
            <select
              value={choice.storageRootId}
              disabled={busy}
              onChange={(event) =>
                setChoice({ storageRootId: event.target.value, storageFolder: "" })
              }
            >
              {roots.map((root) => (
                <option key={root.id} value={root.id}>
                  {root.name} · {root.path}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !choice.storageFolder}
            onClick={() =>
              setChoice({
                ...choice,
                storageFolder: choice.storageFolder.split("/").slice(0, -1).join("/"),
              })
            }
          >
            上一级
          </button>
          <fieldset className="project-folder-list" aria-label="当前设备上的子文件夹">
            {listing?.folders.map((name) => (
              <button
                type="button"
                key={name}
                disabled={busy}
                onClick={() =>
                  setChoice({
                    ...choice,
                    storageFolder: [choice.storageFolder, name].filter(Boolean).join("/"),
                  })
                }
              >
                ▸ {name}
              </button>
            ))}
            {listing?.folders.length === 0 ? (
              <span>没有子文件夹，可直接在当前位置创建项目。</span>
            ) : null}
          </fieldset>
          <label>
            新建子文件夹
            <input
              value={newFolder}
              maxLength={100}
              onChange={(event) => setNewFolder(event.target.value)}
              placeholder="例如：短片"
            />
          </label>
          <button
            type="button"
            disabled={busy || !listing || !newFolder.trim()}
            onClick={() => {
              setBusy(true);
              setError("");
              void deviceApi
                .createFolder(choice.storageRootId, choice.storageFolder, newFolder)
                .then(({ name }) => {
                  setNewFolder("");
                  setChoice({
                    ...choice,
                    storageFolder: [choice.storageFolder, name].filter(Boolean).join("/"),
                  });
                })
                .catch((cause) =>
                  setError(cause instanceof Error ? cause.message : "无法创建文件夹"),
                )
                .finally(() => setBusy(false));
            }}
          >
            创建文件夹
          </button>
          <details>
            <summary>添加其他保存位置</summary>
            <p>输入当前设备上已有文件夹的完整路径，不会移动任何现有项目。</p>
            {connection?.kind === "local" && "__TAURI__" in window ? (
              <a
                href={`takeboard-desktop://choose-folder?${new URLSearchParams({ request: folderRequest })}`}
              >
                浏览此电脑的文件夹…
              </a>
            ) : null}
            <input
              aria-label="当前设备上的完整文件夹路径"
              value={newRoot}
              onChange={(event) => setNewRoot(event.target.value)}
              placeholder={
                device?.platform === "win32" ? "D:\\TakeBoardProjects" : "/data/TakeBoardProjects"
              }
            />
            <button
              type="button"
              disabled={busy || !newRoot.trim()}
              onClick={() => {
                setBusy(true);
                setError("");
                void deviceApi
                  .addStorageRoot(newRoot, "自定义位置")
                  .then(({ root }) => {
                    setRoots((items) => [...items.filter((item) => item.id !== root.id), root]);
                    setChoice({ storageRootId: root.id, storageFolder: "" });
                    setNewRoot("");
                  })
                  .catch((cause) =>
                    setError(cause instanceof Error ? cause.message : "无法添加位置"),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              允许在此位置创建项目
            </button>
          </details>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
