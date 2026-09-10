import type { Run, Shot } from "@takeboard/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { demoApi, projectApi, type WorkflowSummary } from "./api";
import { compileMiniMaxH3Mentions } from "./canvas-projection";
import type { GenerationContext } from "./generation-context";
import {
  findWorkflow,
  type GenerationLaunchOptions,
  type GenerationProgress,
  type GenerationSettings,
  realGenerationProgress,
} from "./generation-model";
import { generationProblem } from "./generation-readiness";
import { batchGenerationProgress, cancellableRunIds, submitCandidates } from "./generation-session";
import { modelProfile } from "./model-profiles";
import type { useGenerationDraft } from "./use-generation-draft";
import { useRunRecovery } from "./use-run-recovery";

export function useGenerationSession(
  context: GenerationContext,
  draft: ReturnType<typeof useGenerationDraft>,
  comfyEditorUrl: string,
  workflows: WorkflowSummary[],
) {
  const {
    projectKey,
    projectMode,
    snapshot,
    selectedShot,
    visible,
    acceptPayload,
    readDocument: readProjectDocument,
    onError: setError,
    onNotice: setNotice,
  } = context;
  const {
    generationSettings,
    promptMentions,
    selectedReferenceAudioIds,
    selectedReferenceImageIds,
    selectedReferenceVideoIds,
    candidateCount,
  } = draft;
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationCancelling, setGenerationCancelling] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [observed, setObserved] = useState<{ shotId: string; progress: GenerationProgress } | null>(
    null,
  );
  const generationTokenRef = useRef(0);
  const cancellationScope = useRef(0);
  const stopping = useRef(false);
  const submissionShot = useRef<string | null>(null);
  const cancellationShot = useRef<string | null>(null);
  const viewScope = visible ? (projectKey ?? snapshot?.project.id ?? "demo") : "hub";
  const attachedScope = useRef(viewScope);
  const pendingSubmissions = useRef(
    new Map<
      string,
      {
        token: number;
        shotId: string;
        batchId: string;
        promise: Promise<PromiseSettledResult<Awaited<ReturnType<typeof projectApi.generate>>>[]>;
      }
    >(),
  );
  const detach = useCallback(() => {
    generationTokenRef.current++;
    cancellationScope.current++;
    stopping.current = false;
    setGenerationBusy(false);
    setGenerationCancelling(false);
    setGenerationProgress(null);
    setObserved(null);
  }, []);
  useEffect(() => {
    attachedScope.current = viewScope;
    detach();
    return () => {
      generationTokenRef.current++;
      cancellationScope.current++;
    };
  }, [viewScope, detach]);
  const activeRuns = (snapshot?.runs ?? []).filter(
    (run) =>
      run.shotId === selectedShot?.id &&
      !["completed", "failed", "cancelled", "orphaned"].includes(run.status),
  );
  const activeRun = activeRuns.at(-1);

  const generateReal = useCallback(
    async (
      shot: Shot,
      settingsOverride: Partial<GenerationSettings> = {},
      launchOptions: GenerationLaunchOptions = {},
    ) => {
      if (
        !visible ||
        attachedScope.current !== viewScope ||
        !projectKey ||
        !context.canEdit ||
        pendingSubmissions.current.has(projectKey) ||
        generationCancelling
      )
        return;
      const submittedSettings = { ...generationSettings, ...settingsOverride };
      const selectedWorkflow = findWorkflow(submittedSettings.recipePath, workflows);
      const selectedModelProfile = modelProfile(selectedWorkflow, shot.aspectRatio);
      const effectiveDisabledReason = generationProblem({
        projectMode: "project",
        selectedWorkflow,
        selectedModelProfile,
        generationSettings: {
          ...submittedSettings,
          firstFrameAssetId:
            launchOptions.firstFrameAssetId === undefined
              ? submittedSettings.firstFrameAssetId
              : launchOptions.firstFrameAssetId,
          lastFrameAssetId:
            launchOptions.lastFrameAssetId === undefined
              ? submittedSettings.lastFrameAssetId
              : launchOptions.lastFrameAssetId,
        },
        selectedInputCounts: {
          reference: (launchOptions.referenceImageAssetIds ?? selectedReferenceImageIds).length,
          reference_video: (launchOptions.referenceVideoAssetIds ?? selectedReferenceVideoIds)
            .length,
          reference_audio: (launchOptions.referenceAudioAssetIds ?? selectedReferenceAudioIds)
            .length,
        },
        assets: readProjectDocument()?.snapshot.assets ?? [],
      });
      const token = generationTokenRef.current + 1;
      generationTokenRef.current = token;
      submissionShot.current = shot.id;
      setGenerationBusy(true);
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
        const submissionPromise = submitCandidates(
          seeds,
          (seed, offset) =>
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
          () => generationTokenRef.current === token,
        );
        pendingSubmissions.current.set(projectKey, {
          token,
          shotId: shot.id,
          batchId,
          promise: submissionPromise,
        });
        const submissionResults = await submissionPromise;
        if (pendingSubmissions.current.get(projectKey)?.token === token)
          pendingSubmissions.current.delete(projectKey);
        // Navigation detaches the view, not the server-owned generation task.
        if (generationTokenRef.current !== token) return;
        const submitted = submissionResults.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        for (const result of submitted) acceptPayload(result);
        if (submissionResults.some((result) => result.status === "rejected")) {
          const refreshed = await projectApi.open(projectKey).catch(() => null);
          if (refreshed) acceptPayload(refreshed);
        }
        const latestSnapshot = readProjectDocument()?.snapshot;
        const batchRunIds = [
          ...new Set([
            ...submitted.map((result) => result.runId),
            ...(latestSnapshot?.runs
              .filter((run) => run.parameters.candidateBatchId === batchId)
              .map((run) => run.id) ?? []),
          ]),
        ];
        if (generationTokenRef.current !== token) {
          return;
        }
        const submissionFailures = batchSize - submitted.length;
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
      } catch (cause) {
        if (generationTokenRef.current === token) {
          setError(cause instanceof Error ? cause.message : "生成失败");
        }
      } finally {
        if (generationTokenRef.current === token) {
          setGenerationBusy(false);
          setGenerationProgress(null);
        }
      }
    },
    [
      context.canEdit,
      generationCancelling,
      acceptPayload,
      comfyEditorUrl,
      generationSettings,
      promptMentions,
      projectKey,
      selectedReferenceAudioIds,
      selectedReferenceImageIds,
      selectedReferenceVideoIds,
      readProjectDocument,
      setError,
      setNotice,
      workflows,
      visible,
      viewScope,
    ],
  );

  const retryGenerationRun = useCallback(
    async (run: Run) => {
      const shot = readProjectDocument()?.snapshot?.shots.find((item) => item.id === run.shotId);
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
          executionPolicy: run.execution?.policy ?? generationSettings.executionPolicy,
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
    [generateReal, generationSettings, readProjectDocument, setError],
  );

  const cancelGeneration = useCallback(async () => {
    if (
      stopping.current ||
      generationCancelling ||
      !context.canEdit ||
      !projectKey ||
      !selectedShot ||
      projectMode !== "project"
    )
      return;
    const submission = pendingSubmissions.current.get(projectKey);
    const pending = submission?.shotId === selectedShot.id ? submission : null;
    if (pending) generationTokenRef.current++;
    const token = ++cancellationScope.current;
    stopping.current = true;
    cancellationShot.current = selectedShot.id;
    setGenerationCancelling(true);
    setGenerationProgress({
      phase: "collecting",
      label: "正在停止任务",
      detail: "等待提交确认并核对执行端停止",
      percent: null,
      elapsedSeconds: 0,
    });
    try {
      if (pending) await pending.promise;
      const refreshed = await projectApi.open(projectKey);
      const ids = cancellableRunIds(refreshed.snapshot.runs, selectedShot.id);
      // Explicit cancellation finishes for the captured project even if the user navigates away.
      const results = await submitCandidates(ids, (runId) =>
        projectApi.cancelRun(projectKey, runId),
      );
      if (cancellationScope.current !== token) return;
      let stopped = 0;
      for (const result of results)
        if (result.status === "fulfilled") {
          acceptPayload(result.value);
          if (result.value.cancelled) stopped++;
        }
      setNotice(
        ids.length
          ? `${stopped} 个生成任务已停止${stopped < ids.length ? "，其余任务仍需核对" : "并完成清理"}`
          : "已停止本次生成准备",
      );
    } catch (cause) {
      if (cancellationScope.current === token)
        setError(cause instanceof Error ? cause.message : "停止生成失败");
    } finally {
      if (cancellationScope.current === token) {
        stopping.current = false;
        if (submissionShot.current === selectedShot.id) setGenerationBusy(false);
        setGenerationCancelling(false);
        setGenerationProgress(null);
      }
    }
  }, [
    generationCancelling,
    context.canEdit,
    projectKey,
    projectMode,
    selectedShot,
    acceptPayload,
    setNotice,
    setError,
  ]);

  useRunRecovery({
    enabled: visible && projectMode === "project" && !generationBusy && !generationCancelling,
    projectKey,
    selectedShotId: selectedShot?.id ?? null,
    runs: snapshot?.runs ?? [],
    onResult: (result, run) => {
      acceptPayload(result);
      if (run.shotId === selectedShot?.id)
        setObserved({
          shotId: run.shotId,
          progress: realGenerationProgress(result.progress, Date.parse(run.createdAt)),
        });
    },
    onPending: (run) => {
      if (!run) {
        setObserved(null);
        return;
      }
      setObserved({
        shotId: run.shotId,
        progress: {
          phase: run.status === "collecting_outputs" ? "collecting" : "running",
          label: "已恢复后台生成任务",
          detail: "任务由服务端持续跟踪，关闭页面不影响结果回收",
          percent: null,
          elapsedSeconds: Math.max(0, Math.round((Date.now() - Date.parse(run.createdAt)) / 1000)),
        },
      });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "后台任务状态同步失败"),
  });
  const requestShotGeneration = useCallback(
    async (shot: Shot, settingsOverride: Partial<GenerationSettings> = {}) => {
      if (!context.canEdit || generationBusy || generationCancelling) return;
      if (
        shot.status === "approved" &&
        !window.confirm(
          `“${shot.label}”已有采用结果。\n\n继续生成会开启一轮新候选，当前采用记录仍会保留。是否继续？`,
        )
      )
        return;
      if (projectMode !== "demo") return generateReal(shot, settingsOverride, { candidateCount });
      const token = ++generationTokenRef.current;
      submissionShot.current = shot.id;
      setGenerationBusy(true);
      try {
        const payload = await demoApi.generate(shot.id);
        if (token === generationTokenRef.current) {
          acceptPayload(payload);
          setNotice(`${shot.label} 已生成 4 个新候选`);
        }
      } catch (cause) {
        if (token === generationTokenRef.current)
          setError(cause instanceof Error ? cause.message : "生成失败");
      } finally {
        if (token === generationTokenRef.current) setGenerationBusy(false);
      }
    },
    [
      context.canEdit,
      generationBusy,
      generationCancelling,
      projectMode,
      generateReal,
      candidateCount,
      acceptPayload,
      setNotice,
      setError,
    ],
  );
  const batchProgress = selectedShot
    ? batchGenerationProgress(snapshot?.runs ?? [], selectedShot.id)
    : null;
  const operationShot = generationCancelling ? cancellationShot.current : submissionShot.current;
  return {
    canCancelGeneration:
      context.canEdit &&
      ((generationBusy && submissionShot.current === selectedShot?.id) || activeRuns.length > 0),
    generationBusy,
    generationCancelling,
    generationProgress:
      generationProgress && operationShot === selectedShot?.id
        ? generationProgress
        : batchProgress
          ? batchProgress
          : observed && observed.shotId === selectedShot?.id
            ? observed.progress
            : null,
    activeRun,
    requestShotGeneration,
    retryGenerationRun,
    cancelGeneration,
    detach,
  };
}
