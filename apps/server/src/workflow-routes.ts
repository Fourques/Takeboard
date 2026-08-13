import type { FastifyInstance } from "fastify";

type WorkflowNode = {
  type?: string;
  title?: string;
  widgets_values?: unknown[];
};

type WorkflowJson = {
  nodes?: WorkflowNode[];
  definitions?: { subgraphs?: Array<{ nodes?: WorkflowNode[] }> };
};

const capabilityLabels = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  text_to_video: "文生视频",
  image_to_video: "图生视频",
  first_last_video: "首尾帧视频",
  reference_video: "参考生成视频",
} as const;

type Capability = keyof typeof capabilityLabels;

function allNodes(workflow: WorkflowJson) {
  return [
    ...(workflow.nodes ?? []),
    ...(workflow.definitions?.subgraphs ?? []).flatMap((subgraph) => subgraph.nodes ?? []),
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
  if (capability === "first_last_video") slots.add("last_frame");
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
      if (typeof value === "string" && /\.(?:safetensors|ckpt|pt|pth|gguf)$/i.test(value)) {
        models.add(value);
      }
    }
  }
  return [...models];
}

function displayName(path: string) {
  return (
    path
      .split("/")
      .at(-1)
      ?.replace(/\.json$/i, "")
      .replace(/^Kino_/i, "")
      .replaceAll("_", " ") ?? path
  );
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
      const paths = ((await response.json()) as unknown[]).filter(
        (path): path is string => typeof path === "string" && path.endsWith(".json"),
      );
      const workflows = await Promise.all(
        paths.map(async (path) => {
          const workflow = await fetchWorkflow(comfyUrl, path);
          const nodes = allNodes(workflow);
          const capability = detectCapability(path, nodes);
          return {
            id: Buffer.from(path).toString("base64url"),
            path,
            name: displayName(path),
            capability,
            capabilityLabel: capabilityLabels[capability],
            inputs: detectInputs(capability, nodes),
            models: detectModels(nodes),
            nodeCount: nodes.length,
            source: "comfyui" as const,
            editorUrl,
            execution:
              path.endsWith("Kino_Wan22_I2V.json") || path.endsWith("Kino_Wan22_FLF2V.json")
                ? "native"
                : "comfy_only",
          };
        }),
      );
      return { editorUrl, workflows };
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
    if (!path || path.includes("..") || !path.endsWith(".json")) {
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
    if (!Array.isArray(workflow.nodes)) {
      return await reply.code(400).send({ error: "文件不是 ComfyUI Workflow" });
    }
    const safeName = upload.filename
      .replace(/\.json$/i, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .slice(0, 80);
    const path = `workflows/TakeBoard/${safeName || `workflow-${Date.now()}`}.json`;
    const response = await fetch(`${comfyUrl}/api/userdata/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workflow),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return await reply.code(502).send({ error: `ComfyUI 保存失败：${response.status}` });
    }
    const nodes = allNodes(workflow);
    const relativePath = path.replace(/^workflows\//, "");
    const capability = detectCapability(relativePath, nodes);
    return await reply.code(201).send({
      path: relativePath,
      name: displayName(relativePath),
      capability,
      capabilityLabel: capabilityLabels[capability],
      inputs: detectInputs(capability, nodes),
      models: detectModels(nodes),
      nodeCount: nodes.length,
    });
  });
}
