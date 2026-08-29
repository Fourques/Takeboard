import { describe, expect, it } from "vitest";
import { inspectImage, inspectVideo } from "../src/asset-inspection.js";

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function mp4Box(type: string, ...payloads: Uint8Array[]) {
  const length = 8 + payloads.reduce((total, payload) => total + payload.length, 0);
  const bytes = new Uint8Array(length);
  new DataView(bytes.buffer).setUint32(0, length);
  bytes.set(
    [...type].map((character) => character.charCodeAt(0)),
    4,
  );
  let offset = 8;
  for (const payload of payloads) {
    bytes.set(payload, offset);
    offset += payload.length;
  }
  return bytes;
}

function concatenate(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function mp4Fixture() {
  const mvhd = new Uint8Array(20);
  new DataView(mvhd.buffer).setUint32(12, 90_000);
  new DataView(mvhd.buffer).setUint32(16, 180_000);
  const tkhd = new Uint8Array(84);
  const tkhdView = new DataView(tkhd.buffer);
  tkhdView.setInt32(40, 65_536);
  tkhdView.setInt32(56, 65_536);
  tkhdView.setUint32(76, 1920 * 65_536);
  tkhdView.setUint32(80, 1080 * 65_536);
  const mdhd = new Uint8Array(20);
  new DataView(mdhd.buffer).setUint32(12, 90_000);
  const hdlr = new Uint8Array(12);
  hdlr.set([118, 105, 100, 101], 8);
  const stts = new Uint8Array(16);
  const sttsView = new DataView(stts.buffer);
  sttsView.setUint32(4, 1);
  sttsView.setUint32(8, 60);
  sttsView.setUint32(12, 3_000);
  const trak = mp4Box(
    "trak",
    mp4Box("tkhd", tkhd),
    mp4Box(
      "mdia",
      mp4Box("mdhd", mdhd),
      mp4Box("hdlr", hdlr),
      mp4Box("minf", mp4Box("stbl", mp4Box("stts", stts))),
    ),
  );
  return concatenate(
    mp4Box("ftyp", new Uint8Array(16)),
    mp4Box("moov", mp4Box("mvhd", mvhd), trak),
  );
}

describe("asset image inspection", () => {
  it("reads dimensions from a PNG header", () => {
    expect(inspectImage(pngHeader(1080, 1920), "image/png")).toEqual({
      mimeType: "image/png",
      width: 1080,
      height: 1920,
    });
  });

  it("rejects MIME spoofing and pixel bombs", () => {
    expect(() => inspectImage(pngHeader(480, 848), "image/jpeg")).toThrow(/不一致/);
    expect(() => inspectImage(pngHeader(20_000, 20_000), "image/png")).toThrow(/安全范围/);
  });
});

describe("asset video inspection", () => {
  it("reads dimensions, duration and average frame rate without external binaries", () => {
    expect(inspectVideo(mp4Fixture(), "video/mp4")).toEqual({
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 2,
      frameRate: 30,
    });
  });

  it("rejects a supported MIME type when the container signature does not match", () => {
    expect(() => inspectVideo(mp4Fixture(), "video/webm")).toThrow(/不一致/);
    expect(() => inspectVideo(new Uint8Array(40), "video/mp4")).toThrow(/不一致/);
  });
});
