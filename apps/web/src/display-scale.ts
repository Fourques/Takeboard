export type DisplayScale = number;
export const minDisplayPercent = 90;
export const maxDisplayPercent = 140;

export function resolveDisplayScale(value: string | null): DisplayScale {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0.9 && numericValue <= 1.4
    ? Math.round(numericValue * 100) / 100
    : 1.12;
}
