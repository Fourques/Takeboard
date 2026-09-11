import { Component, type ErrorInfo, type ReactNode } from "react";
import { requestDesktopAction } from "./desktop-actions";

type AppErrorBoundaryProps = { children: ReactNode };
type AppErrorBoundaryState = {
  error: Error | null;
  componentStack: string | null;
  incidentId: string | null;
  reportStatus: string;
  savingReport: boolean;
  reportText: string | null;
};

const recoveryCss = `.fatal-error-shell{display:grid;min-width:0;min-height:100dvh;padding:clamp(22px,6vw,80px);place-items:center;color:var(--text-1);background:radial-gradient(circle at 18% 18%,var(--hero-a),transparent 34%),radial-gradient(circle at 82% 78%,var(--hero-b),transparent 32%),var(--surface-root)}.fatal-error-shell>section{width:min(680px,100%);padding:clamp(24px,4vw,48px);border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--surface-1) 94%,transparent);box-shadow:0 32px 100px rgb(0 0 0/36%)}.fatal-error-shell>section>span{color:var(--accent-strong);font-size:calc(10px * var(--ui-scale));font-weight:800;letter-spacing:.16em}.fatal-error-shell h1{max-width:16em;margin:12px 0;font-size:clamp(26px,calc(34px * var(--ui-scale)),46px);font-weight:560;letter-spacing:-.04em}.fatal-error-shell p{max-width:54em;color:var(--text-2);font-size:calc(13px * var(--ui-scale));line-height:1.7}.fatal-error-actions{display:flex;flex-wrap:wrap;margin-top:22px;gap:9px}.fatal-error-actions button{min-height:40px;padding:0 14px;border:1px solid var(--line);border-radius:8px;color:var(--text-1);background:var(--surface-2);cursor:pointer;font-size:calc(12px * var(--ui-scale))}.fatal-error-actions button:first-child{border-color:var(--accent);color:var(--surface-root);background:var(--accent-strong);font-weight:700}.fatal-error-shell details{margin-top:22px;color:var(--text-2);font-size:calc(11px * var(--ui-scale))}.fatal-error-shell details :is(code,small){display:block;margin-top:8px;overflow-wrap:anywhere}`;

function createIncidentId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {
    // A non-secure browser context may expose crypto without randomUUID.
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function crashReportText(
  state: Pick<AppErrorBoundaryState, "error" | "componentStack" | "incidentId">,
) {
  if (!state.error) return "";
  const report = {
    format: "takeboard.client-crash-report",
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    incidentId: state.incidentId,
    error: {
      name: state.error.name,
      message: state.error.message.slice(0, 4000),
      stack: state.error.stack?.slice(0, 8000) ?? null,
      componentStack: state.componentStack?.slice(0, 8000) ?? null,
    },
    client: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      online: navigator.onLine,
    },
    privacy:
      "此报告由浏览器异常信息生成，不主动包含项目、素材、提示词、Cookie、Token 或 localStorage 内容。发送前请自行检查。",
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

async function downloadCrashReport(state: AppErrorBoundaryState, text: string) {
  if (!text) throw new Error("没有可保存的报告");
  if ((window as unknown as { __takeboardReportSave?: boolean }).__takeboardReportSave) {
    await requestDesktopAction("save-report", { report: text }, 120_000);
    return "诊断报告已保存";
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `takeboard-crash-${state.incidentId ?? Date.now()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return "已请求下载。若没有出现文件，请使用“复制报告”或下方文本保存。";
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
    incidentId: null,
    reportStatus: "",
    savingReport: false,
    reportText: null,
  };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error, incidentId: createIncidentId() };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
  }

  saveReport = async () => {
    const text = crashReportText(this.state);
    this.setState({
      savingReport: true,
      reportText: text,
      reportStatus: "",
    });
    try {
      const reportStatus = await downloadCrashReport(this.state, text);
      this.setState({ reportStatus });
    } catch (cause) {
      this.setState({
        reportStatus: cause instanceof Error ? cause.message : "保存失败，请复制下方报告文本。",
      });
    } finally {
      this.setState({ savingReport: false });
    }
  };

  copyReport = async () => {
    const reportText = crashReportText(this.state);
    this.setState({ reportText });
    try {
      await navigator.clipboard.writeText(reportText);
      this.setState({ reportStatus: "报告已复制。发送前请检查是否包含敏感信息。" });
    } catch {
      this.setState({ reportStatus: "无法自动复制，请选中下方文本后复制。" });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error-shell" role="alert" aria-labelledby="fatal-error-title">
        <style>{recoveryCss}</style>
        <section>
          <span>RECOVERY MODE</span>
          <h1 id="fatal-error-title">页面遇到异常。先保留现场，再重新进入。</h1>
          <p>
            已经保存的项目内容仍在服务端。当前页面里尚未提交的文字可能没有保存，请先下载诊断报告，再重新加载。
          </p>
          <div className="fatal-error-actions">
            <button
              type="button"
              disabled={this.state.savingReport}
              onClick={() => void this.saveReport()}
            >
              {this.state.savingReport ? "等待保存…" : "下载异常报告"}
            </button>
            <button type="button" onClick={() => void this.copyReport()}>
              复制报告
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              重新加载页面
            </button>
            <button type="button" onClick={() => window.location.assign("/")}>
              返回项目主页
            </button>
          </div>
          {this.state.reportStatus ? <p role="status">{this.state.reportStatus}</p> : null}
          {this.state.reportText ? (
            <textarea
              aria-label="异常报告文本"
              readOnly
              value={this.state.reportText}
              onFocus={(event) => event.currentTarget.select()}
              style={{
                width: "100%",
                minHeight: 140,
                marginTop: 16,
                resize: "vertical",
                color: "var(--text-1)",
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: 12,
              }}
            />
          ) : null}
          <details>
            <summary>查看错误摘要</summary>
            <code>{this.state.error.message || this.state.error.name}</code>
            <small>事件编号：{this.state.incidentId}</small>
          </details>
        </section>
      </main>
    );
  }
}
