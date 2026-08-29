import {
  applyNodeChanges,
  Background,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type Asset,
  type CanvasItem,
  type CommandAuditEntry,
  type ProjectCommandPreview,
  type ProjectSnapshot,
  type Run,
  resolveGenerationResolution,
  type Shot,
  type Take,
} from "@takeboard/contracts";
import {
  lazy,
  type MouseEvent as ReactMouseEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  demoApi,
  type ProjectCatalogItem,
  projectApi,
  type TrashedProjectItem,
  type WorkerStatus,
  type WorkflowSummary,
  workflowApi,
} from "./api";
import { AccountButton, useAuth } from "./auth-ui";
import { type BoardNode, boardNodeTypes } from "./board-nodes";
import { DisplaySettings } from "./display-settings";
import {
  loadModelPreferences,
  type ModelProfile,
  modelProfile,
  saveModelPreferences,
  workflowInputSlots,
} from "./model-profiles";
import { NumericInput } from "./numeric-input";
import { ThemeSwitcher } from "./theme-switcher";

const AssetLibrary = lazy(() =>
  import("./asset-library").then((module) => ({ default: module.AssetLibrary })),
);
const CommandHistory = lazy(() =>
  import("./command-history").then((module) => ({ default: module.CommandHistory })),
);
const RecipeStudio = lazy(() =>
  import("./recipe-studio").then((module) => ({ default: module.RecipeStudio })),
);
const Storyboard = lazy(() =>
  import("./storyboard").then((module) => ({ default: module.Storyboard })),
);
const OperationsCenter = lazy(() =>
  import("./operations-center").then((module) => ({ default: module.OperationsCenter })),
);
const ProjectHub = lazy(() =>
  import("./project-hub").then((module) => ({ default: module.ProjectHub })),
);

const rejectionReasons = ["角色漂移", "运动方向错误", "构图不稳定", "细节异常"];
const canvasSnapGrid: [number, number] = [12, 12];
const alignmentThreshold = 7;

type GenerationSettings = {
  recipePath: string;
  prompt: string;
  negativePrompt: string;
  firstFrameAssetId: string | null;
  lastFrameAssetId: string | null;
  referenceAssetId: string | null;
  referenceImageSize: "match" | "max";
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  seed: number;
  steps: number;
  denoise: number;
};

type PromptMention = {
  assetId: string;
  alias: string;
  role: string;
  canonicalToken: string;
  thumbnailUrl: string | undefined;
};

type ShotCanvasControls = {
  settings: GenerationSettings;
  workflows: WorkflowSummary[];
  workflowLocked: boolean;
  mentionAliases: string[];
  busy: boolean;
  progress: GenerationProgress | null;
  disabledReason: string | null;
  onWorkflowChange: (path: string) => void;
  onSettingsChange: (input: Partial<GenerationSettings>) => void;
  onGenerate: (input: Partial<GenerationSettings>) => void;
  onOpenDetails: () => void;
  onCommitTitle: (title: string) => void;
};

const defaultGenerationSettings: GenerationSettings = {
  recipePath: "Kino/Kino_Wan22_I2V.json",
  prompt: "",
  negativePrompt: "",
  firstFrameAssetId: null,
  lastFrameAssetId: null,
  referenceAssetId: null,
  referenceImageSize: "match",
  width: 480,
  height: 848,
  durationSeconds: 5,
  fps: 16,
  seed: 26081301,
  steps: 20,
  denoise: 0.65,
};

const nativeWorkflowFallbacks: WorkflowSummary[] = [
  {
    id: "native-wan22-i2v",
    path: "Kino/Kino_Wan22_I2V.json",
    name: "Wan 2.2 I2V · 高质量",
    capability: "image_to_video",
    capabilityLabel: "图生视频",
    inputs: [
      "prompt",
      "negative_prompt",
      "first_frame",
      "resolution",
      "duration",
      "fps",
      "seed",
      "steps",
    ],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-wan22-flf2v",
    path: "Kino/Kino_Wan22_FLF2V.json",
    name: "Wan 2.2 首尾帧 · 高质量",
    capability: "first_last_video",
    capabilityLabel: "首尾帧视频",
    inputs: [
      "prompt",
      "negative_prompt",
      "first_frame",
      "last_frame",
      "resolution",
      "duration",
      "fps",
      "seed",
      "steps",
    ],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-wan22-i2v-preview",
    path: "Kino/Kino_Wan22_I2V_Preview.json",
    name: "Wan 2.2 I2V · 快速预演",
    capability: "image_to_video",
    capabilityLabel: "图生视频",
    inputs: ["prompt", "negative_prompt", "first_frame", "resolution", "duration", "fps", "seed"],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-wan22-flf2v-preview",
    path: "Kino/Kino_Wan22_FLF2V_Preview.json",
    name: "Wan 2.2 首尾帧 · 快速预演",
    capability: "first_last_video",
    capabilityLabel: "首尾帧视频",
    inputs: [
      "prompt",
      "negative_prompt",
      "first_frame",
      "last_frame",
      "resolution",
      "duration",
      "fps",
      "seed",
    ],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-minimax-h3-i2v",
    path: "Kino/Kino_MinimaxH3_I2V.json",
    name: "MiniMax H3 I2V · 原生音画",
    capability: "image_to_video",
    capabilityLabel: "图生视频",
    inputs: [
      "prompt",
      "first_frame",
      "last_frame",
      "resolution",
      "duration",
      "fps",
      "seed",
      "steps",
    ],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-minimax-h3-t2v",
    path: "Kino/Kino_MinimaxH3_T2V.json",
    name: "MiniMax H3 T2V · 原生音画",
    capability: "text_to_video",
    capabilityLabel: "文生视频",
    inputs: ["prompt", "resolution", "duration", "fps", "seed", "steps"],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-minimax-h3-r2v",
    path: "Kino/Kino_MinimaxH3_R2V.json",
    name: "MiniMax H3 Ref2VA · 多模态参考",
    capability: "reference_video",
    capabilityLabel: "参考生成视频",
    inputs: [
      "prompt",
      "reference_images",
      "reference_videos",
      "reference_audio",
      "resolution",
      "duration",
      "fps",
      "seed",
      "steps",
    ],
    mediaInputs: {
      first_frame: 0,
      last_frame: 0,
      reference: 9,
      reference_video: 3,
      reference_audio: 3,
    },
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-ltx23-i2v",
    path: "Kino/Kino_LTX23_I2V_Draft.json",
    name: "LTX23 I2V Draft",
    capability: "image_to_video",
    capabilityLabel: "图生视频",
    inputs: ["prompt", "first_frame", "resolution", "duration", "fps", "seed"],
    models: [],
    nodeCount: 0,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-qwen-image-2512-t2i",
    path: "Kino/Kino_QwenImage2512_T2I.json",
    name: "Qwen Image 2512 T2I",
    capability: "text_to_image",
    capabilityLabel: "文生图",
    inputs: ["prompt", "negative_prompt", "resolution", "seed", "steps"],
    models: ["qwen_image_2512_fp8_e4m3fn.safetensors"],
    nodeCount: 10,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
  {
    id: "native-qwen-image-2512-i2i",
    path: "Kino/Kino_QwenImage2512_I2I.json",
    name: "Qwen Image 2512 I2I",
    capability: "image_to_image",
    capabilityLabel: "图生图",
    inputs: ["prompt", "negative_prompt", "first_frame", "resolution", "seed", "steps", "denoise"],
    models: ["qwen_image_2512_fp8_e4m3fn.safetensors"],
    nodeCount: 11,
    source: "comfyui",
    editorUrl: "http://127.0.0.1:48188",
    execution: "native",
  },
];

function shortId(value: string) {
  return value.slice(-6).toUpperCase();
}

function runWorkflowPath(snapshot: ProjectSnapshot, shotId: string) {
  const value = [...snapshot.runs].reverse().find((run) => run.shotId === shotId)
    ?.parameters.recipePath;
  return typeof value === "string" ? value : null;
}

function findWorkflow(path: string | null | undefined, workflows: WorkflowSummary[]) {
  if (!path) return null;
  return (
    workflows.find((workflow) => workflow.path === path) ??
    nativeWorkflowFallbacks.find((workflow) => workflow.path === path) ??
    null
  );
}

function boardNodes(
  snapshot: ProjectSnapshot,
  selectedCanvasItemId: string | null,
  projectKey: string | null,
  workflows: WorkflowSummary[],
  selectedWorkflow: WorkflowSummary | null,
  selectedShotId: string | null,
  controls: ShotCanvasControls | null,
): BoardNode[] {
  return snapshot.canvasItems.map((item): BoardNode => {
    const common = {
      id: item.id,
      position: { x: item.x, y: item.y },
      style: { width: item.width },
      type: item.refType,
      selected: selectedCanvasItemId === item.id,
    };
    if (item.refType === "text") {
      const text = snapshot.textItems.find((candidate) => candidate.id === item.refId);
      return {
        ...common,
        data: {
          kind: "text",
          eyebrow: text?.kind === "script" ? "SCRIPT" : "NOTE",
          title: text?.title ?? "文字",
          body: text?.body ?? "",
          selected: selectedCanvasItemId === item.id,
        },
      };
    }
    if (item.refType === "entity") {
      const entity = snapshot.entities.find((candidate) => candidate.id === item.refId);
      const referenceAsset = snapshot.assets.find((asset) =>
        entity?.referenceAssetIds.includes(asset.id),
      );
      return {
        ...common,
        data: {
          kind: "entity",
          eyebrow:
            entity?.kind === "character"
              ? "CHARACTER"
              : entity?.kind === "location"
                ? "LOCATION"
                : "PROP",
          title: entity?.name ?? "角色",
          body: entity?.description ?? "",
          selected: selectedCanvasItemId === item.id,
          mediaUrl:
            projectKey && referenceAsset
              ? projectApi.assetUrl(projectKey, referenceAsset.id)
              : undefined,
          mediaWidth: referenceAsset?.width ?? undefined,
          mediaHeight: referenceAsset?.height ?? undefined,
          details: [
            `${entity?.referenceAssetIds.length ?? 0} 张参考`,
            entity?.kind === "character"
              ? "人物资产"
              : entity?.kind === "location"
                ? "场景资产"
                : "道具资产",
          ],
        },
      };
    }
    if (item.refType === "asset") {
      const asset = snapshot.assets.find((candidate) => candidate.id === item.refId);
      return {
        ...common,
        data: {
          kind: "asset",
          eyebrow: "LOCATION",
          title: asset?.originalName.includes("ferry")
            ? "雾港旧渡口"
            : (asset?.originalName ?? "素材"),
          body: "",
          selected: selectedCanvasItemId === item.id,
          mediaUrl: projectKey && asset ? projectApi.assetUrl(projectKey, asset.id) : undefined,
          mediaType: asset?.mediaType,
          mediaWidth: asset?.width ?? undefined,
          mediaHeight: asset?.height ?? undefined,
          details: [
            asset?.width && asset?.height ? `${asset.width} × ${asset.height}` : "尺寸待识别",
            asset?.mimeType.split("/").at(-1)?.toUpperCase() ?? "IMAGE",
          ],
        },
      };
    }

    const shot = snapshot.shots.find((candidate) => candidate.id === item.refId);
    const workflow =
      findWorkflow(shot?.workflowPath ?? runWorkflowPath(snapshot, item.refId), workflows) ??
      (item.refId === selectedShotId ? selectedWorkflow : null);
    const profile = modelProfile(workflow, shot?.aspectRatio ?? "16:9");
    const takes = snapshot.takes.filter((take) => take.shotId === item.refId);
    if (item.refType === "take_stack") {
      return {
        ...common,
        data: {
          kind: "take_stack",
          eyebrow: "TAKE STACK",
          title: shot?.label ?? "镜头",
          body: "",
          status: shot?.status,
          takeCount: takes.length,
          rejectedCount: takes.filter((take) => take.status === "rejected").length,
          selected: selectedCanvasItemId === item.id,
        },
      };
    }
    const previewTake =
      takes.find((take) => take.id === shot?.approvedTakeId) ??
      [...takes].reverse().find((take) => take.status !== "rejected");
    const previewAsset = snapshot.assets.find((asset) => asset.id === previewTake?.assetId);
    return {
      ...common,
      style: {
        width: Math.max(item.width, 470),
      },
      data: {
        kind: "shot",
        eyebrow: "SHOT",
        title: shot?.label ?? "镜头",
        body: shot?.intent ?? "",
        status: shot?.status,
        duration: shot?.durationSeconds,
        takeCount: takes.length,
        engine: workflow?.name ?? "未选择模型",
        mediaUrl:
          projectKey && previewAsset ? projectApi.assetUrl(projectKey, previewAsset.id) : undefined,
        mediaType: previewAsset?.mediaType,
        mediaWidth: previewAsset?.width ?? undefined,
        mediaHeight: previewAsset?.height ?? undefined,
        aspectRatio: shot?.aspectRatio,
        selected: selectedCanvasItemId === item.id,
        details: [
          shot?.aspectRatio ?? "未设画幅",
          profile.slots.length
            ? `${profile.slots.reduce((sum, slot) => sum + slot.maxCount, 0)} 个画面位置`
            : "纯文字输入",
          profile.outputLabel,
        ],
        inputSlots: profile.slots.map(({ id, label, maxCount, required, mediaType }) => ({
          id,
          label,
          connectedCount: snapshot.canvasEdges.filter(
            (edge) => edge.targetItemId === item.id && edge.targetSlot === id,
          ).length,
          maxCount,
          required,
          mediaType,
        })),
        ...(selectedCanvasItemId === item.id && controls
          ? {
              inlineControls: {
                workflowPath: controls.settings.recipePath,
                workflows: controls.workflows.map((candidate) => ({
                  path: candidate.path,
                  name: candidate.name,
                  capability: candidate.capability,
                  capabilityLabel: candidate.capabilityLabel,
                })),
                workflowLocked: controls.workflowLocked,
                prompt: controls.settings.prompt,
                width: controls.settings.width,
                height: controls.settings.height,
                durationSeconds: controls.settings.durationSeconds,
                seed: controls.settings.seed,
                outputLabel: profile.outputLabel,
                mentionAliases: controls.mentionAliases,
                busy: controls.busy,
                progress: controls.progress,
                disabledReason: controls.disabledReason,
                onWorkflowChange: controls.onWorkflowChange,
                onSettingsChange: controls.onSettingsChange,
                onGenerate: controls.onGenerate,
                onOpenDetails: controls.onOpenDetails,
                onCommitTitle: controls.onCommitTitle,
              },
            }
          : {}),
      },
    };
  });
}

function boardEdges(
  snapshot: ProjectSnapshot,
  workflows: WorkflowSummary[],
  selectedWorkflow: WorkflowSummary | null,
  selectedShotId: string | null,
  selectedEdgeId: string | null,
): Edge[] {
  const slotMeta = {
    first_frame: { label: "首帧", color: "#65cba5" },
    last_frame: { label: "尾帧", color: "#d6a95f" },
    reference: { label: "参考", color: "#9e8cff" },
    reference_video: { label: "参考视频", color: "#63a9d8" },
    reference_audio: { label: "参考音频", color: "#dd8bb5" },
  } as const;
  return snapshot.canvasEdges
    .filter((edge) => {
      if (!edge.targetSlot) return true;
      const targetItem = snapshot.canvasItems.find((item) => item.id === edge.targetItemId);
      const shot = snapshot.shots.find((candidate) => candidate.id === targetItem?.refId);
      const workflow =
        findWorkflow(shot?.workflowPath ?? runWorkflowPath(snapshot, shot?.id ?? ""), workflows) ??
        (shot?.id === selectedShotId ? selectedWorkflow : null);
      return workflowInputSlots(workflow).some((slot) => slot.id === edge.targetSlot);
    })
    .map((edge) => ({
      id: edge.id,
      source: edge.sourceItemId,
      target: edge.targetItemId,
      ...(edge.targetSlot ? { sourceHandle: "media", targetHandle: edge.targetSlot } : {}),
      selected: edge.id === selectedEdgeId,
      label: edge.targetSlot ? slotMeta[edge.targetSlot].label : undefined,
      labelStyle: {
        fill: edge.targetSlot ? slotMeta[edge.targetSlot].color : "#89928f",
        fontSize: 10,
        fontWeight: 700,
      },
      labelBgStyle: { fill: "rgba(15, 19, 18, .88)", fillOpacity: 1 },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 5,
      type: "smoothstep",
      animated: edge.relation === "generated_from",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#66716e", width: 16, height: 16 },
      style: {
        stroke:
          edge.relation === "generated_from"
            ? "#d6a95f"
            : edge.targetSlot
              ? slotMeta[edge.targetSlot].color
              : "#58635f",
        strokeWidth: edge.relation === "generated_from" ? 2 : 1.25,
      },
    }));
}

function resolveSnapshotEdge(snapshot: ProjectSnapshot, edge: Edge) {
  const byId = snapshot.canvasEdges.find((candidate) => candidate.id === edge.id);
  if (byId) return byId;
  const targetSlot = edge.targetHandle;
  const exactConnection = [...snapshot.canvasEdges]
    .reverse()
    .find(
      (candidate) =>
        candidate.sourceItemId === edge.source &&
        candidate.targetItemId === edge.target &&
        (targetSlot ? candidate.targetSlot === targetSlot : !candidate.targetSlot),
    );
  if (exactConnection) return exactConnection;
  const targetCandidates = snapshot.canvasEdges.filter(
    (candidate) => candidate.targetItemId === edge.target,
  );
  return targetCandidates.length === 1 ? targetCandidates[0] : undefined;
}

function edgeIdentityFromPointer(event: ReactMouseEvent): CanvasEdgeIdentity | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const edgeElement = target.closest(".react-flow__edge");
  const labelledElement =
    edgeElement?.querySelector('[aria-label^="Edge from "]') ??
    (edgeElement?.matches('[aria-label^="Edge from "]') ? edgeElement : null);
  const label = labelledElement?.getAttribute("aria-label") ?? "";
  const match = /^Edge from (\S+) to (\S+)$/.exec(label);
  if (!match) return null;
  const visibleLabel = edgeElement?.textContent ?? "";
  const targetSlot = visibleLabel.includes("参考音频")
    ? "reference_audio"
    : visibleLabel.includes("参考视频")
      ? "reference_video"
      : visibleLabel.includes("首帧")
        ? "first_frame"
        : visibleLabel.includes("尾帧")
          ? "last_frame"
          : visibleLabel.includes("参考")
            ? "reference"
            : null;
  return { sourceItemId: match[1] as string, targetItemId: match[2] as string, targetSlot };
}

function gentlyAlignedPosition(node: BoardNode, nodes: BoardNode[]) {
  let x = Math.round(node.position.x / canvasSnapGrid[0]) * canvasSnapGrid[0];
  let y = Math.round(node.position.y / canvasSnapGrid[1]) * canvasSnapGrid[1];
  const width = node.measured?.width ?? 0;
  const height = node.measured?.height ?? 0;
  let closestX = alignmentThreshold + 1;
  let closestY = alignmentThreshold + 1;
  let alignXBy = 0;
  let alignYBy = 0;

  for (const other of nodes) {
    if (other.id === node.id) continue;
    const otherWidth = other.measured?.width ?? 0;
    const otherHeight = other.measured?.height ?? 0;
    const horizontalDeltas = [
      other.position.x - x,
      other.position.x + otherWidth / 2 - (x + width / 2),
      other.position.x + otherWidth - (x + width),
    ];
    const verticalDeltas = [
      other.position.y - y,
      other.position.y + otherHeight / 2 - (y + height / 2),
      other.position.y + otherHeight - (y + height),
    ];
    for (const delta of horizontalDeltas) {
      if (Math.abs(delta) < closestX && Math.abs(delta) <= alignmentThreshold) {
        closestX = Math.abs(delta);
        alignXBy = delta;
      }
    }
    for (const delta of verticalDeltas) {
      if (Math.abs(delta) < closestY && Math.abs(delta) <= alignmentThreshold) {
        closestY = Math.abs(delta);
        alignYBy = delta;
      }
    }
  }
  x += alignXBy;
  y += alignYBy;
  return { x, y };
}

function sourceAssetId(
  snapshot: ProjectSnapshot,
  source: ProjectSnapshot["canvasItems"][number] | undefined,
  mediaType: "image" | "video" | "audio",
) {
  if (source?.refType === "asset") return source.refId;
  if (source?.refType === "entity") {
    const entity = snapshot.entities.find((candidate) => candidate.id === source.refId);
    return (
      entity?.referenceAssetIds.find((assetId) =>
        snapshot.assets.some((asset) => asset.id === assetId && asset.mediaType === mediaType),
      ) ?? null
    );
  }
  if (source?.refType === "shot") {
    const shot = snapshot.shots.find((candidate) => candidate.id === source.refId);
    const take =
      snapshot.takes.find((candidate) => candidate.id === shot?.approvedTakeId) ??
      [...snapshot.takes]
        .reverse()
        .find((candidate) => candidate.shotId === source.refId && candidate.status !== "rejected");
    return snapshot.assets.some(
      (asset) => asset.id === take?.assetId && asset.mediaType === mediaType,
    )
      ? (take?.assetId ?? null)
      : null;
  }
  return null;
}

function connectedAssetId(
  snapshot: ProjectSnapshot,
  targetShotId: string,
  slot: "first_frame" | "last_frame" | "reference" | "reference_video" | "reference_audio",
) {
  const targetItem = snapshot.canvasItems.find(
    (item) => item.refType === "shot" && item.refId === targetShotId,
  );
  const edge = snapshot.canvasEdges.find(
    (candidate) => candidate.targetItemId === targetItem?.id && candidate.targetSlot === slot,
  );
  const source = snapshot.canvasItems.find((item) => item.id === edge?.sourceItemId);
  return sourceAssetId(
    snapshot,
    source,
    slot === "reference_video" ? "video" : slot === "reference_audio" ? "audio" : "image",
  );
}

function compileMiniMaxH3Mentions(prompt: string, mentions: PromptMention[]) {
  return [...mentions]
    .sort((a, b) => b.alias.length - a.alias.length)
    .reduce(
      (compiled, mention) => compiled.replaceAll(`@${mention.alias}`, mention.canonicalToken),
      prompt,
    );
}

function CandidateArt({
  index,
  approved,
  source,
  mediaType,
}: {
  index: number;
  approved: boolean;
  source: string | undefined;
  mediaType: Asset["mediaType"] | undefined;
}) {
  return (
    <div className={`candidate-art candidate-${index + 1}`}>
      {source && mediaType === "image" ? (
        <img src={source} alt="生成候选" />
      ) : source ? (
        <video
          src={source}
          muted
          loop
          playsInline
          onMouseEnter={(event) => void event.currentTarget.play()}
          onMouseLeave={(event) => {
            event.currentTarget.pause();
            event.currentTarget.currentTime = 0;
          }}
        />
      ) : (
        <>
          <span className="candidate-fog fog-a" />
          <span className="candidate-fog fog-b" />
          <span className="candidate-person" />
          <span className="candidate-pier" />
        </>
      )}
      {approved ? <span className="candidate-approved">✓ 已批准</span> : null}
      {mediaType === "video" ? <span className="candidate-play">▶</span> : null}
    </div>
  );
}

type GenerationProgress = {
  phase: "preparing" | "queued" | "running" | "collecting";
  label: string;
  detail: string;
  percent: number | null;
  elapsedSeconds: number;
};

type GenerationLaunchOptions = {
  candidateCount?: number;
  candidateBatchId?: string;
  candidateIndex?: number;
  retryOfRunId?: string;
  compiledPrompt?: string;
  firstFrameAssetId?: string | null;
  lastFrameAssetId?: string | null;
  referenceImageAssetIds?: string[];
  referenceVideoAssetIds?: string[];
  referenceAudioAssetIds?: string[];
};

function realGenerationProgress(
  progress: {
    phase: "queued" | "running" | "collecting";
    label: string;
    detail: string;
    percent: number | null;
  } | null,
  startedAt: number,
): GenerationProgress {
  return {
    phase: progress?.phase ?? "running",
    label: progress?.label ?? "ComfyUI 正在执行工作流",
    detail: progress?.detail ?? "当前节点没有提供步进百分比",
    percent: progress?.percent ?? null,
    elapsedSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
  };
}

type ContextInspectorProps = {
  item: CanvasItem;
  snapshot: ProjectSnapshot;
  projectKey: string | null;
  readOnly: boolean;
  selectedShot: Shot | null;
  onOpenAssets: () => void;
  onUseAsset: (
    assetId: string,
    slot: "firstFrameAssetId" | "lastFrameAssetId" | "referenceAssetId",
  ) => void;
  onSetAssetCustomTags: (assetId: string, tags: string[]) => void;
  onUseText: (body: string) => void;
  onClose: () => void;
};

function formatBytes(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
}

function NodeContextInspector({
  item,
  snapshot,
  projectKey,
  readOnly,
  selectedShot,
  onOpenAssets,
  onUseAsset,
  onSetAssetCustomTags,
  onUseText,
  onClose,
}: ContextInspectorProps) {
  const [customTagDraft, setCustomTagDraft] = useState("");
  const scene = snapshot.scenes.find((candidate) => candidate.id === item.sceneId);
  const sourceUrl = (asset: Asset, proxy = true) =>
    projectKey ? projectApi.assetUrl(projectKey, asset.id, proxy) : undefined;

  if (item.refType === "text") {
    const text = snapshot.textItems.find((candidate) => candidate.id === item.refId);
    return (
      <aside className="inspector node-context-inspector" aria-label="剧本节点检查器">
        <div className="context-hero context-hero-text">
          <div className="context-icon">文</div>
          <div>
            <span className="section-kicker">SCRIPT SOURCE</span>
            <h2>{text?.title || "未命名文本"}</h2>
            <p>
              {scene?.label ?? "场景"} · {text?.kind === "script" ? "剧本" : "创作笔记"}
            </p>
          </div>
          <div className="context-hero-actions">
            <span className="context-type-pill">TEXT</span>
            <InspectorDismiss onClose={onClose} />
          </div>
        </div>
        <section className="context-section">
          <div className="context-section-heading">
            <div>
              <span className="section-kicker">CONTENT</span>
              <h3>文本内容</h3>
            </div>
            <span>{text?.body.length ?? 0} 字</span>
          </div>
          <div className="context-copy">{text?.body || "这个节点还没有内容。"}</div>
        </section>
        {!readOnly ? (
          <section className="context-action-card">
            <span>用于当前镜头</span>
            <strong>{selectedShot?.label ?? "尚未选择镜头"}</strong>
            <p>将文本追加到镜头提示词中，之后仍可在镜头面板继续编辑。</p>
            <button
              type="button"
              disabled={!selectedShot || !text?.body.trim()}
              onClick={() => text && onUseText(text.body)}
            >
              ＋ 追加到镜头提示词
            </button>
          </section>
        ) : (
          <div className="viewer-context-note">
            只读访问 · 可以查看文本内容，不能改写镜头提示词。
          </div>
        )}
        <ContextSelectionHint />
      </aside>
    );
  }

  if (item.refType === "entity") {
    const entity = snapshot.entities.find((candidate) => candidate.id === item.refId);
    const references = snapshot.assets.filter((asset) =>
      entity?.referenceAssetIds.includes(asset.id),
    );
    const firstImage = references.find((asset) => asset.mediaType === "image");
    const typeLabel =
      entity?.kind === "character"
        ? "人物资产"
        : entity?.kind === "location"
          ? "场景资产"
          : "道具资产";
    return (
      <aside className="inspector node-context-inspector" aria-label="实体节点检查器">
        <div className="context-hero context-hero-entity">
          <div className="context-icon">
            {entity?.kind === "character" ? "角" : entity?.kind === "location" ? "景" : "物"}
          </div>
          <div>
            <span className="section-kicker">ASSET IDENTITY</span>
            <h2>{entity?.name ?? "未命名资产"}</h2>
            <p>
              {typeLabel} · {references.length} 张参考
            </p>
          </div>
          <div className="context-hero-actions">
            <span className="context-type-pill">ENTITY</span>
            <InspectorDismiss onClose={onClose} />
          </div>
        </div>
        {firstImage && sourceUrl(firstImage) ? (
          <div className="context-media context-media-portrait">
            <img src={sourceUrl(firstImage)} alt={`${entity?.name ?? "资产"}参考图`} />
            <span>PRIMARY REFERENCE</span>
          </div>
        ) : (
          <div className="context-media context-media-empty">
            <span>{entity?.kind === "character" ? "人物参考位" : "视觉参考位"}</span>
            <small>可从资产库补充参考图片</small>
          </div>
        )}
        <section className="context-section">
          <div className="context-section-heading">
            <div>
              <span className="section-kicker">PROFILE</span>
              <h3>设定描述</h3>
            </div>
          </div>
          <div className="context-copy compact">
            {entity?.description || "这个资产还没有补充设定描述。"}
          </div>
          <div className="context-facts">
            <span>
              <small>类型</small>
              {typeLabel}
            </span>
            <span>
              <small>参考</small>
              {references.length} 个文件
            </span>
            <span>
              <small>场景</small>
              {scene?.label ?? "全局"}
            </span>
          </div>
        </section>
        <section className="context-actions-inline">
          <button type="button" className="secondary" onClick={onOpenAssets}>
            打开资产库
          </button>
          {!readOnly ? (
            <button
              type="button"
              disabled={!selectedShot || !firstImage}
              onClick={() => firstImage && onUseAsset(firstImage.id, "referenceAssetId")}
            >
              设为镜头参考
            </button>
          ) : null}
        </section>
        <ContextSelectionHint />
      </aside>
    );
  }

  const asset = snapshot.assets.find((candidate) => candidate.id === item.refId);
  const assetUrl = asset ? sourceUrl(asset, false) : undefined;
  const assetCanvasItemIds = new Set(
    snapshot.canvasItems
      .filter((candidate) => candidate.refType === "asset" && candidate.refId === item.refId)
      .map((candidate) => candidate.id),
  );
  const connectedRoles = new Set(
    snapshot.canvasEdges
      .filter((edge) => assetCanvasItemIds.has(edge.sourceItemId) && edge.targetSlot)
      .map((edge) => edge.targetSlot),
  );
  const addCustomTag = () => {
    if (readOnly || !asset) return;
    const tag = customTagDraft.trim();
    if (!tag || asset.customTags.includes(tag)) return;
    onSetAssetCustomTags(asset.id, [...asset.customTags, tag]);
    setCustomTagDraft("");
  };
  return (
    <aside className="inspector node-context-inspector" aria-label="素材节点检查器">
      <div className="context-hero context-hero-asset">
        <div className="context-icon">素</div>
        <div>
          <span className="section-kicker">SOURCE ASSET</span>
          <h2>{asset?.originalName ?? "素材"}</h2>
          <p>
            {asset?.mediaType.toUpperCase() ?? "FILE"} ·{" "}
            {asset ? formatBytes(asset.byteSize) : "未知大小"}
          </p>
        </div>
        <div className="context-hero-actions">
          <span className="context-type-pill">ASSET</span>
          <InspectorDismiss onClose={onClose} />
        </div>
      </div>
      <div className="context-media context-media-asset">
        {assetUrl && asset?.mediaType === "image" ? (
          <img src={assetUrl} alt={asset.originalName} />
        ) : assetUrl && asset?.mediaType === "video" ? (
          <video src={assetUrl} controls muted playsInline />
        ) : assetUrl && asset?.mediaType === "audio" ? (
          <div className="context-audio-preview">
            <span aria-hidden="true">♪</span>
            {/* biome-ignore lint/a11y/useMediaCaption: raw reference audio has no authored caption track */}
            <audio src={assetUrl} controls preload="metadata" />
          </div>
        ) : (
          <div className="context-media-empty">
            <span>{asset?.mediaType === "audio" ? "音频素材" : "素材预览"}</span>
            <small>{projectKey ? "暂时无法生成预览" : "Demo 不读取本地文件"}</small>
          </div>
        )}
        <span className="context-media-label">{asset?.mimeType ?? "MEDIA"}</span>
      </div>
      {assetUrl && asset?.mediaType === "image" ? (
        <div className="original-asset-actions">
          <span>原始文件只读保存；后续裁切、扩图或重绘将创建新的衍生节点。</span>
          <div>
            <a href={assetUrl} target="_blank" rel="noreferrer">
              查看原图 ↗
            </a>
            <a href={assetUrl} download={asset.originalName}>
              下载原图
            </a>
          </div>
        </div>
      ) : null}
      <section className="context-section">
        <div className="context-section-heading">
          <div>
            <span className="section-kicker">METADATA</span>
            <h3>素材信息</h3>
          </div>
        </div>
        <div className="context-facts context-facts-wide">
          <span>
            <small>尺寸</small>
            {asset?.width && asset.height ? `${asset.width} × ${asset.height}` : "待识别"}
          </span>
          <span>
            <small>格式</small>
            {asset?.mimeType.split("/").at(-1)?.toUpperCase() ?? "—"}
          </span>
          <span>
            <small>大小</small>
            {asset ? formatBytes(asset.byteSize) : "—"}
          </span>
        </div>
      </section>
      {asset?.mediaType === "image" ? (
        <>
          <section className="context-connection-roles">
            <div>
              <span className="section-kicker">CONNECTED AS</span>
              <h3>连接用途</h3>
            </div>
            <div className="connection-role-badges">
              {connectedRoles.has("first_frame") ? <span>首帧</span> : null}
              {connectedRoles.has("last_frame") ? <span>尾帧</span> : null}
              {connectedRoles.has("reference") ? <span>参考图</span> : null}
              {connectedRoles.size === 0 ? <em>尚未连接到模型输入</em> : null}
            </div>
            <p>从照片右侧端口拖到模型输入，系统会自动记录用途并占用对应输入。</p>
          </section>
          <section className="context-custom-tags">
            <div>
              <span className="section-kicker">CUSTOM TAGS</span>
              <h3>自定义标签</h3>
            </div>
            {asset.customTags.length ? (
              <div className="custom-tag-list">
                {asset.customTags.map((tag) =>
                  readOnly ? (
                    <span className="viewer-custom-tag" key={tag}>
                      {tag}
                    </span>
                  ) : (
                    <button
                      type="button"
                      key={tag}
                      aria-label={`移除标签 ${tag}`}
                      onClick={() =>
                        onSetAssetCustomTags(
                          asset.id,
                          asset.customTags.filter((candidate) => candidate !== tag),
                        )
                      }
                    >
                      {tag}
                      <span>×</span>
                    </button>
                  ),
                )}
              </div>
            ) : null}
            {!readOnly ? (
              <div className="custom-tag-entry">
                <input
                  aria-label="新增自定义标签"
                  value={customTagDraft}
                  maxLength={40}
                  placeholder="例如：冷色、夜景、定妆"
                  onChange={(event) => setCustomTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCustomTag();
                    }
                  }}
                />
                <button type="button" disabled={!customTagDraft.trim()} onClick={addCustomTag}>
                  添加
                </button>
              </div>
            ) : null}
            <p>
              {readOnly
                ? "标签由项目编辑者维护。"
                : "自定义标签只用于整理与检索，不会改变模型输入。"}
            </p>
          </section>
        </>
      ) : null}
      <ContextSelectionHint />
    </aside>
  );
}

function ContextSelectionHint() {
  return (
    <div className="context-selection-hint">
      <span>⌁</span>
      <p>
        <strong>节点已选中</strong>点击其他卡片切换内容；点击画布空白处即可收起。
      </p>
    </div>
  );
}

function InspectorDismiss({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="inspector-dismiss"
      onClick={onClose}
      aria-label="收起检查器"
      title="收起检查器"
    >
      ×
    </button>
  );
}

type InspectorProps = {
  shot: Shot;
  takes: Take[];
  busy: boolean;
  onGenerate: () => void;
  onCancel: () => void;
  canCancel: boolean;
  cancelling: boolean;
  onReject: (takeId: string, reason: string) => void;
  onApprove: (takeId: string) => void;
  workerLabel: string;
  assets: Asset[];
  projectKey: string | null;
  isDemo: boolean;
  runs: Run[];
  settings: GenerationSettings;
  workflow: WorkflowSummary | null;
  profile: ModelProfile;
  workflowDetected: boolean;
  workflowLocked: boolean;
  inputCounts: Record<
    "first_frame" | "last_frame" | "reference" | "reference_video" | "reference_audio",
    number
  >;
  mentions: PromptMention[];
  onSettingsChange: (settings: GenerationSettings) => void;
  onUpdateShot: (input: {
    title: string;
    body: string;
    durationSeconds: number;
    aspectRatio: Shot["aspectRatio"];
  }) => void;
  onOpenAssets: () => void;
  onOpenRecipes: () => void;
  generateDisabledReason: string | null;
  progress: GenerationProgress | null;
  candidateCount: number;
  onCandidateCountChange: (count: number) => void;
  onRetryRun: (run: Run) => void;
  onClose: () => void;
  readOnly: boolean;
};

function Inspector({
  shot,
  takes,
  busy,
  onGenerate,
  onCancel,
  canCancel,
  cancelling,
  onReject,
  onApprove,
  workerLabel,
  assets,
  projectKey,
  isDemo,
  runs,
  settings,
  workflow,
  profile,
  workflowDetected,
  workflowLocked,
  inputCounts,
  mentions,
  onSettingsChange,
  onUpdateShot,
  onOpenAssets,
  onOpenRecipes,
  generateDisabledReason,
  progress,
  candidateCount,
  onCandidateCountChange,
  onRetryRun,
  onClose,
  readOnly,
}: InspectorProps) {
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const [reason, setReason] = useState(rejectionReasons[0] ?? "角色漂移");
  const [mentionOpen, setMentionOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [shotDraft, setShotDraft] = useState(() => ({
    title: shot.label,
    body: shot.intent,
    durationSeconds: shot.durationSeconds,
    aspectRatio: shot.aspectRatio,
  }));
  useEffect(() => {
    setShotDraft({
      title: shot.label,
      body: shot.intent,
      durationSeconds: shot.durationSeconds,
      aspectRatio: shot.aspectRatio,
    });
  }, [shot]);
  useEffect(() => {
    const approved = takes.find((take) => take.status === "approved");
    const candidate = takes.find((take) => take.status === "candidate");
    setSelectedTakeId(approved?.id ?? candidate?.id ?? takes[0]?.id ?? null);
  }, [takes]);
  const selectedTake = takes.find((take) => take.id === selectedTakeId);
  const mediaSource = (assetId: string) => {
    const asset = assets.find((candidate) => candidate.id === assetId);
    return projectKey && asset ? projectApi.assetUrl(projectKey, asset.id) : undefined;
  };
  const mediaType = (assetId: string) =>
    assets.find((candidate) => candidate.id === assetId)?.mediaType;
  const modelCheckLabel =
    workflow?.modelStatus === "ready"
      ? "所需模型已在当前 ComfyUI 检测"
      : workflow?.modelStatus === "missing"
        ? `缺少 ${workflow.missingModels?.length ?? 0} 个模型文件`
        : workflowDetected
          ? "Workflow 已检测，模型清单待确认"
          : "本地参考配置";
  const resolutionPolicy =
    workflow?.execution !== "native"
      ? "exact"
      : profile.family === "qwen_image"
        ? "qwen_image_2512"
        : profile.family === "minimax_h3"
          ? "minimax_h3"
          : profile.family === "ltx23"
            ? "multiple_32"
            : "exact";
  const resolvedResolution = resolveGenerationResolution(
    resolutionPolicy,
    settings.width,
    settings.height,
  );
  const shotRuns = runs.filter((run) => run.shotId === shot.id);
  const latestBatchId = [...shotRuns]
    .reverse()
    .map((run) => run.parameters.candidateBatchId)
    .find((value): value is string => typeof value === "string");
  const latestBatchRuns = latestBatchId
    ? [...shotRuns]
        .filter((run) => run.parameters.candidateBatchId === latestBatchId)
        .reduce<Map<number, Run>>((latestByIndex, run) => {
          const index = run.parameters.candidateIndex;
          if (typeof index === "number") latestByIndex.set(index, run);
          return latestByIndex;
        }, new Map())
    : new Map<number, Run>();
  const orderedBatchRuns = [...latestBatchRuns.entries()].sort(([left], [right]) => left - right);
  const expectedBatchCount =
    orderedBatchRuns.find(([, run]) => typeof run.parameters.candidateCount === "number")?.[1]
      .parameters.candidateCount ?? orderedBatchRuns.length;
  const batchCompleted = orderedBatchRuns.filter(([, run]) => run.status === "completed").length;
  const batchFailed = orderedBatchRuns.filter(([, run]) =>
    ["failed", "cancelled", "orphaned"].includes(run.status),
  ).length;

  return (
    <aside className="inspector" aria-label="镜头候选检查器">
      <div className="inspector-heading">
        <div>
          <span className="section-kicker">SHOT INSPECTOR</span>
          <input
            className="shot-title-input"
            aria-label="镜头名称"
            value={shotDraft.title}
            maxLength={80}
            onChange={(event) =>
              setShotDraft((current) => ({ ...current, title: event.target.value }))
            }
          />
        </div>
        <div className="inspector-heading-actions">
          <span className={`large-status status-${shot.status}`}>
            {shot.status === "approved"
              ? "已批准"
              : shot.status === "review"
                ? "待选择"
                : shot.status === "generating"
                  ? "生成中"
                  : "待生成"}
          </span>
          <InspectorDismiss onClose={onClose} />
        </div>
      </div>
      {readOnly ? (
        <div className="viewer-mode-note">Viewer 模式 · 可以查看素材与候选，但不能修改或生成</div>
      ) : null}
      <fieldset className="inspector-editable-zone" disabled={readOnly}>
        <div className="shot-quick-edit">
          <textarea
            aria-label="镜头备注"
            value={shotDraft.body}
            placeholder="一句话记录镜头意图（可留空）"
            onChange={(event) =>
              setShotDraft((current) => ({ ...current, body: event.target.value }))
            }
          />
          <div>
            <label>
              <span>画幅</span>
              <select
                aria-label="镜头画幅"
                value={shotDraft.aspectRatio}
                onChange={(event) =>
                  setShotDraft((current) => ({
                    ...current,
                    aspectRatio: event.target.value as Shot["aspectRatio"],
                  }))
                }
              >
                {(["16:9", "9:16", "1:1", "4:5", "2.35:1"] as const).map((ratio) => (
                  <option key={ratio}>{ratio}</option>
                ))}
              </select>
            </label>
            <label htmlFor="inspector-shot-duration">
              <span>时长</span>
              <NumericInput
                id="inspector-shot-duration"
                aria-label="镜头时长"
                min={0.5}
                max={300}
                step={0.5}
                value={shotDraft.durationSeconds}
                onValueChange={(durationSeconds) =>
                  setShotDraft((current) => ({
                    ...current,
                    durationSeconds,
                  }))
                }
              />
            </label>
            <button type="button" onClick={() => onUpdateShot(shotDraft)}>
              保存镜头
            </button>
          </div>
          <small>{workerLabel}</small>
        </div>

        {!isDemo ? (
          <section className="generation-console">
            <button
              className={`recipe-selector ${workflowLocked ? "locked" : ""}`}
              type="button"
              disabled={workflowLocked}
              onClick={onOpenRecipes}
            >
              <span className="recipe-selector-icon">⌘</span>
              <span>
                <small>RECIPE</small>
                <strong>{workflow?.name ?? "选择工作流"}</strong>
              </span>
              <i>{workflowLocked ? "已随镜头锁定" : `${workflow?.capabilityLabel ?? "选择"}⌄`}</i>
            </button>
            <div
              className={`model-profile-summary ${workflow?.modelStatus === "missing" ? "is-missing" : workflowDetected ? "is-detected" : "is-fallback"}`}
            >
              <div>
                <span>{profile.outputLabel.toUpperCase()} PROFILE</span>
                <strong>{profile.title}</strong>
                <p>{profile.description}</p>
              </div>
              <small>{modelCheckLabel}</small>
            </div>
            <label className="prompt-field prompt-with-mentions">
              <span>
                镜头提示词 <small>{settings.prompt.length}/20000</small>
              </span>
              <textarea
                ref={promptRef}
                value={settings.prompt}
                onChange={(event) => {
                  onSettingsChange({ ...settings, prompt: event.target.value });
                  setMentionOpen(/@[^\s，。；：,.!?]*$/.test(event.target.value));
                }}
                onKeyDown={(event) => {
                  if (event.key === "@" && mentions.length > 0) setMentionOpen(true);
                  if (event.key === "Escape") setMentionOpen(false);
                }}
                placeholder={
                  profile.family === "minimax_h3"
                    ? "按时间线描述画面与声音，例如 [0s-2s] 动作、运镜、对白与环境声…"
                    : mentions.length
                      ? "输入 @ 引用已连接画面…"
                      : "描述一个主要动作、运镜、速度和光线连续性…"
                }
              />
              {mentions.length ? (
                <div className={`prompt-mention-menu ${mentionOpen ? "open" : ""}`}>
                  {mentions.map((mention) => (
                    <button
                      type="button"
                      key={`${mention.assetId}-${mention.alias}`}
                      onClick={() => {
                        const textarea = promptRef.current;
                        const cursor = textarea?.selectionStart ?? settings.prompt.length;
                        const before = settings.prompt
                          .slice(0, cursor)
                          .replace(/@[^\s，。；：,.!?]*$/, "");
                        const after = settings.prompt.slice(cursor);
                        const token = `@${mention.alias}`;
                        onSettingsChange({ ...settings, prompt: `${before}${token}${after}` });
                        setMentionOpen(false);
                        window.requestAnimationFrame(() => {
                          textarea?.focus();
                          const nextCursor = before.length + token.length;
                          textarea?.setSelectionRange(nextCursor, nextCursor);
                        });
                      }}
                    >
                      {mention.thumbnailUrl ? (
                        <img src={mention.thumbnailUrl} alt="" />
                      ) : (
                        <span>图</span>
                      )}
                      <strong>@{mention.alias}</strong>
                      <small>
                        {mention.role} · {mention.canonicalToken}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
              {mentions.length ? (
                <div className="prompt-mention-chips">
                  {mentions.map((mention) => (
                    <button type="button" key={mention.alias} onClick={() => setMentionOpen(true)}>
                      @{mention.alias}
                      <small>{mention.canonicalToken}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>
            {profile.family === "minimax_h3" ? (
              <details className="h3-prompt-guide">
                <summary>H3 音画提示词结构</summary>
                {workflow?.capability === "reference_video" ? (
                  <p>
                    先定义参考素材提供的人物、场景、动作或声线，再按播放顺序写镜头。使用上方的
                    @素材名；提交时会自动转换为 H3 所需的 Picture / Video / Audio 标签。
                  </p>
                ) : (
                  <p>
                    按镜头时间线描述画面、动作、运镜、对白和同步声音；最后分别说明整体环境声与非画内配乐。
                  </p>
                )}
                <code>
                  {workflow?.capability === "reference_video"
                    ? "subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music"
                    : "integrated_multimodal_description → overall_soundscape → non_diegetic_music"}
                </code>
              </details>
            ) : null}
            {workflow?.inputs.includes("negative_prompt") ? (
              <label className="negative-field">
                <span>负面提示词</span>
                <input
                  value={settings.negativePrompt}
                  onChange={(event) =>
                    onSettingsChange({ ...settings, negativePrompt: event.target.value })
                  }
                  placeholder="不希望出现的内容"
                />
              </label>
            ) : null}
            {profile.slots.length > 0 ? (
              <div className="frame-slots model-driven-slots">
                {profile.slots.map((slot) => {
                  const connectedCount = inputCounts[slot.id];
                  return (
                    <button
                      type="button"
                      className={connectedCount > 0 ? "filled" : ""}
                      onClick={onOpenAssets}
                      key={slot.id}
                    >
                      <span>{connectedCount > 0 ? connectedCount : "+"}</span>
                      <div>
                        <small>
                          {slot.required ? "必需" : "可选"} · {connectedCount}/{slot.maxCount}
                        </small>
                        <strong>{slot.label}</strong>
                        <em>
                          {slot.maxCount > 1
                            ? `最多 ${slot.maxCount} ${slot.mediaType === "image" ? "张" : "段"}`
                            : slot.hint}
                        </em>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-only-workflow-note">
                <span>文</span>
                <div>
                  <strong>无需图片输入</strong>
                  <p>这个模型从文字开始，画布节点不会显示多余的图片端口。</p>
                </div>
              </div>
            )}
            <details className="advanced-generation-settings">
              <summary>
                生成参数 <span>分辨率、Seed 与采样</span>
              </summary>
              {workflow?.inputs.includes("resolution") ? (
                <div className="parameter-grid">
                  <label htmlFor="generation-width">
                    <span>宽度</span>
                    <NumericInput
                      id="generation-width"
                      min={256}
                      max={2048}
                      step={32}
                      value={settings.width}
                      onValueChange={(width) => onSettingsChange({ ...settings, width })}
                    />
                  </label>
                  <label htmlFor="generation-height">
                    <span>高度</span>
                    <NumericInput
                      id="generation-height"
                      min={256}
                      max={2048}
                      step={32}
                      value={settings.height}
                      onValueChange={(height) => onSettingsChange({ ...settings, height })}
                    />
                  </label>
                  {workflow.inputs.includes("fps") && profile.family !== "minimax_h3" ? (
                    <label htmlFor="generation-fps">
                      <span>帧率</span>
                      <div>
                        <NumericInput
                          id="generation-fps"
                          min={8}
                          max={60}
                          step={1}
                          value={settings.fps}
                          onValueChange={(fps) => onSettingsChange({ ...settings, fps })}
                        />
                        <i>fps</i>
                      </div>
                    </label>
                  ) : null}
                </div>
              ) : null}
              {workflow?.inputs.includes("resolution") && resolvedResolution.changed ? (
                <div className="effective-resolution" role="status">
                  <span>实际输出</span>
                  <strong>
                    {resolvedResolution.effective.width} × {resolvedResolution.effective.height}
                  </strong>
                  <small>
                    输入 {resolvedResolution.requested.width} ×{" "}
                    {resolvedResolution.requested.height}；{resolvedResolution.reason}
                  </small>
                </div>
              ) : null}
              {workflow?.inputs.includes("seed") ? (
                <label className="seed-field" htmlFor="generation-seed">
                  <span>Seed</span>
                  <NumericInput
                    id="generation-seed"
                    min={0}
                    max={2_147_483_647}
                    step={1}
                    value={settings.seed}
                    onValueChange={(seed) => onSettingsChange({ ...settings, seed })}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onSettingsChange({
                        ...settings,
                        seed: Math.floor(Math.random() * 2_147_483_647),
                      })
                    }
                  >
                    随机
                  </button>
                </label>
              ) : null}
              {workflow?.inputs.includes("steps") ? (
                <label className="seed-field" htmlFor="generation-steps">
                  <span>Steps</span>
                  <NumericInput
                    id="generation-steps"
                    min={workflow.name.toLowerCase().includes("wan") ? 8 : 1}
                    max={workflow.name.toLowerCase().includes("wan") ? 40 : 100}
                    step={1}
                    value={settings.steps}
                    onValueChange={(steps) => onSettingsChange({ ...settings, steps })}
                  />
                  <small>
                    {workflow.name.toLowerCase().includes("qwen")
                      ? settings.steps <= 4
                        ? "Lightning 快速预览"
                        : "标准采样配置"
                      : workflow.name.toLowerCase().includes("minimax")
                        ? "由当前 JSON 暴露"
                        : workflow.name.toLowerCase().includes("wan")
                          ? "20 步为官方高质量基线；8–40 步可调"
                          : "当前工作流参数"}
                  </small>
                </label>
              ) : null}
              {profile.family === "minimax_h3" && workflow?.capability === "reference_video" ? (
                <label className="seed-field" htmlFor="generation-reference-fidelity">
                  <span>参考图精度</span>
                  <select
                    id="generation-reference-fidelity"
                    value={settings.referenceImageSize}
                    onChange={(event) =>
                      onSettingsChange({
                        ...settings,
                        referenceImageSize: event.target.value === "max" ? "max" : "match",
                      })
                    }
                  >
                    <option value="match">平衡 · 匹配输出尺寸</option>
                    <option value="max">身份优先 · 保留更多参考细节</option>
                  </select>
                  <small>“身份优先”会显著增加显存与采样时间，24 GB 显存建议少量参考图使用。</small>
                </label>
              ) : null}
              {workflow?.inputs.includes("denoise") ? (
                <label className="seed-field" htmlFor="generation-denoise">
                  <span>重绘强度</span>
                  <NumericInput
                    id="generation-denoise"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={settings.denoise}
                    onValueChange={(denoise) => onSettingsChange({ ...settings, denoise })}
                  />
                  <small>0.35 保守 · 0.65 平衡 · 1.0 重构</small>
                </label>
              ) : null}
            </details>
            {workflow?.execution === "comfy_only" ? (
              <div className="comfy-only-note">这个 JSON 目前从 ComfyUI 打开运行。</div>
            ) : null}
          </section>
        ) : null}
      </fieldset>

      {progress ? (
        <section className="generation-progress" aria-live="polite">
          <div className="generation-progress-head">
            <div>
              <i />
              <span>{progress.label}</span>
            </div>
            <strong>{progress.percent === null ? "实时" : `${progress.percent}%`}</strong>
          </div>
          <div
            className={`generation-progress-track ${progress.percent === null ? "indeterminate" : ""}`}
          >
            <span
              style={progress.percent === null ? undefined : { width: `${progress.percent}%` }}
            />
          </div>
          <div className="generation-progress-detail">
            <span>{progress.detail}</span>
            <span>{progress.elapsedSeconds}s</span>
          </div>
          <div className="generation-phases">
            {(["preparing", "queued", "running", "collecting"] as const).map((phase) => (
              <i className={phase === progress.phase ? "active" : ""} key={phase} />
            ))}
          </div>
          <small>百分比来自 ComfyUI 当前节点；节点不提供步进时只显示实时状态。</small>
          {canCancel ? (
            <button
              className="cancel-generation-button"
              type="button"
              disabled={readOnly || cancelling}
              onClick={onCancel}
            >
              {cancelling ? "正在停止并清理…" : "■ 停止生成并清理任务"}
            </button>
          ) : null}
        </section>
      ) : null}

      {!progress && canCancel ? (
        <section className="generation-cancel-strip">
          <span>
            <i /> 检测到这个镜头有运行中的任务
          </span>
          <button type="button" disabled={readOnly || cancelling} onClick={onCancel}>
            {cancelling ? "停止中…" : "停止并清理"}
          </button>
        </section>
      ) : null}

      {orderedBatchRuns.length > 1 || batchFailed > 0 ? (
        <section className="candidate-batch-status" aria-label="最近一批候选的运行状态">
          <div className="candidate-batch-heading">
            <div>
              <span>LATEST BATCH</span>
              <strong>
                {batchCompleted}/{String(expectedBatchCount)} 已完成
              </strong>
            </div>
            {batchFailed > 0 ? <small>{batchFailed} 个需要处理</small> : null}
          </div>
          <div className="candidate-batch-runs">
            {orderedBatchRuns.map(([index, run]) => {
              const retryable = ["failed", "cancelled", "orphaned"].includes(run.status);
              const statusLabel =
                run.status === "completed"
                  ? "已完成"
                  : run.status === "failed"
                    ? "失败"
                    : run.status === "cancelled"
                      ? "已停止"
                      : run.status === "orphaned"
                        ? "待核对"
                        : run.status === "queued"
                          ? "排队中"
                          : "生成中";
              return (
                <div className={`candidate-run-state status-${run.status}`} key={run.id}>
                  <span>{String(index).padStart(2, "0")}</span>
                  <div>
                    <strong>{statusLabel}</strong>
                    <small>seed {String(run.parameters.seed ?? "—")}</small>
                  </div>
                  {retryable && !readOnly ? (
                    <button type="button" disabled={busy} onClick={() => onRetryRun(run)}>
                      同参数重试
                    </button>
                  ) : (
                    <i />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="candidate-title-row">
        <div>
          <h3>候选 Takes</h3>
          <p>{takes.length > 0 ? `${takes.length} 个结果 · 点击比较` : "先生成一组可选择的结果"}</p>
        </div>
        <div className="candidate-generation-actions">
          {!isDemo && workflow?.execution !== "comfy_only" ? (
            <fieldset className="candidate-count-control" aria-label="每批候选数量">
              {[1, 2, 3, 4].map((count) => (
                <button
                  type="button"
                  className={candidateCount === count ? "active" : ""}
                  aria-pressed={candidateCount === count}
                  disabled={readOnly || busy}
                  onClick={() => onCandidateCountChange(count)}
                  key={count}
                >
                  {count}
                </button>
              ))}
            </fieldset>
          ) : null}
          <button
            className="generate-button"
            type="button"
            onClick={onGenerate}
            disabled={readOnly || busy || !!generateDisabledReason}
            title={generateDisabledReason ?? undefined}
          >
            {busy ? <span className="spinner" /> : <span>✦</span>}
            {busy
              ? progress
                ? `${progress.label}${progress.percent === null ? "" : ` · ${progress.percent}%`}`
                : "处理中…"
              : isDemo
                ? takes.length > 0
                  ? "再抽 4 个"
                  : "生成 4 个"
                : workflow?.execution === "comfy_only"
                  ? "在 ComfyUI 中打开"
                  : `生成 ${candidateCount} 个`}
          </button>
        </div>
      </div>

      {!isDemo && generateDisabledReason ? (
        <div className="generation-validation">{generateDisabledReason}</div>
      ) : null}

      {takes.length === 0 ? (
        <div className="empty-candidates">
          <div className="empty-orbit">
            <span />
            <span />
            <span />
          </div>
          <strong>这个镜头还没有 Take</strong>
          <p>
            {isDemo
              ? "Demo 会模拟 4 次独立运行，并保留 seed、来源和选择历史。"
              : workflow?.execution === "comfy_only"
                ? "TakeBoard 已识别输入槽位；点击后进入 ComfyUI 调整和运行完整节点图。"
                : `将使用已选择的素材运行 ${workflow?.name ?? "当前 Recipe"}，并保存 seed、来源和参数快照。`}
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={readOnly || busy || !!generateDisabledReason}
          >
            {workflow?.execution === "comfy_only" ? "进入 ComfyUI" : "开始生成"}
          </button>
        </div>
      ) : (
        <>
          <div className="candidate-grid">
            {takes.map((take, index) => (
              <button
                className={`candidate-card ${selectedTakeId === take.id ? "selected" : ""} status-${take.status}`}
                key={take.id}
                type="button"
                onClick={() => setSelectedTakeId(take.id)}
                aria-label={`选择候选 ${index + 1}`}
              >
                <CandidateArt
                  index={index % 4}
                  approved={take.status === "approved"}
                  source={mediaSource(take.assetId)}
                  mediaType={mediaType(take.assetId)}
                />
                <div className="candidate-meta">
                  <span>TAKE {String(index + 1).padStart(2, "0")}</span>
                  <span className={`take-state state-${take.status}`}>
                    {take.status === "approved"
                      ? "APPROVED"
                      : take.status === "rejected"
                        ? "REJECTED"
                        : "CANDIDATE"}
                  </span>
                </div>
                <div className="candidate-seed">
                  seed · {String(runs.find((run) => run.id === take.runId)?.parameters.seed ?? "—")}
                </div>
              </button>
            ))}
          </div>
          {selectedTake ? (
            <div className="decision-panel">
              <div className="decision-id">
                <span>当前选择</span>
                <strong>{shortId(selectedTake.id)}</strong>
              </div>
              <select
                aria-label="淘汰原因"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={selectedTake.status === "approved"}
              >
                {rejectionReasons.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <button
                className="reject-button"
                type="button"
                disabled={readOnly || busy || selectedTake.status === "approved"}
                onClick={() => onReject(selectedTake.id, reason)}
              >
                淘汰
              </button>
              <button
                className="approve-button"
                type="button"
                disabled={readOnly || busy || selectedTake.status === "approved"}
                onClick={() => onApprove(selectedTake.id)}
              >
                ✓ 批准此 Take
              </button>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}

type CanvasContextMenuState = {
  clientX: number;
  clientY: number;
  flowX: number;
  flowY: number;
  itemId: string | null;
  edge: {
    id: string;
    sourceItemId: string;
    targetItemId: string;
    targetSlot: ProjectSnapshot["canvasEdges"][number]["targetSlot"];
    immutable: boolean;
  } | null;
};

type CanvasEdgeIdentity = Pick<
  NonNullable<CanvasContextMenuState["edge"]>,
  "sourceItemId" | "targetItemId" | "targetSlot"
>;

type CanvasClipboardState = {
  itemId: string;
  mode: "copy" | "cut";
};

type NodeEditDraft = {
  itemId: string;
  kind: "text" | "entity" | "asset" | "shot";
  title: string;
  body: string;
  durationSeconds: number | null;
  aspectRatio: Shot["aspectRatio"] | null;
};

type PendingCanvasRemoval = {
  itemId: string;
  preview: ProjectCommandPreview;
};

export function App() {
  const { user: authUser } = useAuth();
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [selectedCanvasItemId, setSelectedCanvasItemId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [canvasGuideOpen, setCanvasGuideOpen] = useState(false);
  const [commandHistoryOpen, setCommandHistoryOpen] = useState(false);
  const [commandHistory, setCommandHistory] = useState<CommandAuditEntry[]>([]);
  const [commandHistoryBusy, setCommandHistoryBusy] = useState(false);
  const [commandHistoryError, setCommandHistoryError] = useState<string | null>(null);
  const [blankCanvasGuideOpen, setBlankCanvasGuideOpen] = useState(false);
  const [canvasClipboard, setCanvasClipboard] = useState<CanvasClipboardState | null>(null);
  const [deletingShotItemId, setDeletingShotItemId] = useState<string | null>(null);
  const [deletingShotPreview, setDeletingShotPreview] = useState<ProjectCommandPreview | null>(
    null,
  );
  const [pendingCanvasRemoval, setPendingCanvasRemoval] = useState<PendingCanvasRemoval | null>(
    null,
  );
  const [pendingCanvasArrange, setPendingCanvasArrange] = useState<ProjectCommandPreview | null>(
    null,
  );
  const [nodeEditDraft, setNodeEditDraft] = useState<NodeEditDraft | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<BoardNode> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [projectMode, setProjectMode] = useState<"demo" | "project">("project");
  const [projects, setProjects] = useState<ProjectCatalogItem[]>([]);
  const [trashedProjects, setTrashedProjects] = useState<TrashedProjectItem[]>([]);
  const [showHub, setShowHub] = useState(true);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [workerBusy, setWorkerBusy] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowWarnings, setWorkflowWarnings] = useState<string[]>([]);
  const [comfyEditorUrl, setComfyEditorUrl] = useState("http://127.0.0.1:48188");
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"current" | "updated" | "pending" | "offline">(
    "current",
  );
  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(() => ({
    ...defaultGenerationSettings,
    ...loadModelPreferences(defaultGenerationSettings.recipePath),
  }));
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationCancelling, setGenerationCancelling] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [candidateCount, setCandidateCount] = useState(1);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1120);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1040);
  const [comfortableDensity, setComfortableDensity] = useState(
    () => window.localStorage.getItem("takeboard.density") !== "compact",
  );
  const [shotQuery, setShotQuery] = useState("");
  const [shotFilter, setShotFilter] = useState<"all" | "todo" | "approved">("all");
  const assetInput = useRef<HTMLInputElement>(null);
  const pendingAssetPosition = useRef<{ x: number; y: number } | null>(null);
  const generationScopeRef = useRef("");
  const generationTokenRef = useRef(0);
  const generationRunIdsRef = useRef<string[]>([]);
  const projectCatalogRequestRef = useRef(0);
  const acceptedProjectIdRef = useRef<string | null>(null);
  const acceptedRevisionRef = useRef(0);
  const pendingSyncRef = useRef<NonNullable<Awaited<ReturnType<typeof projectApi.sync>>> | null>(
    null,
  );
  const interactionActiveRef = useRef(false);
  const selectedEdgeIdentityRef = useRef<CanvasEdgeIdentity | null>(null);
  const latestSnapshotRef = useRef(snapshot);
  const selectionProjectRef = useRef<string | null>(null);
  latestSnapshotRef.current = snapshot;
  interactionActiveRef.current = Boolean(
    nodeEditDraft ||
      pendingCanvasRemoval ||
      pendingCanvasArrange ||
      deletingShotPreview ||
      renameOpen,
  );
  const activeProjectRole =
    projectMode === "project" && projectKey
      ? (projects.find((project) => project.key === projectKey)?.role ?? "owner")
      : "owner";
  const canEditProject = projectMode === "demo" || activeProjectRole !== "viewer";
  const selectedShot = snapshot?.shots.find((shot) => shot.id === selectedShotId) ?? null;
  const selectedShotWorkflowPath =
    selectedShot && snapshot
      ? (selectedShot.workflowPath ?? runWorkflowPath(snapshot, selectedShot.id))
      : null;
  const selectedWorkflow = useMemo(
    () => findWorkflow(selectedShotWorkflowPath ?? generationSettings.recipePath, workflows),
    [generationSettings.recipePath, selectedShotWorkflowPath, workflows],
  );
  const workflowLocked = Boolean(
    selectedShotId && snapshot?.runs.some((run) => run.shotId === selectedShotId),
  );

  const acceptPayload = useCallback(
    (payload: Awaited<ReturnType<typeof demoApi.get>>, preferredShotId?: string) => {
      const incomingProjectId = payload.snapshot.project.id;
      if (
        acceptedProjectIdRef.current === incomingProjectId &&
        payload.revision <= acceptedRevisionRef.current
      ) {
        return false;
      }
      acceptedProjectIdRef.current = incomingProjectId;
      acceptedRevisionRef.current = payload.revision;
      latestSnapshotRef.current = payload.snapshot;
      setSnapshot(payload.snapshot);
      setRevision(payload.revision);
      setSelectedShotId((current) =>
        payload.snapshot.shots.some((shot) => shot.id === (preferredShotId ?? current))
          ? (preferredShotId ?? current)
          : (payload.snapshot.shots[0]?.id ?? null),
      );
      return true;
    },
    [],
  );

  const applyPendingSync = useCallback(() => {
    const payload = pendingSyncRef.current;
    if (!payload || !projectKey) return;
    pendingSyncRef.current = null;
    if (acceptPayload(payload)) projectApi.markRevision(projectKey, payload.revision);
    setSyncStatus("updated");
    setNotice("已载入其他设备的更新");
  }, [acceptPayload, projectKey]);

  const refreshCommandHistory = useCallback(async () => {
    if (!projectKey || projectMode !== "project") return;
    setCommandHistoryBusy(true);
    setCommandHistoryError(null);
    try {
      const payload = await projectApi.audit(projectKey);
      setCommandHistory(payload.entries);
    } catch (cause) {
      setCommandHistoryError(cause instanceof Error ? cause.message : "无法读取操作记录");
    } finally {
      setCommandHistoryBusy(false);
    }
  }, [projectKey, projectMode]);

  const openCommandHistory = useCallback(() => {
    setCanvasGuideOpen(false);
    setCommandHistoryOpen(true);
    void refreshCommandHistory();
  }, [refreshCommandHistory]);

  const undoProjectCommand = useCallback(
    async (commandId: string) => {
      if (!projectKey || projectMode !== "project") return;
      setCommandHistoryBusy(true);
      setCommandHistoryError(null);
      try {
        const payload = await projectApi.undo(projectKey, commandId);
        acceptPayload(payload);
        const audit = await projectApi.audit(projectKey);
        setCommandHistory(audit.entries);
        setNotice("操作已撤销");
      } catch (cause) {
        setCommandHistoryError(cause instanceof Error ? cause.message : "撤销失败");
      } finally {
        setCommandHistoryBusy(false);
      }
    },
    [acceptPayload, projectKey, projectMode],
  );

  useEffect(() => {
    const catalogRequestId = ++projectCatalogRequestRef.current;
    void Promise.allSettled([
      projectApi.list(),
      projectApi.trash(),
      projectApi.worker(),
      workflowApi.list(),
    ]).then(([catalog, trash, status, detected]) => {
      if (catalog.status === "fulfilled") {
        if (projectCatalogRequestRef.current === catalogRequestId) {
          setProjects(catalog.value.projects);
        }
      } else {
        setError(catalog.reason instanceof Error ? catalog.reason.message : "无法载入项目列表");
      }
      if (trash.status === "fulfilled" && projectCatalogRequestRef.current === catalogRequestId) {
        setTrashedProjects(trash.value.projects);
      }
      if (status.status === "fulfilled") setWorker(status.value);
      else setWorker({ status: "offline", engine: "ComfyUI" });
      if (detected.status === "fulfilled") {
        setWorkflows(detected.value.workflows);
        setWorkflowWarnings([
          ...(detected.value.warnings ?? []),
          ...(detected.value.diagnostics ?? []).map(
            (item) => `${item.code} · ${item.path}：${item.message}`,
          ),
        ]);
        setComfyEditorUrl(detected.value.editorUrl);
      }
    });
  }, []);

  useEffect(() => {
    if (showHub || projectMode !== "project" || !projectKey || !acceptedProjectIdRef.current)
      return;
    let stopped = false;
    let syncing = false;
    let timer = 0;
    const synchronize = async () => {
      if (stopped || syncing) return;
      if (document.visibilityState === "hidden") {
        timer = window.setTimeout(() => void synchronize(), 5_000);
        return;
      }
      syncing = true;
      try {
        const payload = await projectApi.sync(projectKey, acceptedRevisionRef.current);
        if (stopped) return;
        if (payload) {
          if (interactionActiveRef.current) {
            pendingSyncRef.current = payload;
            setSyncStatus("pending");
          } else if (acceptPayload(payload)) {
            projectApi.markRevision(projectKey, payload.revision);
            setSyncStatus("updated");
          }
        } else if (!pendingSyncRef.current) {
          setSyncStatus("current");
        }
      } catch {
        if (!stopped) setSyncStatus("offline");
      } finally {
        syncing = false;
        if (!stopped) timer = window.setTimeout(() => void synchronize(), 4_000);
      }
    };
    const syncNow = () => {
      window.clearTimeout(timer);
      void synchronize();
    };
    timer = window.setTimeout(() => void synchronize(), 1_500);
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", syncNow);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", syncNow);
      document.removeEventListener("visibilitychange", syncNow);
    };
  }, [acceptPayload, projectKey, projectMode, showHub]);

  useEffect(() => {
    const recoverConflict = (event: Event) => {
      if (!projectKey || projectMode !== "project") return;
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (!detail?.path?.includes(`/api/projects/${encodeURIComponent(projectKey)}`)) return;
      void projectApi
        .open(projectKey)
        .then((payload) => {
          acceptPayload(payload);
          pendingSyncRef.current = null;
          setSyncStatus("updated");
          setError("项目刚刚在其他设备发生变化；已载入最新版本，请确认后再次执行刚才的操作。");
        })
        .catch(() => setSyncStatus("offline"));
    };
    window.addEventListener("takeboard:revision-conflict", recoverConflict);
    return () => window.removeEventListener("takeboard:revision-conflict", recoverConflict);
  }, [acceptPayload, projectKey, projectMode]);

  useEffect(() => {
    if (showHub || projectMode !== "demo" || !snapshot) return;
    window.sessionStorage.setItem("takeboard.resumeDemo", "1");
  }, [projectMode, showHub, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const projectChanged = selectionProjectRef.current !== snapshot.project.id;
    selectionProjectRef.current = snapshot.project.id;
    setSelectedCanvasItemId((current) => {
      if (current && snapshot.canvasItems.some((item) => item.id === current)) return current;
      if (!projectChanged) return null;
      return (
        snapshot.canvasItems.find(
          (item) => item.refType === "shot" && item.refId === selectedShotId,
        )?.id ??
        snapshot.canvasItems.find((item) => item.refType === "shot")?.id ??
        snapshot.canvasItems[0]?.id ??
        null
      );
    });
  }, [selectedShotId, snapshot]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    window.localStorage.setItem(
      "takeboard.density",
      comfortableDensity ? "comfortable" : "compact",
    );
  }, [comfortableDensity]);

  useEffect(() => {
    const effectiveWidth = () => {
      const scale = Number(window.localStorage.getItem("takeboard.display-scale")) || 1;
      return window.innerWidth / scale;
    };
    let narrow = effectiveWidth() <= 1120;
    const adaptWorkspacePanels = () => {
      const nextNarrow = effectiveWidth() <= 1120;
      if (nextNarrow === narrow) return;
      narrow = nextNarrow;
      setSidebarOpen(!nextNarrow);
      setInspectorOpen(!nextNarrow);
    };
    window.addEventListener("resize", adaptWorkspacePanels);
    window.addEventListener("takeboard:display-scale", adaptWorkspacePanels);
    return () => {
      window.removeEventListener("resize", adaptWorkspacePanels);
      window.removeEventListener("takeboard:display-scale", adaptWorkspacePanels);
    };
  }, []);

  const edges = useMemo(
    () =>
      snapshot
        ? boardEdges(snapshot, workflows, selectedWorkflow, selectedShotId, selectedEdgeId)
        : [],
    [selectedEdgeId, selectedShotId, selectedWorkflow, snapshot, workflows],
  );
  const selectedModelProfile = useMemo(
    () => modelProfile(selectedWorkflow, selectedShot?.aspectRatio ?? "16:9"),
    [selectedShot?.aspectRatio, selectedWorkflow],
  );
  const selectedCanvasItem =
    snapshot?.canvasItems.find((item) => item.id === selectedCanvasItemId) ?? null;
  const inspectorHasContent = Boolean(selectedCanvasItem || selectedShot);
  const inspectorVisible = inspectorOpen && inspectorHasContent;
  const selectedShotItem = snapshot?.canvasItems.find(
    (item) => item.refType === "shot" && item.refId === selectedShotId,
  );
  const selectedShotInputEdges = useMemo(
    () =>
      snapshot && selectedShotItem
        ? snapshot.canvasEdges
            .filter(
              (edge) =>
                edge.targetItemId === selectedShotItem.id &&
                edge.targetSlot &&
                selectedModelProfile.slots.some((slot) => slot.id === edge.targetSlot),
            )
            .sort((a, b) => {
              const order = {
                first_frame: 0,
                reference: 1,
                reference_video: 2,
                reference_audio: 3,
                last_frame: 4,
              } as const;
              return (
                order[a.targetSlot as keyof typeof order] -
                  order[b.targetSlot as keyof typeof order] || a.targetSlotIndex - b.targetSlotIndex
              );
            })
        : [],
    [selectedModelProfile.slots, selectedShotItem, snapshot],
  );
  const promptMentions = useMemo<PromptMention[]>(() => {
    if (!snapshot) return [];
    const aliases = new Map<string, number>();
    const mentions: PromptMention[] = [];
    let pictureIndex = 0;
    let videoIndex = 0;
    let audioIndex = selectedShotInputEdges.filter(
      (edge) => edge.targetSlot === "reference_video",
    ).length;
    for (const edge of selectedShotInputEdges) {
      const source = snapshot.canvasItems.find((item) => item.id === edge.sourceItemId);
      const expectedMedia =
        edge.targetSlot === "reference_video"
          ? "video"
          : edge.targetSlot === "reference_audio"
            ? "audio"
            : "image";
      const assetId = sourceAssetId(snapshot, source, expectedMedia);
      const asset = snapshot.assets.find(
        (candidate) => candidate.id === assetId && candidate.mediaType === expectedMedia,
      );
      if (!asset) continue;
      const baseAlias =
        asset.originalName
          .replace(/\.[^.]+$/, "")
          .trim()
          .replace(/[\s@，。；：,.!?]+/g, "_")
          .slice(0, 32) ||
        (asset.mediaType === "video"
          ? "参考视频"
          : asset.mediaType === "audio"
            ? "参考音频"
            : "参考图");
      const count = (aliases.get(baseAlias) ?? 0) + 1;
      aliases.set(baseAlias, count);
      const canonicalToken =
        asset.mediaType === "image"
          ? `<Picture ${++pictureIndex}>`
          : asset.mediaType === "video"
            ? `<Video ${++videoIndex}>`
            : `<Audio ${++audioIndex}>`;
      mentions.push({
        assetId: asset.id,
        alias: `${baseAlias}${count > 1 ? `_${count}` : ""}`,
        canonicalToken,
        role:
          edge.targetSlot === "first_frame"
            ? "首帧"
            : edge.targetSlot === "last_frame"
              ? "尾帧"
              : edge.targetSlot === "reference_video"
                ? `参考视频 ${edge.targetSlotIndex + 1}`
                : edge.targetSlot === "reference_audio"
                  ? `参考音频 ${edge.targetSlotIndex + 1}`
                  : `参考图 ${edge.targetSlotIndex + 1}`,
        thumbnailUrl:
          asset.mediaType === "image" && projectMode === "project" && projectKey
            ? projectApi.assetUrl(projectKey, asset.id, true)
            : undefined,
      });
    }
    return mentions;
  }, [projectKey, projectMode, selectedShotInputEdges, snapshot]);
  const selectedInputCounts = useMemo(
    () => ({
      first_frame: selectedShotInputEdges.filter((edge) => edge.targetSlot === "first_frame")
        .length,
      last_frame: selectedShotInputEdges.filter((edge) => edge.targetSlot === "last_frame").length,
      reference: selectedShotInputEdges.filter((edge) => edge.targetSlot === "reference").length,
      reference_video: selectedShotInputEdges.filter(
        (edge) => edge.targetSlot === "reference_video",
      ).length,
      reference_audio: selectedShotInputEdges.filter(
        (edge) => edge.targetSlot === "reference_audio",
      ).length,
    }),
    [selectedShotInputEdges],
  );
  const selectedReferenceVideoIds = useMemo(
    () =>
      selectedShotInputEdges.flatMap((edge) => {
        if (edge.targetSlot !== "reference_video") return [];
        const source = snapshot?.canvasItems.find((item) => item.id === edge.sourceItemId);
        if (source?.refType === "asset") return [source.refId];
        if (source?.refType === "entity") {
          const assetId = snapshot?.entities
            .find((entity) => entity.id === source.refId)
            ?.referenceAssetIds.find((id) =>
              snapshot.assets.some((asset) => asset.id === id && asset.mediaType === "video"),
            );
          return assetId ? [assetId] : [];
        }
        return [];
      }),
    [selectedShotInputEdges, snapshot],
  );
  const selectedReferenceImageIds = useMemo(
    () =>
      selectedShotInputEdges.flatMap((edge) => {
        if (edge.targetSlot !== "reference") return [];
        const source = snapshot?.canvasItems.find((item) => item.id === edge.sourceItemId);
        const assetId = snapshot ? sourceAssetId(snapshot, source, "image") : null;
        return assetId ? [assetId] : [];
      }),
    [selectedShotInputEdges, snapshot],
  );
  const selectedReferenceAudioIds = useMemo(
    () =>
      selectedShotInputEdges.flatMap((edge) => {
        if (edge.targetSlot !== "reference_audio") return [];
        const source = snapshot?.canvasItems.find((item) => item.id === edge.sourceItemId);
        const assetId = snapshot ? sourceAssetId(snapshot, source, "audio") : null;
        return assetId ? [assetId] : [];
      }),
    [selectedShotInputEdges, snapshot],
  );
  const selectedTakes = snapshot?.takes.filter((take) => take.shotId === selectedShotId) ?? [];
  const visibleShots = useMemo(() => {
    const normalizedQuery = shotQuery.trim().toLocaleLowerCase("zh-CN");
    const sceneOrder = new Map(snapshot?.scenes.map((scene) => [scene.id, scene.order]) ?? []);
    return (snapshot?.shots ?? [])
      .filter(
        (shot) =>
          `${shot.label} ${shot.intent}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery) &&
          (shotFilter === "all" ||
            (shotFilter === "approved" && shot.status === "approved") ||
            (shotFilter === "todo" && shot.status !== "approved")),
      )
      .sort(
        (left, right) =>
          (sceneOrder.get(left.sceneId) ?? 0) - (sceneOrder.get(right.sceneId) ?? 0) ||
          left.order - right.order ||
          left.id.localeCompare(right.id),
      );
  }, [shotFilter, shotQuery, snapshot?.scenes, snapshot?.shots]);
  const activeRuns = (snapshot?.runs ?? []).filter(
    (run) =>
      run.shotId === selectedShotId &&
      !["completed", "failed", "cancelled", "orphaned"].includes(run.status),
  );
  const activeRun = activeRuns.at(-1);

  useEffect(() => {
    if (!selectedShot || !selectedWorkflow || projectMode !== "project") return;
    const workflowPath = selectedShotWorkflowPath ?? defaultGenerationSettings.recipePath;
    const synchronizedScope = `${projectMode}:${projectKey ?? "demo"}:${selectedShot.id}:${workflowPath}`;
    if (
      generationScopeRef.current !== synchronizedScope ||
      generationSettings.recipePath !== workflowPath ||
      selectedWorkflow.path !== workflowPath
    ) {
      return;
    }
    saveModelPreferences(workflowPath, {
      width: generationSettings.width,
      height: generationSettings.height,
      durationSeconds: generationSettings.durationSeconds,
      fps: generationSettings.fps,
      steps: generationSettings.steps,
      denoise: generationSettings.denoise,
    });
  }, [
    generationSettings,
    projectKey,
    projectMode,
    selectedShot,
    selectedShotWorkflowPath,
    selectedWorkflow,
  ]);

  useEffect(() => {
    if (showHub || projectMode !== "project" || !projectKey || !snapshot || generationBusy) return;
    const recoverableRuns = snapshot.runs.filter(
      (run) =>
        !["completed", "failed", "cancelled"].includes(run.status) &&
        (run.status !== "orphaned" || Boolean(run.promptId)),
    );
    if (recoverableRuns.length === 0) {
      setGenerationProgress(null);
      return;
    }

    const selectedRun = [...recoverableRuns].reverse().find((run) => run.shotId === selectedShotId);
    if (selectedRun) {
      setGenerationProgress({
        phase: selectedRun.status === "collecting_outputs" ? "collecting" : "running",
        label: selectedRun.status === "orphaned" ? "正在核对执行端任务" : "已恢复后台生成任务",
        detail: "正在连接 ComfyUI 实时事件；页面可以安全刷新",
        percent: null,
        elapsedSeconds: Math.max(
          0,
          Math.round((Date.now() - Date.parse(selectedRun.createdAt)) / 1000),
        ),
      });
    } else {
      setGenerationProgress(null);
    }

    let stopped = false;
    let retryTimer = 0;
    const poll = async () => {
      try {
        for (const run of recoverableRuns) {
          if (stopped) return;
          const result = await projectApi.run(projectKey, run.id);
          if (stopped) return;
          acceptPayload(result, run.shotId);
          if (run.shotId === selectedShotId) {
            setGenerationProgress(
              realGenerationProgress(result.progress, Date.parse(run.createdAt)),
            );
          }
        }
        if (!stopped) retryTimer = window.setTimeout(() => void poll(), 3_000);
      } catch (cause) {
        if (!stopped) {
          setError(cause instanceof Error ? cause.message : "后台任务状态同步失败");
          retryTimer = window.setTimeout(() => void poll(), 5_000);
        }
      }
    };
    const initialTimer = window.setTimeout(() => void poll(), 1_000);
    return () => {
      stopped = true;
      window.clearTimeout(initialTimer);
      window.clearTimeout(retryTimer);
    };
  }, [acceptPayload, generationBusy, projectKey, projectMode, selectedShotId, showHub, snapshot]);
  const imageAssets = useMemo(
    () => snapshot?.assets.filter((asset) => asset.mediaType === "image") ?? [],
    [snapshot?.assets],
  );
  const firstFrameAvailable = imageAssets.some(
    (asset) => asset.id === generationSettings.firstFrameAssetId,
  );
  const lastFrameAvailable = imageAssets.some(
    (asset) => asset.id === generationSettings.lastFrameAssetId,
  );
  const generationDisabledReason = useMemo(() => {
    if (projectMode === "demo" || selectedWorkflow?.execution === "comfy_only") return null;
    if (!selectedWorkflow) return "请先选择一个可用 Workflow";
    if (selectedWorkflow.modelStatus === "missing") {
      return `当前电脑缺少模型：${(selectedWorkflow.missingModels ?? []).slice(0, 2).join("、")}`;
    }
    if (!generationSettings.prompt.trim()) return "请先输入镜头提示词";
    if (selectedWorkflow.inputs.includes("first_frame") && !firstFrameAvailable) {
      return "请从资产库选择一张起始帧";
    }
    if (selectedWorkflow.capability === "first_last_video" && !lastFrameAvailable) {
      return "首尾帧模式还需要一张结束帧";
    }
    if (
      selectedWorkflow.capability === "reference_video" &&
      selectedInputCounts.reference +
        selectedInputCounts.reference_video +
        selectedInputCounts.reference_audio ===
        0
    ) {
      return "Ref2VA 至少需要一张参考图、一段参考视频或参考音频";
    }
    const imageWorkflow = ["text_to_image", "image_to_image"].includes(selectedWorkflow.capability);
    const invalidVideoParameters =
      !imageWorkflow &&
      (!Number.isFinite(generationSettings.durationSeconds) ||
        generationSettings.durationSeconds <
          (selectedModelProfile.family === "minimax_h3" ? 4 : 1) ||
        generationSettings.durationSeconds > 15 ||
        !Number.isFinite(generationSettings.fps) ||
        generationSettings.fps < 8 ||
        generationSettings.fps > 60);
    const invalidDenoise =
      selectedWorkflow.inputs.includes("denoise") &&
      (!Number.isFinite(generationSettings.denoise) ||
        generationSettings.denoise < 0.05 ||
        generationSettings.denoise > 1);
    if (
      !Number.isFinite(generationSettings.width) ||
      generationSettings.width < 256 ||
      generationSettings.width > 2048 ||
      !Number.isFinite(generationSettings.height) ||
      generationSettings.height < 256 ||
      generationSettings.height > 2048 ||
      invalidVideoParameters ||
      invalidDenoise ||
      !Number.isSafeInteger(generationSettings.seed) ||
      generationSettings.seed < 0 ||
      !Number.isSafeInteger(generationSettings.steps) ||
      generationSettings.steps < 1 ||
      generationSettings.steps > 100
    ) {
      return imageWorkflow
        ? "请检查分辨率、Steps、重绘强度和 Seed"
        : "请检查分辨率、时长、帧率和 Seed";
    }
    return null;
  }, [
    firstFrameAvailable,
    generationSettings,
    lastFrameAvailable,
    projectMode,
    selectedInputCounts,
    selectedModelProfile.family,
    selectedWorkflow,
  ]);
  const approvedCount = snapshot?.shots.filter((shot) => shot.status === "approved").length ?? 0;
  const totalDuration = snapshot?.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) ?? 0;
  const activeScene =
    snapshot?.scenes.find((scene) => scene.id === selectedShot?.sceneId) ?? snapshot?.scenes[0];
  const contextEdge = canvasContextMenu?.edge ?? null;
  const deletingShotItem = snapshot?.canvasItems.find(
    (item) => item.id === deletingShotItemId && item.refType === "shot",
  );
  const deletingShot = snapshot?.shots.find((shot) => shot.id === deletingShotItem?.refId);
  const deletingShotRunCount =
    snapshot?.runs.filter((run) => run.shotId === deletingShot?.id).length ?? 0;

  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    setNodes((currentNodes) =>
      applyNodeChanges(
        changes.filter((change) => change.type !== "select"),
        currentNodes,
      ),
    );
  }, []);

  const onNodeClick: NodeMouseHandler<BoardNode> = useCallback(
    (_event, node) => {
      if (!snapshot) return;
      const item = snapshot.canvasItems.find((candidate) => candidate.id === node.id);
      if (!item) return;
      setSelectedCanvasItemId(item.id);
      setSelectedEdgeId(null);
      setInspectorOpen(true);
      if (item.refType === "shot" || item.refType === "take_stack") {
        setSelectedShotId(item.refId);
      }
    },
    [snapshot],
  );

  const openNodeEditor = useCallback(
    (itemId: string) => {
      if (!canEditProject) {
        setNotice("Viewer 权限为只读；可以查看节点，但不能修改内容");
        return;
      }
      if (projectMode !== "project") {
        setNotice("示例画布为只读；新建或打开项目后即可编辑节点");
        return;
      }
      const item = snapshot?.canvasItems.find((candidate) => candidate.id === itemId);
      if (!snapshot || !item) return;
      if (item.refType === "take_stack") {
        setNotice("候选组由运行记录自动管理，可删除画布卡片但不能直接改写");
        return;
      }
      if (item.refType === "text") {
        const text = snapshot.textItems.find((candidate) => candidate.id === item.refId);
        if (text) {
          setNodeEditDraft({
            itemId,
            kind: "text",
            title: text.title,
            body: text.body,
            durationSeconds: null,
            aspectRatio: null,
          });
        }
        return;
      }
      if (item.refType === "entity") {
        const entity = snapshot.entities.find((candidate) => candidate.id === item.refId);
        if (entity) {
          setNodeEditDraft({
            itemId,
            kind: "entity",
            title: entity.name,
            body: entity.description,
            durationSeconds: null,
            aspectRatio: null,
          });
        }
        return;
      }
      if (item.refType === "asset") {
        const asset = snapshot.assets.find((candidate) => candidate.id === item.refId);
        if (asset) {
          setNodeEditDraft({
            itemId,
            kind: "asset",
            title: asset.originalName,
            body: "",
            durationSeconds: null,
            aspectRatio: null,
          });
        }
        return;
      }
      const shot = snapshot.shots.find((candidate) => candidate.id === item.refId);
      if (shot) {
        setNodeEditDraft({
          itemId,
          kind: "shot",
          title: shot.label,
          body: shot.intent,
          durationSeconds: shot.durationSeconds,
          aspectRatio: shot.aspectRatio,
        });
      }
    },
    [canEditProject, projectMode, snapshot],
  );

  const saveNodeEditor = useCallback(async () => {
    if (!projectKey || !nodeEditDraft || !canEditProject) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await projectApi.editCanvasItem(projectKey, nodeEditDraft.itemId, {
        title: nodeEditDraft.title,
        body: nodeEditDraft.body,
        ...(nodeEditDraft.durationSeconds !== null
          ? { durationSeconds: nodeEditDraft.durationSeconds }
          : {}),
        ...(nodeEditDraft.aspectRatio !== null ? { aspectRatio: nodeEditDraft.aspectRatio } : {}),
      });
      acceptPayload(payload);
      setNodeEditDraft(null);
      setNotice("节点内容已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "节点编辑失败");
    } finally {
      setBusy(false);
    }
  }, [acceptPayload, canEditProject, nodeEditDraft, projectKey]);

  const updateSelectedShot = useCallback(
    async (input: {
      title: string;
      body: string;
      durationSeconds: number;
      aspectRatio: Shot["aspectRatio"];
    }) => {
      if (
        !projectKey ||
        projectMode !== "project" ||
        !selectedShotId ||
        !snapshot ||
        !canEditProject
      ) {
        setNotice("示例镜头不会写入修改");
        return;
      }
      const item = snapshot.canvasItems.find(
        (candidate) => candidate.refType === "shot" && candidate.refId === selectedShotId,
      );
      if (!item) return;
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.editCanvasItem(projectKey, item.id, input);
        acceptPayload(payload, selectedShotId);
        setGenerationSettings((current) => ({
          ...current,
          durationSeconds: input.durationSeconds,
        }));
        setNotice("镜头信息已保存");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "镜头保存失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode, selectedShotId, snapshot],
  );

  const removeCanvasItem = useCallback(
    async (itemId: string, preview: ProjectCommandPreview) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) {
        setNotice("功能示例不会删除节点");
        return;
      }
      const item = snapshot?.canvasItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      setBusy(true);
      setError(null);
      try {
        const payload = (await projectApi.executeCommand(
          projectKey,
          { type: "canvas.remove_item", itemId },
          preview,
        )) as Awaited<ReturnType<typeof projectApi.deleteCanvasItem>>;
        acceptPayload(payload);
        setSelectedCanvasItemId((current) => (current === itemId ? null : current));
        setCanvasClipboard((current) => (current?.itemId === itemId ? null : current));
        setCanvasContextMenu(null);
        setPendingCanvasRemoval(null);
        setNotice("已从画布移除；底层项目数据与原始文件仍然保留");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "节点删除失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode, snapshot?.canvasItems],
  );

  const previewCanvasArrange = useCallback(async () => {
    if (!projectKey || projectMode !== "project" || !activeScene || !canEditProject) return;
    setBusy(true);
    setError(null);
    try {
      const { preview } = await projectApi.previewCommand(projectKey, {
        type: "canvas.arrange_scene",
        sceneId: activeScene.id,
      });
      setPendingCanvasArrange(preview);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "当前画布无法自动整理");
    } finally {
      setBusy(false);
    }
  }, [activeScene, canEditProject, projectKey, projectMode]);

  const confirmCanvasArrange = useCallback(async () => {
    if (
      !projectKey ||
      projectMode !== "project" ||
      !activeScene ||
      !pendingCanvasArrange ||
      !canEditProject
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const payload = await projectApi.executeCommand(
        projectKey,
        { type: "canvas.arrange_scene", sceneId: activeScene.id },
        pendingCanvasArrange,
      );
      acceptPayload(payload, selectedShotId ?? undefined);
      setPendingCanvasArrange(null);
      setNotice("画布已按连线方向整理，可在“记录”中撤销");
      window.requestAnimationFrame(
        () => void flowInstance?.fitView({ padding: 0.16, duration: 420 }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "画布整理失败");
    } finally {
      setBusy(false);
    }
  }, [
    acceptPayload,
    activeScene,
    canEditProject,
    flowInstance,
    pendingCanvasArrange,
    projectKey,
    projectMode,
    selectedShotId,
  ]);

  const deleteCanvasItem = useCallback(
    (itemId: string) => {
      if (!canEditProject) return;
      const item = snapshot?.canvasItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      setCanvasContextMenu(null);
      if (item.refType === "shot") {
        setError(null);
        setDeletingShotPreview(null);
        setDeletingShotItemId(item.id);
        const shot = snapshot?.shots.find((candidate) => candidate.id === item.refId);
        const hasRuns = snapshot?.runs.some((run) => run.shotId === shot?.id);
        if (projectKey && projectMode === "project" && shot && !hasRuns) {
          void projectApi
            .previewCommand(projectKey, { type: "shot.delete", shotId: shot.id })
            .then(({ preview }) => setDeletingShotPreview(preview))
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "无法预览删除影响"),
            );
        }
        return;
      }
      if (!projectKey || projectMode !== "project") {
        setNotice("功能示例不会删除节点");
        return;
      }
      setBusy(true);
      setError(null);
      void projectApi
        .previewCommand(projectKey, { type: "canvas.remove_item", itemId: item.id })
        .then(({ preview }) => setPendingCanvasRemoval({ itemId: item.id, preview }))
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "无法预览移除影响"),
        )
        .finally(() => setBusy(false));
    },
    [canEditProject, projectKey, projectMode, snapshot],
  );

  const confirmDeleteShot = useCallback(async () => {
    if (
      !projectKey ||
      projectMode !== "project" ||
      !deletingShotItem ||
      !deletingShot ||
      !canEditProject
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const payload = (await projectApi.executeCommand(
        projectKey,
        { type: "shot.delete", shotId: deletingShot.id },
        deletingShotPreview ?? undefined,
      )) as Awaited<ReturnType<typeof projectApi.deleteShot>>;
      acceptPayload(payload);
      setSelectedCanvasItemId((current) =>
        payload.removedItemIds.includes(current ?? "") ? null : current,
      );
      setCanvasClipboard((current) =>
        current && payload.removedItemIds.includes(current.itemId) ? null : current,
      );
      setDeletingShotItemId(null);
      setDeletingShotPreview(null);
      setInspectorOpen(false);
      setNotice(`镜头“${deletingShot.label}”已删除，镜头列表与画布已同步`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "镜头删除失败");
    } finally {
      setBusy(false);
    }
  }, [
    acceptPayload,
    canEditProject,
    deletingShot,
    deletingShotItem,
    deletingShotPreview,
    projectKey,
    projectMode,
  ]);

  const deleteCanvasEdge = useCallback(
    async (edgeId: string, requestedIdentity?: CanvasEdgeIdentity) => {
      if (!projectKey || projectMode !== "project" || !snapshot || !canEditProject) return;
      const identity = requestedIdentity ?? selectedEdgeIdentityRef.current;
      const edge =
        (identity
          ? snapshot.canvasEdges.find(
              (candidate) =>
                candidate.sourceItemId === identity.sourceItemId &&
                candidate.targetItemId === identity.targetItemId &&
                candidate.targetSlot === identity.targetSlot,
            )
          : null) ?? snapshot.canvasEdges.find((candidate) => candidate.id === edgeId);
      if (edge?.immutable) {
        setNotice("生成溯源连线需要保留，不能删除");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        if (!edge) throw new Error("连线已经不存在，请刷新画布后重试");
        const payload = await projectApi.disconnect(projectKey, edge.id);
        acceptPayload(payload);
        setSelectedEdgeId(null);
        setCanvasContextMenu(null);
        selectedEdgeIdentityRef.current = null;
        const targetItemId = identity?.targetItemId ?? edge?.targetItemId;
        const targetSlot = identity?.targetSlot ?? edge?.targetSlot;
        const targetItem = payload.snapshot.canvasItems.find((item) => item.id === targetItemId);
        if (targetItem?.refType === "shot" && targetSlot) {
          const assetId = connectedAssetId(payload.snapshot, targetItem.refId, targetSlot);
          setGenerationSettings((current) => ({
            ...current,
            [targetSlot === "first_frame"
              ? "firstFrameAssetId"
              : targetSlot === "last_frame"
                ? "lastFrameAssetId"
                : "referenceAssetId"]: assetId,
          }));
        }
        setNotice("连线已删除，输入位置已释放");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "连线删除失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode, snapshot],
  );

  const duplicateCanvasItem = useCallback(
    async (itemId: string, position?: { x: number; y: number }) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) {
        setNotice("功能示例不会复制节点");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.duplicateCanvasItem(
          projectKey,
          itemId,
          position?.x,
          position?.y,
        );
        acceptPayload(payload);
        setSelectedCanvasItemId(payload.itemId);
        setCanvasContextMenu(null);
        setNotice(
          payload.copyMode === "independent"
            ? "已创建可独立编辑的副本；素材文件不会重复占用空间"
            : "已创建引用副本；底层素材文件不会重复占用空间",
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "节点复制失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode],
  );

  const copyCanvasItem = useCallback(
    (itemId: string, mode: "copy" | "cut") => {
      if (!canEditProject) return;
      setCanvasClipboard({ itemId, mode });
      setCanvasContextMenu(null);
      setNotice(mode === "copy" ? "节点已复制，右键空白处粘贴" : "节点已剪切，粘贴前不会移除");
    },
    [canEditProject],
  );

  const pasteCanvasItem = useCallback(
    async (position?: { x: number; y: number }) => {
      if (
        !canvasClipboard ||
        !snapshot ||
        !projectKey ||
        projectMode !== "project" ||
        !canEditProject
      )
        return;
      const source = snapshot.canvasItems.find((item) => item.id === canvasClipboard.itemId);
      if (!source) {
        setCanvasClipboard(null);
        setError("剪贴板中的节点已经不存在");
        return;
      }
      const target = position ?? { x: source.x + 36, y: source.y + 36 };
      if (canvasClipboard.mode === "copy") {
        await duplicateCanvasItem(source.id, target);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.move(projectKey, source.id, target.x, target.y);
        acceptPayload(payload);
        setSelectedCanvasItemId(source.id);
        setCanvasClipboard(null);
        setCanvasContextMenu(null);
        setNotice("节点已移动到新的位置");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "节点粘贴失败");
      } finally {
        setBusy(false);
      }
    },
    [
      acceptPayload,
      canEditProject,
      canvasClipboard,
      duplicateCanvasItem,
      projectKey,
      projectMode,
      snapshot,
    ],
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === "Escape") {
        const overlayOpen = Boolean(
          canvasContextMenu ||
            canvasGuideOpen ||
            commandHistoryOpen ||
            pendingCanvasRemoval ||
            pendingCanvasArrange ||
            deletingShotItemId ||
            nodeEditDraft ||
            recipeOpen ||
            assetLibraryOpen ||
            storyboardOpen ||
            renameOpen,
        );
        setCanvasContextMenu(null);
        setCanvasGuideOpen(false);
        setCommandHistoryOpen(false);
        setPendingCanvasRemoval(null);
        setPendingCanvasArrange(null);
        setDeletingShotItemId(null);
        setDeletingShotPreview(null);
        setNodeEditDraft(null);
        setRecipeOpen(false);
        setAssetLibraryOpen(false);
        setStoryboardOpen(false);
        setRenameOpen(false);
        if (!overlayOpen) {
          setSelectedCanvasItemId(null);
          setSelectedShotId(null);
          setSelectedEdgeId(null);
          setInspectorOpen(false);
        }
        return;
      }
      if (
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "[") {
        setSidebarOpen((current) => !current);
        return;
      }
      if (event.key === "]") {
        if (inspectorHasContent) setInspectorOpen((current) => !current);
        return;
      }
      if (event.key === "\\") {
        const enteringFocus = sidebarOpen || inspectorVisible;
        setSidebarOpen(!enteringFocus);
        setInspectorOpen(!enteringFocus && inspectorHasContent);
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (!canEditProject) return;
      if (command && event.key.toLowerCase() === "c" && selectedCanvasItemId) {
        event.preventDefault();
        copyCanvasItem(selectedCanvasItemId, "copy");
      } else if (command && event.key.toLowerCase() === "x" && selectedCanvasItemId) {
        event.preventDefault();
        copyCanvasItem(selectedCanvasItemId, "cut");
      } else if (command && event.key.toLowerCase() === "v" && canvasClipboard) {
        event.preventDefault();
        void pasteCanvasItem();
      } else if (command && event.key.toLowerCase() === "d" && selectedCanvasItemId) {
        event.preventDefault();
        void duplicateCanvasItem(selectedCanvasItemId);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedEdgeId) {
        event.preventDefault();
        void deleteCanvasEdge(selectedEdgeId);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedCanvasItemId) {
        event.preventDefault();
        void deleteCanvasItem(selectedCanvasItemId);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    canvasClipboard,
    canEditProject,
    canvasContextMenu,
    canvasGuideOpen,
    commandHistoryOpen,
    pendingCanvasRemoval,
    pendingCanvasArrange,
    deletingShotItemId,
    copyCanvasItem,
    deleteCanvasEdge,
    deleteCanvasItem,
    duplicateCanvasItem,
    pasteCanvasItem,
    selectedCanvasItemId,
    selectedEdgeId,
    sidebarOpen,
    inspectorHasContent,
    inspectorVisible,
    nodeEditDraft,
    recipeOpen,
    assetLibraryOpen,
    storyboardOpen,
    renameOpen,
  ]);

  const openNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: BoardNode) => {
      event.preventDefault();
      if (!canEditProject) return;
      const point = flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
        x: node.position.x,
        y: node.position.y,
      };
      setSelectedCanvasItemId(node.id);
      const item = snapshot?.canvasItems.find((candidate) => candidate.id === node.id);
      if (item && (item.refType === "shot" || item.refType === "take_stack")) {
        setSelectedShotId(item.refId);
      }
      setCanvasContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        flowX: point.x,
        flowY: point.y,
        itemId: node.id,
        edge: null,
      });
    },
    [canEditProject, flowInstance, snapshot?.canvasItems],
  );

  const openPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      if (!canEditProject) return;
      setSelectedCanvasItemId(null);
      setSelectedShotId(null);
      setSelectedEdgeId(null);
      setInspectorOpen(false);
      const point = flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
        x: 180,
        y: 180,
      };
      setCanvasContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        flowX: point.x,
        flowY: point.y,
        itemId: null,
        edge: null,
      });
    },
    [canEditProject, flowInstance],
  );

  const openEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      event.preventDefault();
      const currentSnapshot = latestSnapshotRef.current;
      const snapshotEdge = currentSnapshot ? resolveSnapshotEdge(currentSnapshot, edge) : null;
      const resolvedEdgeId = snapshotEdge?.id ?? edge.id;
      const targetSlot =
        snapshotEdge?.targetSlot ??
        (edge.targetHandle === "first_frame" ||
        edge.targetHandle === "last_frame" ||
        edge.targetHandle === "reference" ||
        edge.targetHandle === "reference_video" ||
        edge.targetHandle === "reference_audio"
          ? edge.targetHandle
          : null);
      const identity =
        edgeIdentityFromPointer(event) ??
        ({
          sourceItemId: snapshotEdge?.sourceItemId ?? edge.source,
          targetItemId: snapshotEdge?.targetItemId ?? edge.target,
          targetSlot,
        } satisfies CanvasEdgeIdentity);
      selectedEdgeIdentityRef.current = identity;
      setSelectedEdgeId(resolvedEdgeId);
      setSelectedCanvasItemId(null);
      setSelectedShotId(null);
      setInspectorOpen(false);
      const point = flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
        x: 180,
        y: 180,
      };
      setCanvasContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        flowX: point.x,
        flowY: point.y,
        itemId: null,
        edge: {
          id: resolvedEdgeId,
          ...identity,
          immutable: snapshotEdge?.immutable ?? false,
        },
      });
    },
    [flowInstance],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (
        !projectKey ||
        projectMode !== "project" ||
        !connection.source ||
        !connection.target ||
        !canEditProject
      ) {
        setNotice("功能示例中的连线不会写入项目");
        return;
      }
      const slot = connection.targetHandle;
      if (
        slot !== "first_frame" &&
        slot !== "last_frame" &&
        slot !== "reference" &&
        slot !== "reference_video" &&
        slot !== "reference_audio"
      ) {
        setError("请连接到镜头的图片、视频或音频输入端口");
        return;
      }
      setBusy(true);
      setError(null);
      void projectApi
        .connect(projectKey, connection.source, connection.target, slot)
        .then((payload) => {
          acceptPayload(payload);
          const targetItem = payload.snapshot.canvasItems.find(
            (item) => item.id === connection.target,
          );
          if (targetItem?.refType === "shot") {
            setSelectedCanvasItemId(targetItem.id);
            setSelectedShotId(targetItem.refId);
            setInspectorOpen(true);
            const assetId = connectedAssetId(payload.snapshot, targetItem.refId, slot);
            if (slot !== "reference_video" && slot !== "reference_audio") {
              setGenerationSettings((current) => ({
                ...current,
                [slot === "first_frame"
                  ? "firstFrameAssetId"
                  : slot === "last_frame"
                    ? "lastFrameAssetId"
                    : "referenceAssetId"]: assetId,
              }));
            }
          }
          setNotice(
            `已连接为${slot === "first_frame" ? "首帧" : slot === "last_frame" ? "尾帧" : slot === "reference_video" ? "参考视频" : slot === "reference_audio" ? "参考音频" : "参考图"}`,
          );
        })
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "连线保存失败"),
        )
        .finally(() => setBusy(false));
    },
    [acceptPayload, canEditProject, projectKey, projectMode],
  );

  const connectAssetFromLibrary = useCallback(
    async (
      assetId: string,
      slot: "first" | "last" | "reference" | "referenceVideo" | "referenceAudio",
    ) => {
      if (!projectKey || projectMode !== "project" || !snapshot || !selectedShot || !canEditProject)
        return;
      const target = snapshot.canvasItems.find(
        (item) => item.refType === "shot" && item.refId === selectedShot.id,
      );
      if (!target) return;
      setBusy(true);
      setError(null);
      try {
        let source = snapshot.canvasItems.find(
          (item) =>
            (item.refType === "asset" && item.refId === assetId) ||
            (item.refType === "entity" &&
              snapshot.entities
                .find((entity) => entity.id === item.refId)
                ?.referenceAssetIds.includes(assetId)),
        );
        if (!source) {
          const added = await projectApi.addCanvasItem(projectKey, {
            refType: "asset",
            refId: assetId,
            sceneId: selectedShot.sceneId,
            x: target.x - 300,
            y: target.y + 36,
          });
          acceptPayload(added, selectedShot.id);
          source = added.snapshot.canvasItems.find((item) => item.id === added.itemId);
        }
        if (!source) throw new Error("素材无法加入当前画布");
        const targetSlot =
          slot === "first"
            ? "first_frame"
            : slot === "last"
              ? "last_frame"
              : slot === "referenceVideo"
                ? "reference_video"
                : slot === "referenceAudio"
                  ? "reference_audio"
                  : "reference";
        const connected = await projectApi.connect(projectKey, source.id, target.id, targetSlot);
        acceptPayload(connected, selectedShot.id);
        if (slot !== "referenceVideo" && slot !== "referenceAudio") {
          setGenerationSettings((current) => ({
            ...current,
            [slot === "first"
              ? "firstFrameAssetId"
              : slot === "last"
                ? "lastFrameAssetId"
                : "referenceAssetId"]: assetId,
          }));
        }
        setNotice(
          `${slot === "first" ? "首帧" : slot === "last" ? "尾帧" : slot === "referenceVideo" ? "参考视频" : slot === "referenceAudio" ? "参考音频" : "参考图"}已连接到 ${selectedShot.label}`,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "素材连接失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode, selectedShot, snapshot],
  );

  const addAssetToCanvasFromLibrary = useCallback(
    async (assetId: string) => {
      if (!projectKey || projectMode !== "project" || !snapshot || !canEditProject) {
        return { ok: false, error: "请先打开一个本地项目" };
      }
      const existing = snapshot.canvasItems.find(
        (item) =>
          (item.refType === "asset" && item.refId === assetId) ||
          (item.refType === "entity" &&
            snapshot.entities
              .find((entity) => entity.id === item.refId)
              ?.referenceAssetIds.includes(assetId)),
      );
      if (existing) {
        setSelectedCanvasItemId(existing.id);
        setAssetLibraryOpen(false);
        setNotice("素材已经在画布中，已为你定位");
        return { ok: true };
      }
      const target = selectedShot
        ? snapshot.canvasItems.find(
            (item) => item.refType === "shot" && item.refId === selectedShot.id,
          )
        : null;
      const sceneId = selectedShot?.sceneId ?? activeScene?.id ?? snapshot.scenes[0]?.id;
      if (!sceneId) return { ok: false, error: "当前项目还没有可用画布" };
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.addCanvasItem(projectKey, {
          refType: "asset",
          refId: assetId,
          sceneId,
          x: target ? target.x - 320 : 120,
          y: target ? target.y + target.height + 56 : 160,
        });
        acceptPayload(payload, selectedShot?.id);
        setSelectedCanvasItemId(payload.itemId);
        setAssetLibraryOpen(false);
        setNotice("素材已加入当前画布");
        return { ok: true };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "素材加入画布失败";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [
      acceptPayload,
      activeScene?.id,
      canEditProject,
      projectKey,
      projectMode,
      selectedShot,
      snapshot,
    ],
  );

  const updateAssetMetadata = useCallback(
    async (
      assetId: string,
      input: {
        title?: string;
        customTags?: string[];
        libraryKind?: "character" | "location" | "prop" | null;
      },
    ) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) {
        return { ok: false, error: "示例项目不会保存资产修改" };
      }
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.updateAsset(projectKey, assetId, input);
        acceptPayload(payload);
        setNotice(
          input.title !== undefined
            ? "素材名称已更新"
            : input.libraryKind !== undefined
              ? "素材分类已更新"
              : "素材标签已更新",
        );
        return { ok: true };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "素材信息保存失败";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode],
  );

  const inspectHistoricalAssetMetadata = useCallback(async () => {
    if (!projectKey || projectMode !== "project" || !canEditProject) {
      return { ok: false, error: "示例项目不会修改资产信息" };
    }
    setBusy(true);
    setError(null);
    try {
      const payload = await projectApi.inspectAssetMetadata(projectKey);
      acceptPayload(payload);
      const warning = payload.warnings.length
        ? `；${payload.warnings.length} 个文件暂时无法识别`
        : "";
      setNotice(`已补全 ${payload.updatedAssetIds.length} 段视频的信息${warning}`);
      return {
        ok: true,
        updated: payload.updatedAssetIds.length,
        warnings: payload.warnings.length,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "视频信息识别失败";
      setError(message);
      return { ok: false, error: message };
    } finally {
      setBusy(false);
    }
  }, [acceptPayload, canEditProject, projectKey, projectMode]);

  const setAssetCustomTags = useCallback(
    async (assetId: string, customTags: string[]) => {
      if (!canEditProject) return;
      const asset = snapshot?.assets.find((candidate) => candidate.id === assetId);
      if (!asset) return;

      if (projectMode !== "project" || !projectKey) {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                assets: current.assets.map((candidate) =>
                  candidate.id === assetId ? { ...candidate, customTags } : candidate,
                ),
              }
            : current,
        );
        setNotice("自定义标签已更新");
        return;
      }

      await updateAssetMetadata(assetId, { customTags });
    },
    [canEditProject, projectKey, projectMode, snapshot?.assets, updateAssetMetadata],
  );

  const openProject = useCallback(
    async (key: string) => {
      generationTokenRef.current += 1;
      setGenerationBusy(false);
      setGenerationProgress(null);
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.open(key);
        pendingSyncRef.current = null;
        setSyncStatus("current");
        window.sessionStorage.removeItem("takeboard.resumeDemo");
        setBlankCanvasGuideOpen(false);
        setProjectKey(key);
        setProjectMode("project");
        acceptPayload(payload);
        setShowHub(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "项目打开失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload],
  );

  const createProject = useCallback(
    async (input: Parameters<typeof projectApi.create>[0]) => {
      const catalogRequestId = ++projectCatalogRequestRef.current;
      generationTokenRef.current += 1;
      setGenerationBusy(false);
      setGenerationProgress(null);
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.create(input);
        window.sessionStorage.removeItem("takeboard.resumeDemo");
        let showFirstGuide = false;
        try {
          showFirstGuide = window.localStorage.getItem("takeboard.blankCanvasGuideSeen") !== "1";
          window.localStorage.setItem("takeboard.blankCanvasGuideSeen", "1");
        } catch {
          // Storage may be unavailable in privacy-restricted browser sessions.
        }
        setBlankCanvasGuideOpen(showFirstGuide);
        setProjectKey(payload.key);
        setProjectMode("project");
        acceptPayload(payload);
        setShowHub(false);
        const catalog = await projectApi.list();
        if (projectCatalogRequestRef.current === catalogRequestId) setProjects(catalog.projects);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "项目创建失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload],
  );

  const importProject = useCallback(async (file: File) => {
    const catalogRequestId = ++projectCatalogRequestRef.current;
    setBusy(true);
    setError(null);
    try {
      const imported = await projectApi.importPackage(file);
      const catalog = await projectApi.list();
      if (projectCatalogRequestRef.current === catalogRequestId) setProjects(catalog.projects);
      setNotice(`“${imported.title}”已完成校验并导入`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目包导入失败");
      throw cause;
    } finally {
      setBusy(false);
    }
  }, []);

  const renameProject = useCallback(
    async (key: string, title: string) => {
      const catalogRequestId = ++projectCatalogRequestRef.current;
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.rename(key, title);
        if (projectKey === key) acceptPayload(payload);
        const catalog = await projectApi.list();
        if (projectCatalogRequestRef.current === catalogRequestId) setProjects(catalog.projects);
        setNotice("项目名称已更新");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "项目重命名失败");
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, projectKey],
  );

  const deleteProject = useCallback(
    async (key: string) => {
      const catalogRequestId = ++projectCatalogRequestRef.current;
      setBusy(true);
      setError(null);
      try {
        await projectApi.delete(key);
        if (projectKey === key) setProjectKey(null);
        const catalog = await projectApi.list();
        if (projectCatalogRequestRef.current === catalogRequestId) setProjects(catalog.projects);
        const trash = await projectApi.trash();
        if (projectCatalogRequestRef.current === catalogRequestId) {
          setTrashedProjects(trash.projects);
        }
        setNotice("项目已移到回收区");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "项目删除失败");
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [projectKey],
  );

  const restoreProject = useCallback(async (trashKey: string) => {
    const catalogRequestId = ++projectCatalogRequestRef.current;
    setBusy(true);
    setError(null);
    try {
      const restored = await projectApi.restore(trashKey);
      const [catalog, trash] = await Promise.all([projectApi.list(), projectApi.trash()]);
      if (projectCatalogRequestRef.current === catalogRequestId) {
        setProjects(catalog.projects);
        setTrashedProjects(trash.projects);
      }
      setNotice(`“${restored.title}”已恢复`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目恢复失败");
      throw cause;
    } finally {
      setBusy(false);
    }
  }, []);

  const openDemo = useCallback(async () => {
    generationTokenRef.current += 1;
    setGenerationBusy(false);
    setGenerationProgress(null);
    setBusy(true);
    setError(null);
    try {
      const payload = await demoApi.get();
      setProjectKey(null);
      setProjectMode("demo");
      acceptPayload(payload);
      setShowHub(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Demo 打开失败");
    } finally {
      setBusy(false);
    }
  }, [acceptPayload]);

  useEffect(() => {
    if (!selectedShot || !snapshot) return;
    const workflowPath = selectedShotWorkflowPath ?? defaultGenerationSettings.recipePath;
    const scope = `${projectMode}:${projectKey ?? "demo"}:${selectedShot.id}:${workflowPath}`;
    if (generationScopeRef.current === scope) return;
    generationScopeRef.current = scope;
    const workflow = findWorkflow(workflowPath, workflows);
    const profile = modelProfile(workflow, selectedShot.aspectRatio);
    const preferred = { ...profile.defaults, ...loadModelPreferences(workflowPath) };
    const lastRun = [...snapshot.runs].reverse().find((run) => run.shotId === selectedShot.id);
    const parameter = (name: string, fallback: number) => {
      const value = lastRun?.parameters[name];
      return typeof value === "number" ? value : fallback;
    };
    setGenerationSettings((current) => ({
      ...current,
      recipePath: workflowPath,
      prompt:
        typeof lastRun?.parameters.promptSource === "string"
          ? lastRun.parameters.promptSource
          : typeof lastRun?.parameters.prompt === "string"
            ? lastRun.parameters.prompt
            : selectedShot.intent,
      negativePrompt:
        typeof lastRun?.parameters.negativePrompt === "string"
          ? lastRun.parameters.negativePrompt
          : "",
      width: parameter("width", preferred.width),
      height: parameter("height", preferred.height),
      durationSeconds: parameter("durationSeconds", selectedShot.durationSeconds),
      fps: parameter("fps", preferred.fps),
      steps: parameter("steps", preferred.steps),
      denoise: parameter("denoise", preferred.denoise),
      seed: parameter("seed", current.seed),
      firstFrameAssetId: connectedAssetId(snapshot, selectedShot.id, "first_frame"),
      lastFrameAssetId: connectedAssetId(snapshot, selectedShot.id, "last_frame"),
      referenceAssetId: connectedAssetId(snapshot, selectedShot.id, "reference"),
      referenceImageSize: lastRun?.parameters.referenceImageSize === "max" ? "max" : "match",
    }));
  }, [projectKey, projectMode, selectedShot, selectedShotWorkflowPath, snapshot, workflows]);

  useEffect(() => {
    if (window.sessionStorage.getItem("takeboard.resumeDemo") !== "1") return;
    window.sessionStorage.removeItem("takeboard.resumeDemo");
    void openDemo();
  }, [openDemo]);

  const createShot = useCallback(
    async (position?: { x: number; y: number }) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) return;
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.createShot(projectKey, position);
        setBlankCanvasGuideOpen(false);
        acceptPayload(payload, payload.shotId);
        setSelectedCanvasItemId(payload.itemId);
        setNotice("已添加一个空白镜头；在右侧设置镜头内容与工作流");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "镜头创建失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey, projectMode],
  );

  const createTextNode = useCallback(
    async (position: { x: number; y: number }) => {
      if (!projectKey || projectMode !== "project" || !canEditProject) return;
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.createTextNode(projectKey, {
          title: "新笔记",
          x: position.x,
          y: position.y,
          ...(activeScene ? { sceneId: activeScene.id } : {}),
        });
        acceptPayload(payload);
        setSelectedCanvasItemId(payload.itemId);
        setCanvasContextMenu(null);
        setNotice("笔记已加入画布；双击即可编辑");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "笔记创建失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, activeScene, canEditProject, projectKey, projectMode],
  );

  const uploadAsset = useCallback(
    async (
      file: File,
      metadata?: {
        kind?: "character" | "location" | "prop";
        name?: string;
        x?: number;
        y?: number;
        addToCanvas?: boolean;
      },
    ) => {
      if (!projectKey) return { ok: false, error: "请先打开一个项目" };
      if (!canEditProject) return { ok: false, error: "Viewer 权限为只读" };
      setBusy(true);
      setError(null);
      try {
        const payload = await projectApi.uploadAsset(projectKey, file, metadata);
        acceptPayload(payload);
        setNotice(
          metadata?.kind
            ? `已存入${metadata.kind === "character" ? "人物" : metadata.kind === "location" ? "场景" : "道具"}资产：${metadata.name || file.name}`
            : `已导入参考素材：${file.name}`,
        );
        const importedAssetId = payload.snapshot.assets.at(-1)?.id;
        return { ok: true, ...(importedAssetId ? { assetId: importedAssetId } : {}) };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "素材导入失败";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, canEditProject, projectKey],
  );

  const refreshWorkflows = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const detected = await workflowApi.list();
      setWorkflows(detected.workflows);
      setWorkflowWarnings([
        ...(detected.warnings ?? []),
        ...(detected.diagnostics ?? []).map(
          (item) => `${item.code} · ${item.path}：${item.message}`,
        ),
      ]);
      setComfyEditorUrl(detected.editorUrl);
      setNotice(`已检测 ${detected.workflows.length} 个 ComfyUI Workflow`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作流检测失败");
    } finally {
      setBusy(false);
    }
  }, []);

  const bindWorkflowToSelectedShot = useCallback(
    async (workflow: WorkflowSummary) => {
      if (!selectedShot || !snapshot) return;
      if (workflowLocked) {
        setNotice("这个镜头已有运行记录；工作流已锁定");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const profile = modelProfile(workflow, selectedShot.aspectRatio);
        const saved = loadModelPreferences(workflow.path);
        if (projectMode === "project" && projectKey) {
          const item = snapshot.canvasItems.find(
            (candidate) => candidate.refType === "shot" && candidate.refId === selectedShot.id,
          );
          if (!item) throw new Error("镜头不在当前画布中");
          const payload = await projectApi.editCanvasItem(projectKey, item.id, {
            workflowPath: workflow.path,
          });
          acceptPayload(payload, selectedShot.id);
        }
        setGenerationSettings((current) => ({
          ...current,
          recipePath: workflow.path,
          ...profile.defaults,
          ...saved,
        }));
        setRecipeOpen(false);
        setNotice(`已为 ${selectedShot.label} 绑定：${workflow.name}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "工作流绑定失败");
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload, projectKey, projectMode, selectedShot, snapshot, workflowLocked],
  );

  const importWorkflow = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const imported = await workflowApi.import(file);
        await refreshWorkflows();
        setNotice(`已导入：${imported.name} · 完成映射确认后即可用于镜头`);
        return imported;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Workflow 导入失败");
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [refreshWorkflows],
  );

  const generateReal = useCallback(
    async (
      shot: Shot,
      settingsOverride: Partial<GenerationSettings> = {},
      launchOptions: GenerationLaunchOptions = {},
    ) => {
      if (!projectKey) return;
      const submittedSettings = { ...generationSettings, ...settingsOverride };
      const effectiveDisabledReason =
        generationDisabledReason === "请先输入镜头提示词" && submittedSettings.prompt.trim()
          ? null
          : generationDisabledReason;
      const token = generationTokenRef.current + 1;
      generationTokenRef.current = token;
      setGenerationBusy(true);
      const startedAt = Date.now();
      setGenerationProgress({
        phase: "preparing",
        label: "正在准备输入",
        detail: "校验素材、参数与工作流",
        percent: null,
        elapsedSeconds: 0,
      });
      setError(null);
      try {
        if (selectedWorkflow?.execution === "comfy_only") {
          const opened = window.open(
            `${comfyEditorUrl}/?takeboard_workflow=${encodeURIComponent(selectedWorkflow.path)}`,
            "_blank",
          );
          if (!opened) throw new Error("浏览器阻止了新窗口，请允许弹窗后重试");
          opened.opener = null;
          setNotice("已打开 ComfyUI；这个 JSON 的输入槽位已在 TakeBoard 中识别");
          return;
        }
        if (effectiveDisabledReason) throw new Error(effectiveDisabledReason);
        setGenerationProgress({
          phase: "queued",
          label: "正在提交任务",
          detail: "构建候选批次与可复现的运行快照",
          percent: null,
          elapsedSeconds: 0,
        });
        const miniMaxH3 = selectedModelProfile.family === "minimax_h3";
        const requestedCount = Math.min(4, Math.max(1, launchOptions.candidateCount ?? 1));
        const batchId =
          launchOptions.candidateBatchId ??
          `batch_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
        const firstCandidateIndex = launchOptions.candidateIndex ?? 1;
        const batchSize = launchOptions.candidateIndex ? 1 : requestedCount;
        const seeds = Array.from({ length: batchSize }, (_, offset) =>
          launchOptions.retryOfRunId
            ? submittedSettings.seed
            : (submittedSettings.seed + offset * 104_729) % 2_147_483_648,
        );
        const submissionResults = await Promise.allSettled(
          seeds.map((seed, offset) =>
            projectApi.generate(projectKey, shot.id, {
              ...submittedSettings,
              seed,
              promptSource: submittedSettings.prompt,
              prompt:
                launchOptions.compiledPrompt ??
                (miniMaxH3
                  ? compileMiniMaxH3Mentions(submittedSettings.prompt, promptMentions)
                  : submittedSettings.prompt),
              firstFrameAssetId:
                launchOptions.firstFrameAssetId === undefined
                  ? submittedSettings.firstFrameAssetId
                  : launchOptions.firstFrameAssetId,
              lastFrameAssetId:
                launchOptions.lastFrameAssetId === undefined
                  ? submittedSettings.lastFrameAssetId
                  : launchOptions.lastFrameAssetId,
              referenceImageAssetIds:
                launchOptions.referenceImageAssetIds ?? selectedReferenceImageIds,
              referenceVideoAssetIds:
                launchOptions.referenceVideoAssetIds ?? selectedReferenceVideoIds,
              referenceAudioAssetIds:
                launchOptions.referenceAudioAssetIds ?? selectedReferenceAudioIds,
              candidateBatchId: batchId,
              candidateIndex: firstCandidateIndex + offset,
              candidateCount: requestedCount,
              ...(launchOptions.retryOfRunId ? { retryOfRunId: launchOptions.retryOfRunId } : {}),
            }),
          ),
        );
        const submitted = submissionResults.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        for (const result of submitted) acceptPayload(result, shot.id);
        if (submissionResults.some((result) => result.status === "rejected")) {
          const refreshed = await projectApi.open(projectKey).catch(() => null);
          if (refreshed) acceptPayload(refreshed, shot.id);
        }
        const latestSnapshot = latestSnapshotRef.current;
        const batchRunIds = [
          ...new Set([
            ...submitted.map((result) => result.runId),
            ...(latestSnapshot?.runs
              .filter((run) => run.parameters.candidateBatchId === batchId)
              .map((run) => run.id) ?? []),
          ]),
        ];
        generationRunIdsRef.current = batchRunIds;
        if (generationTokenRef.current !== token) {
          await Promise.allSettled(
            batchRunIds.map((runId) => projectApi.cancelRun(projectKey, runId)),
          );
          return;
        }
        const submissionFailures = submissionResults.length - submitted.length;
        if (batchRunIds.length === 0) {
          const firstFailure = submissionResults.find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
          );
          throw firstFailure?.reason instanceof Error
            ? firstFailure.reason
            : new Error("候选任务未能提交到执行端");
        }
        setNotice(
          submissionFailures > 0
            ? `${batchRunIds.length} 个运行已保存，${submissionFailures} 个提交需要重试`
            : `${selectedWorkflow?.name ?? "Recipe"} 已提交 ${batchRunIds.length} 个独立运行`,
        );
        const terminalStatuses = new Set(["completed", "failed", "cancelled", "orphaned"]);
        const runStates = new Map<string, string>();
        let consecutiveSyncFailures = 0;
        while (generationTokenRef.current === token) {
          await new Promise((resolve) => window.setTimeout(resolve, 3_000));
          if (generationTokenRef.current !== token) return;
          const pendingRunIds = batchRunIds.filter(
            (runId) => !terminalStatuses.has(runStates.get(runId) ?? "running"),
          );
          if (pendingRunIds.length === 0) break;
          const synchronized = await Promise.allSettled(
            pendingRunIds.map((runId) => projectApi.run(projectKey, runId)),
          );
          const successful = synchronized.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          );
          if (successful.length === 0) {
            consecutiveSyncFailures += 1;
            setGenerationProgress({
              phase: "running",
              label: `正在生成 ${batchRunIds.length} 个候选`,
              detail: `状态同步暂时中断，正在第 ${consecutiveSyncFailures} 次重连`,
              percent: null,
              elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
            });
            await new Promise((resolve) =>
              window.setTimeout(resolve, Math.min(12_000, consecutiveSyncFailures * 2_000)),
            );
            continue;
          }
          consecutiveSyncFailures = 0;
          if (generationTokenRef.current !== token) return;
          for (const result of successful) {
            runStates.set(result.runId, result.status);
            acceptPayload(result, shot.id);
          }
          const knownRuns = latestSnapshotRef.current?.runs.filter((run) =>
            batchRunIds.includes(run.id),
          );
          for (const run of knownRuns ?? []) runStates.set(run.id, run.status);
          const completed = batchRunIds.filter(
            (runId) => runStates.get(runId) === "completed",
          ).length;
          const failed = batchRunIds.filter((runId) =>
            ["failed", "cancelled", "orphaned"].includes(runStates.get(runId) ?? ""),
          ).length;
          const running = batchRunIds.length - completed - failed;
          const livePercents = successful
            .map((result) => result.progress?.percent)
            .filter((percent): percent is number => typeof percent === "number");
          setGenerationProgress({
            phase: running > 0 ? "running" : "collecting",
            label: running > 0 ? `正在生成 ${batchRunIds.length} 个候选` : "正在整理候选",
            detail: `${completed} 已完成 · ${running} 执行中${failed > 0 ? ` · ${failed} 失败` : ""}`,
            percent:
              livePercents.length === running && running > 0
                ? Math.round(
                    (completed * 100 + livePercents.reduce((sum, percent) => sum + percent, 0)) /
                      batchRunIds.length,
                  )
                : running === 0
                  ? 100
                  : null,
            elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
          });
        }
        const finalRuns = latestSnapshotRef.current?.runs.filter((run) =>
          batchRunIds.includes(run.id),
        );
        const completed = finalRuns?.filter((run) => run.status === "completed").length ?? 0;
        const failed = (finalRuns?.length ?? 0) - completed;
        const isImage =
          selectedWorkflow &&
          ["text_to_image", "image_to_image"].includes(selectedWorkflow.capability);
        setNotice(
          failed > 0
            ? `${shot.label} 完成 ${completed} 个候选，${failed} 个可单独重试`
            : `${shot.label} 已生成 ${completed} 个真实${isImage ? "图片" : "视频"}候选`,
        );
      } catch (cause) {
        if (generationTokenRef.current === token) {
          setError(cause instanceof Error ? cause.message : "生成失败");
        }
      } finally {
        if (generationTokenRef.current === token) {
          generationRunIdsRef.current = [];
          setGenerationBusy(false);
          window.setTimeout(() => {
            if (generationTokenRef.current === token) setGenerationProgress(null);
          }, 900);
        }
      }
    },
    [
      acceptPayload,
      comfyEditorUrl,
      generationDisabledReason,
      generationSettings,
      promptMentions,
      projectKey,
      selectedModelProfile.family,
      selectedReferenceAudioIds,
      selectedReferenceImageIds,
      selectedReferenceVideoIds,
      selectedWorkflow,
    ],
  );

  const retryGenerationRun = useCallback(
    async (run: Run) => {
      const shot = latestSnapshotRef.current?.shots.find((item) => item.id === run.shotId);
      if (!shot) {
        setError("原镜头已不存在，无法重试这个候选");
        return;
      }
      const numberParameter = (name: string, fallback: number) => {
        const value = run.parameters[name];
        return typeof value === "number" && Number.isFinite(value) ? value : fallback;
      };
      const stringParameter = (name: string, fallback: string) => {
        const value = run.parameters[name];
        return typeof value === "string" ? value : fallback;
      };
      const inputIds = (slotPrefix: string) =>
        run.inputs
          .filter((input) => input.refType === "asset" && input.slot.startsWith(slotPrefix))
          .map((input) => input.refId);
      const storedBatchId = run.parameters.candidateBatchId;
      const storedCandidateIndex = run.parameters.candidateIndex;
      const storedCandidateCount = run.parameters.candidateCount;
      await generateReal(
        shot,
        {
          recipePath: stringParameter("recipePath", generationSettings.recipePath),
          prompt: stringParameter(
            "promptSource",
            stringParameter("prompt", generationSettings.prompt),
          ),
          negativePrompt:
            typeof run.parameters.negativePrompt === "string" ? run.parameters.negativePrompt : "",
          width: numberParameter("width", generationSettings.width),
          height: numberParameter("height", generationSettings.height),
          durationSeconds: numberParameter("durationSeconds", generationSettings.durationSeconds),
          fps: numberParameter("fps", generationSettings.fps),
          seed: numberParameter("seed", generationSettings.seed),
          steps: numberParameter("steps", generationSettings.steps),
          denoise: numberParameter("denoise", generationSettings.denoise),
          referenceImageSize: run.parameters.referenceImageSize === "max" ? "max" : "match",
        },
        {
          candidateCount: typeof storedCandidateCount === "number" ? storedCandidateCount : 1,
          candidateBatchId:
            typeof storedBatchId === "string"
              ? storedBatchId
              : `batch_${Date.now().toString(36)}_retry000`,
          candidateIndex: typeof storedCandidateIndex === "number" ? storedCandidateIndex : 1,
          retryOfRunId: run.id,
          compiledPrompt: stringParameter("prompt", generationSettings.prompt),
          firstFrameAssetId: inputIds("start_image")[0] ?? null,
          lastFrameAssetId: inputIds("last_image")[0] ?? null,
          referenceImageAssetIds: inputIds("reference_image_"),
          referenceVideoAssetIds: inputIds("reference_video_"),
          referenceAudioAssetIds: inputIds("reference_audio_"),
        },
      );
    },
    [generateReal, generationSettings],
  );

  const cancelGeneration = useCallback(async () => {
    generationTokenRef.current += 1;
    setGenerationCancelling(true);
    setGenerationProgress({
      phase: "collecting",
      label: "正在停止任务",
      detail: "取消执行、清理历史、临时输入与未采用生成物",
      percent: null,
      elapsedSeconds: generationProgress?.elapsedSeconds ?? 0,
    });
    try {
      const runIds = [
        ...new Set([...generationRunIdsRef.current, ...activeRuns.map((run) => run.id)]),
      ];
      if (projectMode === "project" && projectKey && runIds.length > 0) {
        const results = await Promise.allSettled(
          runIds.map((runId) => projectApi.cancelRun(projectKey, runId)),
        );
        const stopped = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        for (const result of stopped) {
          const run = result.snapshot.runs.find((item) => item.id === result.runId);
          acceptPayload(result, run?.shotId);
        }
        const unconfirmed = stopped.filter((result) => !result.cancelled).length;
        const requestFailures = results.length - stopped.length;
        setNotice(
          unconfirmed + requestFailures > 0
            ? `${stopped.length} 个任务已处理，${unconfirmed + requestFailures} 个仍需稍后核对`
            : `${stopped.length} 个生成任务已停止并完成清理`,
        );
      } else {
        setNotice("已停止本次生成准备");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "停止生成失败");
    } finally {
      setGenerationBusy(false);
      setGenerationCancelling(false);
      setGenerationProgress(null);
      generationRunIdsRef.current = [];
    }
  }, [acceptPayload, activeRuns, generationProgress?.elapsedSeconds, projectKey, projectMode]);

  const runAction = useCallback(
    async (action: () => ReturnType<typeof demoApi.get>, message: string, shotId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const payload = await action();
        acceptPayload(payload, shotId);
        setNotice(message);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "操作失败");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [acceptPayload],
  );

  const requestShotGeneration = useCallback(
    async (shot: Shot, settingsOverride: Partial<GenerationSettings> = {}) => {
      if (
        shot.status === "approved" &&
        !window.confirm(
          `“${shot.label}”已有采用结果。\n\n继续生成会开启一轮新候选，当前采用记录仍会保留。是否继续？`,
        )
      ) {
        return;
      }
      if (projectMode === "demo") {
        await runAction(
          () => demoApi.generate(shot.id),
          `${shot.label} 已生成 4 个新候选`,
          shot.id,
        );
        return;
      }
      await generateReal(shot, settingsOverride, { candidateCount });
    },
    [candidateCount, generateReal, projectMode, runAction],
  );

  useEffect(() => {
    if (!snapshot) return;
    const availableWorkflows = [...workflows];
    if (
      selectedWorkflow &&
      !availableWorkflows.some((workflow) => workflow.path === selectedWorkflow.path)
    ) {
      availableWorkflows.push(selectedWorkflow);
    }
    setNodes(
      boardNodes(
        snapshot,
        selectedCanvasItemId,
        projectMode === "project" ? projectKey : null,
        workflows,
        selectedWorkflow,
        selectedShotId,
        selectedShot && canEditProject
          ? {
              settings: generationSettings,
              workflows: availableWorkflows,
              workflowLocked,
              mentionAliases: promptMentions.map((mention) => mention.alias),
              busy: busy || generationBusy || Boolean(activeRun),
              progress: generationProgress,
              disabledReason:
                projectMode === "project" && selectedWorkflow?.execution === "comfy_only"
                  ? "这个工作流需要在 ComfyUI 中运行"
                  : generationDisabledReason,
              onWorkflowChange: (path) => {
                const workflow = findWorkflow(path, availableWorkflows);
                if (workflow) void bindWorkflowToSelectedShot(workflow);
              },
              onSettingsChange: (input) =>
                setGenerationSettings((current) => ({ ...current, ...input })),
              onGenerate: (input) => {
                void requestShotGeneration(selectedShot, input);
              },
              onOpenDetails: () => setInspectorOpen(true),
              onCommitTitle: (title) =>
                void updateSelectedShot({
                  title,
                  body: selectedShot.intent,
                  durationSeconds: selectedShot.durationSeconds,
                  aspectRatio: selectedShot.aspectRatio,
                }),
            }
          : null,
      ),
    );
  }, [
    activeRun,
    bindWorkflowToSelectedShot,
    busy,
    canEditProject,
    generationBusy,
    generationProgress,
    generationDisabledReason,
    generationSettings,
    projectKey,
    projectMode,
    promptMentions,
    requestShotGeneration,
    selectedCanvasItemId,
    selectedShot,
    selectedShotId,
    selectedWorkflow,
    snapshot,
    updateSelectedShot,
    workflowLocked,
    workflows,
  ]);

  const refreshWorker = useCallback(async () => {
    setWorkerBusy(true);
    try {
      setWorker(await projectApi.worker());
    } catch (cause) {
      setWorker({
        status: "offline",
        engine: "ComfyUI",
        error: cause instanceof Error ? cause.message : "无法检测 ComfyUI",
      });
    } finally {
      setWorkerBusy(false);
    }
  }, []);

  const startWorker = useCallback(async () => {
    setWorkerBusy(true);
    try {
      setWorker(await projectApi.startWorker());
    } catch (cause) {
      setWorker({
        status: "offline",
        engine: "ComfyUI",
        error: cause instanceof Error ? cause.message : "ComfyUI 启动失败",
      });
    } finally {
      setWorkerBusy(false);
    }
  }, []);

  if (showHub) {
    return (
      <Suspense fallback={<main className="loading-screen">正在打开 TakeBoard…</main>}>
        <ProjectHub
          busy={busy}
          error={error}
          notice={notice}
          onCreate={createProject}
          onDelete={deleteProject}
          onImport={importProject}
          onOpen={openProject}
          onRefreshWorker={refreshWorker}
          onRename={renameProject}
          onRestore={restoreProject}
          onStartWorker={startWorker}
          projects={projects}
          trashedProjects={trashedProjects}
          worker={worker}
          workerBusy={workerBusy}
        />
      </Suspense>
    );
  }

  if (!snapshot) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">T</div>
        <strong>正在打开 TakeBoard Demo</strong>
        <span>{error ?? "读取本地项目与开放快照…"}</span>
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"} ${inspectorVisible ? "inspector-open" : "inspector-collapsed"} ${comfortableDensity ? "density-comfortable" : "density-compact"}`}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>TakeBoard</strong>
            <span>OPEN FILMMAKING CANVAS</span>
          </div>
        </div>
        <button
          className={`project-heading ${canEditProject ? "" : "read-only"}`}
          type="button"
          title={canEditProject ? "修改项目名称" : "Viewer 权限为只读"}
          onClick={() => {
            if (projectMode !== "project" || !canEditProject) return;
            setRenameTitle(snapshot.project.title);
            setRenameOpen(true);
          }}
        >
          <span className="project-dot" />
          <div>
            <strong>{snapshot.project.title}</strong>
            <span>
              {snapshot.scenes[0]?.title || "工作画板"} ·{" "}
              {projectMode === "demo" ? "功能示例" : "本地优先项目"}
            </span>
          </div>
          {projectMode === "project" && canEditProject ? (
            <span className="project-heading-edit">✎</span>
          ) : null}
        </button>
        <div className="top-actions">
          {!canEditProject ? <span className="read-only-badge">VIEW ONLY</span> : null}
          {syncStatus === "pending" ? (
            <button
              className="save-status"
              type="button"
              onClick={applyPendingSync}
              title="当前编辑完成后，点击载入其他设备的更新"
            >
              ↻ 有新版本 · 当前 r{revision}
            </button>
          ) : (
            <span
              className="save-status"
              title={syncStatus === "offline" ? "暂时无法检查其他设备的更新" : "项目已保存"}
            >
              {syncStatus === "offline"
                ? `○ 同步待重连 · r${revision}`
                : syncStatus === "updated"
                  ? `✓ 已同步 · r${revision}`
                  : `✓ 已保存 · r${revision}`}
            </span>
          )}
          <Suspense fallback={null}>
            <OperationsCenter onOpenProject={openProject} />
          </Suspense>
          <ThemeSwitcher compact />
          <DisplaySettings compact />
          <button
            className="density-button"
            type="button"
            onClick={() => setComfortableDensity((current) => !current)}
            title={comfortableDensity ? "切换为紧凑密度" : "切换为舒适密度"}
            aria-label={comfortableDensity ? "切换为紧凑密度" : "切换为舒适密度"}
          >
            <span aria-hidden="true">{comfortableDensity ? "舒" : "紧"}</span>
            {comfortableDensity ? "舒适" : "紧凑"}
          </button>
          <AccountButton
            compact
            projectKey={projectMode === "project" ? (projectKey ?? undefined) : undefined}
            projectTitle={projectMode === "project" ? snapshot.project.title : undefined}
            projectRole={projectMode === "project" ? activeProjectRole : undefined}
          />
          <span className="local-badge">
            <i /> {authUser ? "PRIVATE" : "LOCAL"}
          </span>
          <button
            className="reset-button"
            type="button"
            onClick={() => {
              generationTokenRef.current += 1;
              setGenerationBusy(false);
              setGenerationProgress(null);
              window.sessionStorage.removeItem("takeboard.resumeDemo");
              setShowHub(true);
            }}
          >
            切换项目
          </button>
          {projectMode === "demo" ? (
            <button
              className={resetArmed ? "reset-button armed" : "reset-button"}
              type="button"
              onClick={() => {
                if (!resetArmed) {
                  setResetArmed(true);
                  window.setTimeout(() => setResetArmed(false), 3000);
                  return;
                }
                setResetArmed(false);
                void runAction(() => demoApi.reset(), "Demo 已恢复初始状态");
              }}
            >
              {resetArmed ? "确认重置" : "重置 Demo"}
            </button>
          ) : null}
        </div>
      </header>

      <nav className="sidebar" aria-label="项目镜头导航">
        <div className="scene-section">
          <span className="section-kicker">PROJECT</span>
          <div className="project-cover">
            <span className="cover-number">01</span>
            <div>
              <strong>{snapshot.project.title}</strong>
              <span>
                {snapshot.scenes.length} 场 · {totalDuration.toFixed(totalDuration % 1 ? 1 : 0)} 秒
              </span>
            </div>
          </div>
        </div>
        <div className="progress-card">
          <div>
            <span>镜头完成度</span>
            <strong>
              {approvedCount}/{snapshot.shots.length}
            </strong>
          </div>
          <div className="progress-track">
            <span
              style={{
                width: `${snapshot.shots.length ? (approvedCount / snapshot.shots.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <div className="shot-list-heading">
          <span className="section-kicker">SHOTS</span>
          <div className="shot-list-heading-actions">
            <span>{snapshot.shots.length}</span>
            <button
              type="button"
              aria-label="打开分镜墙"
              title="打开分镜墙"
              onClick={() => setStoryboardOpen(true)}
            >
              ▦
            </button>
            {projectMode === "project" && canEditProject ? (
              <button
                type="button"
                aria-label="添加镜头"
                title="添加镜头"
                disabled={busy}
                onClick={() => void createShot()}
              >
                ＋
              </button>
            ) : null}
          </div>
        </div>
        <div className="shot-navigator-tools">
          <label>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={shotQuery}
              onChange={(event) => setShotQuery(event.target.value)}
              placeholder="搜索镜头"
              aria-label="搜索镜头"
            />
          </label>
          <fieldset>
            <legend className="visually-hidden">筛选镜头</legend>
            {(["all", "todo", "approved"] as const).map((filter) => (
              <button
                type="button"
                key={filter}
                className={shotFilter === filter ? "active" : ""}
                onClick={() => setShotFilter(filter)}
              >
                {filter === "all" ? "全部" : filter === "todo" ? "待办" : "完成"}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="shot-list">
          {visibleShots.map((shot) => {
            const shotTakes = snapshot.takes.filter((take) => take.shotId === shot.id);
            const previewTake =
              shotTakes.find((take) => take.id === shot.approvedTakeId) ??
              [...shotTakes].reverse().find((take) => take.status !== "rejected");
            const previewAsset = snapshot.assets.find((asset) => asset.id === previewTake?.assetId);
            const previewUrl =
              projectKey && previewAsset
                ? projectApi.assetUrl(
                    projectKey,
                    previewAsset.id,
                    previewAsset.mediaType === "image",
                  )
                : null;
            return (
              <button
                type="button"
                key={shot.id}
                className={selectedShotId === shot.id ? "active" : ""}
                onClick={() => {
                  setSelectedShotId(shot.id);
                  setInspectorOpen(true);
                  const shotItem = snapshot.canvasItems.find(
                    (item) => item.refType === "shot" && item.refId === shot.id,
                  );
                  if (shotItem) {
                    setSelectedCanvasItemId(shotItem.id);
                  } else if (projectMode === "project" && projectKey && canEditProject) {
                    setBusy(true);
                    void projectApi
                      .addCanvasItem(projectKey, {
                        refType: "shot",
                        refId: shot.id,
                        x: 420,
                        y: 120 + shot.order * 240,
                      })
                      .then((payload) => {
                        acceptPayload(payload, shot.id);
                        setSelectedCanvasItemId(payload.itemId);
                        setNotice("镜头已恢复到画布");
                      })
                      .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : "镜头恢复失败"),
                      )
                      .finally(() => setBusy(false));
                  } else {
                    setNotice("这个镜头节点当前不在示例画布中");
                  }
                }}
              >
                <span
                  className={`shot-thumb thumb-${shot.order + 1} ${previewUrl ? "has-media" : ""}`}
                >
                  {previewUrl && previewAsset?.mediaType === "video" ? (
                    <video src={previewUrl} muted playsInline preload="metadata" />
                  ) : previewUrl ? (
                    <img src={previewUrl} alt="" />
                  ) : (
                    <b>{String(shot.order + 1).padStart(2, "0")}</b>
                  )}
                  {previewUrl && shot.status === "approved" ? (
                    <i className="shot-thumb-approved">✓</i>
                  ) : null}
                </span>
                <span className="shot-list-copy">
                  <strong>{shot.label}</strong>
                  <small>{shotTakes.length > 0 ? `${shotTakes.length} Takes` : "未生成"}</small>
                </span>
                <i className={`status-dot status-${shot.status}`} />
              </button>
            );
          })}
          {visibleShots.length === 0 ? (
            <div className="shot-list-empty">
              <span>{snapshot.shots.length === 0 ? "＋" : "⌕"}</span>
              {snapshot.shots.length === 0 ? "还没有镜头" : "没有匹配的镜头"}
            </div>
          ) : null}
        </div>
        {projectMode === "project" ? (
          <div className="asset-import">
            <input
              ref={assetInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
              onChange={(event) => {
                const file = event.target.files?.[0];
                const position = pendingAssetPosition.current;
                pendingAssetPosition.current = null;
                if (file) void uploadAsset(file, position ?? undefined);
                event.target.value = "";
              }}
            />
            {canEditProject ? (
              <button type="button" disabled={busy} onClick={() => assetInput.current?.click()}>
                ＋ 导入参考素材
              </button>
            ) : null}
            <button
              type="button"
              className="vault-button"
              onClick={() => setAssetLibraryOpen(true)}
            >
              ◇ 打开资产库
            </button>
            <small>
              {
                snapshot.assets.filter((asset) => ["image", "video"].includes(asset.mediaType))
                  .length
              }{" "}
              个素材已入库
            </small>
          </div>
        ) : null}
        <div className="sidebar-bottom">
          <span>{projectMode === "demo" ? "DEMO WORKER" : "GENERATION WORKER"}</span>
          <div>
            <i /> {projectMode === "demo" ? "Fake ComfyUI" : (worker?.engine ?? "ComfyUI")} ·{" "}
            {worker?.status === "ready" || projectMode === "demo" ? "Ready" : "Offline"}
          </div>
          <small>
            {projectMode === "demo" ? "无需计算资源 · 不产生费用" : "数据、模型与工作流由你掌控"}
          </small>
        </div>
      </nav>

      <section className="canvas-wrap" aria-label="TakeBoard 创作画布">
        <div className="canvas-toolbar">
          <div>
            <button
              className="panel-toggle"
              type="button"
              onClick={() => setSidebarOpen((current) => !current)}
              title={`${sidebarOpen ? "隐藏" : "显示"}镜头导航（[）`}
              aria-label={`${sidebarOpen ? "隐藏" : "显示"}镜头导航`}
            >
              {sidebarOpen ? "←" : "→"}
            </button>
            <span className="scene-chip">{activeScene?.label ?? "SC-01"}</span>
            <strong>{activeScene?.title || "未命名场景"}</strong>
          </div>
          <div className="canvas-utility">
            {inspectorHasContent ? (
              <button
                className="panel-toggle"
                type="button"
                onClick={() => setInspectorOpen((current) => !current)}
                title={`${inspectorVisible ? "隐藏" : "显示"}检查器（]）`}
                aria-label={`${inspectorVisible ? "隐藏" : "显示"}检查器`}
              >
                {inspectorVisible ? "→" : "←"}
              </button>
            ) : null}
            <button
              className="focus-toggle"
              type="button"
              onClick={() => {
                const enteringFocus = sidebarOpen || inspectorVisible;
                setSidebarOpen(!enteringFocus);
                setInspectorOpen(!enteringFocus && inspectorHasContent);
              }}
              title="切换专注画布（\\）"
            >
              {sidebarOpen || inspectorVisible ? "专注" : "退出专注"}
            </button>
            <button
              className={`canvas-guide-toggle ${canvasGuideOpen ? "active" : ""}`}
              type="button"
              aria-label="查看画布操作"
              aria-expanded={canvasGuideOpen}
              onClick={() => setCanvasGuideOpen((current) => !current)}
            >
              ?
            </button>
            {projectMode === "project" && canEditProject ? (
              <button
                className="canvas-arrange-toggle"
                type="button"
                disabled={
                  busy ||
                  (snapshot?.canvasItems.filter((item) => item.sceneId === activeScene?.id)
                    .length ?? 0) < 2
                }
                aria-label="按连线方向整理当前画布"
                title="预览后整理节点位置，可撤销"
                onClick={() => void previewCanvasArrange()}
              >
                ⤢ <span>整理</span>
              </button>
            ) : null}
            {projectMode === "project" ? (
              <button
                className={`canvas-history-toggle ${commandHistoryOpen ? "active" : ""}`}
                type="button"
                aria-label="查看项目操作记录"
                aria-expanded={commandHistoryOpen}
                onClick={() => {
                  if (commandHistoryOpen) setCommandHistoryOpen(false);
                  else openCommandHistory();
                }}
              >
                ↶ <span>记录</span>
              </button>
            ) : null}
            {canvasGuideOpen ? (
              <aside className="canvas-guide" aria-label="画布操作说明">
                <header>
                  <div>
                    <span>CANVAS GUIDE</span>
                    <strong>需要时，再看这里。</strong>
                  </div>
                  <button
                    type="button"
                    aria-label="关闭画布操作说明"
                    onClick={() => setCanvasGuideOpen(false)}
                  >
                    ×
                  </button>
                </header>
                <dl>
                  <div>
                    <dt>添加</dt>
                    <dd>双击或右键空白处</dd>
                  </div>
                  <div>
                    <dt>编辑</dt>
                    <dd>单击镜头；空白处退出</dd>
                  </div>
                  <div>
                    <dt>连接</dt>
                    <dd>素材或生成结果都可继续连线</dd>
                  </div>
                  <div>
                    <dt>更多</dt>
                    <dd>右键节点或连线</dd>
                  </div>
                </dl>
                <p>复制、粘贴和删除仍支持系统常用快捷键。</p>
              </aside>
            ) : null}
          </div>
        </div>
        {projectMode === "project" &&
        canEditProject &&
        nodes.length === 0 &&
        blankCanvasGuideOpen ? (
          <section className="blank-canvas-start" aria-label="空白工作画板">
            <button
              className="blank-canvas-close"
              type="button"
              aria-label="关闭首次使用提示"
              onClick={() => setBlankCanvasGuideOpen(false)}
            >
              ×
            </button>
            <span className="blank-canvas-index">01 / START</span>
            <h2>从你手里已有的东西开始。</h2>
            <p>可以先放一张参考图，也可以先建立镜头。画幅只属于镜头，不属于整张画布。</p>
            <div>
              <button type="button" disabled={busy} onClick={() => void createShot()}>
                添加第一个镜头
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBlankCanvasGuideOpen(false);
                  assetInput.current?.click();
                }}
              >
                导入参考素材
              </button>
            </div>
          </section>
        ) : null}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={boardNodeTypes as NodeTypes}
          onInit={setFlowInstance}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          nodesDraggable={canEditProject}
          nodesConnectable={canEditProject}
          onNodeClick={onNodeClick}
          onEdgeClick={(event, edge) => {
            const snapshotEdge = resolveSnapshotEdge(latestSnapshotRef.current ?? snapshot, edge);
            selectedEdgeIdentityRef.current =
              edgeIdentityFromPointer(event) ??
              ({
                sourceItemId: snapshotEdge?.sourceItemId ?? edge.source,
                targetItemId: snapshotEdge?.targetItemId ?? edge.target,
                targetSlot:
                  snapshotEdge?.targetSlot ??
                  (edge.targetHandle === "first_frame" ||
                  edge.targetHandle === "last_frame" ||
                  edge.targetHandle === "reference" ||
                  edge.targetHandle === "reference_video" ||
                  edge.targetHandle === "reference_audio"
                    ? edge.targetHandle
                    : null),
              } satisfies CanvasEdgeIdentity);
            setSelectedEdgeId(snapshotEdge?.id ?? edge.id);
            setSelectedCanvasItemId(null);
            setSelectedShotId(null);
            setInspectorOpen(false);
            setNotice(
              canEditProject ? "连线已选中 · 按 Delete 删除" : "连线已选中 · Viewer 只读查看",
            );
          }}
          onEdgeContextMenu={openEdgeContextMenu}
          onNodeDoubleClick={(_event, node) => {
            const item = snapshot.canvasItems.find((candidate) => candidate.id === node.id);
            if (item?.refType === "shot") {
              setSelectedShotId(item.refId);
              setSelectedCanvasItemId(item.id);
              setInspectorOpen(true);
              return;
            }
            if (canEditProject) openNodeEditor(node.id);
          }}
          onNodeContextMenu={openNodeContextMenu}
          onPaneContextMenu={openPaneContextMenu}
          onPaneClick={(event) => {
            if (event.detail === 2) {
              openPaneContextMenu(event);
              return;
            }
            setCanvasContextMenu(null);
            setCanvasGuideOpen(false);
            setSelectedEdgeId(null);
            setSelectedCanvasItemId(null);
            setSelectedShotId(null);
            setInspectorOpen(false);
            setNodeEditDraft(null);
          }}
          onNodeDragStop={(_event, node) => {
            const position = gentlyAlignedPosition(node, nodes);
            setNodes((current) =>
              current.map((candidate) =>
                candidate.id === node.id ? { ...candidate, position } : candidate,
              ),
            );
            void (
              projectMode === "project" && projectKey
                ? projectApi.move(projectKey, node.id, position.x, position.y)
                : demoApi.move(node.id, position.x, position.y)
            )
              .then((payload) => {
                acceptPayload(payload);
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "位置保存失败"),
              );
          }}
          minZoom={0.35}
          maxZoom={1.5}
          snapToGrid
          snapGrid={canvasSnapGrid}
          defaultViewport={{ x: 60, y: 30, zoom: 0.78 }}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 0.9 }}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          disableKeyboardA11y
        >
          <Background color="var(--canvas-grid)" gap={28} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        <div className="canvas-status">
          {nodes.length} 节点 · {edges.length} 关系 · 轻量对齐
        </div>
      </section>

      {canvasContextMenu ? (
        <div
          className="canvas-context-menu"
          role="menu"
          style={{
            left: Math.min(canvasContextMenu.clientX, window.innerWidth - 230),
            top: Math.min(canvasContextMenu.clientY, window.innerHeight - 330),
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="canvas-context-menu-head">
            <span>
              {canvasContextMenu.edge
                ? "CONNECTION"
                : canvasContextMenu.itemId
                  ? "NODE ACTIONS"
                  : "ADD TO CANVAS"}
            </span>
            <button type="button" onClick={() => setCanvasContextMenu(null)} aria-label="关闭菜单">
              ×
            </button>
          </div>
          {canvasContextMenu.edge && contextEdge ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setSelectedCanvasItemId(contextEdge.sourceItemId);
                  setSelectedEdgeId(null);
                  setInspectorOpen(true);
                  setCanvasContextMenu(null);
                }}
              >
                <span>↖</span>
                <strong>定位来源节点</strong>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const target = snapshot.canvasItems.find(
                    (item) => item.id === contextEdge.targetItemId,
                  );
                  setSelectedCanvasItemId(contextEdge.targetItemId);
                  if (target?.refType === "shot") setSelectedShotId(target.refId);
                  setSelectedEdgeId(null);
                  setInspectorOpen(true);
                  setCanvasContextMenu(null);
                }}
              >
                <span>↘</span>
                <strong>定位输入节点</strong>
              </button>
              <div className="context-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={!canEditProject || contextEdge.immutable}
                onClick={() => void deleteCanvasEdge(contextEdge.id, contextEdge)}
              >
                <span>⌫</span>
                <strong>{contextEdge.immutable ? "生成溯源不可删除" : "断开连接"}</strong>
                <kbd>Delete</kbd>
              </button>
            </>
          ) : canvasContextMenu.itemId ? (
            <>
              {snapshot.canvasItems.find((item) => item.id === canvasContextMenu.itemId)
                ?.refType !== "shot" ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    openNodeEditor(canvasContextMenu.itemId as string);
                    setCanvasContextMenu(null);
                  }}
                >
                  <span>✎</span>
                  <strong>编辑节点</strong>
                  <kbd>双击</kbd>
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() => copyCanvasItem(canvasContextMenu.itemId as string, "copy")}
              >
                <span>□</span>
                <strong>复制</strong>
                <kbd>⌘ C</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => copyCanvasItem(canvasContextMenu.itemId as string, "cut")}
              >
                <span>✂</span>
                <strong>剪切</strong>
                <kbd>⌘ X</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  void duplicateCanvasItem(canvasContextMenu.itemId as string, {
                    x: canvasContextMenu.flowX + 36,
                    y: canvasContextMenu.flowY + 36,
                  })
                }
              >
                <span>＋</span>
                <strong>创建副本</strong>
                <kbd>⌘ D</kbd>
              </button>
              <div className="context-menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => deleteCanvasItem(canvasContextMenu.itemId as string)}
              >
                <span>⌫</span>
                <strong>
                  {snapshot.canvasItems.find((item) => item.id === canvasContextMenu.itemId)
                    ?.refType === "shot"
                    ? "删除镜头"
                    : "从画布移除"}
                </strong>
                <kbd>Delete</kbd>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void createShot({ x: canvasContextMenu.flowX, y: canvasContextMenu.flowY });
                  setCanvasContextMenu(null);
                }}
              >
                <span>＋</span>
                <strong>添加生成镜头</strong>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  void createTextNode({ x: canvasContextMenu.flowX, y: canvasContextMenu.flowY })
                }
              >
                <span>文</span>
                <strong>添加文字笔记</strong>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  pendingAssetPosition.current = {
                    x: canvasContextMenu.flowX,
                    y: canvasContextMenu.flowY,
                  };
                  assetInput.current?.click();
                  setCanvasContextMenu(null);
                }}
              >
                <span>◇</span>
                <strong>导入图片或视频</strong>
              </button>
              <div className="context-menu-separator" />
              <button
                type="button"
                role="menuitem"
                disabled={!canvasClipboard}
                onClick={() =>
                  void pasteCanvasItem({
                    x: canvasContextMenu.flowX,
                    y: canvasContextMenu.flowY,
                  })
                }
              >
                <span>▣</span>
                <strong>粘贴节点</strong>
                <kbd>⌘ V</kbd>
              </button>
              <p>
                {canvasClipboard
                  ? canvasClipboard.mode === "cut"
                    ? "把已剪切的节点移动到这里"
                    : "在这里创建节点副本"
                  : "先复制或剪切一个节点"}
              </p>
            </>
          )}
        </div>
      ) : null}

      {selectedCanvasItem &&
      selectedCanvasItem.refType !== "shot" &&
      selectedCanvasItem.refType !== "take_stack" ? (
        <NodeContextInspector
          key={selectedCanvasItem.id}
          item={selectedCanvasItem}
          snapshot={snapshot}
          projectKey={projectMode === "project" ? projectKey : null}
          readOnly={!canEditProject}
          selectedShot={selectedShot}
          onOpenAssets={() => setAssetLibraryOpen(true)}
          onUseAsset={(assetId, slot) => {
            void connectAssetFromLibrary(
              assetId,
              slot === "firstFrameAssetId"
                ? "first"
                : slot === "lastFrameAssetId"
                  ? "last"
                  : "reference",
            );
          }}
          onSetAssetCustomTags={(assetId, tags) => void setAssetCustomTags(assetId, tags)}
          onClose={() => setInspectorOpen(false)}
          onUseText={(body) => {
            setGenerationSettings((current) => ({
              ...current,
              prompt: [current.prompt.trim(), body.trim()].filter(Boolean).join("\n\n"),
            }));
            setNotice("文本已追加到当前镜头提示词");
          }}
        />
      ) : selectedShot ? (
        <Inspector
          key={selectedCanvasItem?.id ?? selectedShot.id}
          shot={selectedShot}
          takes={selectedTakes}
          busy={busy || generationBusy || Boolean(activeRun)}
          assets={snapshot.assets}
          projectKey={projectMode === "project" ? projectKey : null}
          isDemo={projectMode === "demo"}
          runs={snapshot.runs}
          settings={generationSettings}
          workflow={selectedWorkflow}
          profile={selectedModelProfile}
          workflowDetected={workflows.some((workflow) => workflow.path === selectedWorkflow?.path)}
          workflowLocked={workflowLocked}
          inputCounts={selectedInputCounts}
          mentions={promptMentions}
          onSettingsChange={setGenerationSettings}
          onUpdateShot={(input) => void updateSelectedShot(input)}
          onOpenAssets={() => setAssetLibraryOpen(true)}
          onOpenRecipes={() => setRecipeOpen(true)}
          generateDisabledReason={generationDisabledReason}
          progress={generationProgress}
          candidateCount={candidateCount}
          onCandidateCountChange={setCandidateCount}
          onRetryRun={(run) => void retryGenerationRun(run)}
          readOnly={!canEditProject}
          onClose={() => setInspectorOpen(false)}
          workerLabel={
            projectMode === "demo"
              ? "Fake Wan I2V"
              : `${selectedWorkflow?.name ?? "ComfyUI"} · 本地执行`
          }
          onGenerate={() => void requestShotGeneration(selectedShot)}
          onCancel={() => void cancelGeneration()}
          canCancel={generationBusy || activeRuns.length > 0}
          cancelling={generationCancelling}
          onReject={(takeId, reason) =>
            void runAction(
              () =>
                projectMode === "project" && projectKey
                  ? projectApi.reject(projectKey, takeId, reason)
                  : demoApi.reject(takeId, reason),
              `已淘汰候选 · ${reason}`,
              selectedShot.id,
            )
          }
          onApprove={(takeId) => {
            setSelectedCanvasItemId(null);
            void runAction(
              () =>
                projectMode === "project" && projectKey
                  ? projectApi.approve(projectKey, takeId, "人工采用")
                  : demoApi.approve(takeId, "Demo 人工采用"),
              `${selectedShot.label} 已采用，决策历史已保存`,
              selectedShot.id,
            );
          }}
        />
      ) : null}

      <Suspense
        fallback={
          <div className="studio-backdrop studio-loading-backdrop" role="status">
            <span>正在打开工作区工具…</span>
          </div>
        }
      >
        {storyboardOpen ? (
          <Storyboard
            snapshot={snapshot}
            projectKey={projectMode === "project" ? projectKey : null}
            readOnly={!canEditProject || projectMode === "demo"}
            onClose={() => setStoryboardOpen(false)}
            onOpenShot={(shotId) => {
              setSelectedShotId(shotId);
              setInspectorOpen(true);
              setStoryboardOpen(false);
              const shotItem = snapshot.canvasItems.find(
                (item) => item.refType === "shot" && item.refId === shotId,
              );
              setSelectedCanvasItemId(shotItem?.id ?? null);
            }}
            onReorderShot={async (shotId, toIndex) => {
              if (!projectKey || !canEditProject) return false;
              setError(null);
              try {
                const payload = await projectApi.reorderShot(projectKey, shotId, toIndex);
                acceptPayload(payload, shotId);
                setNotice("镜头播放顺序已保存；画布布局保持不变");
                return true;
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "镜头顺序调整失败");
                return false;
              }
            }}
          />
        ) : null}
        {recipeOpen ? (
          <RecipeStudio
            busy={busy}
            canManageWorkflows={!authUser || authUser.instanceRole === "admin"}
            editorUrl={comfyEditorUrl}
            onClose={() => setRecipeOpen(false)}
            onImport={importWorkflow}
            onRefresh={refreshWorkflows}
            onSelect={(workflow) => void bindWorkflowToSelectedShot(workflow)}
            open
            selectedPath={generationSettings.recipePath}
            selectionLocked={workflowLocked}
            warnings={workflowWarnings}
            workflows={workflows}
          />
        ) : null}
        {commandHistoryOpen ? (
          <CommandHistory
            busy={commandHistoryBusy}
            entries={commandHistory}
            error={commandHistoryError}
            onClose={() => setCommandHistoryOpen(false)}
            onRefresh={() => void refreshCommandHistory()}
            onUndo={(commandId) => void undoProjectCommand(commandId)}
            open
            readOnly={!canEditProject}
          />
        ) : null}
        {projectKey && assetLibraryOpen ? (
          <AssetLibrary
            assets={snapshot.assets}
            busy={busy}
            canvasItems={snapshot.canvasItems}
            entities={snapshot.entities}
            onAddToCanvas={addAssetToCanvasFromLibrary}
            onClose={() => setAssetLibraryOpen(false)}
            onPickFrame={(assetId, slot) => void connectAssetFromLibrary(assetId, slot)}
            onInspectMetadata={inspectHistoricalAssetMetadata}
            onUpdateAsset={updateAssetMetadata}
            onUpload={async (file, metadata) =>
              await uploadAsset(file, { ...metadata, addToCanvas: false })
            }
            open
            projectKey={projectKey}
            readOnly={!canEditProject}
            selectedShotLabel={selectedShot?.label ?? null}
            selectedFirstFrameId={generationSettings.firstFrameAssetId}
            selectedLastFrameId={generationSettings.lastFrameAssetId}
            selectedReferenceId={generationSettings.referenceAssetId}
            selectedReferenceImageIds={selectedReferenceImageIds}
            selectedReferenceVideoIds={selectedReferenceVideoIds}
            selectedReferenceAudioIds={selectedReferenceAudioIds}
            allowedSlots={{
              first: selectedModelProfile.slots.some((slot) => slot.id === "first_frame"),
              last: selectedModelProfile.slots.some((slot) => slot.id === "last_frame"),
              reference: selectedModelProfile.slots.some((slot) => slot.id === "reference"),
              referenceVideo: selectedModelProfile.slots.some(
                (slot) => slot.id === "reference_video",
              ),
              referenceAudio: selectedModelProfile.slots.some(
                (slot) => slot.id === "reference_audio",
              ),
            }}
          />
        ) : null}
      </Suspense>

      {pendingCanvasRemoval ? (
        <div className="modal-backdrop shot-delete-backdrop">
          <section
            className="shot-delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="canvas-remove-title"
          >
            <span className="section-kicker">CANVAS CHANGE</span>
            <h2 id="canvas-remove-title">{pendingCanvasRemoval.preview.summary}？</h2>
            <p>只移除画布上的呈现；资产、人物或文本本体仍保留在项目中。</p>
            <div className="shot-delete-preview">
              <span>影响预览</span>
              <ul>
                {pendingCanvasRemoval.preview.effects.map((item) => (
                  <li key={`${item.action}:${item.entityId ?? item.label}`}>
                    {item.label}
                    {item.detail ? <small>{item.detail}</small> : null}
                  </li>
                ))}
              </ul>
              <small>确认后可以从“记录”撤销；不会静默覆盖后续修改。</small>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="shot-delete-actions">
              <button type="button" disabled={busy} onClick={() => setPendingCanvasRemoval(null)}>
                取消
              </button>
              <button
                className="confirm-shot-delete"
                type="button"
                disabled={busy}
                onClick={() =>
                  void removeCanvasItem(pendingCanvasRemoval.itemId, pendingCanvasRemoval.preview)
                }
              >
                {busy ? "正在移除…" : "从画布移除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingCanvasArrange ? (
        <div className="modal-backdrop shot-delete-backdrop">
          <section
            className="shot-delete-modal canvas-arrange-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="canvas-arrange-title"
          >
            <span className="section-kicker">CANVAS ARRANGE</span>
            <h2 id="canvas-arrange-title">整理当前画布？</h2>
            <p>系统会沿连线从左到右分层，并保留每一列原有的上下顺序。</p>
            <div className="shot-delete-preview">
              <span>位置预览</span>
              <ul>
                {pendingCanvasArrange.effects.slice(0, 8).map((item) => (
                  <li key={item.entityId ?? item.label}>
                    {item.label}
                    {item.detail ? <small>{item.detail}</small> : null}
                  </li>
                ))}
              </ul>
              {pendingCanvasArrange.effects.length > 8 ? (
                <small>以及另外 {pendingCanvasArrange.effects.length - 8} 个节点</small>
              ) : null}
              {pendingCanvasArrange.warnings.map((warning) => (
                <small key={warning}>{warning}</small>
              ))}
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="shot-delete-actions">
              <button type="button" disabled={busy} onClick={() => setPendingCanvasArrange(null)}>
                保持现状
              </button>
              <button type="button" disabled={busy} onClick={() => void confirmCanvasArrange()}>
                {busy ? "正在整理…" : "整理并适配视野"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deletingShotItem && deletingShot ? (
        <div className="modal-backdrop shot-delete-backdrop">
          <section
            className="shot-delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="shot-delete-title"
          >
            <span className="section-kicker">SHOT MANAGEMENT</span>
            <h2 id="shot-delete-title">删除“{deletingShot.label}”？</h2>
            {deletingShotRunCount > 0 ? (
              <p>
                这个镜头已有 {deletingShotRunCount}
                条生成记录。为了保留成片、参数和工作流溯源，目前不能直接删除。
              </p>
            ) : (
              <>
                <p>镜头会同时从画布和左侧镜头列表删除；项目里的原始素材不会受到影响。</p>
                {deletingShotPreview ? (
                  <div className="shot-delete-preview">
                    <span>本次操作</span>
                    <ul>
                      {deletingShotPreview.effects.map((item) => (
                        <li key={`${item.action}:${item.entityId ?? item.label}`}>
                          {item.label}
                          {item.detail ? <small>{item.detail}</small> : null}
                        </li>
                      ))}
                    </ul>
                    <small>删除后可在“记录”中撤销；若已有后续修改，系统会停止并提示冲突。</small>
                  </div>
                ) : (
                  <div className="shot-delete-preview loading">正在核对删除范围…</div>
                )}
              </>
            )}
            {error ? <p className="form-error">{error}</p> : null}
            <div className="shot-delete-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeletingShotItemId(null);
                  setDeletingShotPreview(null);
                }}
              >
                {deletingShotRunCount > 0 ? "知道了" : "取消"}
              </button>
              {deletingShotRunCount === 0 ? (
                <button
                  className="confirm-shot-delete"
                  type="button"
                  disabled={busy || !deletingShotPreview}
                  onClick={() => void confirmDeleteShot()}
                >
                  {busy ? "正在删除…" : "删除镜头"}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {nodeEditDraft && projectKey ? (
        <div className="modal-backdrop node-editor-backdrop">
          <form
            className="node-editor-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void saveNodeEditor();
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">EDIT CANVAS NODE</span>
                <h2>
                  编辑
                  {nodeEditDraft.kind === "shot"
                    ? "镜头"
                    : nodeEditDraft.kind === "entity"
                      ? "人物 / 场景"
                      : nodeEditDraft.kind === "text"
                        ? "文本"
                        : "素材"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="关闭节点编辑"
                onClick={() => setNodeEditDraft(null)}
              >
                ×
              </button>
            </div>
            <label>
              <span>{nodeEditDraft.kind === "shot" ? "镜头编号" : "名称"}</span>
              <input
                value={nodeEditDraft.title}
                maxLength={nodeEditDraft.kind === "asset" ? 512 : 200}
                onChange={(event) =>
                  setNodeEditDraft((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
              />
            </label>
            {nodeEditDraft.kind !== "asset" ? (
              <label>
                <span>{nodeEditDraft.kind === "shot" ? "镜头意图与动作" : "描述内容"}</span>
                <textarea
                  value={nodeEditDraft.body}
                  onChange={(event) =>
                    setNodeEditDraft((current) =>
                      current ? { ...current, body: event.target.value } : current,
                    )
                  }
                />
              </label>
            ) : (
              <p className="node-editor-note">这里只修改项目中的显示名称，不会改变原始文件内容。</p>
            )}
            {nodeEditDraft.kind === "shot" ? (
              <div className="node-editor-field-row">
                <label>
                  <span>镜头画幅</span>
                  <select
                    value={nodeEditDraft.aspectRatio ?? "16:9"}
                    onChange={(event) =>
                      setNodeEditDraft((current) =>
                        current
                          ? {
                              ...current,
                              aspectRatio: event.target.value as Shot["aspectRatio"],
                            }
                          : current,
                      )
                    }
                  >
                    <option value="16:9">16:9 · 横屏</option>
                    <option value="9:16">9:16 · 竖屏</option>
                    <option value="1:1">1:1 · 方形</option>
                    <option value="4:5">4:5 · 社交媒体</option>
                    <option value="2.35:1">2.35:1 · 宽银幕</option>
                  </select>
                </label>
                <label htmlFor="node-editor-duration">
                  <span>镜头时长（秒）</span>
                  <NumericInput
                    id="node-editor-duration"
                    min={0.5}
                    max={300}
                    step={0.5}
                    value={nodeEditDraft.durationSeconds ?? 5}
                    onValueChange={(durationSeconds) =>
                      setNodeEditDraft((current) =>
                        current ? { ...current, durationSeconds } : current,
                      )
                    }
                  />
                </label>
              </div>
            ) : null}
            <div className="node-editor-actions">
              <button type="button" onClick={() => setNodeEditDraft(null)}>
                取消
              </button>
              <button type="submit" disabled={busy || !nodeEditDraft.title.trim()}>
                {busy ? "保存中…" : "保存修改"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {renameOpen && projectKey ? (
        <div className="modal-backdrop">
          <form
            className="rename-project-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void renameProject(projectKey, renameTitle)
                .then(() => setRenameOpen(false))
                .catch(() => undefined);
            }}
          >
            <div className="modal-title">
              <div>
                <span className="section-kicker">RENAME PROJECT</span>
                <h2>修改项目名称</h2>
              </div>
              <button type="button" aria-label="关闭重命名" onClick={() => setRenameOpen(false)}>
                ×
              </button>
            </div>
            <label>
              新名称
              <input
                required
                maxLength={200}
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="modal-actions">
              <span>项目素材和运行记录不会改变</span>
              <button type="submit" disabled={busy || !renameTitle.trim()}>
                {busy ? "正在保存…" : "保存名称"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {notice ? <div className="toast success">✓ {notice}</div> : null}
      {error ? (
        <button className="toast error" type="button" onClick={() => setError(null)}>
          操作失败：{error} · 点击关闭
        </button>
      ) : null}
    </main>
  );
}
