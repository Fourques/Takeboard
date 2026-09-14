import { type RecoveryAction, recoveryGuidance } from "./recovery-guidance";

export function RecoveryNotice({
  message,
  code,
  onAction,
  onDismiss,
  onRetry,
}: {
  message: string;
  code?: string | undefined;
  onAction: (action: RecoveryAction) => void;
  onDismiss?: () => void;
  onRetry?: (() => void) | undefined;
}) {
  const guidance = recoveryGuidance(message, code);
  return (
    <section
      className={`recovery-notice ${onDismiss ? "recovery-toast" : ""}`}
      aria-label="操作提示"
    >
      <div role="alert">
        <strong>{guidance.title}</strong>
        <p>{guidance.next}</p>
      </div>
      <div className="settings-actions">
        <button type="button" onClick={() => onAction(guidance.action)}>
          {guidance.label}
        </button>
        {onRetry ? (
          <button type="button" onClick={onRetry}>
            同参数重试
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" onClick={onDismiss}>
            关闭
          </button>
        ) : null}
      </div>
      {code || guidance.next !== message ? (
        <details>
          <summary>技术详情</summary>
          <pre>
            {code ? `${code}\n` : ""}
            {message}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
