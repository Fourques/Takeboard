import type { Asset, Run, Take } from "@takeboard/contracts";
import type { GenerationSettings } from "./generation-model";

/** Restore recorded controls only. Connections and generation remain explicit user actions. */
export function recordedSettings(run: Run, fallback: GenerationSettings): GenerationSettings {
  const p = run.parameters;
  const number = (key: string, value: number) =>
    typeof p[key] === "number" && Number.isFinite(p[key]) ? (p[key] as number) : value;
  const text = (key: string, value: string) =>
    typeof p[key] === "string" ? (p[key] as string) : value;
  return {
    ...fallback,
    recipePath: text("recipePath", fallback.recipePath),
    prompt: text("promptSource", text("prompt", fallback.prompt)),
    negativePrompt: text("negativePrompt", ""),
    width: number("width", fallback.width),
    height: number("height", fallback.height),
    durationSeconds: number("durationSeconds", fallback.durationSeconds),
    fps: number("fps", fallback.fps),
    seed: number("seed", fallback.seed),
    steps: number("steps", fallback.steps),
    denoise: number("denoise", fallback.denoise),
    referenceImageSize: p.referenceImageSize === "max" ? "max" : "match",
    referenceVideoAudio:
      typeof p.referenceVideoAudio === "boolean"
        ? p.referenceVideoAudio
        : fallback.referenceVideoAudio,
    executionPolicy: run.execution?.policy ?? fallback.executionPolicy,
  };
}

export function comparableResults(takes: Take[], assets: Asset[], selectedId: string) {
  const selected = takes.find((take) => take.id === selectedId);
  const kind = assets.find((asset) => asset.id === selected?.assetId)?.mediaType;
  if (!kind || selected?.status === "media_missing") return [];
  return takes.filter(
    (take) =>
      take.id !== selectedId &&
      take.status !== "media_missing" &&
      assets.some((asset) => asset.id === take.assetId && asset.mediaType === kind),
  );
}
