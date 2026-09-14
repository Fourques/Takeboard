import type { ReactNode } from "react";

export function LayerBackdrop({
  children,
  className = "",
  onClose,
  locked = false,
}: {
  children: ReactNode;
  className?: string;
  onClose: () => void;
  locked?: boolean;
}) {
  return (
    <div className={`studio-backdrop ${className}`}>
      <button
        className="layer-dismiss"
        type="button"
        tabIndex={-1}
        aria-label="关闭当前面板"
        disabled={locked}
        onClick={onClose}
      />
      {children}
    </div>
  );
}
