import type { RemoteAccessStatus } from "@takeboard/contracts";
import { useCallback, useEffect, useState } from "react";
import { authApi } from "./api";

const remoteAccessCss = `.auth-loading.compact{min-height:180px;background:transparent}.remote-access-panel{display:grid;gap:14px}.remote-current-card,.remote-checks,.remote-method-card{border:1px solid var(--line);background:color-mix(in srgb,var(--surface-2) 74%,transparent)}.remote-current-card{display:flex;min-height:82px;align-items:center;justify-content:space-between;padding:16px 18px;border-radius:16px;gap:16px}.remote-current-card>div{display:grid;min-width:0;gap:4px}.remote-current-card strong{font-size:16px}.remote-current-card small{overflow:hidden;color:var(--text-2);text-overflow:ellipsis;white-space:nowrap}.remote-access-kicker,.remote-method-card header>span{color:var(--text-3);font-size:9px;font-weight:800;letter-spacing:.12em}.remote-current-card>i,.remote-method-card header>i{flex:none;padding:5px 8px;border:1px solid var(--line);border-radius:999px;color:var(--text-2);font-size:9px;font-style:normal;font-weight:750}.remote-current-card>i.ready,.remote-method-card header>i.ready{border-color:color-mix(in srgb,var(--success) 42%,var(--line));color:var(--success)}.remote-current-card>i.attention,.remote-method-card header>i.blocked,.remote-method-card header>i.attention{border-color:color-mix(in srgb,var(--warning) 42%,var(--line));color:var(--warning)}.remote-method-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.remote-method-card{display:flex;min-width:0;min-height:196px;flex-direction:column;padding:16px;border-radius:16px;gap:9px}.remote-method-card.recommended{border-color:color-mix(in srgb,var(--accent) 38%,var(--line));background:radial-gradient(circle at 100% 0,color-mix(in srgb,var(--accent) 11%,transparent),transparent 50%),color-mix(in srgb,var(--surface-2) 78%,transparent)}.remote-method-card.future{border-style:dashed}.remote-method-card header{display:flex;align-items:center;justify-content:space-between;gap:8px}.remote-method-card h4,.remote-method-card p{margin:0}.remote-method-card h4{font-size:15px}.remote-method-card p,.remote-method-card small{color:var(--text-2);font-size:10px;line-height:1.55}.remote-method-card code{overflow:auto;padding:9px;border-radius:9px;color:var(--text-2);background:var(--surface-root);font-size:9px;line-height:1.45;white-space:nowrap}.remote-method-card button,.remote-checks header button{min-height:34px;padding:0 11px;border:1px solid var(--line);border-radius:9px;cursor:pointer;color:var(--text-1);background:var(--surface-1);font-size:10px;font-weight:750}.remote-method-card button{align-self:flex-start;margin-top:auto}.remote-checks{overflow:hidden;border-radius:16px}.remote-checks>header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line);gap:12px}.remote-checks>header>div{display:grid;gap:3px}.remote-checks>header small{color:var(--text-2);font-size:9px}.remote-check{display:flex;align-items:start;padding:11px 16px;border-bottom:1px solid color-mix(in srgb,var(--line) 72%,transparent);gap:10px}.remote-check:last-child{border-bottom:0}.remote-check>i{width:7px;height:7px;margin-top:4px;border-radius:50%;background:var(--text-3)}.remote-check>i.pass{background:var(--success)}.remote-check>i.warning{background:var(--warning)}.remote-check>i.blocked{background:var(--red)}.remote-check>div{display:grid;min-width:0;gap:2px}.remote-check strong{font-size:11px}.remote-check span{color:var(--text-2);font-size:10px;line-height:1.45}@media(max-width:720px){.remote-method-grid{grid-template-columns:1fr}.remote-current-card{align-items:flex-start;flex-direction:column}}`;

function accessKindLabel(kind: RemoteAccessStatus["currentAccess"]["kind"]) {
  if (kind === "https_proxy") return "HTTPS 团队入口";
  if (kind === "private_network") return "受限网络地址";
  return "本机或 SSH 隧道";
}

export default function RemoteAccessPanel() {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const standalone = window.matchMedia("(display-mode: standalone)").matches;

  const load = useCallback(() => {
    setError(null);
    void authApi
      .remoteAccess()
      .then(setStatus)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取远程访问状态"));
  }, []);

  useEffect(() => load(), [load]);

  async function copySshCommand() {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.ssh.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("浏览器没有授予剪贴板权限，请手动选择并复制命令");
    }
  }

  if (!status && !error) {
    return (
      <div className="auth-loading compact">
        <style>{remoteAccessCss}</style>正在检查访问方式…
      </div>
    );
  }

  return (
    <div className="remote-access-panel">
      <style>{remoteAccessCss}</style>
      {status ? (
        <>
          <section className="remote-current-card">
            <div>
              <span className="remote-access-kicker">CURRENT CONNECTION</span>
              <strong>{accessKindLabel(status.currentAccess.kind)}</strong>
              <small>{status.currentAccess.origin}</small>
            </div>
            <i className={status.currentAccess.protection === "network" ? "attention" : "ready"}>
              {status.currentAccess.protection === "loopback"
                ? "本机边界"
                : status.currentAccess.protection === "tls"
                  ? "HTTPS 加密"
                  : "仅限可信网络"}
            </i>
          </section>

          <div className="remote-method-grid">
            <article className="remote-method-card recommended">
              <header>
                <span>个人远程</span>
                <i className={status.ssh.state}>{status.ssh.state === "ready" ? "可用" : "检查"}</i>
              </header>
              <h4>SSH 安全连接</h4>
              <p>{status.ssh.detail}</p>
              <code>{status.ssh.command}</code>
              <button type="button" onClick={() => void copySshCommand()}>
                {copied ? "已复制" : "复制连接命令"}
              </button>
            </article>

            <article className="remote-method-card">
              <header>
                <span>固定团队入口</span>
                <i className={status.https.state}>
                  {status.https.state === "ready"
                    ? "已就绪"
                    : status.https.state === "blocked"
                      ? "需处理"
                      : "未配置"}
                </i>
              </header>
              <h4>HTTPS 反向代理</h4>
              <p>{status.https.detail}</p>
              {status.https.publicUrl ? <code>{status.https.publicUrl}</code> : null}
              <small>适合可信团队；ComfyUI 端口仍不应公开。</small>
            </article>

            <article className="remote-method-card future">
              <header>
                <span>多设备入口</span>
                <i>规划中</i>
              </header>
              <h4>TakeBoard 账号门户</h4>
              <p>{status.managedPortal.detail}</p>
              <small>未来由主机主动出站连接，不要求路由器开放端口。</small>
            </article>

            <article className="remote-method-card">
              <header>
                <span>桌面体验</span>
                <i className={standalone ? "ready" : "not_configured"}>
                  {standalone ? "应用模式" : "可安装"}
                </i>
              </header>
              <h4>独立应用窗口</h4>
              <p>
                {standalone
                  ? "当前已经在独立应用窗口中运行。"
                  : "可从支持的浏览器菜单选择“安装 TakeBoard”或“添加到程序坞”。"}
              </p>
              <small>它仍连接自己的 TakeBoard 服务，不会把素材复制到浏览器。</small>
            </article>
          </div>

          <section className="remote-checks" aria-label="远程访问安全检查">
            <header>
              <div>
                <strong>{status.instance.name}</strong>
                <small>
                  {status.instance.id
                    ? `设备标识 ${status.instance.id.slice(0, 8)}…`
                    : "尚无稳定设备标识"}
                </small>
              </div>
              <button type="button" onClick={load}>
                重新检查
              </button>
            </header>
            {status.checks.map((check) => (
              <div className="remote-check" key={check.id}>
                <i className={check.status} aria-hidden="true" />
                <div>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </div>
              </div>
            ))}
          </section>
        </>
      ) : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}{" "}
          <button type="button" onClick={load}>
            重试
          </button>
        </p>
      ) : null}
    </div>
  );
}
