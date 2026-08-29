import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { type ProjectSnapshot, resolveGenerationResolution } from "@takeboard/contracts";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import {
  buildLtx23I2VPrompt,
  buildMiniMaxH3Prompt,
  buildMiniMaxH3ReferencePrompt,
  buildQwenImage2512Prompt,
  buildWan22FirstLastPrompt,
  buildWan22I2VPrompt,
  ComfyClient,
  type ComfyPrompt,
  miniMaxH3Resolution,
  qwenImage2512Resolution,
} from "@takeboard/executor-comfy";
import type { FastifyInstance } from "fastify";
import { createImageProxy, inspectImage, inspectVideo } from "./asset-inspection.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";
import { applyWorkflowBinding, loadExecutableWorkflow } from "./workflow-bindings.js";

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

function mediaType(mimeType: string) {
  if (mimeType.startsWith("image/")) return "image" as const;
  if (mimeType.startsWith("video/")) return "video" as const;
  if (mimeType.startsWith("audio/")) return "audio" as const;
  return null;
}

function resolution(aspectRatio: string) {
  if (aspectRatio === "16:9") return { width: 848, height: 480 };
  if (aspectRatio === "1:1") return { width: 640, height: 640 };
  if (aspectRatio === "4:5") return { width: 512, height: 640 };
  if (aspectRatio === "2.35:1") return { width: 848, height: 360 };
  return { width: 480, height: 848 };
}

function importedImageNodeSize(image: { width: number; height: number } | null) {
  if (!image) return { width: 280, height: 180 };
  const ratio = image.width / image.height;
  const width = Math.round(Math.min(420, Math.max(240, 300 * Math.sqrt(ratio))));
  const previewHeight = Math.min(440, width / ratio);
  return { width, height: Math.round(previewHeight + 76) };
}

function takeStackPosition(snapshot: ProjectSnapshot, shotId: string) {
  const shotItem = snapshot.canvasItems.find(
    (item) => item.refType === "shot" && item.refId === shotId,
  );
  if (!shotItem) return { x: 560, y: 180 };
  const shotWidth = Math.max(470, shotItem.width);
  const shotHeight = Math.max(190, shotItem.height);
  const stack = { width: 280, height: 190 };
  const gap = 64;
  const candidates = [
    { x: shotItem.x + shotWidth + gap, y: shotItem.y },
    { x: shotItem.x, y: shotItem.y + shotHeight + gap },
    { x: shotItem.x, y: shotItem.y - stack.height - gap },
    { x: shotItem.x - stack.width - gap, y: shotItem.y },
  ];
  const overlaps = (candidate: { x: number; y: number }) =>
    snapshot.canvasItems.some((item) => {
      if (item.id === shotItem.id) return false;
      const width = item.refType === "shot" ? Math.max(470, item.width) : item.width;
      const height = Math.max(120, item.height);
      return !(
        candidate.x + stack.width + 24 <= item.x ||
        item.x + width + 24 <= candidate.x ||
        candidate.y + stack.height + 24 <= item.y ||
        item.y + height + 24 <= candidate.y
      );
    });
  return candidates.find((candidate) => !overlaps(candidate)) ?? { x: 560, y: 180 };
}

function parseByteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText = "", endText = ""] = match;
  if (!startText && !endText) return null;
  const requestedStart = startText ? Number(startText) : Math.max(0, size - Number(endText));
  const requestedEnd = endText && startText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(requestedStart) ||
    !Number.isSafeInteger(requestedEnd) ||
    requestedStart < 0 ||
    requestedStart >= size ||
    requestedEnd < requestedStart
  ) {
    return null;
  }
  return { start: requestedStart, end: Math.min(requestedEnd, size - 1) };
}

type GenerationStorageOptions = {
  inputRoot: string | null;
  outputRoot: string | null;
};

const terminalRunStatuses = new Set(["completed", "failed", "cancelled", "orphaned"]);

function refreshShotStatus(snapshot: ProjectSnapshot, shotId: string, timestamp: string) {
  const shot = snapshot.shots.find((item) => item.id === shotId);
  if (!shot) return;
  const hasActiveRun = snapshot.runs.some(
    (run) => run.shotId === shotId && !terminalRunStatuses.has(run.status),
  );
  const hasReviewableTake = snapshot.takes.some(
    (take) => take.shotId === shotId && (take.status === "candidate" || take.status === "approved"),
  );
  shot.status = hasActiveRun
    ? "generating"
    : shot.approvedTakeId
      ? "approved"
      : hasReviewableTake
        ? "review"
        : "draft";
  shot.updatedAt = timestamp;
}

async function cleanupComfyRunFiles(
  storage: GenerationStorageOptions,
  projectId: string,
  shotId: string,
  runId: string,
) {
  if (storage.inputRoot) {
    const inputRoot = resolve(storage.inputRoot);
    const entries = await readdir(inputRoot, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.includes(runId))
        .map((entry) => unlink(join(inputRoot, entry.name)).catch(() => undefined)),
    );
  }
  if (storage.outputRoot) {
    const outputRoot = resolve(storage.outputRoot);
    const runDirectory = resolve(outputRoot, "takeboard", projectId, shotId, runId);
    if (runDirectory.startsWith(`${outputRoot}${sep}`)) {
      await rm(runDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export function registerGenerationRoutes(
  app: FastifyInstance,
  projectsRoot: string,
  comfyUrl: string,
  storage: GenerationStorageOptions = { inputRoot: null, outputRoot: null },
) {
  const root = resolve(projectsRoot);
  const comfy = new ComfyClient(comfyUrl, { liveProgress: process.env.NODE_ENV !== "test" });
  const liveProgress = (run: ProjectSnapshot["runs"][number]) => {
    if (!run.promptId) return null;
    const clientId = run.parameters.comfyClientId;
    if (typeof clientId === "string" && !terminalRunStatuses.has(run.status)) {
      comfy.watchProgress(run.promptId, clientId);
    }
    return (
      comfy.progress(run.promptId) ??
      (!terminalRunStatuses.has(run.status)
        ? {
            phase: run.status === "collecting_outputs" ? "collecting" : "running",
            label:
              run.status === "collecting_outputs" ? "正在回收生成文件" : "ComfyUI 正在执行工作流",
            detail: "当前节点未提供实时步进；任务状态来自执行端 History",
            percent: null,
            nodeId: null,
            queueRemaining: null,
            source: "comfy_history" as const,
            updatedAt: run.updatedAt,
          }
        : null)
    );
  };

  app.post<{
    Params: { key: string };
    Querystring: { kind?: string; name?: string; x?: string; y?: string; canvas?: string };
  }>("/api/projects/:key/assets", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const upload = await request.file();
    if (!upload) return await reply.code(400).send({ error: "请选择素材文件" });
    const kind = mediaType(upload.mimetype);
    if (!kind) return await reply.code(415).send({ error: "仅支持图片、视频和音频素材" });
    const bytes = await upload.toBuffer();
    let imageInfo: ReturnType<typeof inspectImage> | null = null;
    let videoInfo: ReturnType<typeof inspectVideo> | null = null;
    if (kind === "image") {
      try {
        imageInfo = inspectImage(bytes, upload.mimetype);
      } catch (error) {
        return await reply.code(422).send({
          error: error instanceof Error ? error.message : "图片文件无效",
        });
      }
    } else if (kind === "video") {
      try {
        videoInfo = inspectVideo(bytes, upload.mimetype);
      } catch (error) {
        return await reply.code(422).send({
          error: error instanceof Error ? error.message : "视频文件无效",
        });
      }
    }
    const timestamp = toIsoTimestamp();
    const milliseconds = Date.now();
    const assetId = createTakeBoardId("asset", milliseconds);
    const entityKind = ["character", "location", "prop"].includes(request.query.kind ?? "")
      ? (request.query.kind as "character" | "location" | "prop")
      : null;
    const addToCanvas = request.query.canvas !== "0";
    const entityId = entityKind ? createTakeBoardId("entity", milliseconds) : null;
    const safeExtension = extname(basename(upload.filename)).toLowerCase().slice(0, 12);
    const storagePath = `assets/originals/${assetId}${safeExtension}`;
    const proxyStoragePath = imageInfo ? `assets/proxies/${assetId}.jpg` : null;
    const directory = join(root, key);
    const store = ProjectStore.openExisting(directory);
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    let committed = false;
    try {
      const current = store.loadCurrent();
      if (!current) return await reply.code(404).send({ error: "项目不存在" });
      await writeFile(join(directory, storagePath), bytes, { mode: 0o600 });
      const proxyCreated =
        !proxyStoragePath ||
        (await createImageProxy(join(directory, storagePath), join(directory, proxyStoragePath)));
      if (!proxyCreated) {
        await unlink(join(directory, storagePath)).catch(() => undefined);
        return await reply.code(422).send({ error: "图片无法完整解码或生成安全预览" });
      }
      const proxyPath = proxyStoragePath;
      const canvasSize = importedImageNodeSize(imageInfo ?? videoInfo);
      current.snapshot.assets.push({
        id: assetId,
        projectId: current.snapshot.project.id,
        mediaType: kind,
        originalName:
          request.query.name?.trim().slice(0, 512) || basename(upload.filename).slice(0, 512),
        mimeType: upload.mimetype,
        byteSize: bytes.byteLength,
        sha256: sha256(bytes),
        storagePath,
        proxyPath,
        width: imageInfo?.width ?? videoInfo?.width ?? null,
        height: imageInfo?.height ?? videoInfo?.height ?? null,
        durationSeconds: videoInfo?.durationSeconds ?? null,
        frameRate: videoInfo?.frameRate ?? null,
        metadataInspectedAt: kind === "video" ? timestamp : null,
        metadataInspectionError:
          kind === "video" && !videoInfo ? "当前视频封装未提供可读取的轨道信息" : null,
        libraryKind: entityKind,
        customTags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      if (entityKind && entityId) {
        current.snapshot.entities.push({
          id: entityId,
          projectId: current.snapshot.project.id,
          kind: entityKind,
          name:
            request.query.name?.trim().slice(0, 200) ||
            basename(upload.filename, extname(upload.filename)),
          description: "",
          referenceAssetIds: [assetId],
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      const scene = current.snapshot.scenes[0];
      if (scene && addToCanvas) {
        const requestedX = Number(request.query.x);
        const requestedY = Number(request.query.y);
        current.snapshot.canvasItems.push({
          id: createTakeBoardId("canvas_item", milliseconds),
          sceneId: scene.id,
          refType: entityId ? "entity" : "asset",
          refId: entityId ?? assetId,
          x: Number.isFinite(requestedX) ? requestedX : -170,
          y: Number.isFinite(requestedY)
            ? requestedY
            : 180 + Math.max(0, current.snapshot.assets.length - 1) * 190,
          width: canvasSize.width,
          height: canvasSize.height,
          zIndex: 1,
          parentGroupId: null,
          collapsed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      current.snapshot.project.updatedAt = timestamp;
      current.snapshot.exportedAt = timestamp;
      const saved = await store.save(current.snapshot, {
        type: "asset.imported",
        payload: { assetId, mediaType: kind, entityId, entityKind, addToCanvas },
      });
      committed = true;
      return await reply.code(201).send({ key, ...saved });
    } finally {
      if (!committed) {
        await Promise.allSettled([
          unlink(join(directory, storagePath)),
          ...(proxyStoragePath ? [unlink(join(directory, proxyStoragePath))] : []),
        ]);
      }
      store.close();
    }
  });

  app.post<{ Params: { key: string } }>(
    "/api/projects/:key/assets/inspect-metadata",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const directory = join(root, key);
      const store = ProjectStore.openExisting(directory);
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        const candidates = current.snapshot.assets.filter(
          (asset) => asset.mediaType === "video" && !asset.metadataInspectedAt,
        );
        const updatedAssetIds: string[] = [];
        const warnings: Array<{ assetId: string; name: string; reason: string }> = [];
        const timestamp = toIsoTimestamp();
        for (const asset of candidates) {
          try {
            const bytes = await readFile(join(directory, asset.storagePath));
            const info = inspectVideo(bytes, asset.mimeType);
            if (!info) {
              asset.metadataInspectedAt = timestamp;
              asset.metadataInspectionError = "当前视频封装未提供可读取的轨道信息";
              asset.updatedAt = timestamp;
              updatedAssetIds.push(asset.id);
              warnings.push({
                assetId: asset.id,
                name: asset.originalName,
                reason: "暂不支持识别这种视频封装格式",
              });
              continue;
            }
            asset.width = info.width;
            asset.height = info.height;
            asset.durationSeconds = info.durationSeconds;
            asset.frameRate = info.frameRate;
            asset.metadataInspectedAt = timestamp;
            asset.metadataInspectionError = null;
            asset.updatedAt = timestamp;
            updatedAssetIds.push(asset.id);
          } catch (error) {
            warnings.push({
              assetId: asset.id,
              name: asset.originalName,
              reason: error instanceof Error ? error.message : "读取视频信息失败",
            });
          }
        }
        if (updatedAssetIds.length === 0) {
          return {
            key,
            revision: current.revision,
            snapshot: current.snapshot,
            inspected: candidates.length,
            updatedAssetIds,
            warnings,
          };
        }
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "asset.metadata_inspected",
          payload: { inspected: candidates.length, updatedAssetIds, warningCount: warnings.length },
        });
        return { key, inspected: candidates.length, updatedAssetIds, warnings, ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.patch<{ Params: { key: string; assetId: string } }>(
    "/api/projects/:key/assets/:assetId",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const directory = join(root, key);
      const store = ProjectStore.openExisting(directory);
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const asset = current?.snapshot.assets.find((item) => item.id === request.params.assetId);
        if (!current || !asset) return await reply.code(404).send({ error: "素材不存在" });

        if (body.title !== undefined) {
          if (typeof body.title !== "string" || !body.title.trim()) {
            return await reply.code(400).send({ error: "素材名称不能为空" });
          }
          asset.originalName = body.title.trim().slice(0, 512);
        }
        if (body.customTags !== undefined) {
          if (!Array.isArray(body.customTags)) {
            return await reply.code(400).send({ error: "素材标签无效" });
          }
          const customTags = [
            ...new Set(body.customTags.map((tag) => (typeof tag === "string" ? tag.trim() : tag))),
          ].filter(
            (tag): tag is string => typeof tag === "string" && tag.length > 0 && tag.length <= 40,
          );
          if (customTags.length !== body.customTags.length || customTags.length > 24) {
            return await reply.code(400).send({ error: "素材标签无效" });
          }
          asset.customTags = customTags;
        }
        if (body.libraryKind !== undefined) {
          if (
            body.libraryKind !== null &&
            !["character", "location", "prop"].includes(String(body.libraryKind))
          ) {
            return await reply.code(400).send({ error: "素材分类无效" });
          }
          asset.libraryKind = body.libraryKind as "character" | "location" | "prop" | null;
        }

        const timestamp = toIsoTimestamp();
        asset.updatedAt = timestamp;
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "asset.metadata_updated",
          payload: { assetId: asset.id },
        });
        return { key, ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.get<{ Params: { key: string; assetId: string }; Querystring: { proxy?: string } }>(
    "/api/projects/:key/assets/:assetId/content",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const directory = join(root, key);
      const store = ProjectStore.openExisting(directory);
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const asset = current?.snapshot.assets.find((item) => item.id === request.params.assetId);
        if (!asset) return await reply.code(404).send({ error: "素材不存在" });
        const useProxy = request.query.proxy === "1" && asset.proxyPath;
        const filePath = join(directory, useProxy || asset.storagePath);
        const info = await stat(filePath);
        const rangeHeader = request.headers.range;
        reply
          .header("accept-ranges", "bytes")
          .header("cache-control", "private, max-age=31536000, immutable")
          .type(useProxy ? "image/jpeg" : asset.mimeType);
        if (rangeHeader) {
          const range = parseByteRange(rangeHeader, info.size);
          if (!range) {
            return await reply.code(416).header("content-range", `bytes */${info.size}`).send();
          }
          const length = range.end - range.start + 1;
          return await reply
            .code(206)
            .header("content-length", length)
            .header("content-range", `bytes ${range.start}-${range.end}/${info.size}`)
            .send(createReadStream(filePath, range));
        }
        return await reply.header("content-length", info.size).send(createReadStream(filePath));
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string; runId: string } }>(
    "/api/projects/:key/runs/:runId/cancel",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const directory = join(root, key);
      const store = ProjectStore.openExisting(directory);
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const run = current?.snapshot.runs.find((item) => item.id === request.params.runId);
        if (!current || !run) {
          return await reply.code(404).send({ error: "运行记录不存在" });
        }
        if (["completed", "failed", "cancelled"].includes(run.status)) {
          const shot = current.snapshot.shots.find((item) => item.id === run.shotId);
          if (shot?.status === "generating") {
            const timestamp = toIsoTimestamp();
            refreshShotStatus(current.snapshot, run.shotId, timestamp);
            current.snapshot.project.updatedAt = timestamp;
            current.snapshot.exportedAt = timestamp;
            const saved = await store.save(current.snapshot, {
              type: "run.status_reconciled",
              payload: { runId: run.id, status: run.status },
            });
            return { key, runId: run.id, status: run.status, cancelled: false, ...saved };
          }
          return { key, runId: run.id, status: run.status, cancelled: false, ...current };
        }
        let dispatched = run.promptId === null;
        let dispatchError: string | null = null;
        if (run.promptId) {
          try {
            dispatched = await comfy.cancel(run.promptId);
          } catch (error) {
            dispatchError = error instanceof Error ? error.message : "ComfyUI 无法确认取消";
          }
        }
        const timestamp = toIsoTimestamp();
        run.status = dispatched ? "cancelled" : "orphaned";
        run.errorCode = dispatched ? null : "REMOTE_CANCEL_UNCONFIRMED";
        run.errorMessage = dispatched
          ? null
          : dispatchError || "执行端没有确认取消；可在恢复连接后再次清理";
        run.updatedAt = timestamp;
        refreshShotStatus(current.snapshot, run.shotId, timestamp);
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: dispatched ? "run.cancelled" : "run.orphaned",
          payload: { runId: run.id, promptId: run.promptId, dispatched, dispatchError },
        });

        if (!dispatched) {
          return {
            key,
            runId: run.id,
            status: run.status,
            cancelled: false,
            resourcesReleased: false,
            warning: run.errorMessage,
            ...saved,
          };
        }

        await Promise.allSettled([
          ...(run.promptId ? [comfy.deleteHistory(run.promptId)] : []),
          cleanupComfyRunFiles(storage, current.snapshot.project.id, run.shotId, run.id),
        ]);
        if (run.promptId) comfy.forgetProgress(run.promptId);
        let resourcesReleased = false;
        for (let attempt = 0; attempt < 8 && !resourcesReleased; attempt += 1) {
          resourcesReleased = await comfy.freeResourcesIfIdle().catch(() => false);
          if (!resourcesReleased) await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return {
          key,
          runId: run.id,
          status: run.status,
          cancelled: true,
          resourcesReleased,
          ...saved,
        };
      } catch (error) {
        return await reply.code(502).send({
          error: error instanceof Error ? error.message : "停止生成失败",
        });
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string; shotId: string } }>(
    "/api/projects/:key/shots/:shotId/generate",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const directory = join(root, key);
      const store = ProjectStore.openExisting(directory);
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      let submittedPromptId: string | null = null;
      let preparedRunId: string | null = null;
      let preparedProjectId: string | null = null;
      let preparedShotId: string | null = null;
      let submissionStarted = false;
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        const shot = current.snapshot.shots.find((item) => item.id === request.params.shotId);
        if (!shot) return await reply.code(404).send({ error: "镜头不存在" });
        const body =
          typeof request.body === "object" && request.body !== null
            ? (request.body as Record<string, unknown>)
            : {};
        const candidateBatchId =
          typeof body.candidateBatchId === "string" ? body.candidateBatchId : null;
        const candidateIndex =
          typeof body.candidateIndex === "number" && Number.isSafeInteger(body.candidateIndex)
            ? body.candidateIndex
            : null;
        const candidateCount =
          typeof body.candidateCount === "number" && Number.isSafeInteger(body.candidateCount)
            ? body.candidateCount
            : null;
        const hasCandidateMetadata =
          body.candidateBatchId !== undefined ||
          body.candidateIndex !== undefined ||
          body.candidateCount !== undefined;
        if (
          hasCandidateMetadata &&
          (!candidateBatchId ||
            !/^batch_[A-Za-z0-9_-]{8,100}$/.test(candidateBatchId) ||
            candidateIndex === null ||
            candidateCount === null ||
            candidateCount < 1 ||
            candidateCount > 4 ||
            candidateIndex < 1 ||
            candidateIndex > candidateCount)
        ) {
          return await reply.code(400).send({ error: "候选批次信息无效；每批仅支持 1–4 个结果" });
        }
        const retryOfRunId = typeof body.retryOfRunId === "string" ? body.retryOfRunId : null;
        if (retryOfRunId) {
          const retryTarget = current.snapshot.runs.find((run) => run.id === retryOfRunId);
          if (!retryTarget || retryTarget.shotId !== shot.id) {
            return await reply.code(404).send({ error: "要重试的运行记录不存在" });
          }
          if (!["failed", "cancelled", "orphaned"].includes(retryTarget.status)) {
            return await reply.code(409).send({ error: "只有失败、已取消或失联的运行可以重试" });
          }
        }
        const recipePath =
          typeof body.recipePath === "string" ? body.recipePath : "Kino/Kino_Wan22_I2V.json";
        const previousRecipePath = [...current.snapshot.runs]
          .reverse()
          .find((run) => run.shotId === shot.id)?.parameters.recipePath;
        const lockedWorkflowPath =
          shot.workflowPath ?? (typeof previousRecipePath === "string" ? previousRecipePath : null);
        if (lockedWorkflowPath && lockedWorkflowPath !== recipePath) {
          return await reply.code(409).send({ error: "这个镜头已有运行记录，工作流不能直接更换" });
        }
        shot.workflowPath = recipePath;
        const wanFirstLast = /Kino_Wan22_FLF2V(?:_Preview)?\.json$/.test(recipePath);
        const wanImage = /Kino_Wan22_I2V(?:_Preview)?\.json$/.test(recipePath);
        const wanPreview = (wanFirstLast || wanImage) && recipePath.endsWith("_Preview.json");
        const miniMaxText = recipePath.endsWith("Kino_MinimaxH3_T2V.json");
        const miniMaxImage = recipePath.endsWith("Kino_MinimaxH3_I2V.json");
        const miniMaxReference = recipePath.endsWith("Kino_MinimaxH3_R2V.json");
        const miniMax = miniMaxText || miniMaxImage || miniMaxReference;
        const ltxImage = recipePath.endsWith("Kino_LTX23_I2V_Draft.json");
        const qwenText = recipePath.endsWith("Kino_QwenImage2512_T2I.json");
        const qwenImage = recipePath.endsWith("Kino_QwenImage2512_I2I.json");
        const qwen = qwenText || qwenImage;
        const nativeWorkflow = wanImage || wanFirstLast || miniMax || ltxImage || qwen;
        let boundWorkflow: Awaited<ReturnType<typeof loadExecutableWorkflow>> | null = null;
        if (!nativeWorkflow) {
          try {
            boundWorkflow = await loadExecutableWorkflow(comfyUrl, recipePath);
          } catch (error) {
            return await reply.code(422).send({
              error:
                error instanceof Error ? error.message : "该工作流需要先在工作流库中完成参数绑定",
            });
          }
        }
        const timestamp = toIsoTimestamp();
        const milliseconds = Date.now();
        const runId = createTakeBoardId("run", milliseconds);
        preparedRunId = runId;
        preparedProjectId = current.snapshot.project.id;
        preparedShotId = shot.id;
        const requestedAssetId =
          typeof body.firstFrameAssetId === "string" ? body.firstFrameAssetId : null;
        const boundCapability = boundWorkflow?.binding.capability;
        const requiresInputImage =
          wanImage ||
          wanFirstLast ||
          miniMaxImage ||
          ltxImage ||
          qwenImage ||
          ["image_to_image", "image_to_video", "first_last_video"].includes(boundCapability ?? "");
        const inputAsset = requiresInputImage
          ? requestedAssetId
            ? current.snapshot.assets.find((asset) => asset.id === requestedAssetId)
            : [...current.snapshot.assets].reverse().find((asset) => asset.mediaType === "image")
          : null;
        if (requiresInputImage && inputAsset?.mediaType !== "image") {
          return await reply.code(409).send({
            error: requestedAssetId ? "选择的首帧不是可用图片" : "请先上传一张首帧图片",
          });
        }

        const requestedLastAssetId =
          typeof body.lastFrameAssetId === "string" ? body.lastFrameAssetId : null;
        const boundNeedsLast = Boolean(boundWorkflow?.binding.media.last_frame?.length);
        const lastAsset =
          (wanFirstLast || miniMaxImage || boundNeedsLast) && requestedLastAssetId
            ? current.snapshot.assets.find((asset) => asset.id === requestedLastAssetId)
            : null;
        if (
          (wanFirstLast || boundCapability === "first_last_video") &&
          lastAsset?.mediaType !== "image"
        ) {
          return await reply.code(409).send({ error: "首尾帧模式需要选择一张可用的结束帧图片" });
        }
        if (lastAsset && lastAsset.mediaType !== "image") {
          return await reply.code(409).send({ error: "选择的结束帧不是可用图片" });
        }

        const assetIds = (value: unknown, limit: number) =>
          Array.isArray(value)
            ? [...new Set(value.filter((id): id is string => typeof id === "string"))].slice(
                0,
                limit,
              )
            : [];
        const referenceImageIds = assetIds(body.referenceImageAssetIds, 9);
        const referenceVideoIds = assetIds(body.referenceVideoAssetIds, 3);
        const referenceAudioIds = assetIds(body.referenceAudioAssetIds, 3);
        const resolveAssets = (ids: string[], expectedType: "image" | "video" | "audio") =>
          ids
            .map((id) => current.snapshot.assets.find((asset) => asset.id === id))
            .filter(
              (asset): asset is NonNullable<typeof asset> => asset?.mediaType === expectedType,
            );
        const referenceImages = resolveAssets(referenceImageIds, "image");
        const referenceVideos = resolveAssets(referenceVideoIds, "video");
        const referenceAudios = resolveAssets(referenceAudioIds, "audio");
        if (
          referenceImages.length !== referenceImageIds.length ||
          referenceVideos.length !== referenceVideoIds.length ||
          referenceAudios.length !== referenceAudioIds.length
        ) {
          return await reply.code(409).send({ error: "参考素材不存在或类型与输入端口不匹配" });
        }
        if (
          (miniMaxReference || boundCapability === "reference_video") &&
          referenceImages.length + referenceVideos.length + referenceAudios.length === 0
        ) {
          return await reply.code(409).send({ error: "参考生成工作流至少需要一个参考素材" });
        }
        if (
          miniMaxReference &&
          referenceImages.length + referenceVideos.length + referenceAudios.length > 12
        ) {
          return await reply.code(409).send({ error: "MiniMax H3 Ref2VA 最多接收 12 个参考文件" });
        }
        if (
          boundWorkflow &&
          (referenceImages.length > (boundWorkflow.binding.media.reference_image?.length ?? 0) ||
            referenceVideos.length > (boundWorkflow.binding.media.reference_video?.length ?? 0) ||
            referenceAudios.length > (boundWorkflow.binding.media.reference_audio?.length ?? 0))
        ) {
          return await reply.code(409).send({ error: "参考素材数量超过该工作流已绑定的输入位置" });
        }

        let comfyImage: string | null = null;
        if (inputAsset?.mediaType === "image") {
          const bytes = await readFile(join(directory, inputAsset.storagePath));
          const extension = extname(inputAsset.originalName) || ".png";
          comfyImage = await comfy.uploadImage(
            new Uint8Array(bytes),
            `takeboard_${current.snapshot.project.id}_${runId}_${inputAsset.id}${extension}`,
            inputAsset.mimeType,
          );
        }
        const seed =
          typeof body.seed === "number" && Number.isSafeInteger(body.seed) && body.seed >= 0
            ? body.seed
            : Math.floor(Math.random() * 2_147_483_647);
        const fallbackSize = resolution(shot.aspectRatio);
        const width =
          typeof body.width === "number" && body.width >= 256 && body.width <= 2048
            ? Math.round(body.width / 32) * 32
            : fallbackSize.width;
        const height =
          typeof body.height === "number" && body.height >= 256 && body.height <= 2048
            ? Math.round(body.height / 32) * 32
            : fallbackSize.height;
        const durationSeconds =
          typeof body.durationSeconds === "number" &&
          body.durationSeconds >= 1 &&
          body.durationSeconds <= 15
            ? body.durationSeconds
            : shot.durationSeconds;
        if (miniMax && (durationSeconds < 4 || durationSeconds > 15)) {
          return await reply.code(422).send({ error: "MiniMax H3 支持 4–15 秒生成时长" });
        }
        const fps = miniMax
          ? 24
          : typeof body.fps === "number" && body.fps >= 8 && body.fps <= 60
            ? Math.round(body.fps)
            : ltxImage
              ? 25
              : 16;
        const requestedSteps =
          typeof body.steps === "number" &&
          Number.isSafeInteger(body.steps) &&
          body.steps >= 1 &&
          body.steps <= 100
            ? body.steps
            : null;
        const steps =
          wanImage || wanFirstLast
            ? wanPreview
              ? 4
              : Math.min(40, Math.max(8, requestedSteps ?? 20))
            : (requestedSteps ?? (miniMax ? 20 : qwen ? 50 : 20));
        const denoise =
          typeof body.denoise === "number" && body.denoise >= 0.05 && body.denoise <= 1
            ? body.denoise
            : 0.65;
        const positivePrompt =
          typeof body.prompt === "string" && body.prompt.trim()
            ? body.prompt.trim().slice(0, 20_000)
            : shot.intent;
        const negativePrompt =
          typeof body.negativePrompt === "string" && body.negativePrompt.trim()
            ? body.negativePrompt.trim().slice(0, 10_000)
            : undefined;
        let lastComfyImage: string | null = null;
        if (lastAsset) {
          const lastBytes = await readFile(join(directory, lastAsset.storagePath));
          lastComfyImage = await comfy.uploadImage(
            new Uint8Array(lastBytes),
            `takeboard_${current.snapshot.project.id}_${runId}_${lastAsset.id}${extname(lastAsset.originalName) || ".png"}`,
            lastAsset.mimeType,
          );
        }
        const uploadReference = async (asset: (typeof current.snapshot.assets)[number]) => {
          const bytes = await readFile(join(directory, asset.storagePath));
          const extension =
            extname(asset.originalName) ||
            (asset.mediaType === "video" ? ".mp4" : asset.mediaType === "audio" ? ".wav" : ".png");
          return await comfy.uploadImage(
            new Uint8Array(bytes),
            `takeboard_${current.snapshot.project.id}_${runId}_${asset.id}${extension}`,
            asset.mimeType,
          );
        };
        const usesBoundReferences = Boolean(
          boundWorkflow &&
            ((boundWorkflow.binding.media.reference_image?.length ?? 0) > 0 ||
              (boundWorkflow.binding.media.reference_video?.length ?? 0) > 0 ||
              (boundWorkflow.binding.media.reference_audio?.length ?? 0) > 0),
        );
        const [comfyReferenceImages, comfyReferenceVideos, comfyReferenceAudios] =
          miniMaxReference || usesBoundReferences
            ? await Promise.all([
                Promise.all(referenceImages.map(uploadReference)),
                Promise.all(referenceVideos.map(uploadReference)),
                Promise.all(referenceAudios.map(uploadReference)),
              ])
            : [[], [], []];
        const filenamePrefix = `takeboard/${current.snapshot.project.id}/${shot.id}/${runId}/result`;
        const comfyClientId = comfy.createClientId();
        const recipeInput = {
          positivePrompt,
          ...(negativePrompt ? { negativePrompt } : {}),
          width,
          height,
          durationSeconds,
          fps,
          seed,
          filenamePrefix,
        };
        let prompt: ComfyPrompt;
        let effectiveSize = { width, height };
        if (boundWorkflow) {
          prompt = applyWorkflowBinding(boundWorkflow.prompt, boundWorkflow.binding, {
            prompt: positivePrompt,
            ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
            seed,
            steps,
            denoise,
            width,
            height,
            duration: durationSeconds,
            fps,
            ...(comfyImage ? { firstFrame: comfyImage } : {}),
            ...(lastComfyImage ? { lastFrame: lastComfyImage } : {}),
            referenceImages: comfyReferenceImages,
            referenceVideos: comfyReferenceVideos,
            referenceAudios: comfyReferenceAudios,
            filenamePrefix,
          });
        } else if (qwen) {
          effectiveSize = qwenImage2512Resolution(width, height);
          prompt = buildQwenImage2512Prompt({
            ...(qwenImage && comfyImage ? { image: comfyImage } : {}),
            positivePrompt,
            ...(negativePrompt ? { negativePrompt } : {}),
            width,
            height,
            seed,
            steps,
            denoise,
            filenamePrefix,
          });
        } else if (miniMaxReference) {
          effectiveSize = miniMaxH3Resolution(width, height);
          prompt = buildMiniMaxH3ReferencePrompt({
            ...recipeInput,
            referenceImages: comfyReferenceImages,
            referenceVideos: comfyReferenceVideos,
            referenceAudios: comfyReferenceAudios,
            referenceImageSize: body.referenceImageSize === "max" ? "max" : "match",
            steps,
          });
        } else if (miniMax) {
          effectiveSize = miniMaxH3Resolution(width, height);
          prompt = buildMiniMaxH3Prompt({
            ...recipeInput,
            ...(comfyImage ? { firstImage: comfyImage } : {}),
            ...(lastComfyImage ? { lastImage: lastComfyImage } : {}),
            steps,
          });
        } else if (ltxImage && comfyImage) {
          effectiveSize = resolveGenerationResolution("multiple_32", width, height).effective;
          const workflow = await comfy.workflow(recipePath);
          prompt = buildLtx23I2VPrompt(workflow, {
            image: comfyImage,
            positivePrompt,
            width,
            height,
            durationSeconds,
            fps,
            seed,
            filenamePrefix,
          });
        } else if (wanFirstLast && comfyImage && lastComfyImage) {
          prompt = buildWan22FirstLastPrompt({
            ...recipeInput,
            image: comfyImage,
            lastImage: lastComfyImage,
            steps,
            qualityProfile: wanPreview ? "preview" : "quality",
          });
        } else if (comfyImage) {
          prompt = buildWan22I2VPrompt({
            ...recipeInput,
            image: comfyImage,
            steps,
            qualityProfile: wanPreview ? "preview" : "quality",
          });
        } else {
          await cleanupComfyRunFiles(storage, current.snapshot.project.id, shot.id, runId);
          return await reply.code(409).send({ error: "当前 Recipe 需要一张起始帧" });
        }
        const preflightErrors = await comfy.preflightPrompt(prompt);
        if (preflightErrors.length > 0) {
          await cleanupComfyRunFiles(storage, current.snapshot.project.id, shot.id, runId);
          return await reply.code(422).send({
            error: `Recipe 预检失败：${preflightErrors.slice(0, 5).join("；")}`,
          });
        }
        const recipeVersion = boundWorkflow
          ? `workflow-binding-v${boundWorkflow.binding.version}`
          : miniMaxReference
            ? "minimax-h3-ref2va@2"
            : miniMax
              ? "minimax-h3-fl2va@2"
              : qwenImage
                ? "qwen-image-2512-i2i@1"
                : qwenText
                  ? "qwen-image-2512-t2i@1"
                  : ltxImage
                    ? "ltx23-i2v-draft@1"
                    : wanFirstLast
                      ? wanPreview
                        ? "wan22-flf2v-preview@2"
                        : "wan22-flf2v-quality@2"
                      : wanPreview
                        ? "wan22-i2v-preview@2"
                        : "wan22-i2v-quality@2";
        const outputAssetId = createTakeBoardId("asset", milliseconds);
        const outputTakeId = createTakeBoardId("take", milliseconds);
        current.snapshot.runs.push({
          id: runId,
          shotId: shot.id,
          recipeId: createTakeBoardId("recipe", milliseconds),
          recipeVersion,
          workflowSha256: sha256(JSON.stringify(prompt)),
          workerId: createTakeBoardId("worker", milliseconds),
          promptId: null,
          status: "queued",
          inputs: [
            ...(inputAsset?.mediaType === "image"
              ? [
                  {
                    slot: "start_image",
                    refType: "asset" as const,
                    refId: inputAsset.id,
                    assetSha256: inputAsset.sha256,
                  },
                ]
              : []),
            ...(lastAsset
              ? [
                  {
                    slot: "last_image",
                    refType: "asset" as const,
                    refId: lastAsset.id,
                    assetSha256: lastAsset.sha256,
                  },
                ]
              : []),
            ...referenceImages.map((asset, index) => ({
              slot: `reference_image_${index}`,
              refType: "asset" as const,
              refId: asset.id,
              assetSha256: asset.sha256,
            })),
            ...referenceVideos.map((asset, index) => ({
              slot: `reference_video_${index}`,
              refType: "asset" as const,
              refId: asset.id,
              assetSha256: asset.sha256,
            })),
            ...referenceAudios.map((asset, index) => ({
              slot: `reference_audio_${index}`,
              refType: "asset" as const,
              refId: asset.id,
              assetSha256: asset.sha256,
            })),
          ],
          parameters: {
            seed,
            width: effectiveSize.width,
            height: effectiveSize.height,
            ...(boundWorkflow
              ? {
                  ...(boundWorkflow.binding.parameters.duration?.length ? { durationSeconds } : {}),
                  ...(boundWorkflow.binding.parameters.fps?.length ? { fps } : {}),
                  ...(boundWorkflow.binding.parameters.steps?.length ? { steps } : {}),
                  ...(boundWorkflow.binding.parameters.denoise?.length ? { denoise } : {}),
                }
              : {
                  ...(qwen ? {} : { durationSeconds, fps }),
                  ...(ltxImage ? {} : { steps }),
                  ...(qwenImage ? { denoise } : {}),
                }),
            recipePath,
            prompt: positivePrompt,
            promptSource:
              typeof body.promptSource === "string"
                ? body.promptSource.trim().slice(0, 20_000)
                : positivePrompt,
            negativePrompt: negativePrompt ?? null,
            ...(miniMaxReference
              ? { referenceImageSize: body.referenceImageSize === "max" ? "max" : "match" }
              : {}),
            ...(candidateBatchId
              ? {
                  candidateBatchId,
                  candidateIndex,
                  candidateCount,
                }
              : {}),
            ...(retryOfRunId ? { retryOfRunId } : {}),
            comfyInputFiles: [
              comfyImage,
              lastComfyImage,
              ...comfyReferenceImages,
              ...comfyReferenceVideos,
              ...comfyReferenceAudios,
            ].filter((value): value is string => Boolean(value)),
            comfyOutputDirectory: `takeboard/${current.snapshot.project.id}/${shot.id}/${runId}`,
            outputAssetId,
            outputTakeId,
            outputMediaType: boundWorkflow?.binding.outputMediaType ?? (qwen ? "image" : "video"),
            comfyClientId,
          },
          errorCode: null,
          errorMessage: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        shot.status = "generating";
        shot.updatedAt = timestamp;
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        await store.save(current.snapshot, {
          type: "run.prepared",
          payload: { runId, recipe: recipeVersion },
        });

        submissionStarted = true;
        const promptId = await comfy.submit(prompt, comfyClientId);
        submittedPromptId = promptId;
        const preparedRun = current.snapshot.runs.find((run) => run.id === runId);
        if (!preparedRun) throw new Error("准备好的运行记录意外丢失");
        preparedRun.promptId = promptId;
        preparedRun.status = "running";
        preparedRun.updatedAt = toIsoTimestamp();
        current.snapshot.project.updatedAt = preparedRun.updatedAt;
        current.snapshot.exportedAt = preparedRun.updatedAt;
        const saved = await store.save(current.snapshot, {
          type: "run.submitted",
          payload: {
            runId,
            promptId,
            recipe: recipeVersion,
            candidateBatchId,
            candidateIndex,
            candidateCount,
          },
        });
        return await reply.code(202).send({
          key,
          runId,
          promptId,
          candidateBatchId,
          candidateIndex,
          candidateCount,
          progress: liveProgress(preparedRun),
          ...saved,
        });
      } catch (error) {
        let remoteCancellationConfirmed = submittedPromptId === null && !submissionStarted;
        if (submittedPromptId) {
          remoteCancellationConfirmed = await comfy.cancel(submittedPromptId).catch(() => false);
          await comfy.deleteHistory(submittedPromptId).catch(() => undefined);
          comfy.forgetProgress(submittedPromptId);
        }
        if (remoteCancellationConfirmed && preparedProjectId && preparedShotId && preparedRunId) {
          await cleanupComfyRunFiles(storage, preparedProjectId, preparedShotId, preparedRunId);
        }
        if (preparedRunId) {
          try {
            const latest = store.loadCurrent();
            const run = latest?.snapshot.runs.find((item) => item.id === preparedRunId);
            if (latest && run && !terminalRunStatuses.has(run.status)) {
              const timestamp = toIsoTimestamp();
              run.status = remoteCancellationConfirmed ? "failed" : "orphaned";
              run.errorCode = remoteCancellationConfirmed
                ? "SUBMISSION_FAILED"
                : "SUBMISSION_OUTCOME_UNKNOWN";
              run.errorMessage =
                error instanceof Error ? error.message.slice(0, 20_000) : "生成任务提交失败";
              run.updatedAt = timestamp;
              refreshShotStatus(latest.snapshot, run.shotId, timestamp);
              latest.snapshot.project.updatedAt = timestamp;
              latest.snapshot.exportedAt = timestamp;
              await store.save(latest.snapshot, {
                type: remoteCancellationConfirmed ? "run.failed" : "run.orphaned",
                payload: { runId: run.id, promptId: submittedPromptId },
              });
            }
          } catch {
            // Preserve the original submission error; the prepared DB record allows
            // a later reconciliation attempt if failure persistence also fails.
          }
        }
        return await reply.code(502).send({
          error: error instanceof Error ? error.message : "生成任务提交失败",
        });
      } finally {
        store.close();
      }
    },
  );

  app.get<{ Params: { key: string; runId: string } }>(
    "/api/projects/:key/runs/:runId",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const directory = join(root, key);
      const store = ProjectStore.openExisting(directory);
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        const run = current.snapshot.runs.find((item) => item.id === request.params.runId);
        if (!run) return await reply.code(404).send({ error: "运行记录不存在" });
        if (
          ["completed", "failed", "cancelled"].includes(run.status) ||
          (run.status === "orphaned" && !run.promptId)
        ) {
          return { key, runId: run.id, status: run.status, progress: null, ...current };
        }
        if (!run.promptId) {
          const timestamp = toIsoTimestamp();
          run.status = "orphaned";
          run.errorCode = "SUBMISSION_INTERRUPTED";
          run.errorMessage = "任务准备完成，但没有取得执行端任务编号；请重试或清理该运行";
          run.updatedAt = timestamp;
          refreshShotStatus(current.snapshot, run.shotId, timestamp);
          current.snapshot.project.updatedAt = timestamp;
          current.snapshot.exportedAt = timestamp;
          const saved = await store.save(current.snapshot, {
            type: "run.orphaned",
            payload: { runId: run.id, errorCode: run.errorCode },
          });
          return { key, runId: run.id, status: run.status, ...saved };
        }

        const history = await comfy.history(run.promptId);
        if (!history) {
          return {
            key,
            runId: run.id,
            status: run.status,
            progress: liveProgress(run),
            ...current,
          };
        }
        const timestamp = toIsoTimestamp();
        if (history.status?.status_str === "error") {
          run.status = "failed";
          run.errorCode = "COMFY_EXECUTION_ERROR";
          run.errorMessage = "ComfyUI 执行失败，请检查工作站日志";
          run.updatedAt = timestamp;
          refreshShotStatus(current.snapshot, run.shotId, timestamp);
          const saved = await store.save(current.snapshot, {
            type: "run.failed",
            payload: { runId: run.id },
          });
          await Promise.allSettled([
            comfy.deleteHistory(run.promptId),
            cleanupComfyRunFiles(storage, current.snapshot.project.id, run.shotId, run.id),
          ]);
          comfy.forgetProgress(run.promptId);
          return { key, runId: run.id, status: run.status, progress: null, ...saved };
        }

        const outputs = Object.values(history.outputs ?? {});
        const expectsImage =
          run.parameters.outputMediaType === "image" ||
          run.recipeVersion.startsWith("qwen-image-2512-");
        const videoOutput = outputs.flatMap((item) => [
          ...(item.videos ?? []),
          ...(item.gifs ?? []).filter((file) => /\.(?:mp4|webm)$/i.test(file.filename)),
          ...(item.images ?? []).filter((file) => /\.(?:mp4|webm)$/i.test(file.filename)),
        ])[0];
        const imageOutput = outputs
          .flatMap((item) => item.images ?? [])
          .find((file) => /\.(?:png|jpe?g|webp)$/i.test(file.filename));
        const output = expectsImage ? imageOutput : videoOutput;
        if (!output) {
          if (!history.status?.completed) {
            return {
              key,
              runId: run.id,
              status: run.status,
              progress: liveProgress(run),
              ...current,
            };
          }
          run.status = "failed";
          run.errorCode = expectsImage ? "NO_IMAGE_OUTPUT" : "NO_VIDEO_OUTPUT";
          run.errorMessage = expectsImage
            ? "ComfyUI 已完成，但 Workflow 没有返回图片文件"
            : "ComfyUI 已完成，但 Workflow 没有返回视频文件";
          run.updatedAt = timestamp;
          refreshShotStatus(current.snapshot, run.shotId, timestamp);
          const saved = await store.save(current.snapshot, {
            type: "run.failed",
            payload: { runId: run.id, errorCode: run.errorCode },
          });
          await Promise.allSettled([
            comfy.deleteHistory(run.promptId),
            cleanupComfyRunFiles(storage, current.snapshot.project.id, run.shotId, run.id),
          ]);
          comfy.forgetProgress(run.promptId);
          return { key, runId: run.id, status: run.status, progress: null, ...saved };
        }
        const bytes = await comfy.download(output);
        const plannedAssetId = run.parameters.outputAssetId;
        const assetId =
          typeof plannedAssetId === "string" && plannedAssetId.startsWith("asset_")
            ? plannedAssetId
            : createTakeBoardId("asset");
        const extension = extname(output.filename) || (expectsImage ? ".png" : ".mp4");
        const storagePath = `renders/${run.shotId}/${run.id}/${assetId}${extension}`;
        await mkdir(dirname(join(directory, storagePath)), { recursive: true });
        await writeFile(join(directory, storagePath), bytes, { mode: 0o600 });
        const normalizedExtension = extension.toLowerCase();
        const mimeType = expectsImage
          ? normalizedExtension === ".webp"
            ? "image/webp"
            : normalizedExtension === ".jpg" || normalizedExtension === ".jpeg"
              ? "image/jpeg"
              : "image/png"
          : normalizedExtension === ".webm"
            ? "video/webm"
            : "video/mp4";
        const imageInfo = expectsImage ? inspectImage(bytes, mimeType) : null;
        const videoInfo = expectsImage ? null : inspectVideo(bytes, mimeType);
        const proxyStoragePath = expectsImage ? `assets/proxies/${assetId}.jpg` : null;
        const proxyPath =
          proxyStoragePath &&
          (await createImageProxy(join(directory, storagePath), join(directory, proxyStoragePath)))
            ? proxyStoragePath
            : null;
        if (!current.snapshot.assets.some((asset) => asset.id === assetId)) {
          current.snapshot.assets.push({
            id: assetId,
            projectId: current.snapshot.project.id,
            mediaType: expectsImage ? "image" : "video",
            originalName: basename(output.filename).slice(0, 512),
            mimeType,
            byteSize: bytes.byteLength,
            sha256: sha256(bytes),
            storagePath,
            proxyPath,
            width: imageInfo?.width ?? videoInfo?.width ?? null,
            height: imageInfo?.height ?? videoInfo?.height ?? null,
            durationSeconds: videoInfo?.durationSeconds ?? null,
            frameRate: videoInfo?.frameRate ?? null,
            metadataInspectedAt: expectsImage ? null : timestamp,
            metadataInspectionError:
              !expectsImage && !videoInfo ? "当前视频封装未提供可读取的轨道信息" : null,
            customTags: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        const plannedTakeId = run.parameters.outputTakeId;
        const takeId =
          typeof plannedTakeId === "string" && plannedTakeId.startsWith("take_")
            ? plannedTakeId
            : createTakeBoardId("take");
        if (!current.snapshot.takes.some((take) => take.id === takeId)) {
          current.snapshot.takes.push({
            id: takeId,
            runId: run.id,
            shotId: run.shotId,
            assetId,
            status: "candidate",
            rejectionReasons: [],
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
        run.status = "completed";
        run.updatedAt = timestamp;
        const shot = current.snapshot.shots.find((item) => item.id === run.shotId);
        if (shot) {
          if (
            !current.snapshot.canvasItems.some(
              (item) => item.refType === "take_stack" && item.refId === shot.id,
            )
          ) {
            const stackPosition = takeStackPosition(current.snapshot, shot.id);
            current.snapshot.canvasItems.push({
              id: createTakeBoardId("canvas_item"),
              sceneId: shot.sceneId,
              refType: "take_stack",
              refId: shot.id,
              x: stackPosition.x,
              y: stackPosition.y,
              width: 280,
              height: 190,
              zIndex: 2,
              parentGroupId: null,
              collapsed: false,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }
        }
        refreshShotStatus(current.snapshot, run.shotId, timestamp);
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "run.completed",
          payload: { runId: run.id, takeId, assetId },
        });
        await Promise.allSettled([
          comfy.deleteHistory(run.promptId),
          cleanupComfyRunFiles(storage, current.snapshot.project.id, run.shotId, run.id),
        ]);
        comfy.forgetProgress(run.promptId);
        return { key, runId: run.id, status: run.status, progress: null, ...saved };
      } finally {
        store.close();
      }
    },
  );
}
