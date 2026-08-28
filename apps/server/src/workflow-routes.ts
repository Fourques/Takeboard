import type { FastifyInstance } from "fastify";
import {
  inspectWorkflowForBinding,
  isWorkflowPath,
  preflightPromptAgainstObjectInfo,
  readWorkflowBinding,
  suggestedBinding,
  validateWorkflowBinding,
  type WorkflowBinding,
  type WorkflowBindingTarget,
  type WorkflowOutputMediaType,
  workflowBindingVersion,
  workflowHash,
  writeWorkflowBinding,
} from "./workflow-bindings.js";

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

export function registerWorkflowRoutes(app: FastifyInstance, comfyUrl: string, editorUrl: string) {
  app.get("/api/workflows", async (_request, reply) => {
    try {
      const response = await fetch(`${comfyUrl}/api/userdata?dir=workflows&recurse=true`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`ComfyUI returned ${response.status}`);
      const listed = await response.json();
      if (!Array.isArray(listed)) throw new Error("ComfyUI 工作流目录响应无效");
      const paths = listed.filter(isWorkflowPath);
      const inventory = await fetch(`${comfyUrl}/object_info`, {
        signal: AbortSignal.timeout(5_000),
      })
        .then(async (result) => (result.ok ? installedModels(await result.json()) : null))
        .catch(() => null);
      const detected = await Promise.allSettled(
        paths.map(async (path) => {
          const [workflow, binding] = await Promise.all([
            fetchWorkflow(comfyUrl, path),
            readWorkflowBinding(comfyUrl, path),
          ]);
          return workflowSummary(path, workflow, editorUrl, inventory, binding);
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
      return { editorUrl, workflows, warnings };
    } catch (error) {
      return await reply.code(503).send({
        editorUrl,
        workflows: [],
        error: error instanceof Error ? error.message : "无法检测 ComfyUI 工作流",
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
    if (isNativeWorkflow(path)) {
      return { path, status: "built_in", message: "该工作流由 TakeBoard 内置适配器执行" };
    }
    try {
      const inspected = await inspectWorkflowForBinding(comfyUrl, path);
      const workflow = inspected.workflow as WorkflowJson;
      const nodes = allNodes(workflow);
      const capability = detectCapability(path, nodes);
      const hasImageOutput = Object.values(inspected.prompt).some((node) =>
        /save.*image|previewimage/i.test(node.class_type),
      );
      const outputMediaType: WorkflowOutputMediaType = hasImageOutput ? "image" : "video";
      const current = await readWorkflowBinding(comfyUrl, path);
      const suggested = suggestedBinding(
        path,
        inspected.workflowHash,
        capability,
        outputMediaType,
        inspected.candidates,
      );
      const conversionIssues = preflightPromptAgainstObjectInfo(
        inspected.prompt,
        inspected.objectInfo,
      );
      return {
        path,
        status: current
          ? current.workflowHash === inspected.workflowHash
            ? "ready"
            : "stale"
          : "needs_binding",
        workflowHash: inspected.workflowHash,
        nodeCount: Object.keys(inspected.prompt).length,
        candidates: inspected.candidates,
        binding: current ?? suggested,
        suggested,
        conversionIssues,
        warning:
          "启用后会在当前 ComfyUI 执行此工作流及其中的第三方节点；请只信任你了解来源的工作流。",
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
    const apiPrompt = Object.values(workflow).some(
      (node) =>
        node &&
        typeof node === "object" &&
        typeof (node as WorkflowNode).class_type === "string" &&
        (node as WorkflowNode).inputs &&
        typeof (node as WorkflowNode).inputs === "object",
    );
    if (!Array.isArray(workflow.nodes) && !apiPrompt) {
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
}
