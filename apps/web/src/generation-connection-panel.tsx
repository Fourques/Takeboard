import { useEffect, useState } from "react";
import {
  type GenerationConnection,
  type GenerationConnectionTarget,
  generationConnectionApi,
} from "./api";
import { useAuth } from "./auth-ui";
import "./generation-connection-panel.css";

export function GenerationConnectionPanel() {
  const auth = useAuth();
  const [connection, setConnection] = useState<GenerationConnection | null>(null);
  const [kind, setKind] = useState<"ssh" | "url">("ssh");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("8188");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = !auth.enabled || auth.local || auth.user?.instanceRole === "admin";
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    let timer = 0;
    const refresh = async () => {
      try {
        const result = await generationConnectionApi.status();
        if (active) setConnection(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取连接");
      }
      if (active) timer = window.setTimeout(() => void refresh(), 5000);
    };
    void refresh();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canManage]);
  const connect = async (target: GenerationConnectionTarget | { workerId: string }) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setConnection(await generationConnectionApi.connect(target));
      setNotice("已切换生成服务，项目保存位置保持不变。");
      window.dispatchEvent(new Event("takeboard:generation-connection-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接失败，原连接未切换");
    } finally {
      setBusy(false);
    }
  };
  if (!canManage) return <p>生成服务由设备管理员设置，项目成员可使用已配置的服务。</p>;
  return (
    <section className="generation-connection-panel" aria-label="生成服务连接">
      <div>
        <strong>生成服务</strong>
        <span>{connection?.name ?? "正在读取…"}</span>
        <code>{connection?.address}</code>
      </div>
      {connection?.error ? <p role="status">{connection.error}</p> : null}
      <details>
        <summary>选择生成设备</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              kind === "ssh" &&
              (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
            ) {
              setError("ComfyUI 端口需要是 1–65535 的整数");
              return;
            }
            void connect(
              kind === "ssh"
                ? { kind, host: address.trim(), port: Number(port), name }
                : { kind, url: address.trim(), name },
            );
          }}
        >
          <fieldset disabled={busy}>
            <label>
              连接方式
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as "ssh" | "url");
                  setAddress("");
                }}
              >
                <option value="ssh">SSH · 加密连接</option>
                <option value="url">ComfyUI 地址</option>
              </select>
            </label>
            <label>
              {kind === "ssh" ? "IP 或 SSH 名称" : "服务地址"}
              <input
                required
                autoComplete="off"
                value={address}
                placeholder={
                  kind === "ssh" ? "user@server / 已配置的 SSH 名称" : "https://comfy.example.com"
                }
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
            <label>
              显示名称（选填）
              <input
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：家里的工作站"
              />
            </label>
            {kind === "ssh" ? (
              <label>
                服务器上的 ComfyUI 端口
                <input
                  inputMode="numeric"
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              </label>
            ) : null}
            <p>
              {kind === "ssh"
                ? "使用项目所在设备的 SSH 密钥和主机配置；TakeBoard 独立维护连接，不依赖 VS Code。首次连接需先核实服务器指纹。"
                : "支持 HTTPS，或此设备上的 HTTP 回环地址。局域网 HTTP 服务可通过 SSH 连接。"}
            </p>
            <p>
              连接后，生成所需的素材副本会发送到此服务，结果下载到项目文件夹。不会移动项目，也不会自动删除远端原文件。
            </p>
            <button type="submit">{busy ? "正在验证连接…" : "连接并使用"}</button>
          </fieldset>
        </form>
        {connection ? (
          <div className="generation-recent">
            <span>最近使用</span>
            {connection.profiles.map((profile) => (
              <button
                type="button"
                key={profile.workerId}
                disabled={busy}
                onClick={() => void connect(profile.target)}
              >
                {profile.target.name}
                <small>
                  {profile.target.kind === "ssh" ? profile.target.host : profile.target.url}
                </small>
              </button>
            ))}
            <button
              type="button"
              disabled={busy || connection.workerId === connection.localWorkerId}
              onClick={() => void connect({ workerId: connection.localWorkerId })}
            >
              使用原有服务配置
            </button>
          </div>
        ) : null}
      </details>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
