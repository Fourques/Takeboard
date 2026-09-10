import { mkdir, readdir } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { authContext } from "./auth-routes.js";
import { readDeviceSettings, saveDeviceSettings } from "./device-settings.js";
import {
  addStorageRoot,
  projectDirectory,
  storageFolder,
  storageRoots,
} from "./project-locations.js";
import { acquireProjectLock } from "./project-request-lock.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";

/** Device identity is separate from the GPU returned by ComfyUI. */
export function registerDeviceRoutes(app: FastifyInstance, projectsRoot: string) {
  const root = resolve(projectsRoot);
  app.get("/api/device/settings", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const context = authContext(request);
    const canManage = !context || context.local || context.user.instanceRole === "admin";
    const settings = await readDeviceSettings(root);
    let path: string | null = null;
    let available = false;
    try {
      path = (
        await storageFolder(
          root,
          settings.projectLocation.storageRootId,
          settings.projectLocation.storageFolder,
        )
      ).path;
      available = true;
    } catch {
      /* Keep the configured location: never silently fall back to another disk. */
    }
    return {
      revision: settings.revision,
      projectLocation: canManage ? settings.projectLocation : null,
      path: canManage ? path : null,
      available,
      canManage,
    };
  });
  app.put<{
    Body: {
      revision?: number;
      projectLocation?: { storageRootId?: string; storageFolder?: string };
    };
  }>("/api/device/settings", async (request, reply) => {
    const context = authContext(request);
    if (context && !context.local && context.user.instanceRole !== "admin")
      return await reply.code(403).send({ error: "只有设备管理员可以修改默认项目位置" });
    const { revision, projectLocation } = request.body ?? {};
    if (
      !Number.isSafeInteger(revision) ||
      typeof projectLocation?.storageRootId !== "string" ||
      typeof projectLocation.storageFolder !== "string"
    )
      return await reply.code(400).send({ error: "设备设置无效" });
    const release = await acquireProjectLock(`device-settings:${root}`);
    try {
      return await saveDeviceSettings(root, revision as number, {
        storageRootId: projectLocation.storageRootId,
        storageFolder: projectLocation.storageFolder,
      });
    } catch (cause) {
      return await reply
        .code((cause as { statusCode?: number }).statusCode === 409 ? 409 : 400)
        .send({ error: cause instanceof Error ? cause.message : "无法保存设备设置" });
    } finally {
      release();
    }
  });
  app.get("/api/storage/roots", async (request, reply) => {
    const context = authContext(request);
    if (context && !context.local && context.user.instanceRole !== "admin")
      return await reply.code(403).send({ error: "自定义项目位置需要设备管理权限" });
    reply.header("cache-control", "no-store");
    return { roots: storageRoots(root) };
  });
  app.post<{ Body: { path?: string; name?: string } }>(
    "/api/storage/roots",
    async (request, reply) => {
      const context = authContext(request);
      if (context && !context.local && context.user.instanceRole !== "admin")
        return await reply.code(403).send({ error: "只有设备管理员可以添加项目位置" });
      if (typeof request.body?.path !== "string")
        return await reply.code(400).send({ error: "请选择项目文件夹" });
      const release = await acquireProjectLock(`storage-roots:${root}`);
      try {
        const entry = await addStorageRoot(root, {
          path: request.body.path,
          name: typeof request.body.name === "string" ? request.body.name : "",
        });
        return { root: entry };
      } catch (cause) {
        return await reply
          .code(400)
          .send({ error: cause instanceof Error ? cause.message : "无法添加项目位置" });
      } finally {
        release();
      }
    },
  );
  app.get<{ Querystring: { rootId?: string; folder?: string } }>(
    "/api/storage/folders",
    async (request, reply) => {
      const context = authContext(request);
      if (context && !context.local && context.user.instanceRole !== "admin")
        return await reply.code(403).send({ error: "浏览文件夹需要设备管理权限" });
      try {
        await mkdir(root, { recursive: true });
        const { path } = await storageFolder(
          root,
          request.query.rootId ?? "instance",
          request.query.folder ?? "",
        );
        const entries = await readdir(path, { withFileTypes: true });
        reply.header("cache-control", "no-store");
        return {
          path,
          folders: entries
            .filter(
              (entry) =>
                entry.isDirectory() &&
                !entry.name.startsWith(".") &&
                !entry.name.endsWith(".takeboard"),
            )
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b)),
        };
      } catch (cause) {
        return await reply
          .code(400)
          .send({ error: cause instanceof Error ? cause.message : "无法读取文件夹" });
      }
    },
  );
  app.post<{ Body: { rootId?: string; folder?: string; name?: string } }>(
    "/api/storage/folders",
    async (request, reply) => {
      const context = authContext(request);
      if (context && !context.local && context.user.instanceRole !== "admin")
        return await reply.code(403).send({ error: "创建文件夹需要设备管理权限" });
      const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
      if (
        !name ||
        name.length > 100 ||
        /[<>:"/\\|?*]/.test(name) ||
        [...name].some((character) => character.charCodeAt(0) < 32) ||
        name.startsWith(".") ||
        /[. ]$/.test(name) ||
        name.endsWith(".takeboard") ||
        /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)
      )
        return await reply.code(400).send({ error: "文件夹名称无效" });
      try {
        const { path } = await storageFolder(
          root,
          request.body.rootId ?? "instance",
          request.body.folder ?? "",
        );
        await mkdir(join(path, name), { mode: 0o700 });
        return await reply.code(201).send({ name });
      } catch (cause) {
        return await reply
          .code(400)
          .send({ error: cause instanceof Error ? cause.message : "无法创建文件夹" });
      }
    },
  );
  app.get("/api/device", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const context = authContext(request);
    const canManage = !context || context.local || context.user.instanceRole === "admin";
    return {
      instanceId: process.env.TAKEBOARD_INSTANCE_ID ?? null,
      name: process.env.TAKEBOARD_INSTANCE_NAME?.trim() || hostname(),
      platform: process.platform,
      canManage,
      // Never include filesystem locations in public health or support reports.
      projectsDirectory: canManage ? resolve(projectsRoot) : null,
    };
  });

  app.get<{ Params: { key: string } }>("/api/projects/:key/location", async (request, reply) => {
    const key = projectKey(request.params.key);
    if (!key) return await reply.code(400).send({ error: "项目标识无效" });
    const directory = projectDirectory(root, key);
    const store = ProjectStore.openExisting(directory);
    if (!store) return await reply.code(404).send({ error: "项目不存在" });
    try {
      const current = store.loadCurrent();
      if (!current) return await reply.code(404).send({ error: "项目不存在" });
      const context = authContext(request);
      const canInspectPath = !context || context.local || context.user.instanceRole === "admin";
      reply.header("cache-control", "no-store");
      return {
        key,
        title: current.snapshot.project.title,
        directory: canInspectPath ? directory : null,
        deviceName: process.env.TAKEBOARD_INSTANCE_NAME?.trim() || hostname(),
        downloadIsCopy: true,
      };
    } finally {
      store.close();
    }
  });
}
