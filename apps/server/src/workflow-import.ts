import { crc32, inflateSync } from "node:zlib";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const metadataLimit = 4 * 1024 * 1024;

/** Read metadata, never decode pixels or execute an imported node. */
export function workflowFromUpload(filename: string, bytes: Buffer): unknown {
  if (/\.json$/i.test(filename)) return JSON.parse(bytes.toString("utf8"));
  if (!/\.png$/i.test(filename)) throw new Error("请选择工作流 JSON 或包含工作流的 PNG 图片");
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("PNG 文件格式无效");
  const metadata = new Map<string, string>();
  let offset = 8;
  let ended = false;
  let total = 0;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) throw new Error("PNG 数据不完整");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)
    )
      throw new Error("PNG 校验失败，文件可能已损坏");
    offset += size + 12;
    if (type === "IEND") {
      ended = true;
      break;
    }
    if (!["tEXt", "zTXt", "iTXt"].includes(type)) continue;
    const separator = data.indexOf(0);
    if (separator < 1 || separator > 79) continue;
    const key = data.toString("latin1", 0, separator);
    if (key !== "workflow" && key !== "prompt") continue;
    if (metadata.has(key)) throw new Error("图片包含重复的工作流元数据，请改用 JSON 导入");
    let content = data.subarray(separator + 1);
    if (type === "zTXt") {
      if (content[0] !== 0) throw new Error("不支持此 PNG 文本压缩格式");
      content = inflateSync(content.subarray(1), { maxOutputLength: metadataLimit });
    } else if (type === "iTXt") {
      const compressed = content[0];
      if ((compressed !== 0 && compressed !== 1) || content[1] !== 0)
        throw new Error("PNG 文本格式无效");
      const languageEnd = content.indexOf(0, 2);
      const translatedEnd = languageEnd >= 0 ? content.indexOf(0, languageEnd + 1) : -1;
      if (translatedEnd < 0) throw new Error("PNG 文本不完整");
      content = content.subarray(translatedEnd + 1);
      if (compressed === 1) content = inflateSync(content, { maxOutputLength: metadataLimit });
    }
    total += content.length;
    if (total > metadataLimit) throw new Error("图片工作流元数据过大，请导出 JSON 后导入");
    metadata.set(key, content.toString("utf8"));
  }
  if (!ended) throw new Error("PNG 数据不完整");
  const source = metadata.get("workflow") ?? metadata.get("prompt");
  if (!source)
    throw new Error("这张图片不含工作流元数据。普通截图无法还原工作流，请从 ComfyUI 导出 JSON。");
  return JSON.parse(source);
}
