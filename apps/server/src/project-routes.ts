import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AspectRatio, ProjectSnapshot } from "@takeboard/contracts";
import { approveTake, createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import type { FastifyInstance } from "fastify";
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

export function registerProjectRoutes(app: FastifyInstance, projectsRoot: string) {
  const root = resolve(projectsRoot);
  const service = new ProjectService();

  app.get("/api/projects", async () => {
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && projectKey(entry.name))
        .map(async (entry) => {
          const opened = await service.open(join(root, entry.name));
          return opened
            ? {
                key: entry.name,
                id: opened.snapshot.project.id,
                title: opened.snapshot.project.title,
                aspectRatio: opened.snapshot.project.defaultAspectRatio,
                sceneCount: opened.snapshot.scenes.length,
                shotCount: opened.snapshot.shots.length,
                updatedAt: opened.snapshot.project.updatedAt,
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

  app.post("/api/projects", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const ratio = body.aspectRatio;
    if (!title || typeof ratio !== "string" || !allowedRatios.has(ratio as AspectRatio)) {
      return await reply.code(400).send({ error: "项目名称或画幅无效" });
    }

    await mkdir(root, { recursive: true });
    const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const key = `${slugify(title)}-${suffix}.takeboard`;
    const created = await service.create({
      projectDirectory: join(root, key),
      title,
      defaultAspectRatio: ratio as AspectRatio,
      ...(typeof body.sceneTitle === "string" ? { sceneTitle: body.sceneTitle } : {}),
      ...(typeof body.firstShotIntent === "string"
        ? { firstShotIntent: body.firstShotIntent }
        : {}),
    });
    return await reply.code(201).send({ key, ...created });
  });

  app.get<{ Params: { key: string } }>("/api/projects/:key", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const opened = await service.open(join(root, key));
    if (!opened) return await reply.code(404).send({ error: "项目不存在" });
    return { key, ...opened };
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
    store.close();

    const trashRoot = join(root, ".trash");
    await mkdir(trashRoot, { recursive: true });
    const archivedName = `${key}.${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    await rename(source, join(trashRoot, archivedName));
    return { key, deleted: true as const, recoverable: true as const };
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
        !["first_frame", "last_frame", "reference"].includes(String(targetSlot))
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
          !["asset", "entity"].includes(source.refType) ||
          target.refType !== "shot"
        ) {
          return await reply.code(400).send({ error: "只能将图片素材或实体连接到镜头输入" });
        }

        const assetId =
          source.refType === "asset"
            ? source.refId
            : current.snapshot.entities
                .find((entity) => entity.id === source.refId)
                ?.referenceAssetIds.find((candidate) =>
                  current.snapshot.assets.some(
                    (asset) => asset.id === candidate && asset.mediaType === "image",
                  ),
                );
        const asset = current.snapshot.assets.find(
          (candidate) => candidate.id === assetId && candidate.mediaType === "image",
        );
        if (!asset) return await reply.code(400).send({ error: "该节点没有可用的图片素材" });

        const timestamp = toIsoTimestamp();
        current.snapshot.canvasEdges = current.snapshot.canvasEdges.filter(
          (edge) =>
            edge.immutable || edge.targetItemId !== target.id || edge.targetSlot !== targetSlot,
        );
        current.snapshot.canvasEdges.push({
          id: createTakeBoardId("canvas_edge"),
          sceneId: target.sceneId,
          sourceItemId: source.id,
          targetItemId: target.id,
          relation: "reference",
          targetSlot: targetSlot as "first_frame" | "last_frame" | "reference",
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
