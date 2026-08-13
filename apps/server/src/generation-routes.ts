import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import { buildWan22I2VPrompt, ComfyClient } from "@takeboard/executor-comfy";
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

  app.post<{ Params: { key: string } }>("/api/projects/:key/assets", async (request, reply) => {
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
      const scene = current.snapshot.scenes[0];
      if (scene) {
        current.snapshot.canvasItems.push({
          id: createTakeBoardId("canvas_item", milliseconds),
          sceneId: scene.id,
          refType: "asset",
          refId: assetId,
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
        payload: { assetId, mediaType: kind },
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
        const inputAsset = [...current.snapshot.assets]
          .reverse()
          .find((asset) => asset.mediaType === "image");
        if (!inputAsset) return await reply.code(409).send({ error: "请先上传一张首帧图片" });

        const bytes = await readFile(join(directory, inputAsset.storagePath));
        const extension = extname(inputAsset.originalName) || ".png";
        const comfyImage = await comfy.uploadImage(
          new Uint8Array(bytes),
          `takeboard_${current.snapshot.project.id}_${inputAsset.id}${extension}`,
          inputAsset.mimeType,
        );
        const seed = Math.floor(Math.random() * 2_147_483_647);
        const size = resolution(shot.aspectRatio);
        const prompt = buildWan22I2VPrompt({
          image: comfyImage,
          positivePrompt: shot.intent,
          width: size.width,
          height: size.height,
          durationSeconds: shot.durationSeconds,
          seed,
          filenamePrefix: `takeboard/${current.snapshot.project.id}/${shot.id}`,
        });
        const promptId = await comfy.submit(prompt);
        const timestamp = toIsoTimestamp();
        const milliseconds = Date.now();
        const runId = createTakeBoardId("run", milliseconds);
        current.snapshot.runs.push({
          id: runId,
          shotId: shot.id,
          recipeId: createTakeBoardId("recipe", milliseconds),
          recipeVersion: "wan22-i2v-turbo@1",
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
          ],
          parameters: { seed, ...size, durationSeconds: shot.durationSeconds, fps: 16 },
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
          payload: { runId, promptId, recipe: "wan22-i2v-turbo@1" },
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
