import { createHash } from "node:crypto";
import {
  type ComfyObjectInfo,
  type ComfyPrompt,
  convertUiWorkflowToPrompt,
  type UiWorkflow,
} from "@takeboard/executor-comfy";

export const workflowBindingVersion = 1 as const;

export type WorkflowCapability =
  | "text_to_image"
  | "image_to_image"
  | "text_to_video"
  | "image_to_video"
  | "first_last_video"
  | "reference_video";

export type WorkflowOutputMediaType = "image" | "video";
export type WorkflowParameterKey =
  | "prompt"
  | "negative_prompt"
  | "seed"
  | "steps"
  | "width"
  | "height"
  | "duration"
  | "fps";
export type WorkflowMediaKey =
  | "first_frame"
  | "last_frame"
  | "reference_image"
  | "reference_video"
  | "reference_audio";

export type WorkflowBindingTarget = {
  nodeId: string;
  input: string;
};

export type WorkflowBinding = {
  version: typeof workflowBindingVersion;
  workflowPath: string;
  workflowHash: string;
  capability: WorkflowCapability;
  outputMediaType: WorkflowOutputMediaType;
  parameters: Partial<Record<WorkflowParameterKey, WorkflowBindingTarget[]>>;
  media: Partial<Record<WorkflowMediaKey, WorkflowBindingTarget[]>>;
  trusted: true;
  verifiedAt: string;
};

export type WorkflowBindingCandidate = WorkflowBindingTarget & {
  label: string;
  classType: string;
  valueType: "string" | "number" | "boolean" | "unknown";
};

export type WorkflowBindingCandidates = {
  parameters: Record<WorkflowParameterKey, WorkflowBindingCandidate[]>;
  media: Record<WorkflowMediaKey, WorkflowBindingCandidate[]>;
};

type WorkflowDocument = UiWorkflow | ComfyPrompt;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function workflowHash(workflow: unknown) {
  return createHash("sha256").update(canonicalJson(workflow)).digest("hex");
}

export function isWorkflowPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length <= 500 &&
    path.endsWith(".json") &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

const bindingPath = (path: string) =>
  `takeboard/bindings/${Buffer.from(path).toString("base64url")}.json`;

async function fetchJson(comfyUrl: string, path: string, timeout = 5_000) {
  const response = await fetch(`${comfyUrl}/api/userdata/${encodeURIComponent(path)}`, {
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return await response.json();
}

export async function fetchWorkflowDocument(comfyUrl: string, path: string) {
  return (await fetchJson(comfyUrl, `workflows/${path}`)) as WorkflowDocument;
}

export async function fetchComfyObjectInfo(comfyUrl: string) {
  const response = await fetch(`${comfyUrl}/object_info`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`ComfyUI object info returned ${response.status}`);
  return (await response.json()) as ComfyObjectInfo;
}

export async function readWorkflowBinding(comfyUrl: string, path: string) {
  try {
    const binding = (await fetchJson(comfyUrl, bindingPath(path))) as Partial<WorkflowBinding>;
    const targetGroupValid = (group: unknown) =>
      Boolean(
        group &&
          typeof group === "object" &&
          Object.values(group).every(
            (targets) =>
              Array.isArray(targets) &&
              targets.every(
                (target) =>
                  target &&
                  typeof target === "object" &&
                  typeof (target as WorkflowBindingTarget).nodeId === "string" &&
                  typeof (target as WorkflowBindingTarget).input === "string",
              ),
          ),
      );
    if (
      binding.version !== workflowBindingVersion ||
      binding.workflowPath !== path ||
      binding.trusted !== true ||
      typeof binding.workflowHash !== "string" ||
      ![
        "text_to_image",
        "image_to_image",
        "text_to_video",
        "image_to_video",
        "first_last_video",
        "reference_video",
      ].includes(String(binding.capability)) ||
      !["image", "video"].includes(String(binding.outputMediaType)) ||
      !targetGroupValid(binding.parameters) ||
      !targetGroupValid(binding.media)
    ) {
      return null;
    }
    return binding as WorkflowBinding;
  } catch {
    return null;
  }
}

export async function writeWorkflowBinding(
  comfyUrl: string,
  path: string,
  binding: WorkflowBinding,
) {
  const response = await fetch(
    `${comfyUrl}/api/userdata/${encodeURIComponent(bindingPath(path))}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(binding),
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) throw new Error(`ComfyUI 保存参数绑定失败：${response.status}`);
}

const parameterKeys: WorkflowParameterKey[] = [
  "prompt",
  "negative_prompt",
  "seed",
  "steps",
  "width",
  "height",
  "duration",
  "fps",
];
function emptyCandidates(): WorkflowBindingCandidates {
  return {
    parameters: {
      prompt: [],
      negative_prompt: [],
      seed: [],
      steps: [],
      width: [],
      height: [],
      duration: [],
      fps: [],
    },
    media: {
      first_frame: [],
      last_frame: [],
      reference_image: [],
      reference_video: [],
      reference_audio: [],
    },
  };
}

function classifyValue(value: unknown): WorkflowBindingCandidate["valueType"] {
  if (["string", "number", "boolean"].includes(typeof value)) {
    return typeof value as "string" | "number" | "boolean";
  }
  return "unknown";
}

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

export function discoverBindingCandidates(prompt: ComfyPrompt): WorkflowBindingCandidates {
  const candidates = emptyCandidates();
  for (const [nodeId, node] of Object.entries(prompt)) {
    const title = node._meta?.title ?? node.class_type;
    for (const [input, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) continue;
      const haystack = `${title} ${node.class_type} ${input}`.toLowerCase();
      const candidate: WorkflowBindingCandidate = {
        nodeId,
        input,
        label: `${title} · ${input}`,
        classType: node.class_type,
        valueType: classifyValue(value),
      };
      if (typeof value === "string") {
        if (/negative|反向|负面/.test(haystack))
          candidates.parameters.negative_prompt.push(candidate);
        else if (includesAny(haystack, [/prompt/, /positive/, /text/, /提示词/, /文本/])) {
          candidates.parameters.prompt.push(candidate);
        }
      }
      if (typeof value === "number") {
        if (/noise_seed|\bseed\b|种子/.test(haystack)) candidates.parameters.seed.push(candidate);
        if (/\bsteps?\b|步数/.test(haystack)) candidates.parameters.steps.push(candidate);
        if (/\bwidth\b|宽度/.test(haystack)) candidates.parameters.width.push(candidate);
        if (/\bheight\b|高度/.test(haystack)) candidates.parameters.height.push(candidate);
        if (/duration|seconds?|时长/.test(haystack)) candidates.parameters.duration.push(candidate);
        if (/\bfps\b|frame.?rate|帧率/.test(haystack)) candidates.parameters.fps.push(candidate);
      }
      if (typeof value !== "string") continue;
      if (/loadimage|load image|加载图/.test(haystack)) {
        candidates.media.first_frame.push(candidate);
        candidates.media.last_frame.push(candidate);
        candidates.media.reference_image.push(candidate);
      }
      if (/loadvideo|load video|加载视频/.test(haystack)) {
        candidates.media.reference_video.push(candidate);
      }
      if (/loadaudio|load audio|加载音频/.test(haystack)) {
        candidates.media.reference_audio.push(candidate);
      }
    }
  }
  return candidates;
}

export function suggestedBinding(
  path: string,
  hash: string,
  capability: WorkflowCapability,
  outputMediaType: WorkflowOutputMediaType,
  candidates: WorkflowBindingCandidates,
) {
  const one = (items: WorkflowBindingCandidate[]) =>
    items[0] ? [{ nodeId: items[0].nodeId, input: items[0].input }] : undefined;
  const all = (items: WorkflowBindingCandidate[]) =>
    items.length > 0 ? items.map(({ nodeId, input }) => ({ nodeId, input })) : undefined;
  return {
    version: workflowBindingVersion,
    workflowPath: path,
    workflowHash: hash,
    capability,
    outputMediaType,
    parameters: {
      prompt: one(candidates.parameters.prompt),
      negative_prompt: one(candidates.parameters.negative_prompt),
      seed: all(candidates.parameters.seed),
      steps: all(candidates.parameters.steps),
      width: all(candidates.parameters.width),
      height: all(candidates.parameters.height),
      duration: all(candidates.parameters.duration),
      fps: all(candidates.parameters.fps),
    },
    media: {
      first_frame: one(candidates.media.first_frame),
      last_frame: undefined,
      reference_image: undefined,
      reference_video: one(candidates.media.reference_video),
      reference_audio: one(candidates.media.reference_audio),
    },
  };
}

function targetExists(prompt: ComfyPrompt, target: WorkflowBindingTarget) {
  const node = prompt[target.nodeId];
  return Boolean(node && target.input in node.inputs);
}

export function validateWorkflowBinding(prompt: ComfyPrompt, binding: WorkflowBinding) {
  const issues: string[] = [];
  for (const [key, targets] of Object.entries({ ...binding.parameters, ...binding.media })) {
    for (const target of targets ?? []) {
      if (!targetExists(prompt, target))
        issues.push(`${key}：节点 ${target.nodeId}.${target.input} 不存在`);
    }
  }
  if (!(binding.parameters.prompt?.length ?? 0)) issues.push("缺少提示词绑定");
  if (
    ["image_to_image", "image_to_video", "first_last_video"].includes(binding.capability) &&
    !(binding.media.first_frame?.length ?? 0)
  ) {
    issues.push("该能力缺少起始图片绑定");
  }
  if (binding.capability === "first_last_video" && !(binding.media.last_frame?.length ?? 0)) {
    issues.push("首尾帧能力缺少结束图片绑定");
  }
  if (
    binding.capability === "reference_video" &&
    (binding.media.reference_image?.length ?? 0) +
      (binding.media.reference_video?.length ?? 0) +
      (binding.media.reference_audio?.length ?? 0) ===
      0
  ) {
    issues.push("参考生成能力至少需要一个参考素材绑定");
  }
  const outputClasses = Object.values(prompt).map((node) => node.class_type.toLowerCase());
  const outputDetected = outputClasses.some((classType) =>
    binding.outputMediaType === "image"
      ? /save.*image|previewimage/.test(classType)
      : /save.*video|videocombine|createvideo|saveanimated/.test(classType),
  );
  if (!outputDetected)
    issues.push(`未检测到${binding.outputMediaType === "image" ? "图片" : "视频"}输出节点`);
  return issues;
}

export async function inspectWorkflowForBinding(comfyUrl: string, path: string) {
  const workflow = await fetchWorkflowDocument(comfyUrl, path);
  const hash = workflowHash(workflow);
  const objectInfo = await fetchComfyObjectInfo(comfyUrl);
  const prompt = convertUiWorkflowToPrompt(workflow, objectInfo);
  const candidates = discoverBindingCandidates(prompt);
  return { workflow, workflowHash: hash, prompt, candidates, objectInfo };
}

export function preflightPromptAgainstObjectInfo(prompt: ComfyPrompt, objectInfo: ComfyObjectInfo) {
  const issues: string[] = [];
  for (const [nodeId, node] of Object.entries(prompt)) {
    const definition = objectInfo[node.class_type];
    if (!definition) {
      issues.push(`${nodeId}：当前 ComfyUI 缺少节点 ${node.class_type}`);
      continue;
    }
    for (const field of Object.keys(definition.input?.required ?? {})) {
      if (!(field in node.inputs)) issues.push(`${nodeId}：缺少必需输入 ${field}`);
    }
  }
  return issues;
}

export async function loadExecutableWorkflow(comfyUrl: string, path: string) {
  const binding = await readWorkflowBinding(comfyUrl, path);
  if (!binding) throw new Error("该工作流尚未建立并信任 TakeBoard 参数绑定");
  const inspected = await inspectWorkflowForBinding(comfyUrl, path);
  if (binding.workflowHash !== inspected.workflowHash) {
    throw new Error("工作流内容已变化，原参数绑定已失效；请重新检查并确认");
  }
  const issues = validateWorkflowBinding(inspected.prompt, binding);
  if (issues.length > 0) throw new Error(`工作流绑定无效：${issues.slice(0, 5).join("；")}`);
  return { ...inspected, binding };
}

export type GenericWorkflowValues = Partial<Record<WorkflowParameterKey, string | number>> & {
  firstFrame?: string;
  lastFrame?: string;
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
  filenamePrefix: string;
};

function applyTargets(
  prompt: ComfyPrompt,
  targets: WorkflowBindingTarget[] | undefined,
  value: unknown,
) {
  if (value === undefined) return;
  for (const target of targets ?? []) {
    const node = prompt[target.nodeId];
    if (node) node.inputs[target.input] = value;
  }
}

export function applyWorkflowBinding(
  source: ComfyPrompt,
  binding: WorkflowBinding,
  values: GenericWorkflowValues,
) {
  const prompt = structuredClone(source);
  for (const key of parameterKeys) applyTargets(prompt, binding.parameters[key], values[key]);
  applyTargets(prompt, binding.media.first_frame, values.firstFrame);
  applyTargets(prompt, binding.media.last_frame, values.lastFrame);
  const mediaValues: Array<[WorkflowBindingTarget[] | undefined, string[] | undefined]> = [
    [binding.media.reference_image, values.referenceImages],
    [binding.media.reference_video, values.referenceVideos],
    [binding.media.reference_audio, values.referenceAudios],
  ];
  for (const [targets, files] of mediaValues) {
    (targets ?? []).forEach((target, index) => {
      applyTargets(prompt, [target], files?.[index]);
    });
  }
  for (const node of Object.values(prompt)) {
    if (!/save|output|combine|createvideo/i.test(node.class_type)) continue;
    for (const field of ["filename_prefix", "filename", "output_name", "save_path"]) {
      if (field in node.inputs && typeof node.inputs[field] === "string") {
        node.inputs[field] = values.filenamePrefix;
      }
    }
  }
  return prompt;
}
