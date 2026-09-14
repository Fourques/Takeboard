import type { ReactNode } from "react";
import { requestDesktopAction } from "./desktop-actions";

/** Web links remain ordinary links; native windows explicitly hand off to the OS browser. */
export function ExternalLink({
  href,
  children,
  onError,
}: {
  href: string;
  children: ReactNode;
  onError: (message: string) => void;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (!(window as unknown as { __takeboardNativeActions?: number }).__takeboardNativeActions)
          return;
        event.preventDefault();
        void requestDesktopAction("open-external", { url: href }).catch((cause: unknown) =>
          onError(cause instanceof Error ? cause.message : "无法打开浏览器，请检查设备连接。"),
        );
      }}
    >
      {children}
    </a>
  );
}
