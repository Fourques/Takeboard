import {
  type ResolutionPolicy,
  resolveGenerationResolution,
} from "@takeboard/contracts/generation";

export function generationResolutionPolicy(native: boolean, family: string): ResolutionPolicy {
  if (!native) return "exact";
  if (family === "qwen_image") return "qwen_image_2512";
  if (family === "minimax_h3") return "minimax_h3";
  return "multiple_32";
}

const ratios = [
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["3:4", 3 / 4],
  ["4:5", 4 / 5],
  ["2.35:1", 2.35],
] as const;

/** Presets are concrete generation dimensions, not separate shot metadata. */
export function resolutionPresets(width: number, height: number, policy: ResolutionPolicy) {
  const area = Math.max(256 * 256, Math.min(2048 * 2048, width * height));
  return ratios.map(([label, ratio]) => {
    const scale = Math.min(1, 2048 / Math.max(Math.sqrt(area * ratio), Math.sqrt(area / ratio)));
    const size = resolveGenerationResolution(
      policy,
      Math.max(256, Math.round((Math.sqrt(area * ratio) * scale) / 32) * 32),
      Math.max(256, Math.round((Math.sqrt(area / ratio) * scale) / 32) * 32),
    ).effective;
    return { label, ...size };
  });
}

export function closestAspectRatio(width: number, height: number) {
  const nearest = [...ratios].sort(
    (a, b) => Math.abs(Math.log(width / height / a[1])) - Math.abs(Math.log(width / height / b[1])),
  )[0];
  return nearest && Math.abs(Math.log(width / height / nearest[1])) < 0.035 ? nearest[0] : "custom";
}
