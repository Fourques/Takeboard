import { unlink } from "node:fs/promises";
import sharp from "sharp";

export type ImageInfo = {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
};

export type VideoInfo = {
  mimeType: "video/mp4" | "video/quicktime" | "video/webm";
  width: number;
  height: number;
  durationSeconds: number | null;
  frameRate: number | null;
};

type Mp4Box = { type: string; start: number; payloadStart: number; end: number };

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.slice(start, start + length));

function mp4Boxes(bytes: Uint8Array, start: number, end: number) {
  const boxes: Mp4Box[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      const largeSize = view.getBigUint64(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, start: offset, payloadStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

function childBox(bytes: Uint8Array, parent: Mp4Box, type: string) {
  return mp4Boxes(bytes, parent.payloadStart, parent.end).find((box) => box.type === type) ?? null;
}

function mp4Duration(bytes: Uint8Array, box: Mp4Box) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[box.payloadStart] ?? 0;
  const timescaleOffset = box.payloadStart + (version === 1 ? 20 : 12);
  const durationOffset = timescaleOffset + 4;
  if (durationOffset + (version === 1 ? 8 : 4) > box.end) return null;
  const timescale = view.getUint32(timescaleOffset);
  const duration =
    version === 1 ? Number(view.getBigUint64(durationOffset)) : view.getUint32(durationOffset);
  return timescale > 0 && duration > 0 ? duration / timescale : null;
}

function mp4FrameRate(bytes: Uint8Array, trak: Mp4Box) {
  const mdia = childBox(bytes, trak, "mdia");
  const mdhd = mdia ? childBox(bytes, mdia, "mdhd") : null;
  const minf = mdia ? childBox(bytes, mdia, "minf") : null;
  const stbl = minf ? childBox(bytes, minf, "stbl") : null;
  const stts = stbl ? childBox(bytes, stbl, "stts") : null;
  if (!mdhd || !stts) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[mdhd.payloadStart] ?? 0;
  const timescaleOffset = mdhd.payloadStart + (version === 1 ? 20 : 12);
  if (timescaleOffset + 4 > mdhd.end || stts.payloadStart + 8 > stts.end) return null;
  const timescale = view.getUint32(timescaleOffset);
  const count = Math.min(view.getUint32(stts.payloadStart + 4), 100_000);
  let samples = 0;
  let ticks = 0;
  let offset = stts.payloadStart + 8;
  for (let index = 0; index < count && offset + 8 <= stts.end; index += 1, offset += 8) {
    const sampleCount = view.getUint32(offset);
    const sampleDelta = view.getUint32(offset + 4);
    samples += sampleCount;
    ticks += sampleCount * sampleDelta;
  }
  const rate = timescale > 0 && ticks > 0 ? (samples * timescale) / ticks : null;
  return rate && Number.isFinite(rate) && rate > 0 && rate <= 240 ? rate : null;
}

function mp4Info(bytes: Uint8Array, declaredMimeType: string): VideoInfo | null {
  if (bytes.length < 24 || ascii(bytes, 4, 4) !== "ftyp") return null;
  const top = mp4Boxes(bytes, 0, bytes.length);
  const moov = top.find((box) => box.type === "moov");
  if (!moov) return null;
  const movieDuration = childBox(bytes, moov, "mvhd");
  const tracks = mp4Boxes(bytes, moov.payloadStart, moov.end).filter((box) => box.type === "trak");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const track of tracks) {
    const tkhd = childBox(bytes, track, "tkhd");
    const mdia = childBox(bytes, track, "mdia");
    const hdlr = mdia ? childBox(bytes, mdia, "hdlr") : null;
    if (!tkhd || !hdlr || hdlr.payloadStart + 12 > hdlr.end) continue;
    if (ascii(bytes, hdlr.payloadStart + 8, 4) !== "vide") continue;
    if (tkhd.end - tkhd.payloadStart < 8) continue;
    let width = Math.round(view.getUint32(tkhd.end - 8) / 65_536);
    let height = Math.round(view.getUint32(tkhd.end - 4) / 65_536);
    // tkhd stores the presentation transform immediately before width/height. Portrait
    // recordings commonly keep landscape encoded dimensions and rotate them here.
    if (tkhd.end - tkhd.payloadStart >= 44) {
      const matrixOffset = tkhd.end - 44;
      const a = view.getInt32(matrixOffset);
      const b = view.getInt32(matrixOffset + 4);
      const c = view.getInt32(matrixOffset + 12);
      const d = view.getInt32(matrixOffset + 16);
      if (a === 0 && d === 0 && Math.abs(b) === 65_536 && Math.abs(c) === 65_536) {
        [width, height] = [height, width];
      }
    }
    if (width < 1 || height < 1 || width > 32_768 || height > 32_768) continue;
    return {
      mimeType: declaredMimeType === "video/quicktime" ? "video/quicktime" : "video/mp4",
      width,
      height,
      durationSeconds: movieDuration ? mp4Duration(bytes, movieDuration) : null,
      frameRate: mp4FrameRate(bytes, track),
    };
  }
  return null;
}

function ebmlVarInt(bytes: Uint8Array, offset: number, keepMarker: boolean) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let marker = 0x80;
  while (length <= 8 && (first & marker) === 0) {
    length += 1;
    marker >>= 1;
  }
  if (length > 8 || offset + length > bytes.length) return null;
  let value = BigInt(keepMarker ? first : first & (marker - 1));
  for (let index = 1; index < length; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const maximumValue = (1n << BigInt(7 * length)) - 1n;
  return { length, value: Number(value), unknown: !keepMarker && value === maximumValue };
}

type EbmlElement = { id: number; payloadStart: number; end: number };

function ebmlElements(bytes: Uint8Array, start: number, end: number) {
  const elements: EbmlElement[] = [];
  let offset = start;
  while (offset < end) {
    const id = ebmlVarInt(bytes, offset, true);
    if (!id) break;
    const size = ebmlVarInt(bytes, offset + id.length, false);
    if (!size) break;
    const payloadStart = offset + id.length + size.length;
    // WebM normally encodes Segment with an unknown length (all size bits set). In
    // an uploaded, finite file that means "through EOF", not an invalid element.
    const elementEnd = size.unknown ? end : payloadStart + size.value;
    if (elementEnd > end || elementEnd < payloadStart) break;
    elements.push({ id: id.value, payloadStart, end: elementEnd });
    offset = elementEnd;
  }
  return elements;
}

function ebmlUnsigned(bytes: Uint8Array, element: EbmlElement) {
  if (element.end - element.payloadStart > 8) return null;
  let value = 0;
  for (let offset = element.payloadStart; offset < element.end; offset += 1) {
    value = value * 256 + (bytes[offset] ?? 0);
  }
  return value;
}

function ebmlFloat(bytes: Uint8Array, element: EbmlElement) {
  const length = element.end - element.payloadStart;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (length === 4) return view.getFloat32(element.payloadStart);
  if (length === 8) return view.getFloat64(element.payloadStart);
  return null;
}

function webmInfo(bytes: Uint8Array): VideoInfo | null {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== String.fromCharCode(0x1a, 0x45, 0xdf, 0xa3)) {
    return null;
  }
  const root = ebmlElements(bytes, 0, bytes.length);
  const segment = root.find((element) => element.id === 0x18538067);
  if (!segment) return null;
  const children = ebmlElements(bytes, segment.payloadStart, segment.end);
  const info = children.find((element) => element.id === 0x1549a966);
  const tracks = children.find((element) => element.id === 0x1654ae6b);
  if (!tracks) return null;
  let timecodeScale = 1_000_000;
  let durationSeconds: number | null = null;
  if (info) {
    const infoChildren = ebmlElements(bytes, info.payloadStart, info.end);
    const scale = infoChildren.find((element) => element.id === 0x2ad7b1);
    const duration = infoChildren.find((element) => element.id === 0x4489);
    timecodeScale = (scale && ebmlUnsigned(bytes, scale)) || timecodeScale;
    const durationValue = duration ? ebmlFloat(bytes, duration) : null;
    durationSeconds =
      durationValue && durationValue > 0 ? (durationValue * timecodeScale) / 1_000_000_000 : null;
  }
  for (const track of ebmlElements(bytes, tracks.payloadStart, tracks.end).filter(
    (element) => element.id === 0xae,
  )) {
    const entries = ebmlElements(bytes, track.payloadStart, track.end);
    const type = entries.find((element) => element.id === 0x83);
    if (!type || ebmlUnsigned(bytes, type) !== 1) continue;
    const video = entries.find((element) => element.id === 0xe0);
    if (!video) continue;
    const videoEntries = ebmlElements(bytes, video.payloadStart, video.end);
    const widthElement = videoEntries.find((element) => element.id === 0xb0);
    const heightElement = videoEntries.find((element) => element.id === 0xba);
    const width = widthElement ? ebmlUnsigned(bytes, widthElement) : null;
    const height = heightElement ? ebmlUnsigned(bytes, heightElement) : null;
    if (!width || !height) continue;
    const defaultDuration = entries.find((element) => element.id === 0x23e383);
    const frameDuration = defaultDuration ? ebmlUnsigned(bytes, defaultDuration) : null;
    return {
      mimeType: "video/webm",
      width,
      height,
      durationSeconds,
      frameRate: frameDuration && frameDuration > 0 ? 1_000_000_000 / frameDuration : null,
    };
  }
  return null;
}

export function inspectVideo(bytes: Uint8Array, declaredMimeType: string): VideoInfo | null {
  const isoContainer = bytes.length >= 8 && ascii(bytes, 4, 4) === "ftyp";
  const webmContainer =
    bytes.length >= 4 && ascii(bytes, 0, 4) === String.fromCharCode(0x1a, 0x45, 0xdf, 0xa3);
  if (
    ((declaredMimeType === "video/mp4" || declaredMimeType === "video/quicktime") &&
      !isoContainer) ||
    (declaredMimeType === "video/webm" && !webmContainer)
  ) {
    throw new Error("视频内容与声明的文件类型不一致");
  }
  const info = mp4Info(bytes, declaredMimeType) ?? webmInfo(bytes);
  const supportedDeclaredType = ["video/mp4", "video/quicktime", "video/webm"].includes(
    declaredMimeType,
  );
  // A valid container may be fragmented, encrypted or use metadata atoms not handled
  // by this lightweight inspector. Preserve the original and leave metadata empty.
  if (
    info &&
    supportedDeclaredType &&
    (declaredMimeType === "video/webm") !== (info.mimeType === "video/webm")
  ) {
    throw new Error("视频内容与声明的文件类型不一致");
  }
  return info;
}

function pngInfo(bytes: Uint8Array): ImageInfo | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2 || offset + length + 2 > bytes.length) return null;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      return {
        mimeType: "image/jpeg",
        height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
      };
    }
    offset += length + 2;
  }
  return null;
}

function webpInfo(bytes: Uint8Array): ImageInfo | null {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = ascii(12, 4);
  if (chunk === "VP8X") {
    const width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16);
    const height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16);
    return { mimeType: "image/webp", width, height };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return {
      mimeType: "image/webp",
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = view.getUint32(21, true);
    return {
      mimeType: "image/webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

export function inspectImage(bytes: Uint8Array, declaredMimeType: string) {
  const info = pngInfo(bytes) ?? jpegInfo(bytes) ?? webpInfo(bytes);
  if (!info) throw new Error("图片文件签名或尺寸信息无效");
  if (declaredMimeType !== info.mimeType) throw new Error("图片内容与声明的文件类型不一致");
  if (
    info.width < 1 ||
    info.height < 1 ||
    info.width > 32_768 ||
    info.height > 32_768 ||
    info.width * info.height > 100_000_000
  ) {
    throw new Error("图片像素尺寸超出安全范围");
  }
  return info;
}

export async function createImageProxy(source: string, destination: string) {
  try {
    await sharp(source, {
      animated: false,
      failOn: "error",
      limitInputPixels: 100_000_000,
    })
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#f4f1ea" })
      .jpeg({ quality: 82 })
      .toFile(destination);
    return true;
  } catch {
    await unlink(destination).catch(() => undefined);
    return false;
  }
}
