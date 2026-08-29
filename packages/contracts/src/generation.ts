export type ResolutionPolicy = "exact" | "multiple_32" | "qwen_image_2512" | "minimax_h3";

export type ResolvedGenerationResolution = {
  requested: { width: number; height: number };
  effective: { width: number; height: number };
  changed: boolean;
  policy: ResolutionPolicy;
  reason: string | null;
};

function multipleOf32(width: number, height: number) {
  return {
    width: Math.max(32, Math.round(width / 32) * 32),
    height: Math.max(32, Math.round(height / 32) * 32),
  };
}

export function resolveGenerationResolution(
  policy: ResolutionPolicy,
  width: number,
  height: number,
): ResolvedGenerationResolution {
  const requested = { width: Math.round(width), height: Math.round(height) };
  let effective = requested;
  let reason: string | null = null;

  if (policy === "multiple_32") {
    effective = multipleOf32(requested.width, requested.height);
    reason = "该工作流以 32 像素为步进对齐宽高";
  } else if (policy === "qwen_image_2512") {
    const safeWidth = Math.max(512, requested.width);
    const safeHeight = Math.max(512, requested.height);
    const scale = Math.min(
      1,
      1664 / Math.max(safeWidth, safeHeight),
      Math.sqrt(1_800_000 / (safeWidth * safeHeight)),
    );
    effective = {
      width: Math.max(512, Math.round((safeWidth * scale) / 32) * 32),
      height: Math.max(512, Math.round((safeHeight * scale) / 32) * 32),
    };
    reason = "Qwen Image 会限制最长边与总像素，并以 32 像素对齐";
  } else if (policy === "minimax_h3") {
    const safeWidth = Math.max(256, requested.width);
    const safeHeight = Math.max(256, requested.height);
    const scale = Math.min(
      1,
      768 / Math.min(safeWidth, safeHeight),
      1344 / Math.max(safeWidth, safeHeight),
    );
    effective = {
      width: Math.max(256, Math.round((safeWidth * scale) / 32) * 32),
      height: Math.max(256, Math.round((safeHeight * scale) / 32) * 32),
    };
    reason = "MiniMax H3 会限制短边、长边并以 32 像素对齐";
  }

  const changed = effective.width !== requested.width || effective.height !== requested.height;
  return {
    requested,
    effective,
    changed,
    policy,
    reason: changed ? reason : null,
  };
}
