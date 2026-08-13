import { describe, expect, it } from "vitest";
import { inspectImage } from "../src/asset-inspection.js";

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
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
