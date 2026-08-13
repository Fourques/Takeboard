import { useEffect, useState } from "react";

export type TakeBoardTheme = "noir" | "light" | "chroma";

const themes: Array<{ id: TakeBoardTheme; label: string; color: string }> = [
  { id: "noir", label: "黑曜", color: "#111714" },
  { id: "light", label: "明亮", color: "#ebe7de" },
  { id: "chroma", label: "彩色", color: "#6754d9" },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<TakeBoardTheme>(() => {
    const saved = window.localStorage.getItem("takeboard.theme");
    return saved === "light" || saved === "chroma" ? saved : "noir";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("takeboard.theme", theme);
  }, [theme]);

  return (
    <fieldset className={`theme-switcher ${compact ? "compact" : ""}`}>
      <legend className="visually-hidden">界面主题</legend>
      {themes.map((item) => (
        <button
          type="button"
          key={item.id}
          className={theme === item.id ? "active" : ""}
          onClick={() => setTheme(item.id)}
          title={`${item.label}主题`}
          aria-label={`${item.label}主题`}
        >
          <i style={{ background: item.color }} />
          {compact ? null : <span>{item.label}</span>}
        </button>
      ))}
    </fieldset>
  );
}
