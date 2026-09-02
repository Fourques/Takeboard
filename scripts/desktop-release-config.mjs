export const DESKTOP_ICONS = [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.png",
  "icons/icon.icns",
  "icons/icon.ico",
];

export const WINDOWS_WIX_UPGRADE_CODE = "b893e5ab-af9b-5697-acbd-d12b7a4ab163";

const channelOffsets = { alpha: 0, beta: 20_000, rc: 40_000 };

export function windowsInstallerVersion(applicationVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(applicationVersion);
  if (!match) {
    throw new Error(
      `桌面版本 ${applicationVersion} 不符合 major.minor.patch[-alpha|beta|rc.number]`,
    );
  }
  const [, majorText, minorText, patchText, channel, sequenceText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (major > 255 || minor > 255 || patch > 65_535) {
    throw new Error(`桌面版本 ${applicationVersion} 超出 MSI ProductVersion 数值范围`);
  }
  let build = 65_535;
  if (channel) {
    const sequence = Number(sequenceText);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 19_999) {
      throw new Error(`${channel} 序号必须在 1–19999 之间`);
    }
    build = channelOffsets[channel] + sequence;
  }
  return `${major}.${minor}.${patch}.${build}`;
}

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
  const expectedWixVersion = windowsInstallerVersion(applicationVersion);
  if (config?.bundle?.windows?.wix?.version !== expectedWixVersion) {
    throw new Error(
      `WiX 版本应为 ${expectedWixVersion}，当前为 ${String(config?.bundle?.windows?.wix?.version)}`,
    );
  }
  if (config?.bundle?.windows?.wix?.upgradeCode !== WINDOWS_WIX_UPGRADE_CODE) {
    throw new Error("WiX upgradeCode 不可变化，否则 Windows 升级会安装出重复应用");
  }
  return { icons: DESKTOP_ICONS, wixVersion: expectedWixVersion };
}
