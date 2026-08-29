import { useEffect, useRef, useState } from "react";
import { type DisplayScale, displayScales, resolveDisplayScale } from "./display-scale";

export { resolveDisplayScale } from "./display-scale";
export type SceneQuality = "auto" | "full" | "lite";

function savedScale(): DisplayScale {
  return resolveDisplayScale(window.localStorage.getItem("takeboard.display-scale"));
}

function savedSceneQuality(): SceneQuality {
  const value = window.localStorage.getItem("takeboard.scene-quality");
  return value === "full" || value === "lite" ? value : "auto";
}

export function DisplaySettings({ compact = false }: { compact?: boolean }) {
  const [scale, setScale] = useState<DisplayScale>(savedScale);
  const [sceneQuality, setSceneQuality] = useState<SceneQuality>(savedSceneQuality);
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
    window.localStorage.setItem("takeboard.scene-quality", sceneQuality);
    window.dispatchEvent(
      new CustomEvent<SceneQuality>("takeboard:scene-quality", { detail: sceneQuality }),
    );
  }, [sceneQuality]);

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
        title="调整界面文字大小"
        aria-label={`显示大小：${displayScales.find((item) => item.value === scale)?.label ?? "清晰"}`}
      >
        <span aria-hidden="true">Aa</span>
        {compact ? null : "显示"}
      </button>
      {open ? (
        <div className="display-settings-popover" role="dialog" aria-label="显示大小">
          <header>
            <strong>界面文字</strong>
            <small>只影响当前浏览器，不改变项目与生成分辨率</small>
          </header>
          <div className="display-setting-options">
            {displayScales.map((item) => (
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
          <section className="scene-quality-setting">
            <div>
              <strong>首页三维效果</strong>
              <small>不会影响项目画布与生成质量</small>
            </div>
            <div className="scene-quality-options">
              {(
                [
                  ["auto", "自动", "先显示轻量封面，空闲时预载"],
                  ["full", "完整", "打开首页即启用可旋转 3D"],
                  ["lite", "节能", "始终使用清晰静态封面"],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  type="button"
                  key={value}
                  className={sceneQuality === value ? "active" : ""}
                  onClick={() => setSceneQuality(value)}
                >
                  <span>{label}</span>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
          </section>
          <p>画布坐标与生成分辨率保持不变；窄屏时 TakeBoard 会自动收起两侧面板。</p>
        </div>
      ) : null}
    </div>
  );
}
