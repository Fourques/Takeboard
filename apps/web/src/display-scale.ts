export type DisplayScale = 0.9 | 1 | 1.12 | 1.24 | 1.4;

export const displayScales: Array<{ value: DisplayScale; label: string; hint: string }> = [
  { value: 0.9, label: "紧凑", hint: "适合高分辨率大屏" },
  { value: 1, label: "标准", hint: "显示更多画布空间" },
  { value: 1.12, label: "清晰", hint: "推荐的字体与控件大小" },
  { value: 1.24, label: "大字", hint: "低分辨率或远程桌面" },
  { value: 1.4, label: "特大", hint: "小屏或高缩放系统" },
];

export function resolveDisplayScale(value: string | null): DisplayScale {
  const numericValue = Number(value);
  return displayScales.some((item) => item.value === numericValue)
    ? (numericValue as DisplayScale)
    : 1.12;
}
