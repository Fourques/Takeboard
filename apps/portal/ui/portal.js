const authView = document.querySelector("#auth-view");
const workspaceView = document.querySelector("#workspace-view");
const account = document.querySelector("#account");
const authForm = document.querySelector("#auth-form");
const pairingForm = document.querySelector("#pairing-form");
let csrfToken = null;
let registerMode = false;
let portalStatus = null;
let refreshTimer = null;

async function api(path, options = {}) {
  const response = await fetch(`/__portal/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(csrfToken ? { "x-takeboard-portal-csrf": csrfToken } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function configureAuthForm() {
  const firstAccount = !portalStatus.configured;
  const canRegister = firstAccount || portalStatus.registration;
  registerMode = firstAccount || registerMode;
  document.querySelector("#name-field").hidden = !registerMode;
  const setupTokenField = document.querySelector("#setup-token-field");
  setupTokenField.hidden = !firstAccount || !portalStatus.bootstrapRequired;
  setupTokenField.querySelector("input").required = firstAccount && portalStatus.bootstrapRequired;
  document.querySelector("#auth-title").textContent = registerMode
    ? firstAccount
      ? "建立首个门户账号"
      : "创建门户账号"
    : "进入门户";
  document.querySelector("#auth-kicker").textContent = firstAccount ? "首次设置" : "安全登录";
  document.querySelector("#auth-submit").textContent = registerMode ? "创建并进入" : "登录";
  const switcher = document.querySelector("#auth-switch");
  switcher.hidden = !canRegister || firstAccount;
  switcher.textContent = registerMode ? "已有账号，直接登录" : "创建新账号";
  authForm.elements.password.autocomplete = registerMode ? "new-password" : "current-password";
}

function formatDate(value) {
  if (!value) return "尚未上线";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

async function loadDevices() {
  const { devices } = await api("/devices");
  const container = document.querySelector("#devices");
  container.replaceChildren();
  if (!devices.length) {
    const empty = document.createElement("div");
    empty.className = "empty panel";
    empty.textContent = "还没有连接工作站。在 TakeBoard 的“访问与安装”中发起配对。";
    container.append(empty);
    return;
  }
  const template = document.querySelector("#device-template");
  for (const device of devices) {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".device");
    card.classList.toggle("online", device.online);
    fragment.querySelector(".device-state").textContent = device.revokedAt
      ? "已撤销"
      : device.online
        ? "在线"
        : "离线";
    fragment.querySelector(".device-name").textContent = device.name;
    fragment.querySelector(".device-meta").textContent = `TakeBoard ${device.applicationVersion}`;
    fragment.querySelector(".device-seen").textContent =
      `最近连接：${formatDate(device.lastSeenAt)}`;
    const open = fragment.querySelector(".device-open");
    const unavailable = !device.online || Boolean(device.revokedAt);
    if (unavailable) {
      open.removeAttribute("href");
      open.setAttribute("aria-disabled", "true");
      open.textContent = device.revokedAt ? "已撤销" : "工作站离线";
      open.addEventListener("click", (event) => event.preventDefault());
    } else {
      open.href = device.remoteUrl;
    }
    const revoke = fragment.querySelector(".device-revoke");
    revoke.disabled = Boolean(device.revokedAt);
    revoke.hidden = Boolean(device.revokedAt);
    revoke.addEventListener("click", async () => {
      if (!confirm(`撤销“${device.name}”的门户访问？本地项目不会删除。`)) return;
      await api(`/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
      await loadDevices();
    });
    container.append(fragment);
  }
  const desired = new URLSearchParams(location.search).get("device");
  const target = devices.find((device) => device.slug === desired && device.online);
  if (target) location.replace(target.remoteUrl);
}

async function loadActivity() {
  const { entries } = await api("/activity?limit=30");
  const labels = {
    "portal.account_registered": "创建门户账号",
    "portal.login": "登录门户",
    "portal.logout": "退出门户",
    "device.paired": "连接工作站",
    "device.revoked": "撤销工作站",
    "device.remote_opened": "打开工作站",
  };
  document.querySelector("#activity-list").replaceChildren(
    ...entries.map((entry) => {
      const row = document.createElement("div");
      row.className = "activity-row";
      const action = document.createElement("span");
      action.textContent = labels[entry.action] || entry.action;
      const time = document.createElement("time");
      time.textContent = formatDate(entry.createdAt);
      row.append(action, time);
      return row;
    }),
  );
}

async function showWorkspace(user) {
  authView.hidden = true;
  workspaceView.hidden = false;
  account.hidden = false;
  document.querySelector("#account-name").textContent = user.name;
  await Promise.all([loadDevices(), loadActivity()]);
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      if (!document.hidden) loadDevices().catch(() => undefined);
    }, 10_000);
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  document.querySelector("#auth-error").textContent = "";
  const data = new FormData(authForm);
  try {
    const payload = await api(registerMode ? "/auth/register" : "/auth/login", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        email: data.get("email"),
        password: data.get("password"),
        setupToken: data.get("setupToken"),
      }),
    });
    csrfToken = payload.csrfToken;
    await showWorkspace(payload.user);
  } catch (error) {
    document.querySelector("#auth-error").textContent = error.message;
  }
});

document.querySelector("#auth-switch").addEventListener("click", () => {
  registerMode = !registerMode;
  configureAuthForm();
});

document.querySelector("#logout").addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" });
  location.replace("/");
});

document.querySelector("#show-pairing").addEventListener("click", () => {
  pairingForm.hidden = false;
  pairingForm.elements.code.focus();
});
document.querySelector("#cancel-pairing").addEventListener("click", () => {
  pairingForm.hidden = true;
  pairingForm.reset();
});
pairingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  document.querySelector("#pairing-error").textContent = "";
  try {
    await api("/pairings/claim", {
      method: "POST",
      body: JSON.stringify({ code: new FormData(pairingForm).get("code") }),
    });
    pairingForm.hidden = true;
    pairingForm.reset();
    await Promise.all([loadDevices(), loadActivity()]);
  } catch (error) {
    document.querySelector("#pairing-error").textContent = error.message;
  }
});

try {
  portalStatus = await api("/auth/status");
  csrfToken = portalStatus.csrfToken;
  if (portalStatus.user) {
    await showWorkspace(portalStatus.user);
  } else {
    authView.hidden = false;
    configureAuthForm();
  }
} catch (error) {
  authView.hidden = false;
  authForm.hidden = false;
  document.querySelector("#auth-title").textContent = "门户暂时不可用";
  document.querySelector("#auth-error").textContent = error.message;
  document.querySelector("#auth-submit").disabled = true;
}
