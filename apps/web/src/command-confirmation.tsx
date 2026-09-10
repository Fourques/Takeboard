import type { ProjectCommandPreview } from "@takeboard/contracts";
import { useEffect, useRef } from "react";

export function CommandConfirmation({
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  preview: ProjectCommandPreview;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="shot-delete-modal command-confirmation"
      aria-labelledby="connection-confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="connection-confirm-title">替换已有输入？</h2>
      <p>{preview.summary}</p>
      <div className="shot-delete-preview">
        <ul>
          {preview.effects.map((effect) => (
            <li key={`${effect.action}:${effect.entityId ?? effect.label}`}>
              {effect.label}
              {effect.detail ? <small>{effect.detail}</small> : null}
            </li>
          ))}
        </ul>
        {preview.warnings.map((warning) => (
          <small key={warning}>{warning}</small>
        ))}
        {preview.undoable ? <small>确认后可在操作记录中撤销。</small> : null}
      </div>
      <div className="shot-delete-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          保留原输入
        </button>
        <button type="button" disabled={busy} onClick={onConfirm}>
          {busy ? "正在连接…" : "替换并连接"}
        </button>
      </div>
    </dialog>
  );
}
