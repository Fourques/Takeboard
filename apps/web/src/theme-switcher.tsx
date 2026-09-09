import { useEffect, useSyncExternalStore } from "react";
import {
  defaultTheme,
  readThemePreference,
  rememberTheme,
  subscribeToTheme,
  type TakeBoardTheme,
} from "./theme-preferences";

export type { TakeBoardTheme } from "./theme-preferences";

const themes: Array<{ id: TakeBoardTheme; label: string; color: string }> = [
  { id: "noir", label: "黑曜", color: "#111714" },
  { id: "light", label: "明亮", color: "#ebe7de" },
  { id: "chroma", label: "柔彩", color: "#8275d7" },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribeToTheme, readThemePreference, () => defaultTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <fieldset className={`theme-switcher ${compact ? "compact" : ""}`}>
      <legend className="visually-hidden">界面主题</legend>
      {themes.map((item) => (
        <button
          type="button"
          key={item.id}
          className={theme === item.id ? "active" : ""}
          onClick={() => rememberTheme(item.id)}
          title={`${item.label}主题`}
          aria-label={`${item.label}主题`}
          aria-pressed={theme === item.id}
        >
          <i style={{ background: item.color }} />
          {compact ? null : <span>{item.label}</span>}
        </button>
      ))}
    </fieldset>
  );
}
