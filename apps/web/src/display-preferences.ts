import { resolveDisplayScale } from "./display-scale";

// Non-sensitive appearance enums only. Host cookies also survive a desktop port change.
export function readDisplayPreference(key: "display-scale" | "scene-quality") {
  try {
    const value = document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`takeboard_${key}=`))
      ?.split("=")[1];
    if (value) return value;
  } catch {
    /* Storage can be unavailable in an embedded browser. */
  }
  try {
    return localStorage.getItem(`takeboard.${key}`);
  } catch {
    return null;
  }
}
export const savedScale = () => resolveDisplayScale(readDisplayPreference("display-scale"));
export function savedSceneQuality(): "auto" | "full" | "lite" {
  const value = readDisplayPreference("scene-quality");
  return value === "full" || value === "lite" ? value : "auto";
}
export function rememberDisplayPreference(key: "display-scale" | "scene-quality", value: string) {
  try {
    localStorage.setItem(`takeboard.${key}`, value);
  } catch {
    /* Session still works. */
  }
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: Non-sensitive appearance enum, shared across local desktop ports.
    document.cookie = `takeboard_${key}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    /* localStorage is the fallback. */
  }
}
