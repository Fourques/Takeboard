const status = document.querySelector("#status");
const retry = document.querySelector("#retry");
let unlisten;

function showFailure(message) {
  document.querySelector(".progress").hidden = true;
  status.textContent = message;
  retry.hidden = false;
}

function applyStatus(payload) {
  if (payload?.state === "starting") {
    document.querySelector(".progress").hidden = false;
    status.textContent = "正在启动本机工作站…";
    retry.hidden = true;
    return;
  }
  if (payload?.state === "ready" && payload.url) {
    status.textContent = "服务已就绪，正在进入…";
    if (unlisten) unlisten();
    window.location.replace(payload.url);
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
