import { useEffect, useRef, useState } from "react";

type DisplayScale = 0.9 | 1 | 1.12 | 1.24 | 1.4;

const scales: Array<{ value: DisplayScale; label: string; hint: string }> = [
  { value: 0.9, label: "紧凑", hint: "适合高分辨率大屏" },
  { value: 1, label: "标准", hint: "默认显示大小" },
  { value: 1.12, label: "清晰", hint: "字体与控件放大 12%" },
  { value: 1.24, label: "大字", hint: "低分辨率或远程桌面" },
  { value: 1.4, label: "特大", hint: "小屏或高缩放系统" },
];

function savedScale(): DisplayScale {
  const value = Number(window.localStorage.getItem("takeboard.display-scale"));
  return scales.some((item) => item.value === value) ? (value as DisplayScale) : 1;
}

export function DisplaySettings({ compact = false }: { compact?: boolean }) {
  const [scale, setScale] = useState<DisplayScale>(savedScale);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(scale));
    document.documentElement.style.setProperty("--ui-scale-inverse", String(1 / scale));
    document.documentElement.dataset.displayScale = String(scale).replace(".", "-");
    window.localStorage.setItem("takeboard.display-scale", String(scale));
    window.dispatchEvent(new CustomEvent("takeboard:display-scale", { detail: scale }));
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }, [scale]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className={`display-settings ${compact ? "compact" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={open ? "active" : ""}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        title="调整字体与控件大小"
      >
        <span aria-hidden="true">Aa</span>
        {compact ? null : "显示"}
      </button>
      {open ? (
        <div className="display-settings-popover" role="dialog" aria-label="显示大小">
          <header>
            <strong>字体与控件</strong>
            <small>只影响当前浏览器，不改变项目与生成分辨率</small>
          </header>
          <div>
            {scales.map((item) => (
              <button
                type="button"
                key={item.value}
                className={scale === item.value ? "active" : ""}
                onClick={() => {
                  setScale(item.value);
                  setOpen(false);
                }}
              >
                <span style={{ fontSize: `${Math.round(12 * item.value)}px` }}>Aa</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </div>
                <i>{Math.round(item.value * 100)}%</i>
              </button>
            ))}
          </div>
          <p>浏览器自身缩放仍可使用；TakeBoard 会根据剩余空间自动收起两侧面板。</p>
        </div>
      ) : null}
    </div>
  );
}
