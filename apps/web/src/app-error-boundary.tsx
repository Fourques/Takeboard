import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = { children: ReactNode };
type AppErrorBoundaryState = {
  error: Error | null;
  componentStack: string | null;
  incidentId: string | null;
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

function downloadCrashReport(state: AppErrorBoundaryState) {
  if (!state.error) return;
  const report = {
    format: "takeboard.client-crash-report",
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    incidentId: state.incidentId,
    error: {
      name: state.error.name,
      message: state.error.message,
      stack: state.error.stack ?? null,
      componentStack: state.componentStack,
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
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `takeboard-crash-${state.incidentId ?? Date.now()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, componentStack: null, incidentId: null };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error, incidentId: createIncidentId() };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
  }

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
            <button type="button" onClick={() => downloadCrashReport(this.state)}>
              下载异常报告
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              重新加载页面
            </button>
            <button type="button" onClick={() => window.location.assign("/")}>
              返回项目主页
            </button>
          </div>
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
