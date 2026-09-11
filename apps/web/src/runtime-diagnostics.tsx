import type { OperationsDiagnostics } from "@takeboard/contracts";
import { useState } from "react";
import { projectApi } from "./api";

/** Diagnostics only run on explicit request; opening Settings never probes the environment. */
export function RuntimeDiagnostics() {
  const [report, setReport] = useState<OperationsDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inspect = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setReport(await projectApi.diagnostics());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "检测失败，请重试");
    } finally {
      setBusy(false);
    }
  };
  const content = () =>
    JSON.stringify(
      {
        ...report,
        client: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          devicePixelRatio: window.devicePixelRatio,
          displayScale: document.documentElement.style.getPropertyValue("--ui-scale"),
          theme: document.documentElement.dataset.theme,
          online: navigator.onLine,
        },
      },
      null,
      2,
    );
  return (
    <section className="runtime-diagnostics" aria-label="运行诊断" aria-busy={busy}>
      <h3>运行诊断</h3>
      <p>遇到连接或生成问题时，检查当前环境。不会启动服务或读取素材内容。</p>
      <div className="settings-actions">
        <button type="button" disabled={busy} onClick={() => void inspect()}>
          {busy ? "检测中…" : report ? "重新检测" : "开始检测"}
        </button>
        {report ? (
          <>
            <button
              type="button"
              onClick={() => {
                if (!navigator.clipboard) {
                  setError("无法复制，请下载报告");
                  return;
                }
                void navigator.clipboard
                  .writeText(content())
                  .then(() => setNotice("报告已复制"))
                  .catch(() => setError("无法复制，请下载报告"));
              }}
            >
              复制报告
            </button>
            <button
              type="button"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([content()], { type: "application/json" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `takeboard-support-${report.generatedAt.slice(0, 10)}.json`;
                link.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              下载报告
            </button>
          </>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {report ? (
        <>
          <p>
            检测于 {new Date(report.generatedAt).toLocaleTimeString()} ·{" "}
            {report.application.platform}
          </p>
          <div className="diagnostic-results">
            {report.checks.map((check) => (
              <article key={check.id} data-status={check.status}>
                <strong>
                  {check.title}
                  <small>
                    {{ pass: "正常", warning: "需注意", blocked: "需处理" }[check.status]}
                  </small>
                </strong>
                <p>{check.detail}</p>
                {check.action ? <p>{check.action}</p> : null}
              </article>
            ))}
          </div>
          <small>{report.privacy}</small>
        </>
      ) : null}
    </section>
  );
}
