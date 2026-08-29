import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { extract, type Header, pack } from "tar-stream";

const manifestName = "takeboard-recipe.json";
const workflowName = "workflow.json";
const bindingName = "binding.json";
const maxCompressedBytes = 25 * 1024 * 1024;
const maxExpandedBytes = 50 * 1024 * 1024;
const maxEntryBytes = 40 * 1024 * 1024;
const allowedEntries = new Set([manifestName, workflowName, bindingName]);
const capabilities = new Set([
  "text_to_image",
  "image_to_image",
  "text_to_video",
  "image_to_video",
  "first_last_video",
  "reference_video",
]);

type RecipePackageFile = {
  path: typeof workflowName | typeof bindingName;
  size: number;
  sha256: string;
};

export type WorkflowRecipeManifest = {
  format: "takeboard.workflow-recipe";
  version: 1;
  exportedAt: string;
  name: string;
  sourcePath: string;
  workflowHash: string;
  capability: string;
  outputMediaType: "image" | "video";
  bindingIncluded: boolean;
  dependencies: {
    models: string[];
    nodeTypes: string[];
  };
  files: RecipePackageFile[];
};

export type ParsedWorkflowRecipe = {
  manifest: WorkflowRecipeManifest;
  workflow: unknown;
  binding: unknown | null;
};

export class WorkflowRecipePackageError extends Error {
  constructor(
    readonly statusCode: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowRecipePackageError";
  }
}

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

function addBufferEntry(
  archive: ReturnType<typeof pack>,
  header: Partial<Header> & Pick<Header, "name">,
  buffer: Buffer,
) {
  return new Promise<void>((resolveEntry, rejectEntry) => {
    archive.entry(header, buffer, (error) => (error ? rejectEntry(error) : resolveEntry()));
  });
}

export function createWorkflowRecipeArchive(input: {
  name: string;
  sourcePath: string;
  workflowHash: string;
  capability: string;
  outputMediaType: "image" | "video";
  models: string[];
  nodeTypes: string[];
  workflow: unknown;
  binding: unknown | null;
}) {
  const workflow = Buffer.from(`${JSON.stringify(input.workflow, null, 2)}\n`, "utf8");
  const binding = input.binding
    ? Buffer.from(`${JSON.stringify(input.binding, null, 2)}\n`, "utf8")
    : null;
  const files: RecipePackageFile[] = [
    { path: workflowName, size: workflow.byteLength, sha256: sha256(workflow) },
    ...(binding
      ? [
          {
            path: bindingName as typeof bindingName,
            size: binding.byteLength,
            sha256: sha256(binding),
          },
        ]
      : []),
  ];
  const manifest: WorkflowRecipeManifest = {
    format: "takeboard.workflow-recipe",
    version: 1,
    exportedAt: new Date().toISOString(),
    name: input.name,
    sourcePath: input.sourcePath,
    workflowHash: input.workflowHash,
    capability: input.capability,
    outputMediaType: input.outputMediaType,
    bindingIncluded: Boolean(binding),
    dependencies: {
      models: [...new Set(input.models)].sort(),
      nodeTypes: [...new Set(input.nodeTypes)].sort(),
    },
    files,
  };
  const archive = pack();
  const compressed = archive.pipe(createGzip({ level: 6 }));
  void (async () => {
    try {
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await addBufferEntry(
        archive,
        { name: manifestName, size: manifestBytes.byteLength, mode: 0o600 },
        manifestBytes,
      );
      await addBufferEntry(
        archive,
        { name: workflowName, size: workflow.byteLength, mode: 0o600 },
        workflow,
      );
      if (binding) {
        await addBufferEntry(
          archive,
          { name: bindingName, size: binding.byteLength, mode: 0o600 },
          binding,
        );
      }
      archive.finalize();
    } catch (error) {
      archive.destroy(error instanceof Error ? error : new Error("Recipe 打包失败"));
    }
  })();
  return compressed;
}

function parsedJson(bytes: Buffer, label: string) {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new WorkflowRecipePackageError(400, `${label}不是有效 JSON`);
  }
}

function parseManifest(bytes: Buffer): WorkflowRecipeManifest {
  const candidate = parsedJson(bytes, "Recipe 清单");
  if (!candidate || typeof candidate !== "object") {
    throw new WorkflowRecipePackageError(400, "Recipe 包缺少有效清单");
  }
  const manifest = candidate as Partial<WorkflowRecipeManifest>;
  if (
    manifest.format !== "takeboard.workflow-recipe" ||
    manifest.version !== 1 ||
    typeof manifest.name !== "string" ||
    !manifest.name.trim() ||
    manifest.name.length > 200 ||
    typeof manifest.sourcePath !== "string" ||
    typeof manifest.workflowHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.workflowHash) ||
    typeof manifest.capability !== "string" ||
    !capabilities.has(manifest.capability) ||
    !["image", "video"].includes(String(manifest.outputMediaType)) ||
    typeof manifest.bindingIncluded !== "boolean" ||
    !manifest.dependencies ||
    !Array.isArray(manifest.dependencies.models) ||
    !Array.isArray(manifest.dependencies.nodeTypes) ||
    !Array.isArray(manifest.files)
  ) {
    throw new WorkflowRecipePackageError(400, "Recipe 包格式或版本不受支持");
  }
  if (
    !manifest.dependencies.models.every((value) => typeof value === "string") ||
    !manifest.dependencies.nodeTypes.every((value) => typeof value === "string") ||
    manifest.dependencies.models.length > 10_000 ||
    manifest.dependencies.nodeTypes.length > 10_000
  ) {
    throw new WorkflowRecipePackageError(400, "Recipe 依赖清单无效");
  }
  const files = manifest.files.map((entry) => {
    if (
      !entry ||
      ![workflowName, bindingName].includes(entry.path) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new WorkflowRecipePackageError(400, "Recipe 文件清单无效");
    }
    return entry;
  });
  if (new Set(files.map((entry) => entry.path)).size !== files.length) {
    throw new WorkflowRecipePackageError(400, "Recipe 文件清单包含重复路径");
  }
  if (!files.some((entry) => entry.path === workflowName)) {
    throw new WorkflowRecipePackageError(400, "Recipe 包缺少 Workflow 文件");
  }
  if (manifest.bindingIncluded !== files.some((entry) => entry.path === bindingName)) {
    throw new WorkflowRecipePackageError(400, "Recipe 绑定声明与文件清单不一致");
  }
  return { ...(manifest as WorkflowRecipeManifest), files };
}

export async function parseWorkflowRecipeArchive(bytes: Buffer): Promise<ParsedWorkflowRecipe> {
  if (bytes.byteLength > maxCompressedBytes) {
    throw new WorkflowRecipePackageError(413, "Recipe 包超过 25 MB 安全上限");
  }
  const entries = new Map<string, Buffer>();
  let expandedBytes = 0;
  const unpack = extract();
  unpack.on("entry", (header, stream, next) => {
    const fail = (error: Error) => {
      stream.resume();
      unpack.destroy(error);
    };
    if (header.type !== "file" || !allowedEntries.has(header.name)) {
      fail(new WorkflowRecipePackageError(400, `Recipe 包含不允许的条目：${header.name}`));
      return;
    }
    if (entries.has(header.name)) {
      fail(new WorkflowRecipePackageError(400, `Recipe 包包含重复条目：${header.name}`));
      return;
    }
    if (!Number.isSafeInteger(header.size) || header.size < 0 || header.size > maxEntryBytes) {
      fail(new WorkflowRecipePackageError(413, `Recipe 条目大小异常：${header.name}`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on("data", (chunk: unknown) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.byteLength;
      expandedBytes += bytes.byteLength;
      if (size > maxEntryBytes || expandedBytes > maxExpandedBytes) {
        fail(new WorkflowRecipePackageError(413, "Recipe 解压内容超过 50 MB 安全上限"));
        return;
      }
      chunks.push(bytes);
    });
    stream.on("end", () => {
      if (size !== header.size) {
        unpack.destroy(new WorkflowRecipePackageError(400, `Recipe 条目大小不符：${header.name}`));
        return;
      }
      entries.set(header.name, Buffer.concat(chunks));
      next();
    });
    stream.on("error", (error) => unpack.destroy(error));
  });
  try {
    await pipeline(Readable.from(bytes), createGunzip(), unpack);
  } catch (error) {
    if (error instanceof WorkflowRecipePackageError) throw error;
    throw new WorkflowRecipePackageError(400, "Recipe 包不是有效的 .tgz 文件");
  }
  const manifestBytes = entries.get(manifestName);
  if (!manifestBytes) throw new WorkflowRecipePackageError(400, "Recipe 包缺少清单");
  const manifest = parseManifest(manifestBytes);
  if (entries.size !== manifest.files.length + 1) {
    throw new WorkflowRecipePackageError(400, "Recipe 实际文件与清单不一致");
  }
  for (const file of manifest.files) {
    const content = entries.get(file.path);
    if (!content || content.byteLength !== file.size || sha256(content) !== file.sha256) {
      throw new WorkflowRecipePackageError(400, `Recipe 文件完整性校验失败：${file.path}`);
    }
  }
  const workflowBytes = entries.get(workflowName);
  if (!workflowBytes) throw new WorkflowRecipePackageError(400, "Recipe 包缺少 Workflow 文件");
  return {
    manifest,
    workflow: parsedJson(workflowBytes, "Workflow"),
    binding: entries.has(bindingName)
      ? parsedJson(entries.get(bindingName) as Buffer, "Binding")
      : null,
  };
}
