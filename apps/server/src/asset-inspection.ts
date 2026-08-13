import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";

export type ImageInfo = {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
};

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
  const run = (command: string, args: string[]) =>
    new Promise<boolean>((resolve) => {
      const child = spawn(command, args, { stdio: "ignore", timeout: 30_000 });
      child.once("error", () => resolve(false));
      child.once("close", (code) => resolve(code === 0));
    });
  const succeeded =
    (await run("convert", [
      `${source}[0]`,
      "-auto-orient",
      "-thumbnail",
      "512x512>",
      "-strip",
      "-quality",
      "82",
      destination,
    ])) || (await run("sips", ["-s", "format", "jpeg", "-Z", "512", source, "--out", destination]));
  if (!succeeded) await unlink(destination).catch(() => undefined);
  return succeeded;
}
