import { type ReactNode, useState } from "react";

export type DesktopAction = "connections" | "updates" | "choose-folder" | "reveal-folder";
export function desktopActionUrl(
  action: DesktopAction,
  parameters: Record<string, string>,
  modern: boolean,
) {
  return `${modern ? `https://takeboard-desktop.invalid/${action}` : `takeboard-desktop://${action}`}?${new URLSearchParams(parameters)}`;
}

/** Acknowledged navigation bridge; no remote-page filesystem IPC privileges. */
export function requestDesktopAction(
  action: DesktopAction,
  parameters: Record<string, string> = {},
) {
  return new Promise<void>((resolve, reject) => {
    const actionId = crypto.randomUUID();
    const modern =
      (window as unknown as { __takeboardNativeActions?: number }).__takeboardNativeActions === 2;
    const done = (error?: string) => {
      window.clearTimeout(timer);
      window.removeEventListener("takeboard:desktop-action", receive);
      if (error) reject(new Error(error));
      else resolve();
    };
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ actionId: string; error?: string }>).detail;
      if (detail?.actionId === actionId) done(detail.error);
    };
    const timer = window.setTimeout(
      () => done("桌面应用未响应。请从应用菜单打开对应功能，或更新 TakeBoard 安装包后重试。"),
      5000,
    );
    window.addEventListener("takeboard:desktop-action", receive);
    window.location.href = desktopActionUrl(action, { ...parameters, actionId }, modern);
  });
}

export function DesktopActionButton({
  action,
  parameters,
  children,
}: {
  action: DesktopAction;
  parameters?: Record<string, string>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void requestDesktopAction(action, parameters)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "无法打开桌面功能"),
            )
            .finally(() => setBusy(false));
        }}
      >
        {children}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
