import type { Shot } from "@takeboard/contracts";
import { type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { projectApi, type WorkflowSummary } from "./api";
import { connectedAssetId, sourceAssetId } from "./canvas-projection";
import type { GenerationContext } from "./generation-context";
import { initialGenerationDraft } from "./generation-draft";
import {
  defaultGenerationSettings,
  findWorkflow,
  type GenerationSettings,
  type PromptMention,
  runWorkflowPath,
} from "./generation-model";
import { generationProblem } from "./generation-readiness";
import { loadModelPreferences, modelProfile, saveModelPreferences } from "./model-profiles";

export function useGenerationDraft(context: GenerationContext, workflows: WorkflowSummary[]) {
  const {
    snapshot,
    selectedShot,
    projectKey,
    projectMode,
    acceptPayload,
    onError,
    onNotice,
    readDocument,
  } = context;
  const selectedShotId = selectedShot?.id ?? null;
  const workflowPath =
    selectedShot && snapshot
      ? (selectedShot.workflowPath ??
        runWorkflowPath(snapshot, selectedShot.id) ??
        defaultGenerationSettings.recipePath)
      : defaultGenerationSettings.recipePath;
  const shotScope = `${snapshot?.project.id ?? ""}:${selectedShotId ?? ""}`;
  const [demoWorkflows, setDemoWorkflows] = useState(new Map<string, string>());
  const effectivePath =
    projectMode === "demo" ? (demoWorkflows.get(shotScope) ?? workflowPath) : workflowPath;
  const selectedWorkflow = useMemo(
    () => findWorkflow(effectivePath, workflows),
    [effectivePath, workflows],
  );
  const workflowLocked = Boolean(
    selectedShotId && snapshot?.runs.some((run) => run.shotId === selectedShotId),
  );
  const scope = `${snapshot?.project.id ?? ""}:${selectedShotId ?? ""}:${effectivePath}:${selectedWorkflow?.execution === "bound" ? (selectedWorkflow.workflowHash ?? "") : "native"}`;
  const preferenceScope =
    selectedWorkflow?.execution === "bound"
      ? `${selectedWorkflow.editorUrl}:${effectivePath}:${selectedWorkflow.workflowHash ?? ""}`
      : effectivePath;
  const [drafts, setDrafts] = useState<{
    projectId: string | null;
    values: Map<string, GenerationSettings>;
  }>({ projectId: null, values: new Map() });
  const initial = useMemo(
    () =>
      initialGenerationDraft(
        snapshot,
        selectedShot,
        selectedWorkflow,
        loadModelPreferences(preferenceScope),
      ),
    [snapshot, selectedShot, selectedWorkflow, preferenceScope],
  );
  const raw =
    drafts.projectId === snapshot?.project.id ? (drafts.values.get(scope) ?? initial) : initial;
  const generationSettings = useMemo(
    () => ({
      ...raw,
      firstFrameAssetId:
        snapshot && selectedShotId
          ? connectedAssetId(snapshot, selectedShotId, "first_frame")
          : null,
      lastFrameAssetId:
        snapshot && selectedShotId
          ? connectedAssetId(snapshot, selectedShotId, "last_frame")
          : null,
      referenceAssetId:
        snapshot && selectedShotId ? connectedAssetId(snapshot, selectedShotId, "reference") : null,
    }),
    [raw, snapshot, selectedShotId],
  );
  const editSettings = useCallback(
    (update: SetStateAction<GenerationSettings>) => {
      if (!snapshot || !selectedShot || readDocument()?.snapshot.project.id !== snapshot.project.id)
        return;
      setDrafts((current) => {
        const values =
          current.projectId === snapshot.project.id
            ? new Map(current.values)
            : new Map<string, GenerationSettings>();
        const previous = values.get(scope) ?? generationSettings;
        const next = typeof update === "function" ? update(previous) : update;
        values.set(scope, next);
        return { projectId: snapshot.project.id, values };
      });
    },
    [snapshot, selectedShot, readDocument, scope, generationSettings],
  );
  // Persist only a draft that was actually edited in this exact workflow scope.
  const edited = drafts.projectId === snapshot?.project.id ? drafts.values.get(scope) : undefined;
  useEffect(() => {
    if (!edited || projectMode !== "project") return;
    const { width, height, durationSeconds, fps, steps, denoise } = edited;
    if ([width, height, durationSeconds, fps, steps, denoise].every(Number.isFinite))
      saveModelPreferences(preferenceScope, {
        width,
        height,
        durationSeconds,
        fps,
        steps,
        denoise,
      });
  }, [edited, preferenceScope, projectMode]);
  const [candidateCount, setCandidateCount] = useState(1);
  const [bindingBusy, setBindingBusy] = useState(false);
  const selectedModelProfile = useMemo(
    () => modelProfile(selectedWorkflow, selectedShot?.aspectRatio ?? "16:9"),
    [selectedShot?.aspectRatio, selectedWorkflow],
  );

  const selectedShotItem = snapshot?.canvasItems.find(
    (item) => item.refType === "shot" && item.refId === selectedShotId,
  );
  const selectedShotInputEdges = useMemo(
    () =>
      snapshot && selectedShotItem
        ? snapshot.canvasEdges
            .filter((edge) => edge.targetItemId === selectedShotItem.id && edge.targetSlot)
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
    [selectedShotItem, snapshot],
  );
  const promptMentions = useMemo<PromptMention[]>(() => {
    if (!snapshot) return [];
    const aliases = new Set<string>();
    const mentions: PromptMention[] = [];
    let pictureIndex = 0;
    let videoIndex = 0;
    let audioIndex = generationSettings.referenceVideoAudio
      ? selectedShotInputEdges.filter((edge) => edge.targetSlot === "reference_video").length
      : 0;
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
          .replace(/[\s@，。；：、,.!?！？<>()[\]{}“”‘’「」]+/g, "_")
          .slice(0, 32) ||
        (asset.mediaType === "video"
          ? "参考视频"
          : asset.mediaType === "audio"
            ? "参考音频"
            : "参考图");
      let alias = baseAlias;
      let suffix = 2;
      while (aliases.has(alias)) alias = `${baseAlias}_${suffix++}`;
      aliases.add(alias);
      const canonicalToken =
        asset.mediaType === "image"
          ? `<Picture ${++pictureIndex}>`
          : asset.mediaType === "video"
            ? `<Video ${++videoIndex}>`
            : `<Audio ${++audioIndex}>`;
      mentions.push({
        assetId: asset.id,
        alias,
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
  }, [
    projectKey,
    projectMode,
    selectedShotInputEdges,
    snapshot,
    generationSettings.referenceVideoAudio,
  ]);
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
        if (edge.targetSlot !== "reference_video" || !snapshot) return [];
        const assetId = sourceAssetId(
          snapshot,
          snapshot.canvasItems.find((item) => item.id === edge.sourceItemId),
          "video",
        );
        return assetId ? [assetId] : [];
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

  const unsupportedConnections = selectedShotInputEdges.filter(
    (edge) =>
      !selectedModelProfile.slots.some(
        (slot) => slot.id === edge.targetSlot && edge.targetSlotIndex < slot.maxCount,
      ),
  );
  const unavailableConnections = selectedShotInputEdges.filter((edge) => {
    const mediaType =
      edge.targetSlot === "reference_video"
        ? "video"
        : edge.targetSlot === "reference_audio"
          ? "audio"
          : "image";
    const source = snapshot?.canvasItems.find((item) => item.id === edge.sourceItemId);
    return !snapshot || !sourceAssetId(snapshot, source, mediaType);
  });
  const generationDisabledReason = unsupportedConnections.length
    ? `有 ${unsupportedConnections.length} 条连线不适用于当前工作流，请调整连接或更换工作流`
    : unavailableConnections.length
      ? `有 ${unavailableConnections.length} 条连线尚无可用素材，请先生成来源镜头或调整连接`
      : generationProblem({
          projectMode,
          selectedWorkflow,
          generationSettings,
          selectedModelProfile,
          selectedInputCounts,
          assets: snapshot?.assets ?? [],
        });

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
        !context.canEdit
      ) {
        onNotice("示例镜头不会写入修改");
        return;
      }
      const item = snapshot.canvasItems.find(
        (candidate) => candidate.refType === "shot" && candidate.refId === selectedShotId,
      );
      if (!item) return;
      setBindingBusy(true);
      onError(null);
      try {
        const payload = await projectApi.editCanvasItem(projectKey, item.id, input);
        acceptPayload(payload);
        editSettings((current) => ({
          ...current,
          durationSeconds: input.durationSeconds,
        }));
        onNotice("镜头信息已保存");
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "镜头保存失败");
      } finally {
        setBindingBusy(false);
      }
    },
    [
      acceptPayload,
      context.canEdit,
      projectKey,
      projectMode,
      selectedShotId,
      snapshot,
      onNotice,
      onError,
      editSettings,
    ],
  );

  const bindWorkflow = useCallback(
    async (workflow: WorkflowSummary) => {
      if (!selectedShot || !snapshot || !context.canEdit || workflowLocked) {
        onNotice("这个镜头已有运行记录或不可编辑；工作流未改变");
        return false;
      }
      const projectId = snapshot.project.id;
      setBindingBusy(true);
      onError(null);
      try {
        if (projectMode === "project" && projectKey) {
          const item = snapshot.canvasItems.find(
            (item) => item.refType === "shot" && item.refId === selectedShot.id,
          );
          if (!item) throw new Error("镜头不在当前画布中");
          const payload = await projectApi.editCanvasItem(projectKey, item.id, {
            workflowPath: workflow.path,
          });
          if (readDocument()?.snapshot.project.id !== projectId) return false;
          acceptPayload(payload);
        } else setDemoWorkflows((current) => new Map(current).set(shotScope, workflow.path));
        onNotice(`已为 ${selectedShot.label} 绑定：${workflow.name}`);
        return true;
      } catch (cause) {
        if (readDocument()?.snapshot.project.id === projectId)
          onError(cause instanceof Error ? cause.message : "工作流绑定失败");
        return false;
      } finally {
        setBindingBusy(false);
      }
    },
    [
      selectedShot,
      snapshot,
      context.canEdit,
      workflowLocked,
      onNotice,
      onError,
      projectMode,
      projectKey,
      readDocument,
      acceptPayload,
      shotScope,
    ],
  );
  return {
    generationSettings,
    editSettings,
    selectedWorkflow,
    selectedModelProfile,
    workflowLocked,
    promptMentions,
    selectedInputCounts,
    selectedReferenceVideoIds,
    selectedReferenceImageIds,
    selectedReferenceAudioIds,
    generationDisabledReason,
    candidateCount,
    setCandidateCount,
    bindWorkflow,
    updateSelectedShot,
    bindingBusy,
  };
}
