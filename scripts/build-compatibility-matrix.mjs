#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { validateCompatibilityEvidence } from "./compatibility-evidence.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const evidenceRoot = join(repositoryRoot, "docs", "compatibility", "evidence");
const jsonPath = join(repositoryRoot, "docs", "compatibility-matrix.json");
const markdownPath = join(repositoryRoot, "docs", "compatibility-matrix.md");
const checkOnly = process.argv.includes("--check");

function gpuName(value) {
  return value
    .replace(/^cuda:\d+\s*/i, "")
    .replace(/\s*:\s*(?:cudaMallocAsync|native)\s*$/i, "")
    .trim();
}

function gib(bytes) {
  return typeof bytes === "number" && Number.isFinite(bytes)
    ? Math.round((bytes / 1024 ** 3) * 10) / 10
    : null;
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function evidenceLevel(value) {
  if (value === "passed") return "自动 + 视觉";
  if (value === "failed") return "自动通过 / 视觉未通过";
  return "自动完整性";
}

const files = (await readdir(evidenceRoot).catch(() => []))
  .filter((name) => name.endsWith(".json"))
  .sort();
const seen = new Set();
const entries = [];
for (const filename of files) {
  const evidence = validateCompatibilityEvidence(
    JSON.parse(await readFile(join(evidenceRoot, filename), "utf8")),
    filename,
  );
  if (seen.has(evidence.evidenceId)) throw new Error(`重复 Evidence ID：${evidence.evidenceId}`);
  seen.add(evidence.evidenceId);
  entries.push({
    evidenceId: evidence.evidenceId,
    evidenceFile: `docs/compatibility/evidence/${filename}`,
    verifiedAt: evidence.completedAt,
    takeboardVersion: evidence.takeboardVersion,
    commit: evidence.source?.commit ?? null,
    platform: evidence.environment.platform,
    architecture: evidence.environment.architecture,
    engine: evidence.worker.engine,
    engineVersion: evidence.worker.version,
    device: gpuName(evidence.worker.device),
    vramGiB: gib(evidence.worker.vramTotal),
    workflow: basename(evidence.workflow.path),
    workflowHash: evidence.workflow.workflowHash,
    executionPromptSha256: evidence.workflow.executionPromptSha256,
    models: evidence.workflow.models,
    generation: evidence.generation,
    elapsedSeconds: evidence.elapsedSeconds,
    output: evidence.output,
    visualQuality: evidence.review?.visualQuality ?? "not_reviewed",
  });
}
entries.sort((left, right) => right.verifiedAt.localeCompare(left.verifiedAt));

const matrix = {
  format: "takeboard.compatibility-matrix",
  version: 1,
  evidenceSchema: "takeboard.gpu-release-gate@2",
  verifiedRunCount: entries.length,
  entries,
};
const json = `${JSON.stringify(matrix, null, 2)}\n`;
const rows = entries.length
  ? entries
      .map(
        (entry) =>
          `| ${entry.verifiedAt.slice(0, 10)} | ${markdownCell(entry.device)} · ${entry.vramGiB ?? "?"} GiB | ${markdownCell(entry.platform)}/${markdownCell(entry.architecture)} | ${markdownCell(entry.workflow)} | ${entry.generation.width}×${entry.generation.height} · ${entry.generation.durationSeconds}s · ${entry.generation.steps} steps | ${entry.elapsedSeconds}s | ${evidenceLevel(entry.visualQuality)} |`,
      )
      .join("\n")
  : "| — | — | — | — | — | — | 尚无已提交的 v2 证据 |";
const markdown = `# 真实生成兼容性矩阵

这张表只接受由真实 ComfyUI/GPU 端到端生成产生、通过隐私校验并提交到仓库的证据。工作流被发现、模型文件存在或模拟测试通过，都不会被写成“真实兼容”。

## 当前验证记录

| 日期 | GPU / 显存 | 系统 | Workflow | 参数 | 耗时 | 证据等级 |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

机器可读版本见 [compatibility-matrix.json](./compatibility-matrix.json)，原始脱敏证据见 [compatibility/evidence](./compatibility/evidence/README.md)。每一行只证明该次 Workflow 内容哈希、模型、ComfyUI 版本与硬件组合成功，不外推到同系列其他组合。

## 历史基线（v2 证据协议之前）

| 日期 | 环境 | Workflow | 结果 | 限制 |
| --- | --- | --- | --- | --- |
| 2026-08-30 | RTX 4090 · ComfyUI 0.31.0 | MiniMax H3 T2V · hash \`4935b699…d1d4cd7\` | 480×848、5 秒视频，100 秒完成并登记为可复用 MP4 | 来自发布记录，缺少 v2 原始 JSON；不计入上方 verifiedRunCount |

## 证据等级

- **自动完整性**：真实提交、真实进度、终态对账、视频 Asset 登记和媒体 Range 读取均通过。
- **自动 + 视觉**：在自动完整性之外，由人工观看完整视频并明确记录无黑帧、不可解码、严重闪烁或结构崩坏。当前工具不会用算法结果冒充人工审片。
- **自动通过 / 视觉未通过**：技术链路可执行，但人工审片明确不合格；保留记录是为了暴露质量边界，不得宣传为高质量样片。
- **未列出**：不是“不支持”，而是尚无足够证据；应按 [发布门槛](./release-gates.md) 重跑。
`;

async function assertCurrent(path, expected) {
  const current = await readFile(path, "utf8").catch(() => "");
  if (current !== expected) throw new Error(`${path} 已过期；运行 pnpm compatibility:matrix 更新`);
}

if (checkOnly) {
  await Promise.all([assertCurrent(jsonPath, json), assertCurrent(markdownPath, markdown)]);
  console.log(`compatibility matrix current (${entries.length} verified runs)`);
} else {
  await Promise.all([writeFile(jsonPath, json, "utf8"), writeFile(markdownPath, markdown, "utf8")]);
  console.log(`compatibility matrix updated (${entries.length} verified runs)`);
}
