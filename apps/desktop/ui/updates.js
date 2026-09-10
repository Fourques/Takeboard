const element = (id) => document.getElementById(id);
let state;
let pending = false;
function render(value) {
  state = value;
  element("installed").textContent =
    `当前 App ${value.currentVersion} · ${{ darwin: "macOS", win32: "Windows", linux: "Linux" }[value.platform] ?? value.platform} · ${value.arch}`;
  element("automatic").checked = value.autoCheck;
  element("channel").value = value.channel;
  element("unskip").hidden = !value.skippedVersion;
  element("release").hidden = !value.release;
  element("status").textContent =
    {
      idle: "可手动检查新版本。",
      update: "有新版本可下载。",
      up_to_date: "所选频道没有比当前 App 更新的版本。",
      no_release: "所选频道尚无已发布版本。",
      skipped: "已跳过此版本的启动提醒，仍可手动下载。",
      no_installer: "发现新版本，但尚无匹配此电脑的安装包。",
      error: value.error,
    }[value.status] ?? "";
  if (value.release) {
    element("version").textContent = `TakeBoard ${value.release.version}`;
    element("filename").textContent =
      value.release.filename ?? "请等待此平台安装包发布，不要安装其他架构的文件。";
    element("notes-text").textContent = value.release.notes;
    element("download").hidden = !value.release.downloadUrl;
  }
}
async function action(operation, input) {
  if (pending) return;
  pending = true;
  for (const item of document.querySelectorAll("button,input,select")) item.disabled = true;
  element("status").textContent = operation === "check" ? "正在连接官方发布服务…" : "正在处理…";
  try {
    const value = await window.__TAURI__.core.invoke("update_action", { operation, input });
    if (value.opened) element("status").textContent = "已在系统浏览器打开。";
    else {
      render(value);
      if (operation === "save") element("status").textContent = "提醒设置已保存。";
    }
    return true;
  } catch (error) {
    element("status").textContent = `操作未完成：${String(error)}`;
    return false;
  } finally {
    pending = false;
    for (const item of document.querySelectorAll("button,input,select")) item.disabled = false;
  }
}
const preferences = (skippedVersion = state?.skippedVersion ?? null) => ({
  channel: element("channel").value,
  autoCheck: element("automatic").checked,
  skippedVersion,
});
element("save").addEventListener("click", () => action("save", preferences()));
element("check").addEventListener("click", async () => {
  if (await action("save", preferences())) await action("check");
});
element("download").addEventListener("click", () =>
  action("download", { version: state.release.version }),
);
element("notes").addEventListener("click", () =>
  action("notes", { version: state.release.version }),
);
element("skip").addEventListener("click", () => action("save", preferences(state.release.version)));
element("unskip").addEventListener("click", () => action("save", preferences(null)));
void action("status");
