export type TakeBoardTheme = "noir" | "light" | "chroma";

export const themeStorageKey = "takeboard.theme";
export const themeCookieName = "takeboard_theme";
export const defaultTheme: TakeBoardTheme = "chroma";
const themeChangeEvent = "takeboard:theme";
let sessionTheme: TakeBoardTheme | null = null;

export function parseTheme(value: string | null | undefined): TakeBoardTheme | null {
  return value === "noir" || value === "light" || value === "chroma" ? value : null;
}

export function themeFromCookie(cookie: string): TakeBoardTheme | null {
  const value = cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${themeCookieName}=`))
    ?.slice(themeCookieName.length + 1);
  return parseTheme(value);
}

export function readThemePreference(): TakeBoardTheme {
  if (sessionTheme) return sessionTheme;
  // Desktop service ports may change on restart. Host-only cookies survive that
  // change, unlike origin-scoped localStorage. This contains only a theme enum,
  // never identity, authentication or project data.
  try {
    const cookieTheme = themeFromCookie(document.cookie);
    if (cookieTheme) return cookieTheme;
  } catch {
    // Sandboxed/blocked storage must not prevent the app from opening.
  }
  try {
    return parseTheme(window.localStorage.getItem(themeStorageKey)) ?? defaultTheme;
  } catch {
    return parseTheme(document.documentElement.dataset.theme) ?? defaultTheme;
  }
}

export function rememberTheme(theme: TakeBoardTheme) {
  sessionTheme = theme;
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // The current session can still change appearance when storage is unavailable.
  }
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: Synchronous first paint and WKWebView compatibility; non-sensitive enum only.
    document.cookie = `${themeCookieName}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {
    // localStorage is the fallback when cookies are blocked.
  }
  window.dispatchEvent(new Event(themeChangeEvent));
}

export function subscribeToTheme(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === themeStorageKey || event.key === null) {
      sessionTheme = null;
      listener();
    }
  };
  window.addEventListener(themeChangeEvent, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(themeChangeEvent, listener);
    window.removeEventListener("storage", onStorage);
  };
}
