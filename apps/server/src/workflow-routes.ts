import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ComfyPrompt } from "@takeboard/executor-comfy";
import type { FastifyInstance } from "fastify";
import { ProjectStore } from "./storage/project-store.js";
import {
  fetchComfyObjectInfo,
  inspectWorkflowDocument,
  inspectWorkflowForBinding,
  isWorkflowPath,
  parseWorkflowBinding,
  preflightPromptAgainstObjectInfo,
  readWorkflowBinding,
  readWorkflowBindingProposal,
  suggestedBinding,
  validateWorkflowBinding,
  type WorkflowBinding,
  type WorkflowBindingTarget,
  type WorkflowOutputMediaType,
  workflowBindingVersion,
  workflowHash,
  writeWorkflowBinding,
  writeWorkflowBindingProposal,
} from "./workflow-bindings.js";
import { buildWorkflowDiagnostic } from "./workflow-diagnostics.js";
import {
  createWorkflowRecipeArchive,
  parseWorkflowRecipeArchive,
  WorkflowRecipePackageError,
} from "./workflow-recipe-package.js";

type WorkflowNode = {
  type?: string;
  class_type?: string;
  title?: string;
  _meta?: { title?: string };
  widgets_values?: unknown[];
  inputs?: Record<string, unknown>;
};

type WorkflowJson = {
  nodes?: WorkflowNode[];
  definitions?: { subgraphs?: Array<{ nodes?: WorkflowNode[] }> };
  [nodeId: string]: unknown;
};

const modelExtension = /\.(?:safetensors|ckpt|pt|pth|gguf)$/i;

const capabilityLabels = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  text_to_video: "文生视频",
  image_to_video: "图生视频",
  first_last_video: "首尾帧视频",
  reference_video: "参考生成视频",
} as const;

type Capability = keyof typeof capabilityLabels;

function allNodes(workflow: WorkflowJson): WorkflowNode[] {
  const apiNodes = !Array.isArray(workflow.nodes)
    ? Object.values(workflow).filter((node): node is WorkflowNode =>
        Boolean(node && typeof node === "object" && "class_type" in node),
      )
    : [];
  return [
    ...(workflow.nodes ?? []),
    ...(workflow.definitions?.subgraphs ?? []).flatMap((subgraph) => subgraph.nodes ?? []),
    ...apiNodes.map((node) => {
      const normalized: WorkflowNode = {
        ...node,
        widgets_values: Object.values(node.inputs ?? {}).filter((value) => !Array.isArray(value)),
      };
      if (node.class_type) normalized.type = node.class_type;
      if (node._meta?.title) normalized.title = node._meta.title;
      return normalized;
    }),
  ];
}

function detectCapability(path: string, nodes: WorkflowNode[]): Capability {
  const normalizedPath = path.toLowerCase();
  if (/reference.*video|ref2v|r2v/.test(normalizedPath)) return "reference_video";
  if (/first.*last.*video|firstlast|flf2v|首尾帧/.test(normalizedPath)) {
    return "first_last_video";
  }
  if (/text.*to.*video|t2v|文生视频/.test(normalizedPath)) return "text_to_video";
  if (/image.*to.*video|i2v|图生视频/.test(normalizedPath)) return "image_to_video";
  if (/image.*to.*image|img2img|i2i|图生图/.test(normalizedPath)) return "image_to_image";
  if (/text.*to.*image|txt2img|t2i|文生图/.test(normalizedPath)) return "text_to_image";

  const haystack = nodes
    .map((node) => `${node.type ?? ""} ${node.title ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (/reference.*video|ref2v|r2v/.test(haystack)) return "reference_video";
  if (/first.*last.*video|firstlast|flf2v|首尾帧/.test(haystack)) return "first_last_video";
  if (/text.*to.*video|t2v|文生视频/.test(haystack)) return "text_to_video";
  if (/image.*to.*video|i2v|图生视频|createvideo|savevideo/.test(haystack)) {
    return "image_to_video";
  }
  if (/image.*to.*image|img2img|i2i|图生图/.test(haystack)) return "image_to_image";
  return "text_to_image";
}

function detectInputs(capability: Capability, nodes: WorkflowNode[]) {
  const types = nodes.map((node) => node.type ?? "");
  const text = nodes
    .map((node) => `${node.type ?? ""} ${node.title ?? ""}`)
    .join(" ")
    .toLowerCase();
  const slots = new Set<string>(["prompt"]);
  if (["image_to_image", "image_to_video", "first_last_video"].includes(capability)) {
    slots.add("first_frame");
  }
  if (capability === "image_to_image") slots.add("denoise");
  if (capability === "image_to_video" && types.some((type) => type === "MiniMaxH3ImageToVideo")) {
    slots.add("last_frame");
  }
  if (capability === "first_last_video" || /last[_ ]frame|end[_ ]image|结束帧|尾帧/.test(text)) {
    slots.add("last_frame");
  }
  if (capability === "reference_video") {
    slots.add("reference_images");
    slots.add("reference_videos");
    slots.add("reference_audio");
  }
  if (/negative/.test(text)) slots.add("negative_prompt");
  if (types.some((type) => /video/i.test(type))) {
    slots.add("duration");
    slots.add("fps");
  }
  if (types.some((type) => /sampler|noise/i.test(type))) {
    slots.add("seed");
    slots.add("steps");
    slots.add("cfg");
  }
  slots.add("resolution");
  return [...slots];
}

function detectModels(nodes: WorkflowNode[]) {
  const models = new Set<string>();
  for (const node of nodes) {
    for (const value of node.widgets_values ?? []) {
      if (typeof value === "string" && modelExtension.test(value)) {
        models.add(value);
      }
    }
  }
  return [...models];
}

function detectNodeTypes(nodes: WorkflowNode[]) {
  return [
    ...new Set(
      nodes
        .map((node) => node.type ?? node.class_type)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ].sort();
}

function isComfyWorkflowDocument(workflow: WorkflowJson) {
  const apiPrompt = Object.values(workflow).some(
    (node) =>
      node &&
      typeof node === "object" &&
      typeof (node as WorkflowNode).class_type === "string" &&
      (node as WorkflowNode).inputs &&
      typeof (node as WorkflowNode).inputs === "object",
  );
  return Array.isArray(workflow.nodes) || apiPrompt;
}

function installedModels(value: unknown) {
  const models = new Set<string>();
  const visit = (entry: unknown) => {
    if (typeof entry === "string") {
      if (modelExtension.test(entry)) {
        const normalized = entry.replaceAll("\\", "/").toLowerCase();
        models.add(normalized);
        const filename = normalized.split("/").at(-1);
        if (filename) models.add(filename);
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (entry && typeof entry === "object") Object.values(entry).forEach(visit);
  };
  visit(value);
  return models;
}

function displayName(path: string) {
  const filename = path.split("/").at(-1) ?? path;
  const curatedNames: Record<string, string> = {
    "Kino_Wan22_I2V.json": "Wan 2.2 I2V · 高质量",
    "Kino_Wan22_FLF2V.json": "Wan 2.2 首尾帧 · 高质量",
    "Kino_Wan22_I2V_Preview.json": "Wan 2.2 I2V · 快速预演",
    "Kino_Wan22_FLF2V_Preview.json": "Wan 2.2 首尾帧 · 快速预演",
    "Kino_MinimaxH3_I2V.json": "MiniMax H3 I2V · 原生音画",
    "Kino_MinimaxH3_T2V.json": "MiniMax H3 T2V · 原生音画",
    "Kino_MinimaxH3_R2V.json": "MiniMax H3 Ref2VA · 多模态参考",
  };
  if (curatedNames[filename]) return curatedNames[filename];
  return (
    filename
      ?.replace(/\.json$/i, "")
      .replace(/^Kino_/i, "")
      .replaceAll("_", " ") ?? path
  );
}

function isNativeWorkflow(path: string) {
  return (
    path.endsWith("Kino_Wan22_I2V.json") ||
    path.endsWith("Kino_Wan22_FLF2V.json") ||
    path.endsWith("Kino_Wan22_I2V_Preview.json") ||
    path.endsWith("Kino_Wan22_FLF2V_Preview.json") ||
    path.endsWith("Kino_MinimaxH3_I2V.json") ||
    path.endsWith("Kino_MinimaxH3_T2V.json") ||
    path.endsWith("Kino_MinimaxH3_R2V.json") ||
    path.endsWith("Kino_LTX23_I2V_Draft.json") ||
    path.endsWith("Kino_QwenImage2512_T2I.json") ||
    path.endsWith("Kino_QwenImage2512_I2I.json")
  );
}

function workflowSummary(
  path: string,
  workflow: WorkflowJson,
  editorUrl: string,
  inventory: Set<string> | null,
  binding: WorkflowBinding | null = null,
) {
  const nodes = allNodes(workflow);
  const hash = workflowHash(workflow);
  const native = isNativeWorkflow(path);
  const activeBinding = binding?.workflowHash === hash ? binding : null;
  const capability = activeBinding?.capability ?? detectCapability(path, nodes);
  const detectedInputs = detectInputs(capability, nodes);
  const boundInputs = activeBinding
    ? [
        ...Object.entries(activeBinding.parameters)
          .filter(([, targets]) => (targets?.length ?? 0) > 0)
          .map(([key]) => key),
        ...(activeBinding.media.first_frame?.length ? ["first_frame"] : []),
        ...(activeBinding.media.last_frame?.length ? ["last_frame"] : []),
        ...(activeBinding.media.reference_image?.length ? ["reference_images"] : []),
        ...(activeBinding.media.reference_video?.length ? ["reference_videos"] : []),
        ...(activeBinding.media.reference_audio?.length ? ["reference_audio"] : []),
      ]
    : detectedInputs;
  const inputs = [...new Set(boundInputs)].filter((slot) => {
    if (!native) return true;
    if (slot === "cfg") return false;
    if (slot === "steps" && path.toLowerCase().includes("preview")) {
      return false;
    }
    if (
      slot === "steps" &&
      !path.toLowerCase().includes("minimax") &&
      !path.toLowerCase().includes("qwenimage") &&
      !path.toLowerCase().includes("wan22")
    ) {
      return false;
    }
    return true;
  });
  const models = detectModels(nodes);
  const mediaInputs = {
    first_frame: inputs.includes("first_frame") ? 1 : 0,
    last_frame: inputs.includes("last_frame") ? 1 : 0,
    reference: activeBinding
      ? (activeBinding.media.reference_image?.length ?? 0)
      : inputs.includes("reference_images")
        ? 9
        : 0,
    reference_video: activeBinding
      ? (activeBinding.media.reference_video?.length ?? 0)
      : inputs.includes("reference_videos")
        ? 3
        : 0,
    reference_audio: activeBinding
      ? (activeBinding.media.reference_audio?.length ?? 0)
      : inputs.includes("reference_audio")
        ? 3
        : 0,
  };
  const missingModels = inventory
    ? models.filter((model) => {
        const normalized = model.replaceAll("\\", "/").toLowerCase();
        const filename = normalized.split("/").at(-1) ?? normalized;
        return !inventory.has(normalized) && !inventory.has(filename);
      })
    : [];
  return {
    id: Buffer.from(path).toString("base64url"),
    path,
    name: displayName(path),
    capability,
    capabilityLabel: capabilityLabels[capability],
    inputs,
    mediaInputs,
    models,
    modelStatus:
      inventory === null || models.length === 0
        ? ("unknown" as const)
        : missingModels.length > 0
          ? ("missing" as const)
          : ("ready" as const),
    missingModels,
    nodeCount: nodes.length,
    source: "comfyui" as const,
    editorUrl,
    execution: native
      ? ("native" as const)
      : activeBinding
        ? ("bound" as const)
        : ("comfy_only" as const),
    bindingStatus: native
      ? ("built_in" as const)
      : binding
        ? activeBinding
          ? ("ready" as const)
          : ("stale" as const)
        : ("needs_binding" as const),
    workflowHash: hash,
    origin: path.startsWith("Kino/")
      ? ("built_in" as const)
      : path.startsWith("TakeBoard/")
        ? ("imported" as const)
        : ("comfyui" as const),
  };
}

async function fetchWorkflow(comfyUrl: string, path: string) {
  const response = await fetch(
    `${comfyUrl}/api/userdata/${encodeURIComponent(`workflows/${path}`)}`,
    {
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) throw new Error(`Workflow ${path} returned ${response.status}`);
  return (await response.json()) as WorkflowJson;
}

function detectedOutputMediaType(
  capability: Capability,
  prompt: ComfyPrompt,
  binding?: WorkflowBinding | null,
): WorkflowOutputMediaType {
  if (binding?.outputMediaType) return binding.outputMediaType;
  if (["text_to_image", "image_to_image"].includes(capability)) return "image";
  if (
    ["text_to_video", "image_to_video", "first_last_video", "reference_video"].includes(capability)
  ) {
    return "video";
  }
  return Object.values(prompt).some((node) => /save.*image|previewimage/i.test(node.class_type))
    ? "image"
    : "video";
}

type WorkflowReference = {
  projectKey: string;
  projectTitle: string;
  location: "active" | "trash";
  shotIds: string[];
  shotLabels: string[];
  runCount: number;
};

function importedWorkflowPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    isWorkflowPath(path) &&
    path.startsWith("TakeBoard/") &&
    !path.startsWith("TakeBoard/.archive/")
  );
}

function workflowArchivePath(path: string) {
  return `TakeBoard/.archive/${Date.now()}-${Buffer.from(path).toString("base64url")}.json`;
}

function archivedWorkflow(path: string) {
  const match = /^TakeBoard\/\.archive\/(\d+)-([A-Za-z0-9_-]+)\.json$/.exec(path);
  if (!match) return null;
  try {
    const timestamp = Number(match[1]);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) return null;
    const archivedAt = new Date(timestamp);
    if (Number.isNaN(archivedAt.getTime())) return null;
    const originalPath = Buffer.from(match[2] ?? "", "base64url").toString("utf8");
    if (!importedWorkflowPath(originalPath)) return null;
    return {
      archivePath: path,
      originalPath,
      name: displayName(originalPath),
      archivedAt: archivedAt.toISOString(),
    };
  } catch {
    return null;
  }
}

async function listComfyWorkflowPaths(comfyUrl: string) {
  const response = await fetch(`${comfyUrl}/api/userdata?dir=workflows&recurse=true`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`ComfyUI returned ${response.status}`);
  const listed = await response.json();
  if (!Array.isArray(listed)) throw new Error("ComfyUI 工作流目录响应无效");
  return listed.filter(isWorkflowPath);
}

async function moveComfyWorkflow(comfyUrl: string, source: string, destination: string) {
  const response = await fetch(
    `${comfyUrl}/api/userdata/${encodeURIComponent(`workflows/${source}`)}/move/${encodeURIComponent(`workflows/${destination}`)}?overwrite=false`,
    { method: "POST", signal: AbortSignal.timeout(5_000) },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ComfyUI 移动工作流失败（${response.status}）${detail ? `：${detail}` : ""}`);
  }
}

async function workflowReferences(projectsRoot: string, path: string) {
  const root = resolve(projectsRoot);
  const locations: Array<{ directory: string; location: "active" | "trash" }> = [
    { directory: root, location: "active" },
    { directory: join(root, ".trash"), location: "trash" },
  ];
  const references: WorkflowReference[] = [];
  for (const source of locations) {
    const entries = await readdir(source.directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        (source.location === "active" && !entry.name.endsWith(".takeboard"))
      ) {
        continue;
      }
      const store = ProjectStore.openExisting(join(source.directory, entry.name));
      if (!store) continue;
      try {
        const current = store.loadCurrent();
        if (!current) continue;
        const shots = current.snapshot.shots.filter((shot) => shot.workflowPath === path);
        const runs = current.snapshot.runs.filter((run) => run.parameters.recipePath === path);
        const shotIds = [
          ...new Set([...shots.map((shot) => shot.id), ...runs.map((run) => run.shotId)]),
        ];
        if (shotIds.length === 0 && runs.length === 0) continue;
        references.push({
          projectKey: entry.name,
          projectTitle: current.snapshot.project.title,
          location: source.location,
          shotIds,
          shotLabels: shotIds.map(
            (shotId) => current.snapshot.shots.find((shot) => shot.id === shotId)?.label ?? shotId,
          ),
          runCount: runs.length,
        });
      } finally {
        store.close();
      }
    }
  }
  return references;
}

function workflowArchiveToken(path: string, hash: string, references: WorkflowReference[]) {
  return createHash("sha256")
    .update(JSON.stringify({ purpose: "takeboard-workflow-archive-v1", path, hash, references }))
    .digest("hex");
}

export function registerWorkflowRoutes(
  app: FastifyInstance,
  comfyUrl: string,
  editorUrl: string,
  projectsRoot: string,
) {
  const inspectPath = async (path: string) => {
    const [workflow, current, proposal, objectInfo] = await Promise.all([
      fetchWorkflow(comfyUrl, path),
      readWorkflowBinding(comfyUrl, path),
      readWorkflowBindingProposal(comfyUrl, path),
      fetchComfyObjectInfo(comfyUrl),
    ]);
    const inventory = installedModels(objectInfo);
    const summary = workflowSummary(path, workflow, editorUrl, inventory, current);
    const inspected = inspectWorkflowDocument(workflow, objectInfo, summary.workflowHash);
    const outputMediaType = detectedOutputMediaType(summary.capability, inspected.prompt, current);
    const activeProposal = proposal?.workflowHash === inspected.workflowHash ? proposal : null;
    const suggested = suggestedBinding(
      path,
      inspected.workflowHash,
      summary.capability,
      outputMediaType,
      inspected.candidates,
    );
    const diagnostic = buildWorkflowDiagnostic({
      path,
      workflowHash: inspected.workflowHash,
      prompt: inspected.prompt,
      objectInfo,
      capability: summary.capability,
      outputMediaType,
      bindingStatus: summary.bindingStatus,
      binding: current,
      models: summary.models,
      inventory,
    });
    return {
      ...summary,
      status: summary.bindingStatus,
      diagnostic,
      candidates: inspected.candidates,
      binding: current ?? activeProposal ?? suggested,
      suggested,
      bindingProposal: activeProposal ? "recipe_package" : null,
      conversionIssues: preflightPromptAgainstObjectInfo(inspected.prompt, objectInfo),
      warning:
        summary.bindingStatus === "built_in"
          ? undefined
          : "启用后会在当前 ComfyUI 执行此工作流及其中的第三方节点；请只信任你了解来源的工作流。",
    };
  };

  app.get("/api/workflows", async (_request, reply) => {
    try {
      const paths = (await listComfyWorkflowPaths(comfyUrl)).filter(
        (path) => !path.startsWith("TakeBoard/.archive/"),
      );
      let objectInfoError: string | null = null;
      const objectInfo = await fetchComfyObjectInfo(comfyUrl).catch((error: unknown) => {
        objectInfoError = error instanceof Error ? error.message : "ComfyUI 节点目录不可用";
        return null;
      });
      const inventory = objectInfo ? installedModels(objectInfo) : null;
      const detected = await Promise.allSettled(
        paths.map(async (path) => {
          const [workflow, binding] = await Promise.all([
            fetchWorkflow(comfyUrl, path),
            readWorkflowBinding(comfyUrl, path),
          ]);
          const summary = workflowSummary(path, workflow, editorUrl, inventory, binding);
          if (!objectInfo) return summary;
          const inspected = inspectWorkflowDocument(workflow, objectInfo, summary.workflowHash);
          const outputMediaType = detectedOutputMediaType(
            summary.capability,
            inspected.prompt,
            binding,
          );
          return {
            ...summary,
            diagnostic: buildWorkflowDiagnostic({
              path,
              workflowHash: inspected.workflowHash,
              prompt: inspected.prompt,
              objectInfo,
              capability: summary.capability,
              outputMediaType,
              bindingStatus: summary.bindingStatus,
              binding,
              models: summary.models,
              inventory,
            }),
          };
        }),
      );
      const workflows = detected.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const warnings = detected.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              `${paths[index]}：${result.reason instanceof Error ? result.reason.message : "解析失败"}`,
            ]
          : [],
      );
      const diagnostics = [
        ...(objectInfoError
          ? [
              {
                path: "*",
                status: "unknown" as const,
                code: "COMFY_OBJECT_INFO_UNAVAILABLE",
                message: objectInfoError,
              },
            ]
          : []),
        ...detected.flatMap((result, index) =>
          result.status === "rejected"
            ? [
                {
                  path: paths[index],
                  status: "blocked" as const,
                  code: "WORKFLOW_INSPECTION_FAILED",
                  message: result.reason instanceof Error ? result.reason.message : "解析失败",
                },
              ]
            : [],
        ),
      ];
      return { editorUrl, workflows, warnings, diagnostics };
    } catch (error) {
      return await reply.code(503).send({
        editorUrl,
        workflows: [],
        error: error instanceof Error ? error.message : "无法检测 ComfyUI 工作流",
      });
    }
  });

  app.get<{ Querystring: { path?: string } }>("/api/workflows/inspect", async (request, reply) => {
    const path = request.query.path;
    if (!isWorkflowPath(path)) return await reply.code(400).send({ error: "工作流路径无效" });
    try {
      return await inspectPath(path);
    } catch (error) {
      return await reply.code(422).send({
        error: error instanceof Error ? error.message : "无法检查该工作流",
        diagnostic: {
          path,
          status: "blocked",
          code: "WORKFLOW_INSPECTION_FAILED",
          message: error instanceof Error ? error.message : "无法转换工作流",
        },
      });
    }
  });

  app.get<{ Querystring: { path?: string } }>("/api/workflows/raw", async (request, reply) => {
    const path = request.query.path;
    if (!isWorkflowPath(path)) {
      return await reply.code(400).send({ error: "工作流路径无效" });
    }
    try {
      return await fetchWorkflow(comfyUrl, path);
    } catch (error) {
      return await reply.code(404).send({
        error: error instanceof Error ? error.message : "工作流不存在",
      });
    }
  });

  app.get<{ Querystring: { path?: string } }>("/api/workflows/binding", async (request, reply) => {
    const path = request.query.path;
    if (!isWorkflowPath(path)) return await reply.code(400).send({ error: "工作流路径无效" });
    try {
      const inspected = await inspectPath(path);
      return {
        path,
        status: inspected.bindingStatus,
        workflowHash: inspected.workflowHash,
        nodeCount: inspected.nodeCount,
        candidates: inspected.candidates,
        binding: inspected.binding,
        suggested: inspected.suggested,
        conversionIssues: inspected.conversionIssues,
        warning: inspected.warning,
        diagnostic: inspected.diagnostic,
        ...(inspected.bindingStatus === "built_in"
          ? { message: "该工作流由 TakeBoard 内置适配器执行" }
          : {}),
      };
    } catch (error) {
      return await reply.code(422).send({
        error: error instanceof Error ? error.message : "无法转换该工作流",
      });
    }
  });

  app.put<{ Querystring: { path?: string } }>("/api/workflows/binding", async (request, reply) => {
    const path = request.query.path;
    if (!isWorkflowPath(path)) return await reply.code(400).send({ error: "工作流路径无效" });
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    if (body.trusted !== true) {
      return await reply.code(400).send({ error: "必须明确确认信任后才能启用执行" });
    }
    const capabilities = Object.keys(capabilityLabels) as Capability[];
    const capability = capabilities.includes(body.capability as Capability)
      ? (body.capability as Capability)
      : null;
    const outputMediaType = ["image", "video"].includes(String(body.outputMediaType))
      ? (body.outputMediaType as WorkflowOutputMediaType)
      : null;
    if (!capability || !outputMediaType) {
      return await reply.code(400).send({ error: "工作流能力或输出类型无效" });
    }
    const targets = (value: unknown): WorkflowBindingTarget[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      const parsed = value.slice(0, 32).flatMap((entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as WorkflowBindingTarget).nodeId === "string" &&
        typeof (entry as WorkflowBindingTarget).input === "string"
          ? [
              {
                nodeId: (entry as WorkflowBindingTarget).nodeId.slice(0, 200),
                input: (entry as WorkflowBindingTarget).input.slice(0, 200),
              },
            ]
          : [],
      );
      return parsed.length > 0 ? parsed : undefined;
    };
    const parameterInput =
      body.parameters && typeof body.parameters === "object"
        ? (body.parameters as Record<string, unknown>)
        : {};
    const mediaInput =
      body.media && typeof body.media === "object" ? (body.media as Record<string, unknown>) : {};
    try {
      const inspected = await inspectWorkflowForBinding(comfyUrl, path);
      const compactTargets = (entries: Array<[string, WorkflowBindingTarget[] | undefined]>) =>
        Object.fromEntries(
          entries.filter((entry): entry is [string, WorkflowBindingTarget[]] => Boolean(entry[1])),
        );
      const binding: WorkflowBinding = {
        version: workflowBindingVersion,
        workflowPath: path,
        workflowHash: inspected.workflowHash,
        capability,
        outputMediaType,
        parameters: compactTargets([
          ["prompt", targets(parameterInput.prompt)],
          ["negative_prompt", targets(parameterInput.negative_prompt)],
          ["seed", targets(parameterInput.seed)],
          ["steps", targets(parameterInput.steps)],
          ["denoise", targets(parameterInput.denoise)],
          ["width", targets(parameterInput.width)],
          ["height", targets(parameterInput.height)],
          ["duration", targets(parameterInput.duration)],
          ["fps", targets(parameterInput.fps)],
        ]),
        media: compactTargets([
          ["first_frame", targets(mediaInput.first_frame)],
          ["last_frame", targets(mediaInput.last_frame)],
          ["reference_image", targets(mediaInput.reference_image)],
          ["reference_video", targets(mediaInput.reference_video)],
          ["reference_audio", targets(mediaInput.reference_audio)],
        ]),
        trusted: true,
        verifiedAt: new Date().toISOString(),
      };
      const issues = [
        ...validateWorkflowBinding(inspected.prompt, binding),
        ...preflightPromptAgainstObjectInfo(inspected.prompt, inspected.objectInfo),
      ];
      if (issues.length > 0) {
        return await reply
          .code(422)
          .send({ error: `绑定预检失败：${issues.slice(0, 8).join("；")}` });
      }
      await writeWorkflowBinding(comfyUrl, path, binding);
      return { status: "ready", binding };
    } catch (error) {
      return await reply.code(422).send({
        error: error instanceof Error ? error.message : "无法保存参数绑定",
      });
    }
  });

  app.get<{ Querystring: { path?: string } }>(
    "/api/workflows/recipe-package",
    async (request, reply) => {
      const path = request.query.path;
      if (!isWorkflowPath(path)) return await reply.code(400).send({ error: "工作流路径无效" });
      try {
        const [workflow, binding] = await Promise.all([
          fetchWorkflow(comfyUrl, path),
          readWorkflowBinding(comfyUrl, path),
        ]);
        const hash = workflowHash(workflow);
        const activeBinding = binding?.workflowHash === hash ? binding : null;
        const summary = workflowSummary(path, workflow, editorUrl, null, activeBinding);
        const nodes = allNodes(workflow);
        const outputMediaType =
          activeBinding?.outputMediaType ??
          (["text_to_image", "image_to_image"].includes(summary.capability) ? "image" : "video");
        const stream = createWorkflowRecipeArchive({
          name: summary.name,
          sourcePath: path,
          workflowHash: hash,
          capability: summary.capability,
          outputMediaType,
          models: detectModels(nodes),
          nodeTypes: detectNodeTypes(nodes),
          workflow,
          binding: activeBinding,
        });
        const filename = `${summary.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-").slice(0, 80) || "workflow"}.takeboard-recipe.tgz`;
        reply.header("content-type", "application/gzip");
        reply.header(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        );
        return await reply.send(stream);
      } catch (error) {
        return await reply.code(404).send({
          error: error instanceof Error ? error.message : "无法导出 Recipe 包",
        });
      }
    },
  );

  app.post("/api/workflows/recipe-package/import", async (request, reply) => {
    const upload = await request.file();
    if (
      !upload ||
      (!upload.filename.toLowerCase().endsWith(".takeboard-recipe.tgz") &&
        !upload.filename.toLowerCase().endsWith(".tgz"))
    ) {
      return await reply.code(400).send({ error: "请选择 .takeboard-recipe.tgz 文件" });
    }
    try {
      const recipe = await parseWorkflowRecipeArchive(await upload.toBuffer());
      if (!isWorkflowPath(recipe.manifest.sourcePath)) {
        return await reply.code(400).send({ error: "Recipe 原始工作流路径无效" });
      }
      const workflow = recipe.workflow as WorkflowJson;
      if (!workflow || typeof workflow !== "object" || !isComfyWorkflowDocument(workflow)) {
        return await reply.code(400).send({ error: "Recipe 中的 Workflow 无法识别" });
      }
      const hash = workflowHash(workflow);
      if (hash !== recipe.manifest.workflowHash) {
        return await reply.code(400).send({ error: "Recipe Workflow 内容哈希与清单不一致" });
      }
      const nodes = allNodes(workflow);
      const actualModels = detectModels(nodes).sort();
      const actualNodeTypes = detectNodeTypes(nodes);
      if (
        JSON.stringify(actualModels) !==
          JSON.stringify([...new Set(recipe.manifest.dependencies.models)].sort()) ||
        JSON.stringify(actualNodeTypes) !==
          JSON.stringify([...new Set(recipe.manifest.dependencies.nodeTypes)].sort())
      ) {
        return await reply.code(400).send({ error: "Recipe 依赖清单与 Workflow 内容不一致" });
      }
      const packagedBinding = recipe.binding ? parseWorkflowBinding(recipe.binding) : null;
      if (recipe.binding && !packagedBinding) {
        return await reply.code(400).send({ error: "Recipe 参数绑定格式无效" });
      }
      if (
        packagedBinding &&
        (packagedBinding.workflowHash !== hash ||
          packagedBinding.capability !== recipe.manifest.capability ||
          packagedBinding.outputMediaType !== recipe.manifest.outputMediaType)
      ) {
        return await reply.code(400).send({ error: "Recipe 参数绑定与 Workflow 清单不一致" });
      }
      const safeName = recipe.manifest.name
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 70);
      const destination = `TakeBoard/${safeName || "workflow"}-${randomUUID().slice(0, 8)}.json`;
      const proposal = packagedBinding
        ? {
            ...packagedBinding,
            workflowPath: destination,
            workflowHash: hash,
            verifiedAt: new Date().toISOString(),
          }
        : null;
      if (proposal) await writeWorkflowBindingProposal(comfyUrl, destination, proposal);
      const saved = await fetch(
        `${comfyUrl}/api/userdata/${encodeURIComponent(`workflows/${destination}`)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(workflow),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!saved.ok) {
        return await reply.code(502).send({ error: `ComfyUI 保存失败：${saved.status}` });
      }
      try {
        const inspected = await inspectPath(destination);
        return await reply.code(201).send({
          imported: true,
          ...inspected,
          recipePackage: {
            format: recipe.manifest.format,
            version: recipe.manifest.version,
            sourcePath: recipe.manifest.sourcePath,
            bindingProposalIncluded: Boolean(proposal),
            trustRequired: true,
          },
        });
      } catch (error) {
        return await reply.code(201).send({
          imported: true,
          ...workflowSummary(destination, workflow, editorUrl, null, null),
          recipePackage: {
            format: recipe.manifest.format,
            version: recipe.manifest.version,
            sourcePath: recipe.manifest.sourcePath,
            bindingProposalIncluded: Boolean(proposal),
            trustRequired: true,
          },
          diagnostic: {
            path: destination,
            workflowHash: hash,
            health: "unknown",
            executable: false,
            nodeCount: nodes.length,
            capability: recipe.manifest.capability,
            outputMediaType: recipe.manifest.outputMediaType,
            bindingStatus: "needs_binding",
            modelStatus: "unknown",
            models: actualModels,
            missingModels: [],
            missingNodeTypes: [],
            checks: [
              {
                id: "recipe.import-diagnostic",
                category: "nodes",
                status: "unknown",
                code: "COMFY_DIAGNOSTIC_UNAVAILABLE",
                title: "尚未完成当前电脑诊断",
                detail:
                  error instanceof Error
                    ? error.message
                    : "Recipe 已安全导入，但当前无法连接 ComfyUI 完成依赖诊断。",
                nodeIds: [],
                remediation: "连接当前 ComfyUI 后重新检测工作流，再确认参数绑定。",
              },
            ],
          },
        });
      }
    } catch (error) {
      if (error instanceof WorkflowRecipePackageError) {
        return await reply.code(error.statusCode).send({ error: error.message });
      }
      return await reply.code(400).send({
        error: error instanceof Error ? error.message : "Recipe 包导入失败",
      });
    }
  });

  app.post("/api/workflows/import", async (request, reply) => {
    const upload = await request.file();
    if (!upload?.filename.toLowerCase().endsWith(".json")) {
      return await reply.code(400).send({ error: "请选择 ComfyUI Workflow JSON" });
    }
    const bytes = await upload.toBuffer();
    let workflow: WorkflowJson;
    try {
      workflow = JSON.parse(bytes.toString("utf8")) as WorkflowJson;
    } catch {
      return await reply.code(400).send({ error: "JSON 文件无法解析" });
    }
    if (!isComfyWorkflowDocument(workflow)) {
      return await reply.code(400).send({ error: "文件不是 ComfyUI Workflow 或 API Prompt" });
    }
    const safeName = upload.filename
      .replace(/\.json$/i, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .slice(0, 80);
    const suffix = Date.now().toString(36);
    const path = `workflows/TakeBoard/${safeName || "workflow"}-${suffix}.json`;
    const response = await fetch(`${comfyUrl}/api/userdata/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workflow),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return await reply.code(502).send({ error: `ComfyUI 保存失败：${response.status}` });
    }
    const relativePath = path.replace(/^workflows\//, "");
    return await reply
      .code(201)
      .send(workflowSummary(relativePath, workflow, editorUrl, null, null));
  });

  app.get<{ Querystring: { path?: string } }>(
    "/api/workflows/archive-preview",
    async (request, reply) => {
      const path = request.query.path;
      if (!importedWorkflowPath(path)) {
        return await reply.code(400).send({ error: "只能归档从 TakeBoard 导入的工作流" });
      }
      try {
        const workflow = await fetchWorkflow(comfyUrl, path);
        const hash = workflowHash(workflow);
        const references = await workflowReferences(projectsRoot, path);
        return {
          path,
          name: displayName(path),
          workflowHash: hash,
          references,
          blocked: references.length > 0,
          confirmationToken: workflowArchiveToken(path, hash, references),
        };
      } catch (error) {
        return await reply.code(404).send({
          error: error instanceof Error ? error.message : "工作流不存在",
        });
      }
    },
  );

  app.post("/api/workflows/archive", async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as { path?: unknown; confirmationToken?: unknown })
        : {};
    if (!importedWorkflowPath(body.path) || typeof body.confirmationToken !== "string") {
      return await reply.code(400).send({ error: "归档请求无效" });
    }
    try {
      const workflow = await fetchWorkflow(comfyUrl, body.path);
      const hash = workflowHash(workflow);
      const references = await workflowReferences(projectsRoot, body.path);
      if (references.length > 0) {
        return await reply.code(409).send({
          error: "该工作流仍被项目引用，不能归档",
          references,
        });
      }
      if (body.confirmationToken !== workflowArchiveToken(body.path, hash, references)) {
        return await reply.code(409).send({ error: "工作流或项目引用已经变化，请重新检查" });
      }
      const archivePath = workflowArchivePath(body.path);
      await moveComfyWorkflow(comfyUrl, body.path, archivePath);
      return { archived: true as const, archivePath, originalPath: body.path };
    } catch (error) {
      return await reply.code(502).send({
        error: error instanceof Error ? error.message : "工作流归档失败",
      });
    }
  });

  app.get("/api/workflows/archives", async (_request, reply) => {
    try {
      const archives = (await listComfyWorkflowPaths(comfyUrl))
        .flatMap((path) => archivedWorkflow(path) ?? [])
        .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));
      return { archives };
    } catch (error) {
      return await reply.code(503).send({
        archives: [],
        error: error instanceof Error ? error.message : "无法读取工作流归档",
      });
    }
  });

  app.post("/api/workflows/archives/restore", async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as { archivePath?: unknown })
        : {};
    const archived =
      typeof body.archivePath === "string" ? archivedWorkflow(body.archivePath) : null;
    if (!archived) return await reply.code(400).send({ error: "归档路径无效" });
    try {
      const paths = await listComfyWorkflowPaths(comfyUrl);
      if (!paths.includes(archived.archivePath)) {
        return await reply.code(404).send({ error: "归档不存在" });
      }
      if (paths.includes(archived.originalPath)) {
        return await reply.code(409).send({ error: "原位置已有同名工作流，请先处理名称冲突" });
      }
      await moveComfyWorkflow(comfyUrl, archived.archivePath, archived.originalPath);
      return { restored: true as const, path: archived.originalPath };
    } catch (error) {
      return await reply.code(502).send({
        error: error instanceof Error ? error.message : "工作流恢复失败",
      });
    }
  });
}
