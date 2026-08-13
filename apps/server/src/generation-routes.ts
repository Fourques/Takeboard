import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import {
  buildWan22FirstLastPrompt,
  buildWan22I2VPrompt,
  ComfyClient,
} from "@takeboard/executor-comfy";
import type { FastifyInstance } from "fastify";
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

export function registerGenerationRoutes(
  app: FastifyInstance,
  projectsRoot: string,
  comfyUrl: string,
) {
  const root = resolve(projectsRoot);
  const comfy = new ComfyClient(comfyUrl);

  app.post<{
    Params: { key: string };
    Querystring: { kind?: string; name?: string };
  }>("/api/projects/:key/assets", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const upload = await request.file();
    if (!upload) return await reply.code(400).send({ error: "请选择素材文件" });
    const kind = mediaType(upload.mimetype);
    if (!kind) return await reply.code(415).send({ error: "仅支持图片、视频和音频素材" });
    const bytes = await upload.toBuffer();
    const timestamp = toIsoTimestamp();
    const milliseconds = Date.now();
    const assetId = createTakeBoardId("asset", milliseconds);
    const entityKind = ["character", "location", "prop"].includes(request.query.kind ?? "")
      ? (request.query.kind as "character" | "location" | "prop")
      : null;
    const entityId = entityKind ? createTakeBoardId("entity", milliseconds) : null;
    const safeExtension = extname(basename(upload.filename)).toLowerCase().slice(0, 12);
    const storagePath = `assets/originals/${assetId}${safeExtension}`;
    const directory = join(root, key);
    const store = await ProjectStore.open(directory);
    try {
      const current = store.loadCurrent();
      if (!current) return await reply.code(404).send({ error: "项目不存在" });
      await writeFile(join(directory, storagePath), bytes, { mode: 0o600 });
      current.snapshot.assets.push({
        id: assetId,
        projectId: current.snapshot.project.id,
        mediaType: kind,
        originalName: basename(upload.filename).slice(0, 512),
        mimeType: upload.mimetype,
        byteSize: bytes.byteLength,
        sha256: sha256(bytes),
        storagePath,
        proxyPath: null,
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
      if (scene) {
        current.snapshot.canvasItems.push({
          id: createTakeBoardId("canvas_item", milliseconds),
          sceneId: scene.id,
          refType: entityId ? "entity" : "asset",
          refId: entityId ?? assetId,
          x: -170,
          y: 180 + Math.max(0, current.snapshot.assets.length - 1) * 190,
          width: 250,
          height: 160,
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
        payload: { assetId, mediaType: kind, entityId, entityKind },
      });
      return await reply.code(201).send({ key, ...saved });
    } finally {
      store.close();
    }
  });

  app.get<{ Params: { key: string; assetId: string } }>(
    "/api/projects/:key/assets/:assetId/content",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const directory = join(root, key);
      const store = await ProjectStore.open(directory);
      try {
        const current = store.loadCurrent();
        const asset = current?.snapshot.assets.find((item) => item.id === request.params.assetId);
        if (!asset) return await reply.code(404).send({ error: "素材不存在" });
        const bytes = await readFile(join(directory, asset.storagePath));
        return await reply.type(asset.mimeType).send(bytes);
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
      const store = await ProjectStore.open(directory);
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        const shot = current.snapshot.shots.find((item) => item.id === request.params.shotId);
        if (!shot) return await reply.code(404).send({ error: "镜头不存在" });
        const body =
          typeof request.body === "object" && request.body !== null
            ? (request.body as Record<string, unknown>)
            : {};
        const requestedAssetId =
          typeof body.firstFrameAssetId === "string" ? body.firstFrameAssetId : null;
        const inputAsset = requestedAssetId
          ? current.snapshot.assets.find((asset) => asset.id === requestedAssetId)
          : [...current.snapshot.assets].reverse().find((asset) => asset.mediaType === "image");
        if (!inputAsset) return await reply.code(409).send({ error: "请先上传一张首帧图片" });

        const bytes = await readFile(join(directory, inputAsset.storagePath));
        const extension = extname(inputAsset.originalName) || ".png";
        const comfyImage = await comfy.uploadImage(
          new Uint8Array(bytes),
          `takeboard_${current.snapshot.project.id}_${inputAsset.id}${extension}`,
          inputAsset.mimeType,
        );
        const recipePath =
          typeof body.recipePath === "string" ? body.recipePath : "Kino/Kino_Wan22_I2V.json";
        const firstLast = recipePath.endsWith("Kino_Wan22_FLF2V.json");
        if (!recipePath.endsWith("Kino_Wan22_I2V.json") && !firstLast) {
          return await reply.code(422).send({
            error:
              "该 Workflow 已检测，但尚未映射为 TakeBoard 原生 Recipe；请进入 ComfyUI 编辑或运行",
          });
        }
        const requestedLastAssetId =
          typeof body.lastFrameAssetId === "string" ? body.lastFrameAssetId : null;
        const lastAsset = requestedLastAssetId
          ? current.snapshot.assets.find((asset) => asset.id === requestedLastAssetId)
          : null;
        if (firstLast && !lastAsset) {
          return await reply.code(409).send({ error: "首尾帧模式需要选择结束帧" });
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
            : 16;
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
            `takeboard_${current.snapshot.project.id}_${lastAsset.id}${extname(lastAsset.originalName) || ".png"}`,
            lastAsset.mimeType,
          );
        }
        const recipeInput = {
          image: comfyImage,
          positivePrompt,
          ...(negativePrompt ? { negativePrompt } : {}),
          width,
          height,
          durationSeconds,
          fps,
          seed,
          filenamePrefix: `takeboard/${current.snapshot.project.id}/${shot.id}`,
        };
        const prompt =
          firstLast && lastComfyImage
            ? buildWan22FirstLastPrompt({ ...recipeInput, lastImage: lastComfyImage })
            : buildWan22I2VPrompt(recipeInput);
        const promptId = await comfy.submit(prompt);
        const timestamp = toIsoTimestamp();
        const milliseconds = Date.now();
        const runId = createTakeBoardId("run", milliseconds);
        current.snapshot.runs.push({
          id: runId,
          shotId: shot.id,
          recipeId: createTakeBoardId("recipe", milliseconds),
          recipeVersion: firstLast ? "wan22-flf2v@1" : "wan22-i2v-turbo@1",
          workflowSha256: sha256(JSON.stringify(prompt)),
          workerId: createTakeBoardId("worker", milliseconds),
          promptId,
          status: "running",
          inputs: [
            {
              slot: "start_image",
              refType: "asset",
              refId: inputAsset.id,
              assetSha256: inputAsset.sha256,
            },
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
            width,
            height,
            durationSeconds,
            fps,
            recipePath,
            prompt: positivePrompt,
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
        const saved = await store.save(current.snapshot, {
          type: "run.submitted",
          payload: {
            runId,
            promptId,
            recipe: firstLast ? "wan22-flf2v@1" : "wan22-i2v-turbo@1",
          },
        });
        return await reply.code(202).send({ key, runId, promptId, ...saved });
      } catch (error) {
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
      const store = await ProjectStore.open(directory);
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        const run = current.snapshot.runs.find((item) => item.id === request.params.runId);
        if (!run?.promptId) return await reply.code(404).send({ error: "运行记录不存在" });
        if (run.status === "completed" || run.status === "failed") {
          return { key, runId: run.id, status: run.status, ...current };
        }

        const history = await comfy.history(run.promptId);
        if (!history) return { key, runId: run.id, status: run.status, ...current };
        const timestamp = toIsoTimestamp();
        if (history.status?.status_str === "error") {
          run.status = "failed";
          run.errorCode = "COMFY_EXECUTION_ERROR";
          run.errorMessage = "ComfyUI 执行失败，请检查工作站日志";
          run.updatedAt = timestamp;
          const shot = current.snapshot.shots.find((item) => item.id === run.shotId);
          if (shot) shot.status = "draft";
          const saved = await store.save(current.snapshot, {
            type: "run.failed",
            payload: { runId: run.id },
          });
          return { key, runId: run.id, status: run.status, ...saved };
        }

        const output = Object.values(history.outputs ?? {}).flatMap(
          (item) => item.videos ?? item.images ?? [],
        )[0];
        if (!output) return { key, runId: run.id, status: run.status, ...current };
        const bytes = await comfy.download(output);
        const assetId = createTakeBoardId("asset");
        const extension = extname(output.filename) || ".mp4";
        const storagePath = `renders/${assetId}${extension}`;
        await writeFile(join(directory, storagePath), bytes, { mode: 0o600 });
        const mimeType = extension.toLowerCase() === ".webm" ? "video/webm" : "video/mp4";
        current.snapshot.assets.push({
          id: assetId,
          projectId: current.snapshot.project.id,
          mediaType: "video",
          originalName: output.filename,
          mimeType,
          byteSize: bytes.byteLength,
          sha256: sha256(bytes),
          storagePath,
          proxyPath: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        const takeId = createTakeBoardId("take");
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
        run.status = "completed";
        run.updatedAt = timestamp;
        const shot = current.snapshot.shots.find((item) => item.id === run.shotId);
        if (shot) {
          shot.status = "review";
          shot.updatedAt = timestamp;
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
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "run.completed",
          payload: { runId: run.id, takeId, assetId },
        });
        return { key, runId: run.id, status: run.status, ...saved };
      } finally {
        store.close();
      }
    },
  );
}
