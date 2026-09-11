export type SettingsSection = "appearance" | "storage" | "connections" | "diagnostics" | "about";
export function openSettings(section: SettingsSection = "appearance") {
  window.dispatchEvent(new CustomEvent("takeboard:open-settings", { detail: section }));
}
