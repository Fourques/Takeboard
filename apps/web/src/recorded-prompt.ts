import type { Asset, Run } from "@takeboard/contracts";

export function recordedInputLabel(slot: string, outputType?: Asset["mediaType"]) {
  if (slot === "first_frame" || slot === "start_image")
    return outputType === "image" ? "源图" : "首帧";
  if (slot === "last_frame" || slot === "last_image") return "尾帧";
  if (slot === "reference") return "参考图";
  const match = /^reference_(image|video|audio)(?:_(\d+))?$/.exec(slot);
  if (!match) return slot;
  const label = match[1] === "image" ? "参考图" : match[1] === "video" ? "参考视频" : "参考音频";
  return `${label}${match[2] === undefined ? "" : ` ${Number(match[2]) + 1}`}`;
}

export function recordedInputAsset(input: Run["inputs"][number], assets: Asset[]) {
  const exact = assets.find((asset) => asset.id === input.refId);
  if (exact) return exact;
  const matches = input.assetSha256
    ? assets.filter((asset) => asset.sha256 === input.assetSha256)
    : [];
  return matches.length === 1 ? matches[0] : undefined;
}

export function recordedPromptParts(run: Run, assets: Asset[]) {
  const source = String(run.parameters.promptSource ?? run.parameters.prompt ?? "未记录");
  const compiled = String(run.parameters.prompt ?? "");
  const pattern = /@([^\s@，。；：、,.!?！？<>()[\]{}“”‘’「」]+)/g;
  const mentions = [...source.matchAll(pattern)];
  const tokens = [...compiled.matchAll(/<(Picture|Video|Audio) (\d+)>/g)];
  let tokenIndex = 0;
  const aligned =
    mentions.length === tokens.length &&
    source.replace(pattern, () => tokens[tokenIndex++]?.[0] ?? "") === compiled;
  const parts: { text: string; offset: number; assetId?: string }[] = [];
  let cursor = 0;
  for (const [index, match] of mentions.entries()) {
    if (match.index > cursor)
      parts.push({ text: source.slice(cursor, match.index), offset: cursor });
    let asset: Asset | undefined;
    if (aligned) {
      const token = tokens[index];
      const slot =
        token?.[1] === "Picture"
          ? "reference_image"
          : token?.[1] === "Video"
            ? "reference_video"
            : "reference_audio";
      const mediaIndex = Number(token?.[2]) - 1;
      const videoInputs = run.inputs.filter((input) => input.slot.startsWith("reference_video_"));
      const audioOffset = run.parameters.referenceVideoAudio === true ? videoInputs.length : 0;
      const input =
        token &&
        (token[1] === "Audio" && mediaIndex < audioOffset
          ? run.inputs.find((input) => input.slot === `reference_video_${mediaIndex}`)
          : run.inputs.find(
              (input) =>
                input.slot ===
                `${slot}_${token[1] === "Audio" ? mediaIndex - audioOffset : mediaIndex}`,
            ));
      if (input) asset = recordedInputAsset(input, assets);
    } else {
      const matches = run.inputs
        .map((input) => recordedInputAsset(input, assets))
        .filter(
          (asset) =>
            asset &&
            asset.originalName
              .replace(/\.[^.]+$/, "")
              .trim()
              .replace(/[\s@，。；：、,.!?！？<>()[\]{}“”‘’「」]+/g, "_")
              .slice(0, 32) === match[1],
        );
      const ids = new Set(matches.map((asset) => asset?.id));
      if (ids.size === 1) asset = matches[0];
    }
    parts.push({ text: match[0], offset: match.index, ...(asset ? { assetId: asset.id } : {}) });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), offset: cursor });
  return parts;
}
