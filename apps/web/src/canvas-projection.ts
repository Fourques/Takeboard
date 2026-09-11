import type { ProjectSnapshot } from "@takeboard/contracts";
import { type Edge, MarkerType } from "@xyflow/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { projectApi, type WorkflowSummary } from "./api";
import type { BoardNode } from "./board-nodes";
import {
  findWorkflow,
  type PromptMention,
  runWorkflowPath,
  type ShotCanvasControls,
} from "./generation-model";
import { modelProfile, workflowInputSlots } from "./model-profiles";

const alignmentThreshold = 7;
export const canvasSnapGrid: [number, number] = [12, 12];
export type CanvasEdgeIdentity = Pick<
  ProjectSnapshot["canvasEdges"][number],
  "sourceItemId" | "targetItemId" | "targetSlot"
>;

/** Keep renderer measurements across document/control updates. ResizeObserver will
 * refresh changed content sizes; discarding them hides the node and steals input focus. */
export function retainNodeMeasurements(previous: BoardNode[], next: BoardNode[]): BoardNode[] {
  const byId = new Map(previous.map((node) => [node.id, node]));
  return next.map((node) => {
    const old = byId.get(node.id);
    return old?.type === node.type && old?.measured ? { ...node, measured: old.measured } : node;
  });
}

export function boardNodes(
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

export function boardEdges(
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

export function resolveSnapshotEdge(snapshot: ProjectSnapshot, edge: Edge) {
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
  return exactConnection;
}

export function edgeIdentityFromPointer(event: ReactMouseEvent): CanvasEdgeIdentity | null {
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

export function gentlyAlignedPosition(node: BoardNode, nodes: BoardNode[]) {
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

export function sourceAssetId(
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

export function connectedAssetId(
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

export function compileMiniMaxH3Mentions(prompt: string, mentions: PromptMention[]) {
  return [...mentions]
    .sort((a, b) => b.alias.length - a.alias.length)
    .reduce(
      (compiled, mention) => compiled.replaceAll(`@${mention.alias}`, mention.canonicalToken),
      prompt,
    );
}
