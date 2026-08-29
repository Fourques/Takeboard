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
  | "denoise"
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
  transform?: WorkflowBindingTransform;
};

export type WorkflowBindingTransform =
  | "seconds_to_frames"
  | "seconds_to_frames_plus_one"
  | "seconds_to_frames_minus_one";

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
  suggestedTransform?: WorkflowBindingTransform;
};

export type WorkflowBindingCandidates = {
  parameters: Record<WorkflowParameterKey, WorkflowBindingCandidate[]>;
  media: Record<WorkflowMediaKey, WorkflowBindingCandidate[]>;
};

export type WorkflowDocument = UiWorkflow | ComfyPrompt;

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
const bindingProposalPath = (path: string) =>
  `takeboard/binding-proposals/${Buffer.from(path).toString("base64url")}.json`;

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

export function parseWorkflowBinding(value: unknown, expectedPath?: string) {
  const binding = value as Partial<WorkflowBinding> | null;
  const targetGroupValid = (group: unknown) =>
    Boolean(
      group &&
        typeof group === "object" &&
        Object.values(group).every(
          (targets) =>
            Array.isArray(targets) &&
            targets.length <= 32 &&
            targets.every((target) => {
              const candidate = target as WorkflowBindingTarget;
              return Boolean(
                target &&
                  typeof target === "object" &&
                  typeof candidate.nodeId === "string" &&
                  candidate.nodeId.length <= 200 &&
                  typeof candidate.input === "string" &&
                  candidate.input.length <= 200 &&
                  (candidate.transform === undefined || bindingTransforms.has(candidate.transform)),
              );
            }),
        ),
    );
  if (
    !binding ||
    binding.version !== workflowBindingVersion ||
    (expectedPath !== undefined && binding.workflowPath !== expectedPath) ||
    typeof binding.workflowPath !== "string" ||
    !isWorkflowPath(binding.workflowPath) ||
    binding.trusted !== true ||
    typeof binding.workflowHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(binding.workflowHash) ||
    typeof binding.verifiedAt !== "string" ||
    Number.isNaN(Date.parse(binding.verifiedAt)) ||
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
}

export async function readWorkflowBinding(comfyUrl: string, path: string) {
  try {
    return parseWorkflowBinding(await fetchJson(comfyUrl, bindingPath(path)), path);
  } catch {
    return null;
  }
}

export async function readWorkflowBindingProposal(comfyUrl: string, path: string) {
  try {
    return parseWorkflowBinding(await fetchJson(comfyUrl, bindingProposalPath(path)), path);
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

export async function writeWorkflowBindingProposal(
  comfyUrl: string,
  path: string,
  binding: WorkflowBinding,
) {
  const response = await fetch(
    `${comfyUrl}/api/userdata/${encodeURIComponent(bindingProposalPath(path))}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(binding),
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) throw new Error(`ComfyUI 保存 Recipe 映射草案失败：${response.status}`);
}

const parameterKeys: WorkflowParameterKey[] = [
  "prompt",
  "negative_prompt",
  "seed",
  "steps",
  "denoise",
  "width",
  "height",
  "duration",
  "fps",
];
const bindingTransforms = new Set<WorkflowBindingTransform>([
  "seconds_to_frames",
  "seconds_to_frames_plus_one",
  "seconds_to_frames_minus_one",
]);
function emptyCandidates(): WorkflowBindingCandidates {
  return {
    parameters: {
      prompt: [],
      negative_prompt: [],
      seed: [],
      steps: [],
      denoise: [],
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
        const inputName = input.toLowerCase();
        const nodeHaystack = `${title} ${node.class_type}`.toLowerCase();
        const loaderLike =
          /(?:loader|checkpoint|model loader|加载模型|模型加载)/.test(nodeHaystack) ||
          /(?:^|_)(?:name|path|model)(?:$|_)/.test(inputName);
        const promptInput = /^(?:text|prompt|positive|positive_prompt|caption|description)$/.test(
          inputName,
        );
        const promptNode = /prompt|positive|提示词|文本/.test(nodeHaystack);
        if (/negative|反向|负向|负面/.test(haystack))
          candidates.parameters.negative_prompt.push(candidate);
        else if (!loaderLike && (promptInput || (promptNode && /text|prompt/.test(inputName)))) {
          candidates.parameters.prompt.push(candidate);
        }
      }
      if (typeof value === "number") {
        const inputName = input.toLowerCase();
        const genericNumericInput = /^(?:value|number|integer|int|float)$/.test(inputName);
        const titleHaystack = `${title} ${node.class_type}`.toLowerCase();
        if (
          /(?:^|_)noise_seed$|(?:^|_)seed(?:$|_)/.test(inputName) ||
          (genericNumericInput && /\bseed\b|种子/.test(titleHaystack))
        )
          candidates.parameters.seed.push(candidate);
        if (
          /(?:^|_)steps?(?:$|_)/.test(inputName) ||
          (genericNumericInput && /\bsteps?\b|步数/.test(titleHaystack))
        )
          candidates.parameters.steps.push(candidate);
        if (
          /(?:^|_)denois(?:e|ing)(?:$|_)/.test(inputName) ||
          (genericNumericInput && /denoise|denoising|重绘强度|降噪/.test(titleHaystack))
        )
          candidates.parameters.denoise.push(candidate);
        if (
          /(?:^|_)width(?:$|_)/.test(inputName) ||
          (genericNumericInput && /\bwidth\b|宽度/.test(titleHaystack))
        )
          candidates.parameters.width.push(candidate);
        if (
          /(?:^|_)height(?:$|_)/.test(inputName) ||
          (genericNumericInput && /\bheight\b|高度/.test(titleHaystack))
        )
          candidates.parameters.height.push(candidate);
        const frameRateInput =
          /(?:^|_)fps(?:$|_)|frame.?rate/.test(inputName) ||
          (genericNumericInput && /\bfps\b|frame.?rate|帧率/.test(titleHaystack));
        const frameCountInput =
          !frameRateInput &&
          (/(?:^|_)(?:num_?)?frames?(?:$|_)|frame.?count|video.?length/.test(inputName) ||
            (genericNumericInput && /frame.?count|num.?frames|帧数/.test(titleHaystack)));
        if (frameCountInput) {
          candidates.parameters.duration.push({
            ...candidate,
            label: `${candidate.label} · 按 FPS 换算帧数`,
            suggestedTransform: "seconds_to_frames",
          });
        } else if (
          /duration|seconds?/.test(inputName) ||
          (genericNumericInput && /duration|seconds?|时长/.test(titleHaystack))
        ) {
          candidates.parameters.duration.push(candidate);
        }
        if (frameRateInput) candidates.parameters.fps.push(candidate);
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
  const target = ({ nodeId, input, suggestedTransform }: WorkflowBindingCandidate) => ({
    nodeId,
    input,
    ...(suggestedTransform ? { transform: suggestedTransform } : {}),
  });
  const one = (items: WorkflowBindingCandidate[]) => (items[0] ? [target(items[0])] : undefined);
  const all = (items: WorkflowBindingCandidate[]) =>
    items.length > 0 ? items.map(target) : undefined;
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
      denoise: all(candidates.parameters.denoise),
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
  for (const [key, targets] of Object.entries(binding.parameters)) {
    for (const target of targets ?? []) {
      if (!targetExists(prompt, target))
        issues.push(`${key}：节点 ${target.nodeId}.${target.input} 不存在`);
      if (target.transform && key !== "duration") {
        issues.push(`${key}：只有时长输入可以使用帧数换算`);
      }
    }
  }
  for (const [key, targets] of Object.entries(binding.media)) {
    for (const target of targets ?? []) {
      if (!targetExists(prompt, target))
        issues.push(`${key}：节点 ${target.nodeId}.${target.input} 不存在`);
      if (target.transform) issues.push(`${key}：素材输入不能使用数值换算`);
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
  return inspectWorkflowDocument(workflow, objectInfo, hash);
}

export function inspectWorkflowDocument(
  workflow: unknown,
  objectInfo: ComfyObjectInfo,
  hash = workflowHash(workflow),
) {
  const prompt = convertUiWorkflowToPrompt(workflow as WorkflowDocument, objectInfo);
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
  fps?: number,
) {
  if (value === undefined) return;
  for (const target of targets ?? []) {
    const node = prompt[target.nodeId];
    if (!node) continue;
    let resolved = value;
    if (target.transform && typeof value === "number" && typeof fps === "number") {
      const frames = Math.max(1, Math.round(value * fps));
      if (target.transform === "seconds_to_frames") resolved = frames;
      if (target.transform === "seconds_to_frames_plus_one") resolved = frames + 1;
      if (target.transform === "seconds_to_frames_minus_one") resolved = Math.max(1, frames - 1);
    }
    node.inputs[target.input] = resolved;
  }
}

export function applyWorkflowBinding(
  source: ComfyPrompt,
  binding: WorkflowBinding,
  values: GenericWorkflowValues,
) {
  const prompt = structuredClone(source);
  for (const key of parameterKeys) {
    applyTargets(
      prompt,
      binding.parameters[key],
      values[key],
      typeof values.fps === "number" ? values.fps : undefined,
    );
  }
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
