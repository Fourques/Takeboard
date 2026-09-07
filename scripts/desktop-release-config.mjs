export const DESKTOP_ICONS = [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.png",
  "icons/icon.icns",
  "icons/icon.ico",
];

export function validateDesktopReleaseConfig(applicationVersion, config) {
  if (config?.version !== applicationVersion) {
    throw new Error(
      `桌面应用版本 ${String(config?.version)} 与项目版本 ${applicationVersion} 不一致`,
    );
  }
  const configuredIcons = new Set(config?.bundle?.icon ?? []);
  const missingIcons = DESKTOP_ICONS.filter((icon) => !configuredIcons.has(icon));
  if (missingIcons.length > 0) {
    throw new Error(`桌面安装器缺少图标声明：${missingIcons.join(", ")}`);
  }
  if (config?.bundle?.resources?.["resources/TakeBoard/"] !== "TakeBoard/") {
    throw new Error("桌面运行资源必须映射到 TakeBoard/，与原生启动器的资源路径一致");
  }
  return { icons: DESKTOP_ICONS };
}
