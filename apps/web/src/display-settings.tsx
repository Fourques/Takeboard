import { useEffect, useState } from "react";
import { rememberDisplayPreference, savedScale, savedSceneQuality } from "./display-preferences";
import {
  type DisplayScale,
  maxDisplayPercent,
  minDisplayPercent,
  resolveDisplayScale,
} from "./display-scale";

import { openSettings } from "./settings-navigation";

export { resolveDisplayScale } from "./display-scale";
export type SceneQuality = "auto" | "full" | "lite";

export function DisplaySettings({
  compact = false,
  inline = false,
}: {
  compact?: boolean;
  inline?: boolean;
}) {
  const [scale, setScale] = useState<DisplayScale>(savedScale);
  const [sceneQuality, setSceneQuality] = useState<SceneQuality>(savedSceneQuality);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(scale));
    document.documentElement.style.setProperty("--ui-scale-inverse", String(1 / scale));
    document.documentElement.dataset.displayScale = String(scale).replace(".", "-");
    rememberDisplayPreference("display-scale", String(scale));
    window.dispatchEvent(new CustomEvent("takeboard:display-scale", { detail: scale }));
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }, [scale]);

  useEffect(() => {
    rememberDisplayPreference("scene-quality", sceneQuality);
    window.dispatchEvent(
      new CustomEvent<SceneQuality>("takeboard:scene-quality", { detail: sceneQuality }),
    );
  }, [sceneQuality]);

  useEffect(() => {
    const size = (event: Event) =>
      setScale(resolveDisplayScale(String((event as CustomEvent<DisplayScale>).detail)));
    const quality = (event: Event) => setSceneQuality((event as CustomEvent<SceneQuality>).detail);
    window.addEventListener("takeboard:display-scale", size);
    window.addEventListener("takeboard:scene-quality", quality);
    return () => {
      window.removeEventListener("takeboard:display-scale", size);
      window.removeEventListener("takeboard:scene-quality", quality);
    };
  }, []);

  return (
    <div className={`display-settings ${compact ? "compact" : ""}`}>
      {!inline ? (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => openSettings("appearance")}
          title="调整界面文字大小"
          aria-label={`显示大小：${Math.round(scale * 100)}%`}
        >
          <span aria-hidden="true">Aa</span>
          {compact ? null : "字体大小"}
        </button>
      ) : null}
      {inline ? (
        <section className="display-settings-content" aria-label="显示大小">
          <header>
            <strong>界面文字</strong>
            <small>仅调整界面，不改变素材分辨率</small>
          </header>
          <div className="display-scale-control">
            <button
              type="button"
              aria-label="缩小字体"
              disabled={scale <= minDisplayPercent / 100}
              onClick={() =>
                setScale(Math.max(minDisplayPercent, Math.round(scale * 100) - 1) / 100)
              }
            >
              −
            </button>
            <input
              type="range"
              aria-label="字体大小"
              aria-valuetext={`${Math.round(scale * 100)}%`}
              min={minDisplayPercent}
              max={maxDisplayPercent}
              step={1}
              value={Math.round(scale * 100)}
              onChange={(event) => setScale(Number(event.target.value) / 100)}
            />
            <button
              type="button"
              aria-label="放大字体"
              disabled={scale >= maxDisplayPercent / 100}
              onClick={() =>
                setScale(Math.min(maxDisplayPercent, Math.round(scale * 100) + 1) / 100)
              }
            >
              +
            </button>
            <output aria-label="当前字体大小">{Math.round(scale * 100)}%</output>
          </div>
          <section className="scene-quality-setting">
            <div>
              <strong>首页三维效果</strong>
              <small>不会影响项目画布与生成质量</small>
            </div>
            <div className="scene-quality-options">
              {(
                [
                  ["auto", "自动", "直接显示三维场景，并平衡设备负载"],
                  ["full", "完整", "使用更完整的三维细节"],
                  ["lite", "节能", "始终使用清晰静态封面"],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  type="button"
                  key={value}
                  className={sceneQuality === value ? "active" : ""}
                  aria-pressed={sceneQuality === value}
                  onClick={() => setSceneQuality(value)}
                >
                  <span>{label}</span>
                  <small>{hint}</small>
                </button>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </div>
  );
}
