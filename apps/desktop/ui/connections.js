const api = window.__TAURI__;
const form = document.querySelector("#connect-form");
const kind = document.querySelector("#kind");
const address = document.querySelector("#address");
const port = document.querySelector("#port");
const status = document.querySelector("#status");
const disconnect = document.querySelector("#disconnect");
const reopen = document.querySelector("#reopen");
const key = "takeboard.connections.v1";
let recent = [];
let opening = false;
let connected = false;
try {
  const value = JSON.parse(localStorage.getItem(key) ?? "[]");
  if (Array.isArray(value))
    recent = value
      .filter(
        (item) =>
          item &&
          ["ssh", "https", "portal"].includes(item.kind) &&
          typeof item.address === "string" &&
          item.address.length <= 2048,
      )
      .slice(0, 12);
} catch {}

function explain() {
  const ssh = kind.value === "ssh";
  document.querySelector("#advanced").hidden = !ssh;
  document.querySelector("#address-label").textContent = ssh
    ? "SSH 主机"
    : kind.value === "portal"
      ? "Portal 门户地址"
      : "TakeBoard 地址";
  address.placeholder = ssh ? "user@192.168.1.10 或 SSH 别名" : "https://takeboard.example.com";
  document.querySelector("#help").textContent = ssh
    ? "使用系统已配置的 SSH 密钥和可信主机记录。不保存 SSH 密码；首次连接前需完成密钥配置和服务器指纹确认。"
    : kind.value === "portal"
      ? "连接门户后登录，即可选择已配对且在线的设备。不需要知道服务器 IP 或映射端口。"
      : "使用已配置认证的 HTTPS 服务；已有 SSH 隧道也可填写 http://127.0.0.1:端口。";
}
function failure(error) {
  status.textContent = String(error?.message ?? error);
  status.parentElement.classList.add("error");
  document.querySelector("#connect").disabled = false;
  opening = false;
}
function save() {
  try {
    localStorage.setItem(key, JSON.stringify(recent));
  } catch {
    status.textContent += "（此设备无法保存连接记录）";
  }
}
function render() {
  const list = document.querySelector("#recent");
  list.replaceChildren();
  if (!recent.length) {
    list.textContent = "成功连接后，地址会保存在此设备上。";
    return;
  }
  for (const item of recent) {
    const row = document.createElement("div");
    row.className = "recent-row";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = item.address;
    const subtitle = document.createElement("small");
    subtitle.textContent =
      item.kind === "portal"
        ? "Portal · 已配对设备"
        : item.kind === "ssh"
          ? "SSH · 已验证服务器"
          : "HTTPS · 已验证服务";
    open.append(subtitle);
    open.onclick = () => {
      kind.value = item.kind;
      address.value = item.address;
      port.value = item.port ?? "";
      explain();
      form.requestSubmit();
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.setAttribute("aria-label", `移除连接记录 ${item.address}`);
    remove.onclick = () => {
      if (!confirm(`仅移除 ${item.address} 的本地连接记录？服务器项目和账号不会删除。`)) return;
      recent = recent.filter((entry) => entry !== item);
      save();
      render();
    };
    row.append(open, remove);
    list.append(row);
  }
}
async function apply(value) {
  // The broker first releases an old transport. Do not briefly enable the form
  // or overwrite "connecting" with "disconnected" during that transition.
  if (value.state === "idle" && opening) return;
  connected = value.state === "ready";
  const busy = value.state === "connecting";
  document.querySelector("#connect").disabled = busy;
  disconnect.hidden = !["connecting", "ready"].includes(value.state);
  reopen.hidden = value.state !== "ready";
  status.parentElement.classList.toggle("error", value.state === "failed");
  if (value.state === "connecting") status.textContent = "正在验证服务器和连接权限…";
  if (value.state === "failed") failure(value.message);
  if (value.state === "idle") {
    status.textContent = "尚未连接。选择服务器开始，服务器任务和项目不受影响。";
  }
  if (value.state === "ready") {
    status.textContent = `已连接 · ${value.target.address}`;
    recent = [
      { ...value.target, instanceId: value.instanceId, localPort: value.localPort },
      ...recent.filter(
        (item) => !(item.kind === value.target.kind && item.address === value.target.address),
      ),
    ].slice(0, 12);
    save();
    render();
    if (opening) {
      opening = false;
      try {
        await api.core.invoke("open_remote_workspace");
      } catch (error) {
        failure(error);
      }
    }
  }
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (opening || document.querySelector("#connect").disabled) return;
  if (connected && !confirm("重新连接将替换当前远程连接。请先保存编辑；服务器生成任务不会停止。"))
    return;
  const target = {
    kind: kind.value,
    address: address.value.trim(),
    port: kind.value === "ssh" ? port.value : null,
  };
  const stored = recent.find(
    (item) =>
      item.kind === target.kind &&
      item.address === target.address &&
      String(item.port ?? "") === String(target.port ?? ""),
  );
  document.querySelector("#connect").disabled = true;
  status.textContent = "正在验证服务器和连接权限…";
  status.parentElement.classList.remove("error");
  opening = true;
  try {
    await api.core.invoke("connect_remote", { target: { ...stored, ...target } });
  } catch (error) {
    failure(error);
  }
});
disconnect.onclick = () => {
  if (connected && !confirm("断开并关闭远程窗口？请先保存编辑；服务器生成任务不会停止。")) return;
  opening = false;
  void api.core.invoke("disconnect_remote").catch(failure);
};
reopen.onclick = () => api.core.invoke("open_remote_workspace").catch(failure);
kind.onchange = explain;
render();
explain();
kind.focus();
if (api?.event && api?.core) {
  api.event
    .listen("takeboard-connection", ({ payload }) => void apply(payload))
    .then(() => api.core.invoke("connection_status"))
    .then(apply)
    .catch(failure);
} else failure("此窗口需要通过 TakeBoard 桌面菜单“连接 → 连接设备”打开。");
