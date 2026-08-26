import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type { ProjectSnapshot } from "@takeboard/contracts";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import {
  buildLtx23I2VPrompt,
  buildMiniMaxH3Prompt,
  buildQwenImage2512Prompt,
  buildWan22FirstLastPrompt,
  buildWan22I2VPrompt,
  ComfyClient,
  type ComfyPrompt,
  miniMaxH3Resolution,
  qwenImage2512Resolution,
} from "@takeboard/executor-comfy";
import type { FastifyInstance } from "fastify";
import { createImageProxy, inspectImage } from "./asset-inspection.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";

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
  const comfy = new ComfyClient(comfyUrl);

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
    if (kind === "image") {
      try {
        imageInfo = inspectImage(bytes, upload.mimetype);
      } catch (error) {
        return await reply.code(422).send({
          error: error instanceof Error ? error.message : "图片文件无效",
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
      const canvasSize = importedImageNodeSize(imageInfo);
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
        width: imageInfo?.width ?? null,
        height: imageInfo?.height ?? null,
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
        let resourcesReleased = false;
        for (let attempt = 0; attempt < 8 && !resourcesReleased; attempt += 1) {
          resourcesReleased = await comfy.freeResourcesIfIdle().catch(() => false);
          if (!resourcesReleased) await new Promise((resolve) => setTimeout(resolve, 500));
        }
        await Promise.allSettled([
          ...(run.promptId ? [comfy.deleteHistory(run.promptId)] : []),
          cleanupComfyRunFiles(storage, current.snapshot.project.id, run.shotId, run.id),
        ]);
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
        const wanFirstLast = recipePath.endsWith("Kino_Wan22_FLF2V.json");
        const wanImage = recipePath.endsWith("Kino_Wan22_I2V.json");
        const miniMaxText = recipePath.endsWith("Kino_MinimaxH3_T2V.json");
        const miniMaxImage = recipePath.endsWith("Kino_MinimaxH3_I2V.json");
        const miniMax = miniMaxText || miniMaxImage;
        const ltxImage = recipePath.endsWith("Kino_LTX23_I2V_Draft.json");
        const qwenText = recipePath.endsWith("Kino_QwenImage2512_T2I.json");
        const qwenImage = recipePath.endsWith("Kino_QwenImage2512_I2I.json");
        const qwen = qwenText || qwenImage;
        if (!wanImage && !wanFirstLast && !miniMax && !ltxImage && !qwen) {
          return await reply.code(422).send({
            error:
              "该 Workflow 已检测，但尚未映射为 TakeBoard 原生 Recipe；请进入 ComfyUI 编辑或运行",
          });
        }
        const timestamp = toIsoTimestamp();
        const milliseconds = Date.now();
        const runId = createTakeBoardId("run", milliseconds);
        preparedRunId = runId;
        preparedProjectId = current.snapshot.project.id;
        preparedShotId = shot.id;
        const requestedAssetId =
          typeof body.firstFrameAssetId === "string" ? body.firstFrameAssetId : null;
        const requiresInputImage =
          wanImage || wanFirstLast || miniMaxImage || ltxImage || qwenImage;
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
        const lastAsset =
          (wanFirstLast || miniMaxImage) && requestedLastAssetId
            ? current.snapshot.assets.find((asset) => asset.id === requestedLastAssetId)
            : null;
        if (wanFirstLast && lastAsset?.mediaType !== "image") {
          return await reply.code(409).send({ error: "首尾帧模式需要选择一张可用的结束帧图片" });
        }
        if (lastAsset && lastAsset.mediaType !== "image") {
          return await reply.code(409).send({ error: "选择的结束帧不是可用图片" });
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
        const fps =
          typeof body.fps === "number" && body.fps >= 8 && body.fps <= 60
            ? Math.round(body.fps)
            : miniMax
              ? 24
              : ltxImage
                ? 25
                : 16;
        const steps =
          typeof body.steps === "number" &&
          Number.isSafeInteger(body.steps) &&
          body.steps >= 1 &&
          body.steps <= 100
            ? body.steps
            : miniMax
              ? 20
              : qwen
                ? 50
                : 4;
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
        const filenamePrefix = `takeboard/${current.snapshot.project.id}/${shot.id}/${runId}/result`;
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
        if (qwen) {
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
        } else if (miniMax) {
          effectiveSize = miniMaxH3Resolution(width, height);
          prompt = buildMiniMaxH3Prompt({
            ...recipeInput,
            ...(comfyImage ? { firstImage: comfyImage } : {}),
            ...(lastComfyImage ? { lastImage: lastComfyImage } : {}),
            steps,
          });
        } else if (ltxImage && comfyImage) {
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
          });
        } else if (comfyImage) {
          prompt = buildWan22I2VPrompt({ ...recipeInput, image: comfyImage });
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
        const recipeVersion = miniMax
          ? "minimax-h3@1"
          : qwenImage
            ? "qwen-image-2512-i2i@1"
            : qwenText
              ? "qwen-image-2512-t2i@1"
              : ltxImage
                ? "ltx23-i2v-draft@1"
                : wanFirstLast
                  ? "wan22-flf2v@1"
                  : "wan22-i2v-turbo@1";
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
          ],
          parameters: {
            seed,
            width: effectiveSize.width,
            height: effectiveSize.height,
            ...(qwen ? {} : { durationSeconds, fps }),
            ...(ltxImage ? {} : { steps }),
            ...(qwenImage ? { denoise } : {}),
            recipePath,
            prompt: positivePrompt,
            negativePrompt: negativePrompt ?? null,
            comfyInputFiles: [comfyImage, lastComfyImage].filter((value): value is string =>
              Boolean(value),
            ),
            comfyOutputDirectory: `takeboard/${current.snapshot.project.id}/${shot.id}/${runId}`,
            outputAssetId,
            outputTakeId,
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
        const promptId = await comfy.submit(prompt);
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
          },
        });
        return await reply.code(202).send({ key, runId, promptId, ...saved });
      } catch (error) {
        let remoteCancellationConfirmed = submittedPromptId === null && !submissionStarted;
        if (submittedPromptId) {
          remoteCancellationConfirmed = await comfy.cancel(submittedPromptId).catch(() => false);
          await comfy.deleteHistory(submittedPromptId).catch(() => undefined);
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
          return { key, runId: run.id, status: run.status, ...current };
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
        if (!history) return { key, runId: run.id, status: run.status, ...current };
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
          return { key, runId: run.id, status: run.status, ...saved };
        }

        const outputs = Object.values(history.outputs ?? {});
        const expectsImage = run.recipeVersion.startsWith("qwen-image-2512-");
        const videoOutput = outputs.flatMap((item) => [
          ...(item.videos ?? []),
          ...(item.images ?? []).filter((file) => /\.(?:mp4|webm)$/i.test(file.filename)),
        ])[0];
        const imageOutput = outputs
          .flatMap((item) => item.images ?? [])
          .find((file) => /\.(?:png|jpe?g|webp)$/i.test(file.filename));
        const output = expectsImage ? imageOutput : videoOutput;
        if (!output) {
          if (!history.status?.completed) {
            return { key, runId: run.id, status: run.status, ...current };
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
          return { key, runId: run.id, status: run.status, ...saved };
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
            width: imageInfo?.width ?? null,
            height: imageInfo?.height ?? null,
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
            current.snapshot.canvasItems.push({
              id: createTakeBoardId("canvas_item"),
              sceneId: shot.sceneId,
              refType: "take_stack",
              refId: shot.id,
              x: 560,
              y: 180,
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
        return { key, runId: run.id, status: run.status, ...saved };
      } finally {
        store.close();
      }
    },
  );
}
