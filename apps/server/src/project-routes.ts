import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { AspectRatio, ProjectSnapshot } from "@takeboard/contracts";
import { approveTake, createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import { ComfyClient } from "@takeboard/executor-comfy";
import type { FastifyInstance } from "fastify";
import { authContext } from "./auth-routes.js";
import type { AuthService } from "./auth-service.js";
import {
  createProjectArchive,
  findActiveProjectById,
  importProjectArchive,
  ProjectArchiveError,
} from "./project-archive.js";
import { ProjectService } from "./project-service.js";
import { ProjectStore } from "./storage/project-store.js";

const allowedRatios = new Set<AspectRatio>(["9:16", "16:9", "1:1", "4:5", "2.35:1"]);

function canvasItemLabel(snapshot: ProjectSnapshot, item: { refType: string; refId: string }) {
  if (item.refType === "text") {
    return snapshot.textItems.find((candidate) => candidate.id === item.refId)?.title || "文字";
  }
  if (item.refType === "entity") {
    return snapshot.entities.find((candidate) => candidate.id === item.refId)?.name || "实体";
  }
  if (item.refType === "asset") {
    return snapshot.assets.find((candidate) => candidate.id === item.refId)?.originalName || "素材";
  }
  const shot = snapshot.shots.find((candidate) => candidate.id === item.refId);
  return shot?.label || (item.refType === "take_stack" ? "生成结果" : "镜头");
}

function canvasSourceAssetId(
  snapshot: ProjectSnapshot,
  source: ProjectSnapshot["canvasItems"][number],
  mediaType: "image" | "video" | "audio",
) {
  if (source.refType === "asset") return source.refId;
  if (source.refType === "entity") {
    return snapshot.entities
      .find((entity) => entity.id === source.refId)
      ?.referenceAssetIds.find((assetId) =>
        snapshot.assets.some((asset) => asset.id === assetId && asset.mediaType === mediaType),
      );
  }
  if (source.refType === "shot") {
    const shot = snapshot.shots.find((candidate) => candidate.id === source.refId);
    const take =
      snapshot.takes.find((candidate) => candidate.id === shot?.approvedTakeId) ??
      [...snapshot.takes]
        .reverse()
        .find((candidate) => candidate.shotId === source.refId && candidate.status !== "rejected");
    return snapshot.assets.some(
      (asset) => asset.id === take?.assetId && asset.mediaType === mediaType,
    )
      ? take?.assetId
      : undefined;
  }
  return undefined;
}

export function projectKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,80}\.takeboard$/.test(value)) {
    return null;
  }
  return basename(value) === value ? value : null;
}

function slugify(value: string) {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "project";
}

function trashEntryKey(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 180 || !/^[a-z0-9][a-z0-9.-]+$/.test(value)) {
    return null;
  }
  return basename(value) === value ? value : null;
}

function originalKeyFromTrashEntry(value: string) {
  const marker = value.lastIndexOf(".takeboard.");
  if (marker < 0) return null;
  return projectKey(value.slice(0, marker + ".takeboard".length));
}

type ProjectRouteOptions = {
  comfyUrl: string;
  comfyInputRoot: string | null;
  comfyOutputRoot: string | null;
  auth: AuthService;
};

const terminalProjectRunStatuses = new Set(["completed", "failed", "cancelled"]);
const projectPackageUploadLimit = (() => {
  const configured = Number.parseInt(process.env.TAKEBOARD_PROJECT_PACKAGE_MAX_BYTES ?? "", 10);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : 1024 * 1024 * 1024 * 1024;
})();

function refreshProjectShotStatus(snapshot: ProjectSnapshot, shotId: string, timestamp: string) {
  const shot = snapshot.shots.find((item) => item.id === shotId);
  if (!shot) return;
  const hasActiveRun = snapshot.runs.some(
    (run) => run.shotId === shotId && !terminalProjectRunStatuses.has(run.status),
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

function safeChild(root: string, relativePath: string) {
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, relativePath);
  return target.startsWith(`${normalizedRoot}${sep}`) ? target : null;
}

async function cleanupDeletedProjectRun(
  run: ProjectSnapshot["runs"][number],
  options: ProjectRouteOptions,
) {
  const inputFiles = Array.isArray(run.parameters.comfyInputFiles)
    ? run.parameters.comfyInputFiles.filter((value): value is string => typeof value === "string")
    : [];
  const outputDirectory = run.parameters.comfyOutputDirectory;
  await Promise.allSettled([
    ...inputFiles.flatMap((file) => {
      const target = options.comfyInputRoot ? safeChild(options.comfyInputRoot, file) : null;
      return target ? [unlink(target)] : [];
    }),
    ...(options.comfyOutputRoot && typeof outputDirectory === "string"
      ? (() => {
          const target = safeChild(options.comfyOutputRoot, outputDirectory);
          return target ? [rm(target, { recursive: true, force: true })] : [];
        })()
      : []),
  ]);
}

export function registerProjectRoutes(
  app: FastifyInstance,
  projectsRoot: string,
  options: ProjectRouteOptions,
) {
  const root = resolve(projectsRoot);
  const service = new ProjectService();
  const comfy = new ComfyClient(options.comfyUrl, { liveProgress: false });

  app.get("/api/projects/trash", async (request) => {
    const context = authContext(request);
    const trashRoot = join(root, ".trash");
    await mkdir(trashRoot, { recursive: true });
    const entries = await readdir(trashRoot, { withFileTypes: true });
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && trashEntryKey(entry.name))
        .map(async (entry) => {
          const originalKey = originalKeyFromTrashEntry(entry.name);
          if (!originalKey) return null;
          const directory = join(trashRoot, entry.name);
          const opened = await service.open(directory).catch(() => null);
          if (!opened) return null;
          if (
            context &&
            !options.auth.hasProjectRole(
              opened.snapshot.project.id,
              context.user.id,
              "owner",
              context.user.instanceRole,
            )
          ) {
            return null;
          }
          const information = await stat(directory).catch(() => null);
          return {
            trashKey: entry.name,
            originalKey,
            title: opened.snapshot.project.title,
            shotCount: opened.snapshot.shots.length,
            deletedAt: information?.mtime.toISOString() ?? opened.snapshot.project.updatedAt,
          };
        }),
    );
    return {
      projects: projects
        .filter((project) => project !== null)
        .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)),
    };
  });

  app.post<{ Params: { trashKey: string } }>(
    "/api/projects/trash/:trashKey/restore",
    async (request, reply) => {
      const archiveKey = trashEntryKey(request.params.trashKey);
      if (!archiveKey) return await reply.code(400).send({ error: "回收区项目标识无效" });
      const originalKey = originalKeyFromTrashEntry(archiveKey);
      if (!originalKey) return await reply.code(400).send({ error: "无法识别项目原始位置" });
      const source = join(root, ".trash", archiveKey);
      const store = ProjectStore.openExisting(source);
      if (!store) return await reply.code(404).send({ error: "回收区项目不存在" });
      let title = "恢复的项目";
      let projectId = "";
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "回收区项目无法读取" });
        title = current.snapshot.project.title;
        projectId = current.snapshot.project.id;
        const context = authContext(request);
        if (
          context &&
          !options.auth.hasProjectRole(
            projectId,
            context.user.id,
            "owner",
            context.user.instanceRole,
          )
        ) {
          return await reply.code(403).send({ error: "只有项目 Owner 可以恢复此项目" });
        }
        const duplicateKey = await findActiveProjectById(root, projectId);
        if (duplicateKey) {
          return await reply.code(409).send({
            error: `同一项目已经以“${duplicateKey}”存在；请保留当前项目，或先删除它再恢复回收区版本`,
            duplicateKey,
            projectId,
          });
        }
        const timestamp = toIsoTimestamp();
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        await store.save(current.snapshot, { type: "project.restored", payload: { archiveKey } });
      } finally {
        store.close();
      }
      const restoredKey = existsSync(join(root, originalKey))
        ? `${slugify(title)}-restored-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.takeboard`
        : originalKey;
      await rename(source, join(root, restoredKey));
      return { restored: true as const, key: restoredKey, title };
    },
  );

  app.get("/api/projects", async (request) => {
    const context = authContext(request);
    const accessible = context
      ? options.auth.accessibleProjectIds(context.user.id, context.user.instanceRole)
      : null;
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && projectKey(entry.name))
        .map(async (entry) => {
          const opened = await service.open(join(root, entry.name));
          if (opened && accessible && !accessible.has(opened.snapshot.project.id)) return null;
          return opened
            ? {
                key: entry.name,
                revision: opened.revision,
                id: opened.snapshot.project.id,
                title: opened.snapshot.project.title,
                aspectRatio: (() => {
                  const ratios = new Set(opened.snapshot.shots.map((shot) => shot.aspectRatio));
                  if (ratios.size === 0) return "自由画布";
                  if (ratios.size > 1) return "多画幅";
                  return [...ratios][0];
                })(),
                sceneCount: opened.snapshot.scenes.length,
                shotCount: opened.snapshot.shots.length,
                activeRunCount: opened.snapshot.runs.filter(
                  (run) => !terminalProjectRunStatuses.has(run.status),
                ).length,
                updatedAt: opened.snapshot.project.updatedAt,
                role: context
                  ? context.user.instanceRole === "admin"
                    ? "owner"
                    : options.auth.projectRole(opened.snapshot.project.id, context.user.id)
                  : "owner",
                membershipRole: context
                  ? options.auth.projectRole(opened.snapshot.project.id, context.user.id)
                  : "owner",
                accessSource:
                  context?.user.instanceRole === "admin" ? "instance_admin" : "membership",
                boards: opened.snapshot.scenes.slice(0, 8).map((scene) => {
                  const items = opened.snapshot.canvasItems
                    .filter((item) => item.sceneId === scene.id)
                    .sort((left, right) => left.zIndex - right.zIndex);
                  const nodes = items.slice(0, 16).map((item) => ({
                    id: item.id,
                    refType: item.refType,
                    label: canvasItemLabel(opened.snapshot, item),
                    x: item.x,
                    y: item.y,
                    width: item.width,
                    height: item.height,
                  }));
                  const nodeIds = new Set(nodes.map((node) => node.id));
                  return {
                    sceneId: scene.id,
                    label: scene.label,
                    title: scene.title,
                    itemCount: items.length,
                    nodes,
                    edges: opened.snapshot.canvasEdges
                      .filter(
                        (edge) =>
                          edge.sceneId === scene.id &&
                          nodeIds.has(edge.sourceItemId) &&
                          nodeIds.has(edge.targetItemId),
                      )
                      .map((edge) => ({
                        sourceItemId: edge.sourceItemId,
                        targetItemId: edge.targetItemId,
                      })),
                  };
                }),
              }
            : null;
        }),
    );
    return {
      projects: projects
        .filter((project) => project !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  });

  app.post("/api/projects/import", async (request, reply) => {
    await mkdir(join(root, ".imports"), { recursive: true, mode: 0o700 });
    const uploadPath = join(root, ".imports", `upload-${randomUUID()}.tgz`);
    try {
      const part = await request.file({
        limits: { fileSize: projectPackageUploadLimit, files: 1 },
      });
      if (!part) return await reply.code(400).send({ error: "请选择 TakeBoard 项目包" });
      await pipeline(part.file, createWriteStream(uploadPath, { flags: "wx", mode: 0o600 }));
      if (part.file.truncated) {
        return await reply.code(413).send({ error: "项目包超过当前服务允许的容量上限" });
      }
      const imported = await importProjectArchive(root, uploadPath);
      const context = authContext(request);
      if (context) options.auth.grantProjectOwner(imported.projectId, context.user.id);
      return await reply.code(201).send({
        imported: true as const,
        key: imported.key,
        title: imported.title,
        projectId: imported.projectId,
        revision: imported.revision,
      });
    } catch (error) {
      if (error instanceof ProjectArchiveError) {
        return await reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.warn({ error }, "project package import failed");
      return await reply.code(400).send({
        error: error instanceof Error ? `项目包导入失败：${error.message}` : "项目包导入失败",
      });
    } finally {
      await rm(uploadPath, { force: true });
    }
  });

  app.post("/api/projects", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const ratio = body.aspectRatio;
    if (!title || (ratio !== undefined && !allowedRatios.has(ratio as AspectRatio))) {
      return await reply.code(400).send({ error: !title ? "请输入项目名称" : "画幅无效" });
    }

    await mkdir(root, { recursive: true });
    const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const key = `${slugify(title)}-${suffix}.takeboard`;
    const created = await service.create({
      projectDirectory: join(root, key),
      title,
      defaultAspectRatio: (ratio as AspectRatio | undefined) ?? "16:9",
      // Older clients sent shot fields as part of project creation. Keep that
      // route compatible while the current UI starts with a genuinely blank board.
      createStarterShot:
        typeof ratio === "string" ||
        typeof body.sceneTitle === "string" ||
        typeof body.firstShotIntent === "string",
      ...(typeof body.sceneTitle === "string" ? { sceneTitle: body.sceneTitle } : {}),
      ...(typeof body.firstShotIntent === "string"
        ? { firstShotIntent: body.firstShotIntent }
        : {}),
    });
    const context = authContext(request);
    if (context) options.auth.grantProjectOwner(created.snapshot.project.id, context.user.id);
    return await reply.code(201).send({ key, ...created });
  });

  app.get<{ Params: { key: string } }>("/api/projects/:key/export", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const directory = join(root, key);
    const store = ProjectStore.openExisting(directory);
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    let current: ReturnType<ProjectStore["loadCurrent"]>;
    try {
      current = store.loadCurrent();
      if (!current) return await reply.code(404).send({ error: "项目不存在" });
      const activeRuns = current.snapshot.runs.filter(
        (run) => !terminalProjectRunStatuses.has(run.status),
      );
      if (activeRuns.length > 0) {
        return await reply.code(409).send({
          error: `项目仍有 ${activeRuns.length} 个生成任务未结束，请停止或等待完成后再导出`,
          activeRunIds: activeRuns.map((run) => run.id),
        });
      }
    } finally {
      store.close();
    }
    if (!current) return await reply.code(404).send({ error: "项目不存在" });
    const archive = await createProjectArchive(directory, {
      sourceKey: key,
      projectId: current.snapshot.project.id,
      title: current.snapshot.project.title,
      revision: current.revision,
    });
    const filename = `${current.snapshot.project.title || "TakeBoard-project"}.takeboard.tgz`;
    return await reply
      .header("content-type", "application/gzip")
      .header("cache-control", "no-store")
      .header(
        "content-disposition",
        `attachment; filename="takeboard-project.tgz"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      )
      .send(archive);
  });

  app.post<{ Params: { key: string } }>("/api/projects/:key/shots", async (request, reply) => {
    const key = projectKey(request.params.key);
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const ratio = typeof body.aspectRatio === "string" ? body.aspectRatio : "16:9";
    if (!key || !allowedRatios.has(ratio as AspectRatio)) {
      return await reply.code(400).send({ error: key ? "镜头画幅无效" : "项目标识无效" });
    }
    const store = ProjectStore.openExisting(join(root, key));
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    try {
      const current = store.loadCurrent();
      if (!current) return await reply.code(404).send({ error: "项目不存在" });
      const scene =
        (typeof body.sceneId === "string"
          ? current.snapshot.scenes.find((item) => item.id === body.sceneId)
          : undefined) ?? current.snapshot.scenes[0];
      if (!scene) return await reply.code(409).send({ error: "项目还没有可用画板" });
      const timestamp = toIsoTimestamp();
      const shotId = createTakeBoardId("shot");
      const itemId = createTakeBoardId("canvas_item");
      const order = current.snapshot.shots.filter((shot) => shot.sceneId === scene.id).length;
      current.snapshot.shots.push({
        id: shotId,
        projectId: current.snapshot.project.id,
        sceneId: scene.id,
        label:
          typeof body.label === "string" && body.label.trim()
            ? body.label.trim().slice(0, 80)
            : `SH-${String(order + 1).padStart(2, "0")}`,
        order,
        intent: typeof body.intent === "string" ? body.intent.slice(0, 20_000) : "",
        durationSeconds:
          typeof body.durationSeconds === "number" &&
          body.durationSeconds > 0 &&
          body.durationSeconds <= 300
            ? body.durationSeconds
            : 5,
        aspectRatio: ratio as AspectRatio,
        workflowPath: null,
        status: "draft",
        approvedTakeId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      current.snapshot.canvasItems.push({
        id: itemId,
        sceneId: scene.id,
        refType: "shot",
        refId: shotId,
        x: typeof body.x === "number" && Number.isFinite(body.x) ? body.x : 180 + order * 380,
        y: typeof body.y === "number" && Number.isFinite(body.y) ? body.y : 180,
        width: 330,
        height: 190,
        zIndex: Math.max(0, ...current.snapshot.canvasItems.map((item) => item.zIndex)) + 1,
        parentGroupId: null,
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      current.snapshot.project.updatedAt = timestamp;
      current.snapshot.exportedAt = timestamp;
      const saved = await store.save(current.snapshot, {
        type: "shot.created",
        payload: { shotId, itemId, sceneId: scene.id },
      });
      return await reply.code(201).send({ key, shotId, itemId, ...saved });
    } finally {
      store.close();
    }
  });

  app.delete<{ Params: { key: string; shotId: string } }>(
    "/api/projects/:key/shots/:shotId",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const shot = current?.snapshot.shots.find(
          (candidate) => candidate.id === request.params.shotId,
        );
        if (!current || !shot) return await reply.code(404).send({ error: "镜头不存在" });
        if (current.snapshot.runs.some((run) => run.shotId === shot.id)) {
          return await reply.code(409).send({
            error: "这个镜头已有生成记录。为保留成片与参数溯源，请先保留镜头或仅移除画布节点。",
          });
        }

        const removedItemIds = new Set(
          current.snapshot.canvasItems
            .filter(
              (item) =>
                item.refId === shot.id &&
                (item.refType === "shot" || item.refType === "take_stack"),
            )
            .map((item) => item.id),
        );
        const timestamp = toIsoTimestamp();
        current.snapshot.shots = current.snapshot.shots.filter(
          (candidate) => candidate.id !== shot.id,
        );
        current.snapshot.shots
          .filter((candidate) => candidate.sceneId === shot.sceneId)
          .sort((left, right) => left.order - right.order)
          .forEach((candidate, order) => {
            candidate.order = order;
            candidate.updatedAt = timestamp;
          });
        current.snapshot.canvasItems = current.snapshot.canvasItems.filter(
          (item) => !removedItemIds.has(item.id),
        );
        current.snapshot.canvasEdges = current.snapshot.canvasEdges.filter(
          (edge) =>
            !removedItemIds.has(edge.sourceItemId) && !removedItemIds.has(edge.targetItemId),
        );
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "shot.deleted",
          payload: { shotId: shot.id, removedItemIds: [...removedItemIds] },
        });
        return { key, removedShotId: shot.id, removedItemIds: [...removedItemIds], ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string } }>("/api/projects/:key/text-nodes", async (request, reply) => {
    const key = projectKey(request.params.key);
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const store = ProjectStore.openExisting(join(root, key));
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    try {
      const current = store.loadCurrent();
      const scene =
        current?.snapshot.scenes.find((item) => item.id === body.sceneId) ??
        current?.snapshot.scenes[0];
      if (!current || !scene) return await reply.code(409).send({ error: "项目还没有可用画板" });
      const timestamp = toIsoTimestamp();
      const textId = createTakeBoardId("text");
      const itemId = createTakeBoardId("canvas_item");
      current.snapshot.textItems.push({
        id: textId,
        projectId: current.snapshot.project.id,
        sceneId: scene.id,
        kind: "direction_note",
        title:
          typeof body.title === "string" && body.title.trim()
            ? body.title.trim().slice(0, 200)
            : "新笔记",
        body: typeof body.body === "string" ? body.body.slice(0, 100_000) : "",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      current.snapshot.canvasItems.push({
        id: itemId,
        sceneId: scene.id,
        refType: "text",
        refId: textId,
        x: typeof body.x === "number" && Number.isFinite(body.x) ? body.x : 180,
        y: typeof body.y === "number" && Number.isFinite(body.y) ? body.y : 180,
        width: 300,
        height: 180,
        zIndex: Math.max(0, ...current.snapshot.canvasItems.map((item) => item.zIndex)) + 1,
        parentGroupId: null,
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      current.snapshot.project.updatedAt = timestamp;
      current.snapshot.exportedAt = timestamp;
      const saved = await store.save(current.snapshot, {
        type: "canvas.text_created",
        payload: { textId, itemId },
      });
      return await reply.code(201).send({ key, textId, itemId, ...saved });
    } finally {
      store.close();
    }
  });

  app.get<{ Params: { key: string } }>("/api/projects/:key", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const opened = await service.open(join(root, key));
    if (!opened) return await reply.code(404).send({ error: "项目不存在" });
    return { key, ...opened };
  });

  app.get<{ Params: { key: string } }>("/api/projects/:key/sync", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const store = ProjectStore.openExisting(join(root, key));
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    try {
      const currentRevision = store.currentRevision();
      if (currentRevision === null) return await reply.code(404).send({ error: "项目不存在" });
      const etag = `"takeboard-r${currentRevision}"`;
      reply.header("etag", etag).header("cache-control", "no-store");
      if (request.headers["if-none-match"] === etag) return await reply.code(304).send();
      const current = store.loadCurrent();
      return current ? { key, ...current } : await reply.code(404).send({ error: "项目不存在" });
    } finally {
      store.close();
    }
  });

  app.patch<{ Params: { key: string } }>("/api/projects/:key", async (request, reply) => {
    const key = projectKey(request.params.key);
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!key || !title) return await reply.code(400).send({ error: "项目名称无效" });

    const store = ProjectStore.openExisting(join(root, key));
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    try {
      const current = store.loadCurrent();
      if (!current) return await reply.code(404).send({ error: "项目不存在" });
      const timestamp = toIsoTimestamp();
      current.snapshot.project.title = title;
      current.snapshot.project.updatedAt = timestamp;
      current.snapshot.exportedAt = timestamp;
      const saved = await store.save(current.snapshot, {
        type: "project.renamed",
        payload: { title },
      });
      return { key, ...saved };
    } finally {
      store.close();
    }
  });

  app.delete<{ Params: { key: string } }>("/api/projects/:key", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });

    const source = join(root, key);
    const store = ProjectStore.openExisting(source);
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    const current = store.loadCurrent();
    if (!current) {
      store.close();
      return await reply.code(404).send({ error: "项目不存在" });
    }
    const activeRuns = current.snapshot.runs.filter(
      (run) => !terminalProjectRunStatuses.has(run.status),
    );
    const cancellationResults = await Promise.all(
      activeRuns.map(async (run) => {
        if (!run.promptId) return { run, confirmed: true, error: null as string | null };
        try {
          let confirmed = await comfy.cancel(run.promptId);
          if (!confirmed) {
            const history = await comfy.history(run.promptId).catch(() => null);
            confirmed = Boolean(
              history?.status?.completed || history?.status?.status_str === "error",
            );
          }
          return { run, confirmed, error: null as string | null };
        } catch (error) {
          return {
            run,
            confirmed: false,
            error: error instanceof Error ? error.message : "执行端无法确认停止任务",
          };
        }
      }),
    );
    const timestamp = toIsoTimestamp();
    for (const result of cancellationResults) {
      result.run.status = result.confirmed ? "cancelled" : "orphaned";
      result.run.errorCode = result.confirmed ? null : "PROJECT_DELETE_CANCEL_UNCONFIRMED";
      result.run.errorMessage = result.confirmed
        ? null
        : result.error || "执行端没有确认任务已停止，项目仍保留";
      result.run.updatedAt = timestamp;
    }
    for (const shotId of new Set(activeRuns.map((run) => run.shotId))) {
      refreshProjectShotStatus(current.snapshot, shotId, timestamp);
    }
    if (activeRuns.length > 0) {
      current.snapshot.project.updatedAt = timestamp;
      current.snapshot.exportedAt = timestamp;
      await store.save(current.snapshot, {
        type: "project.delete_runs_cancelled",
        payload: {
          activeRuns: activeRuns.length,
          confirmed: cancellationResults.filter((result) => result.confirmed).length,
        },
      });
    }
    const unconfirmed = cancellationResults.filter((result) => !result.confirmed);
    if (unconfirmed.length > 0) {
      store.close();
      return await reply.code(409).send({
        error: `仍有 ${unconfirmed.length} 个生成任务未确认停止，项目没有删除。请恢复 ComfyUI 连接后重试。`,
        activeRunCount: activeRuns.length,
        stoppedRunCount: cancellationResults.length - unconfirmed.length,
        unconfirmedRunIds: unconfirmed.map((result) => result.run.id),
      });
    }
    store.close();

    await Promise.allSettled(
      cancellationResults.flatMap(({ run }) => [
        ...(run.promptId ? [comfy.deleteHistory(run.promptId)] : []),
        cleanupDeletedProjectRun(run, options),
      ]),
    );
    if (cancellationResults.length > 0) await comfy.freeResourcesIfIdle().catch(() => undefined);

    const trashRoot = join(root, ".trash");
    await mkdir(trashRoot, { recursive: true });
    const archivedName = `${key}.${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    await rename(source, join(trashRoot, archivedName));
    return {
      key,
      deleted: true as const,
      recoverable: true as const,
      stoppedRunCount: cancellationResults.length,
    };
  });

  app.post<{ Params: { key: string } }>(
    "/api/projects/:key/canvas-connections",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const targetSlot = body.targetSlot;
      if (
        !key ||
        typeof body.sourceItemId !== "string" ||
        typeof body.targetItemId !== "string" ||
        !["first_frame", "last_frame", "reference", "reference_video", "reference_audio"].includes(
          String(targetSlot),
        )
      ) {
        return await reply.code(400).send({ error: "连线参数无效" });
      }

      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        const source = current.snapshot.canvasItems.find((item) => item.id === body.sourceItemId);
        const target = current.snapshot.canvasItems.find((item) => item.id === body.targetItemId);
        if (
          !source ||
          !target ||
          source.sceneId !== target.sceneId ||
          !["asset", "entity", "shot"].includes(source.refType) ||
          source.id === target.id ||
          target.refType !== "shot"
        ) {
          return await reply.code(400).send({
            error: "图片、视频、实体或其他镜头的生成结果才能连接到镜头输入",
          });
        }

        const expectedMediaType =
          targetSlot === "reference_video"
            ? "video"
            : targetSlot === "reference_audio"
              ? "audio"
              : "image";
        const assetId = canvasSourceAssetId(current.snapshot, source, expectedMediaType);
        const asset = current.snapshot.assets.find(
          (candidate) => candidate.id === assetId && candidate.mediaType === expectedMediaType,
        );
        if (!asset) {
          return await reply.code(400).send({
            error: `该节点没有可用的${expectedMediaType === "video" ? "视频" : "图片"}素材`,
          });
        }

        const timestamp = toIsoTimestamp();
        const occupiedEdges = current.snapshot.canvasEdges.filter(
          (edge) => edge.targetItemId === target.id && edge.targetSlot === targetSlot,
        );
        const multipleSlot = ["reference", "reference_video", "reference_audio"].includes(
          String(targetSlot),
        );
        if (multipleSlot && occupiedEdges.some((edge) => edge.sourceItemId === source.id)) {
          return { key, revision: current.revision, snapshot: current.snapshot };
        }
        const capacity = targetSlot === "reference" ? 9 : 3;
        if (multipleSlot && occupiedEdges.length >= capacity) {
          return await reply.code(409).send({
            error:
              targetSlot === "reference_video"
                ? "这个工作流最多连接 3 段参考视频"
                : targetSlot === "reference_audio"
                  ? "这个工作流最多连接 3 段参考音频"
                  : "这个工作流最多连接 9 张参考图",
          });
        }
        if (!multipleSlot) {
          current.snapshot.canvasEdges = current.snapshot.canvasEdges.filter(
            (edge) =>
              edge.immutable || edge.targetItemId !== target.id || edge.targetSlot !== targetSlot,
          );
        }
        const targetSlotIndex = multipleSlot
          ? Math.max(-1, ...occupiedEdges.map((edge) => edge.targetSlotIndex)) + 1
          : 0;
        current.snapshot.canvasEdges.push({
          id: createTakeBoardId("canvas_edge"),
          sceneId: target.sceneId,
          sourceItemId: source.id,
          targetItemId: target.id,
          relation: "reference",
          targetSlot: targetSlot as
            | "first_frame"
            | "last_frame"
            | "reference"
            | "reference_video"
            | "reference_audio",
          targetSlotIndex,
          runId: null,
          immutable: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "canvas.input_connected",
          payload: { sourceItemId: source.id, targetItemId: target.id, targetSlot, assetId },
        });
        return { key, ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.delete<{ Params: { key: string } }>(
    "/api/projects/:key/canvas-connections",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const targetSlot = body.targetSlot;
      if (
        !key ||
        typeof body.sourceItemId !== "string" ||
        typeof body.targetItemId !== "string" ||
        (targetSlot !== null &&
          ![
            "first_frame",
            "last_frame",
            "reference",
            "reference_video",
            "reference_audio",
          ].includes(String(targetSlot)))
      ) {
        return await reply.code(400).send({ error: "连线参数无效" });
      }

      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const exactEdge = current?.snapshot.canvasEdges.find(
          (candidate) =>
            candidate.sourceItemId === body.sourceItemId &&
            candidate.targetItemId === body.targetItemId &&
            candidate.targetSlot === targetSlot,
        );
        const targetCandidates = current?.snapshot.canvasEdges.filter(
          (candidate) => !candidate.immutable && candidate.targetItemId === body.targetItemId,
        );
        const edge =
          exactEdge ?? (targetCandidates?.length === 1 ? targetCandidates[0] : undefined);
        if (!current || !edge) return await reply.code(404).send({ error: "连线不存在" });
        if (edge.immutable) {
          return await reply.code(409).send({ error: "生成溯源连线不能删除" });
        }
        current.snapshot.canvasEdges = current.snapshot.canvasEdges.filter(
          (candidate) => candidate.id !== edge.id,
        );
        const timestamp = toIsoTimestamp();
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "canvas.connection_removed",
          payload: { edgeId: edge.id, targetSlot: edge.targetSlot },
        });
        return { key, removedEdgeId: edge.id, ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.delete<{ Params: { key: string; edgeId: string } }>(
    "/api/projects/:key/canvas-connections/:edgeId",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const edge = current?.snapshot.canvasEdges.find(
          (candidate) => candidate.id === request.params.edgeId,
        );
        if (!current || !edge) return await reply.code(404).send({ error: "连线不存在" });
        if (edge.immutable) {
          return await reply.code(409).send({ error: "生成溯源连线不能删除" });
        }
        current.snapshot.canvasEdges = current.snapshot.canvasEdges.filter(
          (candidate) => candidate.id !== edge.id,
        );
        const timestamp = toIsoTimestamp();
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "canvas.connection_removed",
          payload: { edgeId: edge.id, targetSlot: edge.targetSlot },
        });
        return { key, removedEdgeId: edge.id, ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.patch<{ Params: { key: string } }>(
    "/api/projects/:key/canvas-position",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      if (
        !key ||
        typeof body.itemId !== "string" ||
        typeof body.x !== "number" ||
        !Number.isFinite(body.x) ||
        typeof body.y !== "number" ||
        !Number.isFinite(body.y)
      ) {
        return await reply.code(400).send({ error: "画布位置无效" });
      }

      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        const timestamp = toIsoTimestamp();
        const item = current.snapshot.canvasItems.find((candidate) => candidate.id === body.itemId);
        if (!item) return await reply.code(404).send({ error: "画布节点不存在" });
        item.x = body.x;
        item.y = body.y;
        item.updatedAt = timestamp;
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "canvas.item_moved",
          payload: { itemId: body.itemId },
        });
        return { key, ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string } }>(
    "/api/projects/:key/canvas-items",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const refType = body.refType;
      if (
        !key ||
        typeof body.refId !== "string" ||
        !["text", "entity", "asset", "shot", "take_stack"].includes(String(refType))
      ) {
        return await reply.code(400).send({ error: "节点来源无效" });
      }
      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        const sourceExists = {
          text: current.snapshot.textItems.some((item) => item.id === body.refId),
          entity: current.snapshot.entities.some((item) => item.id === body.refId),
          asset: current.snapshot.assets.some((item) => item.id === body.refId),
          shot: current.snapshot.shots.some((item) => item.id === body.refId),
          take_stack: current.snapshot.shots.some((item) => item.id === body.refId),
        }[refType as "text" | "entity" | "asset" | "shot" | "take_stack"];
        if (!sourceExists) return await reply.code(404).send({ error: "节点来源不存在" });
        const sourceShot = current.snapshot.shots.find((item) => item.id === body.refId);
        const sceneId =
          refType === "shot" || refType === "take_stack"
            ? sourceShot?.sceneId
            : typeof body.sceneId === "string"
              ? body.sceneId
              : current.snapshot.scenes[0]?.id;
        if (!sceneId || !current.snapshot.scenes.some((scene) => scene.id === sceneId)) {
          return await reply.code(400).send({ error: "节点场景无效" });
        }
        const timestamp = toIsoTimestamp();
        const itemId = createTakeBoardId("canvas_item");
        current.snapshot.canvasItems.push({
          id: itemId,
          sceneId,
          refType: refType as "text" | "entity" | "asset" | "shot" | "take_stack",
          refId: body.refId,
          x: typeof body.x === "number" && Number.isFinite(body.x) ? body.x : 180,
          y: typeof body.y === "number" && Number.isFinite(body.y) ? body.y : 180,
          width:
            typeof body.width === "number" && body.width >= 180 && body.width <= 1_000
              ? body.width
              : refType === "shot"
                ? 330
                : 280,
          height: refType === "shot" ? 190 : 180,
          zIndex: Math.max(0, ...current.snapshot.canvasItems.map((item) => item.zIndex)) + 1,
          parentGroupId: null,
          collapsed: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "canvas.item_added",
          payload: { itemId, refType, refId: body.refId },
        });
        return await reply.code(201).send({ key, itemId, ...saved });
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string; itemId: string } }>(
    "/api/projects/:key/canvas-items/:itemId/duplicate",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const source = current?.snapshot.canvasItems.find(
          (item) => item.id === request.params.itemId,
        );
        if (!current || !source) return await reply.code(404).send({ error: "画布节点不存在" });
        const timestamp = toIsoTimestamp();
        const itemId = createTakeBoardId("canvas_item");
        current.snapshot.canvasItems.push({
          ...source,
          id: itemId,
          x: typeof body.x === "number" && Number.isFinite(body.x) ? body.x : source.x + 36,
          y: typeof body.y === "number" && Number.isFinite(body.y) ? body.y : source.y + 36,
          zIndex: Math.max(0, ...current.snapshot.canvasItems.map((item) => item.zIndex)) + 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "canvas.item_duplicated",
          payload: { sourceItemId: source.id, itemId },
        });
        return await reply.code(201).send({ key, itemId, ...saved });
      } finally {
        store.close();
      }
    },
  );

  app.patch<{ Params: { key: string; itemId: string } }>(
    "/api/projects/:key/canvas-items/:itemId",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const item = current?.snapshot.canvasItems.find(
          (candidate) => candidate.id === request.params.itemId,
        );
        if (!current || !item) return await reply.code(404).send({ error: "画布节点不存在" });
        const timestamp = toIsoTimestamp();
        if (item.refType === "text") {
          const text = current.snapshot.textItems.find((candidate) => candidate.id === item.refId);
          if (!text) return await reply.code(404).send({ error: "文本不存在" });
          if (typeof body.title === "string") text.title = body.title.trim().slice(0, 200);
          if (typeof body.body === "string") text.body = body.body.slice(0, 100_000);
          text.updatedAt = timestamp;
        } else if (item.refType === "entity") {
          const entity = current.snapshot.entities.find((candidate) => candidate.id === item.refId);
          if (!entity) return await reply.code(404).send({ error: "实体不存在" });
          if (typeof body.title === "string" && body.title.trim()) {
            entity.name = body.title.trim().slice(0, 200);
          }
          if (typeof body.body === "string") entity.description = body.body.slice(0, 10_000);
          entity.updatedAt = timestamp;
        } else if (item.refType === "asset") {
          const asset = current.snapshot.assets.find((candidate) => candidate.id === item.refId);
          if (!asset) return await reply.code(404).send({ error: "素材不存在" });
          if (typeof body.title === "string" && body.title.trim()) {
            asset.originalName = body.title.trim().slice(0, 512);
          }
          if (Array.isArray(body.customTags)) {
            const customTags = [
              ...new Set(
                body.customTags.map((tag) => (typeof tag === "string" ? tag.trim() : tag)),
              ),
            ].filter(
              (tag): tag is string => typeof tag === "string" && tag.length > 0 && tag.length <= 40,
            );
            if (customTags.length !== body.customTags.length || customTags.length > 24) {
              return await reply.code(400).send({ error: "自定义标签无效" });
            }
            asset.customTags = customTags;
          }
          asset.updatedAt = timestamp;
        } else if (item.refType === "shot") {
          const shot = current.snapshot.shots.find((candidate) => candidate.id === item.refId);
          if (!shot) return await reply.code(404).send({ error: "镜头不存在" });
          if (typeof body.title === "string" && body.title.trim()) {
            shot.label = body.title.trim().slice(0, 80);
          }
          if (typeof body.body === "string") shot.intent = body.body.slice(0, 20_000);
          if (
            typeof body.durationSeconds === "number" &&
            body.durationSeconds > 0 &&
            body.durationSeconds <= 300
          ) {
            shot.durationSeconds = body.durationSeconds;
          }
          if (
            typeof body.aspectRatio === "string" &&
            allowedRatios.has(body.aspectRatio as AspectRatio)
          ) {
            shot.aspectRatio = body.aspectRatio as AspectRatio;
          }
          if (typeof body.workflowPath === "string" && body.workflowPath.trim()) {
            const workflowPath = body.workflowPath.trim().slice(0, 1_000);
            const runWorkflowPath = [...current.snapshot.runs]
              .reverse()
              .find((run) => run.shotId === shot.id)?.parameters.recipePath;
            const lockedWorkflowPath =
              shot.workflowPath ?? (typeof runWorkflowPath === "string" ? runWorkflowPath : null);
            const hasHistory = current.snapshot.runs.some((run) => run.shotId === shot.id);
            if (hasHistory && lockedWorkflowPath && lockedWorkflowPath !== workflowPath) {
              return await reply.code(409).send({ error: "这个镜头已有运行记录，工作流已锁定" });
            }
            shot.workflowPath = workflowPath;
          }
          shot.updatedAt = timestamp;
        } else {
          return await reply.code(409).send({ error: "候选组由运行记录管理，不能直接编辑" });
        }
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "canvas.item_edited",
          payload: { itemId: item.id, refType: item.refType, refId: item.refId },
        });
        return { key, ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.delete<{ Params: { key: string; itemId: string } }>(
    "/api/projects/:key/canvas-items/:itemId",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const item = current?.snapshot.canvasItems.find(
          (candidate) => candidate.id === request.params.itemId,
        );
        if (!current || !item) return await reply.code(404).send({ error: "画布节点不存在" });
        const timestamp = toIsoTimestamp();
        current.snapshot.canvasItems = current.snapshot.canvasItems.filter(
          (candidate) => candidate.id !== item.id,
        );
        current.snapshot.canvasEdges = current.snapshot.canvasEdges.filter(
          (edge) => edge.sourceItemId !== item.id && edge.targetItemId !== item.id,
        );
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "canvas.item_removed",
          payload: { itemId: item.id, refType: item.refType, refId: item.refId },
        });
        return { key, removedItemId: item.id, ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string; takeId: string } }>(
    "/api/projects/:key/takes/:takeId/reject",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      if (!key || !reason) return await reply.code(400).send({ error: "淘汰原因无效" });
      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const take = current?.snapshot.takes.find((item) => item.id === request.params.takeId);
        if (!current || !take) return await reply.code(404).send({ error: "候选不存在" });
        if (take.status === "approved") {
          return await reply.code(409).send({ error: "已批准候选需先由另一候选替换" });
        }
        const timestamp = toIsoTimestamp();
        take.status = "rejected";
        take.rejectionReasons = [reason];
        take.updatedAt = timestamp;
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "take.rejected",
          payload: { takeId: take.id, reason },
        });
        return { key, ...saved };
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string; takeId: string } }>(
    "/api/projects/:key/takes/:takeId/approve",
    async (request, reply) => {
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const body =
        typeof request.body === "object" && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2_000) : null;
      const store = ProjectStore.openExisting(join(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const take = current?.snapshot.takes.find((item) => item.id === request.params.takeId);
        const shot = current?.snapshot.shots.find((item) => item.id === take?.shotId);
        if (!current || !take || !shot) {
          return await reply.code(404).send({ error: "候选或镜头不存在" });
        }
        const timestamp = toIsoTimestamp();
        const approved = approveTake({
          shot,
          takes: current.snapshot.takes,
          approvals: current.snapshot.approvals,
          takeId: take.id,
          approvalId: createTakeBoardId("approval"),
          at: timestamp,
          reason,
        });
        current.snapshot.shots = current.snapshot.shots.map((item) =>
          item.id === shot.id ? approved.shot : item,
        );
        current.snapshot.takes = approved.takes;
        current.snapshot.approvals = approved.approvals;
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "take.approved",
          payload: { takeId: take.id, shotId: shot.id },
        });
        return { key, ...saved };
      } finally {
        store.close();
      }
    },
  );
}
