import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  type AspectRatio,
  type BatchApprovalDecision,
  batchApprovalApplyRequestSchema,
  batchApprovalPreviewRequestSchema,
  type ProjectSnapshot,
} from "@takeboard/contracts";
import {
  approveTake,
  approveTakesBatch,
  createTakeBoardId,
  rejectTake,
  summarizeProjectCosts,
  toIsoTimestamp,
} from "@takeboard/domain";
import type { FastifyInstance } from "fastify";
import { authContext } from "./auth-routes.js";
import type { AuthService } from "./auth-service.js";
import { readDeviceSettings } from "./device-settings.js";
import type { ExtensionRegistry } from "./extension-registry.js";
import {
  createProjectArchive,
  findActiveProjectById,
  importProjectArchive,
  ProjectArchiveError,
} from "./project-archive.js";
import {
  isLocatedProject,
  linkProjectDirectory,
  locatedProjectSummary,
  projectDirectory,
  storageFolder,
  updateLocatedProjectSummary,
} from "./project-locations.js";
import { ProjectService } from "./project-service.js";
import { ProjectStore } from "./storage/project-store.js";
import type { WorkerPool } from "./worker-pool.js";

const allowedRatios = new Set<AspectRatio>(["9:16", "16:9", "1:1", "4:5", "2.35:1"]);

function approvalConfirmationToken(revision: number, decisions: readonly BatchApprovalDecision[]) {
  const canonical = [...decisions]
    .map((decision) => ({
      shotId: decision.shotId,
      takeId: decision.takeId,
      reason: decision.reason ?? null,
    }))
    .sort((left, right) => left.shotId.localeCompare(right.shotId));
  return createHash("sha256")
    .update(JSON.stringify({ revision, decisions: canonical }))
    .digest("hex");
}

function buildApprovalPreview(
  snapshot: ProjectSnapshot,
  revision: number,
  decisions: readonly BatchApprovalDecision[],
) {
  const seenShots = new Set<string>();
  const preview = decisions.map((decision) => {
    if (seenShots.has(decision.shotId)) throw new Error("每个镜头在同一批次中只能选择一个候选");
    seenShots.add(decision.shotId);
    const shot = snapshot.shots.find((candidate) => candidate.id === decision.shotId);
    const take = snapshot.takes.find((candidate) => candidate.id === decision.takeId);
    if (!shot || !take) throw new Error("批量批准包含不存在的镜头或候选");
    if (take.shotId !== shot.id) throw new Error("候选与镜头不匹配");
    if (take.status === "media_missing") throw new Error("媒体缺失的候选不能批准");
    return {
      shotId: shot.id,
      shotTitle: shot.label,
      takeId: take.id,
      assetId: take.assetId,
      replacesTakeId: shot.approvedTakeId === take.id ? null : shot.approvedTakeId,
      reason: decision.reason ?? null,
    };
  });
  return {
    revision,
    confirmationToken: approvalConfirmationToken(revision, decisions),
    decisionCount: preview.length,
    replacementCount: preview.filter((decision) => decision.replacesTakeId !== null).length,
    decisions: preview,
  };
}

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

function canvasItemMedia(snapshot: ProjectSnapshot, item: { refType: string; refId: string }) {
  let assetId: string | undefined;
  if (item.refType === "asset") assetId = item.refId;
  else if (item.refType === "entity")
    assetId = snapshot.entities.find((entity) => entity.id === item.refId)?.referenceAssetIds[0];
  else if (item.refType === "shot" || item.refType === "take_stack") {
    const shot = snapshot.shots.find((shot) => shot.id === item.refId);
    const take =
      snapshot.takes.find((take) => take.id === shot?.approvedTakeId) ??
      [...snapshot.takes]
        .reverse()
        .find(
          (take) =>
            take.shotId === item.refId &&
            take.status !== "rejected" &&
            take.status !== "media_missing",
        );
    assetId = take?.assetId;
  }
  const asset = snapshot.assets.find((asset) => asset.id === assetId);
  return asset
    ? {
        assetId: asset.id,
        mediaType: asset.mediaType,
        mediaWidth: asset.width,
        mediaHeight: asset.height,
      }
    : {};
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
  workerPool: WorkerPool;
  extensionRegistry: ExtensionRegistry;
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
  projectId: string,
) {
  if (run.workerId && run.workerId !== options.workerPool.localWorkerId) return;
  const inputFiles = Array.isArray(run.parameters.comfyInputFiles)
    ? run.parameters.comfyInputFiles.filter((value): value is string => typeof value === "string")
    : [];
  const outputDirectory = run.parameters.comfyOutputDirectory;
  await Promise.allSettled([
    ...inputFiles.flatMap((file) => {
      const target =
        options.comfyInputRoot &&
        file.startsWith(`takeboard_${run.id}_`) &&
        !file.includes("/") &&
        !file.includes("\\")
          ? safeChild(options.comfyInputRoot, file)
          : null;
      return target ? [unlink(target)] : [];
    }),
    ...(options.comfyOutputRoot &&
    outputDirectory === `takeboard/${projectId}/${run.shotId}/${run.id}`
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
          let directory: string;
          let opened: Awaited<ReturnType<typeof service.open>> | null;
          try {
            directory = projectDirectory(trashRoot, entry.name);
            opened = await service.open(directory);
          } catch {
            const cached = locatedProjectSummary(trashRoot, entry.name);
            if (
              !cached ||
              (context &&
                !options.auth.hasProjectRole(
                  cached.projectId,
                  context.user.id,
                  "owner",
                  context.user.instanceRole,
                ))
            )
              return null;
            const information = await stat(join(trashRoot, entry.name)).catch(() => null);
            return {
              trashKey: entry.name,
              originalKey,
              title: cached.title,
              shotCount: 0,
              deletedAt: information?.mtime.toISOString() ?? cached.updatedAt,
              unavailable: true,
            };
          }
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
      const store = ProjectStore.openExisting(projectDirectory(join(root, ".trash"), archiveKey));
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
          let opened: Awaited<ReturnType<typeof service.open>>;
          try {
            opened = await service.open(projectDirectory(root, entry.name));
          } catch {
            const cached = locatedProjectSummary(root, entry.name);
            if (!cached || (accessible && !accessible.has(cached.projectId))) return null;
            const role = context
              ? options.auth.projectRole(cached.projectId, context.user.id)
              : "owner";
            return {
              key: entry.name,
              revision: 0,
              id: cached.projectId,
              title: cached.title,
              aspectRatio: "位置不可用",
              sceneCount: 0,
              shotCount: 0,
              activeRunCount: 0,
              updatedAt: cached.updatedAt,
              role: role ?? "owner",
              membershipRole: role,
              accessSource: role ? "membership" : "instance_admin",
              boards: [],
              unavailable: true,
            };
          }
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
                  const nodes = items.slice(0, 80).map((item) => {
                    const media = canvasItemMedia(opened.snapshot, item);
                    const automatic = item.sizeMode !== "manual";
                    const width = automatic && item.refType === "shot" ? 470 : item.width;
                    const height =
                      automatic &&
                      ["shot", "asset"].includes(item.refType) &&
                      media.mediaWidth &&
                      media.mediaHeight
                        ? (width * media.mediaHeight) / media.mediaWidth
                        : item.height;
                    return {
                      id: item.id,
                      refType: item.refType,
                      label: canvasItemLabel(opened.snapshot, item),
                      x: item.x,
                      y: item.y,
                      width,
                      height,
                      ...media,
                    };
                  });
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
    let destination = join(root, key);
    const customLocation = body.storageRootId !== undefined || body.storageFolder !== undefined;
    if (customLocation) {
      const context = authContext(request);
      if (context && !context.local && context.user.instanceRole !== "admin")
        return await reply.code(403).send({ error: "自定义项目位置需要设备管理权限" });
      if (
        typeof body.storageRootId !== "string" ||
        (body.storageFolder !== undefined && typeof body.storageFolder !== "string")
      )
        return await reply.code(400).send({ error: "项目位置无效" });
    }
    const location = customLocation
      ? {
          storageRootId: body.storageRootId as string,
          storageFolder: (body.storageFolder as string | undefined) ?? "",
        }
      : (await readDeviceSettings(root)).projectLocation;
    if (customLocation || location.storageRootId !== "instance" || location.storageFolder !== "") {
      try {
        const selected = await storageFolder(root, location.storageRootId, location.storageFolder);
        const safeTitle =
          [...title]
            .map((character) =>
              character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "_" : character,
            )
            .join("")
            .replace(/[. ]+$/, "") || "项目";
        let folderTitle = "";
        for (const character of safeTitle) {
          if (Buffer.byteLength(folderTitle + character, "utf8") > 180) break;
          folderTitle += character;
        }
        destination = join(selected.path, `${folderTitle} (${suffix}).takeboard`);
      } catch (cause) {
        return await reply.code(400).send({
          error:
            customLocation && cause instanceof Error
              ? cause.message
              : "默认项目位置不可用，请在设置中检查文件夹；未创建替代项目",
        });
      }
    }
    // Reserve an exclusive folder. Never let project creation overwrite an existing directory.
    await mkdir(destination, { mode: 0o700 });
    let created: Awaited<ReturnType<typeof service.create>>;
    let publishedIndex = false;
    try {
      created = await service.create({
        projectDirectory: destination,
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
      await linkProjectDirectory(root, key, destination, {
        projectId: created.snapshot.project.id,
        title,
        updatedAt: created.snapshot.project.updatedAt,
      });
      publishedIndex = resolve(destination) !== resolve(root, key);
      const context = authContext(request);
      if (context) options.auth.grantProjectOwner(created.snapshot.project.id, context.user.id);
    } catch (error) {
      // This request exclusively reserved both paths; rollback only its new,
      // unpublished project. Existing folders and projects are never overwritten.
      if (publishedIndex) await rm(join(root, key), { recursive: true, force: true });
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
    return await reply.code(201).send({ key, ...created });
  });

  app.get<{ Params: { key: string } }>("/api/projects/:key/export", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const directory = projectDirectory(root, key);
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

  app.get<{ Params: { key: string } }>("/api/projects/:key", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const opened = await service.open(projectDirectory(root, key));
    if (!opened) return await reply.code(404).send({ error: "项目不存在" });
    return { key, ...opened };
  });

  app.get<{ Params: { key: string } }>("/api/projects/:key/sync", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const store = ProjectStore.openExisting(projectDirectory(root, key));
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

    const store = ProjectStore.openExisting(projectDirectory(root, key));
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
      await updateLocatedProjectSummary(root, key, {
        projectId: current.snapshot.project.id,
        title,
        updatedAt: timestamp,
      }).catch(() => {
        request.log.warn(
          { code: "PROJECT_LOCATION_CACHE_STALE" },
          "项目已重命名，但离线目录摘要未能更新",
        );
      });
      return { key, ...saved };
    } finally {
      store.close();
    }
  });

  app.delete<{ Params: { key: string } }>("/api/projects/:key", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });

    const source = projectDirectory(root, key);
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
        if (run.status === "collecting_outputs" && run.parameters.remoteExecutionCompleted === true)
          return { run, confirmed: true, error: null as string | null };
        if (!run.promptId) return { run, confirmed: true, error: null as string | null };
        try {
          const comfy = options.workerPool.client(run.workerId, false);
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
      cancellationResults
        .filter(({ run }) => run.parameters.remoteExecutionCompleted !== true)
        .flatMap(({ run }) => [
          ...(run.promptId
            ? [options.workerPool.client(run.workerId, false).deleteHistory(run.promptId)]
            : []),
          cleanupDeletedProjectRun(run, options, current.snapshot.project.id),
        ]),
    );
    if (cancellationResults.length > 0) {
      await Promise.all(
        [
          ...new Set(
            cancellationResults
              .filter(({ run }) => run.parameters.remoteExecutionCompleted !== true)
              .map(({ run }) => run.workerId),
          ),
        ].map(
          async (workerId) =>
            await options.workerPool
              .client(workerId, false)
              .freeResourcesIfIdle()
              .catch(() => undefined),
        ),
      );
    }

    const trashRoot = join(root, ".trash");
    await mkdir(trashRoot, { recursive: true });
    const archivedName = `${key}.${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    // External projects retain their original files. Recycling only moves the
    // catalog entry, so there is no cross-disk move or unintended data deletion.
    await rename(
      isLocatedProject(root, key) ? join(root, key) : source,
      join(trashRoot, archivedName),
    );
    return {
      key,
      deleted: true as const,
      recoverable: true as const,
      stoppedRunCount: cancellationResults.length,
    };
  });

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
      const store = ProjectStore.openExisting(projectDirectory(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        const take = current?.snapshot.takes.find((item) => item.id === request.params.takeId);
        if (!current || !take) return await reply.code(404).send({ error: "候选不存在" });
        if (take.status === "media_missing")
          return await reply.code(409).send({ error: "候选文件缺失，无法更改采用状态" });
        const timestamp = toIsoTimestamp();
        const shot = current.snapshot.shots.find((item) => item.id === take.shotId);
        if (!shot) return await reply.code(404).send({ error: "镜头不存在" });
        const result = rejectTake({
          shot,
          takes: current.snapshot.takes,
          approvals: current.snapshot.approvals,
          takeId: take.id,
          at: timestamp,
          reason,
        });
        current.snapshot.shots = current.snapshot.shots.map((item) =>
          item.id === shot.id ? result.shot : item,
        );
        current.snapshot.takes = result.takes;
        current.snapshot.approvals = result.approvals;
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

  app.get<{ Params: { key: string } }>("/api/projects/:key/costs", async (request, reply) => {
    if (!options.extensionRegistry.hasFeature("production.cost_insights")) {
      return await reply.code(409).send({
        error: "请先在扩展库启用“成本洞察”",
        code: "EXTENSION_DISABLED",
        feature: "production.cost_insights",
      });
    }
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const store = ProjectStore.openExisting(projectDirectory(root, key));
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    try {
      const current = store.loadCurrent();
      if (!current) return await reply.code(404).send({ error: "项目不存在" });
      return {
        key,
        revision: current.revision,
        summary: summarizeProjectCosts(current.snapshot, toIsoTimestamp()),
      };
    } finally {
      store.close();
    }
  });

  app.post<{ Params: { key: string } }>(
    "/api/projects/:key/approvals/batch/preview",
    async (request, reply) => {
      if (!options.extensionRegistry.hasFeature("production.batch_approval")) {
        return await reply.code(409).send({
          error: "请先在扩展库启用“批量审片”",
          code: "EXTENSION_DISABLED",
          feature: "production.batch_approval",
        });
      }
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const parsed = batchApprovalPreviewRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return await reply.code(400).send({
          error: parsed.error.issues[0]?.message ?? "批量批准内容无效",
        });
      }
      const store = ProjectStore.openExisting(projectDirectory(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        try {
          return {
            key,
            preview: buildApprovalPreview(
              current.snapshot,
              current.revision,
              parsed.data.decisions,
            ),
          };
        } catch (error) {
          return await reply
            .code(409)
            .send({ error: error instanceof Error ? error.message : "无法预览批准变更" });
        }
      } finally {
        store.close();
      }
    },
  );

  app.post<{ Params: { key: string } }>(
    "/api/projects/:key/approvals/batch",
    async (request, reply) => {
      if (!options.extensionRegistry.hasFeature("production.batch_approval")) {
        return await reply.code(409).send({
          error: "请先在扩展库启用“批量审片”",
          code: "EXTENSION_DISABLED",
          feature: "production.batch_approval",
        });
      }
      const key = projectKey(request.params.key);
      if (!key) return await reply.code(400).send({ error: "项目标识无效" });
      const parsed = batchApprovalApplyRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return await reply.code(400).send({
          error: parsed.error.issues[0]?.message ?? "批量批准内容无效",
        });
      }
      const store = ProjectStore.openExisting(projectDirectory(root, key));
      if (!store) return await reply.code(404).send({ error: "项目不存在" });
      try {
        const current = store.loadCurrent();
        if (!current) return await reply.code(404).send({ error: "项目不存在" });
        if (current.revision !== parsed.data.revision) {
          return await reply.code(409).send({
            error: "项目已被其他操作更新，请重新预览后再批准",
            code: "APPROVAL_PREVIEW_STALE",
            currentRevision: current.revision,
          });
        }
        const expectedToken = approvalConfirmationToken(current.revision, parsed.data.decisions);
        if (expectedToken !== parsed.data.confirmationToken) {
          return await reply.code(409).send({
            error: "批准选择与预览内容不一致，请重新确认",
            code: "APPROVAL_PREVIEW_MISMATCH",
          });
        }
        let preview: ReturnType<typeof buildApprovalPreview>;
        try {
          preview = buildApprovalPreview(current.snapshot, current.revision, parsed.data.decisions);
        } catch (error) {
          return await reply
            .code(409)
            .send({ error: error instanceof Error ? error.message : "无法应用批准变更" });
        }
        const timestamp = toIsoTimestamp();
        const context = authContext(request);
        const approved = approveTakesBatch({
          shots: current.snapshot.shots,
          takes: current.snapshot.takes,
          approvals: current.snapshot.approvals,
          decisions: parsed.data.decisions,
          approvalIds: parsed.data.decisions.map(() => createTakeBoardId("approval")),
          at: timestamp,
          actorUserId: context?.user.id ?? null,
          actorName: context?.user.name ?? null,
        });
        current.snapshot.shots = approved.shots;
        current.snapshot.takes = approved.takes;
        current.snapshot.approvals = approved.approvals;
        current.snapshot.project.updatedAt = timestamp;
        current.snapshot.exportedAt = timestamp;
        const saved = await store.save(current.snapshot, {
          type: "takes.batch_approved",
          payload: {
            count: parsed.data.decisions.length,
            replacementCount: preview.replacementCount,
            shotIds: parsed.data.decisions.map((decision) => decision.shotId),
            actorUserId: context?.user.id ?? null,
          },
        });
        return {
          key,
          approvedCount: parsed.data.decisions.length,
          replacementCount: preview.replacementCount,
          ...saved,
        };
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
      const store = ProjectStore.openExisting(projectDirectory(root, key));
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
          actorUserId: authContext(request)?.user.id ?? null,
          actorName: authContext(request)?.user.name ?? null,
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
