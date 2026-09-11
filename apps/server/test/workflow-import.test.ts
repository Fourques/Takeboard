import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { workflowFromUpload } from "../src/workflow-import.js";

function chunk(type: string, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length);
  header.write(type, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([header, data, checksum]);
}
function png(...chunks: Buffer[]) {
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks, chunk("IEND")]);
}
const workflow = { nodes: [{ id: 1, type: "Test" }] };
describe("workflow metadata import", () => {
  it("reads JSON and PNG text without decoding the image or changing workflow content", () => {
    expect(workflowFromUpload("作品.json", Buffer.from(JSON.stringify(workflow)))).toEqual(
      workflow,
    );
    const source = png(chunk("tEXt", Buffer.from(`workflow\0${JSON.stringify(workflow)}`)));
    expect(workflowFromUpload("作品.png", source)).toEqual(workflow);
    expect(
      workflowFromUpload(
        "作品.png",
        png(
          chunk(
            "zTXt",
            Buffer.concat([Buffer.from("workflow\0\0"), deflateSync(JSON.stringify(workflow))]),
          ),
        ),
      ),
    ).toEqual(workflow);
    expect(
      workflowFromUpload(
        "作品.png",
        png(
          chunk(
            "iTXt",
            Buffer.concat([
              Buffer.from("workflow\0\x01\0\0\0"),
              deflateSync(JSON.stringify(workflow)),
            ]),
          ),
        ),
      ),
    ).toEqual(workflow);
  });
  it("prefers the editable workflow over prompt metadata and supports prompt-only images", () => {
    const prompt = { "1": { class_type: "Test", inputs: {} } };
    const promptChunk = chunk("tEXt", Buffer.from(`prompt\0${JSON.stringify(prompt)}`));
    expect(workflowFromUpload("out.png", png(promptChunk))).toEqual(prompt);
    expect(
      workflowFromUpload(
        "out.png",
        png(promptChunk, chunk("tEXt", Buffer.from(`workflow\0${JSON.stringify(workflow)}`))),
      ),
    ).toEqual(workflow);
  });
  it("rejects screenshots, corrupt chunks, duplicate metadata and compressed bombs", () => {
    expect(() => workflowFromUpload("screenshot.png", png())).toThrow("不含工作流");
    const text = chunk("tEXt", Buffer.from(`workflow\0${JSON.stringify(workflow)}`));
    expect(() => workflowFromUpload("duplicate.png", png(text, text))).toThrow("重复");
    const corrupt = png(text);
    corrupt[20] = (corrupt[20] ?? 0) ^ 1;
    expect(() => workflowFromUpload("bad.png", corrupt)).toThrow("校验");
    expect(() => workflowFromUpload("short.png", png(text).subarray(0, -3))).toThrow("不完整");
    expect(() =>
      workflowFromUpload(
        "bomb.png",
        png(
          chunk(
            "zTXt",
            Buffer.concat([Buffer.from("workflow\0\0"), deflateSync("x".repeat(5 * 1024 * 1024))]),
          ),
        ),
      ),
    ).toThrow();
  });
});
