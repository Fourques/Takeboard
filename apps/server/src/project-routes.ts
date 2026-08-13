import { mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AspectRatio } from "@takeboard/contracts";
import { approveTake, createTakeBoardId, toIsoTimestamp } from "@takeboard/domain";
import type { FastifyInstance } from "fastify";
import { ProjectService } from "./project-service.js";
import { ProjectStore } from "./storage/project-store.js";

const allowedRatios = new Set<AspectRatio>(["9:16", "16:9", "1:1", "4:5", "2.35:1"]);

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
          const snapshot = await service.open(join(root, entry.name));
          return snapshot
            ? {
                key: entry.name,
                id: snapshot.project.id,
                title: snapshot.project.title,
                aspectRatio: snapshot.project.defaultAspectRatio,
                sceneCount: snapshot.scenes.length,
                shotCount: snapshot.shots.length,
                updatedAt: snapshot.project.updatedAt,
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
    const suffix = Date.now().toString(36);
    const key = `${slugify(title)}-${suffix}.takeboard`;
    const snapshot = await service.create({
      projectDirectory: join(root, key),
      title,
      defaultAspectRatio: ratio as AspectRatio,
      ...(typeof body.sceneTitle === "string" ? { sceneTitle: body.sceneTitle } : {}),
      ...(typeof body.firstShotIntent === "string"
        ? { firstShotIntent: body.firstShotIntent }
        : {}),
    });
    return await reply.code(201).send({ key, revision: 1, snapshot });
  });

  app.get<{ Params: { key: string } }>("/api/projects/:key", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const snapshot = await service.open(join(root, key));
    if (!snapshot) return await reply.code(404).send({ error: "项目不存在" });
    return { key, revision: 1, snapshot };
  });

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
