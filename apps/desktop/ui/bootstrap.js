const status = document.querySelector("#status");
const retry = document.querySelector("#retry");
let unlisten;
// Migrate only from the old bundled origin, before navigating to the local HTTP UI.
// Keep the old key as a recovery copy; an existing native preference file wins.
const connectionMigration = (async () => {
  if (!window.__TAURI__?.core) return;
  const text = localStorage.getItem("takeboard.connections.v1") ?? "[]";
  if (text.length > 65536) throw new Error("旧连接记录过大");
  await window.__TAURI__.core.invoke("import_legacy_connections", { entries: JSON.parse(text) });
})().then(
  () => false,
  () => true,
);

function showFailure(message) {
  document.querySelector(".progress").hidden = true;
  status.textContent = message;
  retry.hidden = false;
}

async function applyStatus(payload) {
  if (payload?.state === "starting") {
    document.querySelector(".progress").hidden = false;
    status.textContent = "正在启动本机工作站…";
    retry.hidden = true;
    return;
  }
  if (payload?.state === "ready" && payload.url) {
    status.textContent = "服务已就绪，正在进入…";
    if (unlisten) unlisten();
    const destination = new URL(payload.url);
    destination.hash = new URLSearchParams({
      "tb-device": JSON.stringify({ kind: "local", address: "" }),
      ...((await connectionMigration) ? { "tb-connection-migration": "failed" } : {}),
      ...(window.__takeboardPendingSettings
        ? { "tb-settings": window.__takeboardPendingSettings }
        : {}),
    }).toString();
    window.location.replace(destination.href);
    return;
  }
  if (payload?.state === "failed") showFailure(payload.message || "TakeBoard 无法启动");
}

retry.addEventListener("click", async () => {
  applyStatus({ state: "starting" });
  try {
    applyStatus(await window.__TAURI__.core.invoke("restart_server"));
  } catch (error) {
    showFailure(error instanceof Error ? error.message : String(error));
  }
});

if (window.__TAURI__?.event && window.__TAURI__?.core) {
  window.__TAURI__.event
    .listen("takeboard-startup", ({ payload }) => applyStatus(payload))
    .then((dispose) => {
      unlisten = dispose;
      return window.__TAURI__.core.invoke("desktop_status");
    })
    .then(applyStatus)
    .catch((error) => showFailure(error instanceof Error ? error.message : String(error)));
} else {
  showFailure("当前入口缺少桌面运行环境，请使用 TakeBoard 启动器打开。");
}
