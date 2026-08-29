import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { OperationTask, StorageCategory } from "@takeboard/contracts";
import type { FastifyInstance } from "fastify";
import { authContext } from "./auth-routes.js";
import type { AuthService } from "./auth-service.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";
import { diskCapacity, projectStorageReserveBytes } from "./storage-capacity.js";

const activeStatuses = new Set([
  "draft",
  "validating",
  "uploading_inputs",
  "queued",
  "running",
  "collecting_outputs",
  "reconciling",
]);

function emptyCategories(): StorageCategory {
  return {
    originals: 0,
    proxies: 0,
    renders: 0,
    runData: 0,
    recipes: 0,
    exports: 0,
    backups: 0,
    other: 0,
  };
}

function storageCategory(root: string, path: string): keyof StorageCategory {
  const portable = relative(root, path).split(sep).join("/");
  if (portable.startsWith("assets/originals/")) return "originals";
  if (portable.startsWith("assets/proxies/")) return "proxies";
  if (portable.startsWith("renders/")) return "renders";
  if (portable.startsWith("runs/")) return "runData";
  if (portable.startsWith("recipes/")) return "recipes";
  if (portable.startsWith("exports/")) return "exports";
  if (portable.startsWith("backups/")) return "backups";
  return "other";
}

async function directoryUsage(directory: string, categorize = false) {
  const root = resolve(directory);
  const categories = emptyCategories();
  let totalBytes = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(path);
      }
    }
    const files = entries
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .map((entry) => join(current, entry.name));
    for (let offset = 0; offset < files.length; offset += 64) {
      const batch = files.slice(offset, offset + 64);
      const sizes = await Promise.all(
        batch.map(async (path) => ({ path, information: await stat(path).catch(() => null) })),
      );
      for (const { path, information } of sizes) {
        if (!information) continue;
        totalBytes += information.size;
        categories[categorize ? storageCategory(root, path) : "other"] += information.size;
      }
    }
  }
  return { totalBytes, categories };
}

function effectiveProjectRole(
  auth: AuthService,
  projectId: string,
  context: ReturnType<typeof authContext>,
) {
  if (!context || context.user.instanceRole === "admin") return "owner" as const;
  return auth.projectRole(projectId, context.user.id);
}

export function registerOperationsRoutes(
  app: FastifyInstance,
  projectsRoot: string,
  auth: AuthService,
) {
  const root = resolve(projectsRoot);

  app.get("/api/operations/tasks", async (request) => {
    const context = authContext(request);
    const accessible = context
      ? auth.accessibleProjectIds(context.user.id, context.user.instanceRole)
      : null;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const tasks: OperationTask[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !projectKey(entry.name)) continue;
      const store = ProjectStore.openExisting(join(root, entry.name));
      if (!store) continue;
      try {
        const current = store.loadCurrent();
        if (!current || (accessible && !accessible.has(current.snapshot.project.id))) continue;
        const role = effectiveProjectRole(auth, current.snapshot.project.id, context);
        if (!role) continue;
        for (const run of current.snapshot.runs) {
          const shot = current.snapshot.shots.find((candidate) => candidate.id === run.shotId);
          tasks.push({
            projectKey: entry.name,
            projectId: current.snapshot.project.id,
            projectTitle: current.snapshot.project.title,
            projectRole: role,
            canCancel: role !== "viewer",
            shotId: run.shotId,
            shotLabel: shot?.label || "镜头",
            runId: run.id,
            status: run.status,
            recipePath:
              typeof run.parameters.recipePath === "string" ? run.parameters.recipePath : null,
            outputMediaType:
              run.parameters.outputMediaType === "image" ||
              run.parameters.outputMediaType === "video"
                ? run.parameters.outputMediaType
                : null,
            progress: null,
            errorMessage: run.errorMessage,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
          });
        }
      } finally {
        store.close();
      }
    }
    const ordered = tasks.sort((left, right) => {
      const activeDifference =
        Number(activeStatuses.has(right.status)) - Number(activeStatuses.has(left.status));
      return activeDifference || right.updatedAt.localeCompare(left.updatedAt);
    });
    const visible = [
      ...ordered.filter((task) => activeStatuses.has(task.status)),
      ...ordered.filter((task) => !activeStatuses.has(task.status)).slice(0, 20),
    ];
    return {
      tasks: visible,
      activeCount: visible.filter((task) => activeStatuses.has(task.status)).length,
      failedCount: visible.filter((task) => task.status === "failed" || task.status === "orphaned")
        .length,
      updatedAt: new Date().toISOString(),
    };
  });

  app.get("/api/operations/storage", async (request) => {
    const context = authContext(request);
    const accessible = context
      ? auth.accessibleProjectIds(context.user.id, context.user.instanceRole)
      : null;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !projectKey(entry.name)) continue;
      const directory = join(root, entry.name);
      const store = ProjectStore.openExisting(directory);
      if (!store) continue;
      try {
        const current = store.loadCurrent();
        if (!current || (accessible && !accessible.has(current.snapshot.project.id))) continue;
        const usage = await directoryUsage(directory, true);
        projects.push({
          projectKey: entry.name,
          projectId: current.snapshot.project.id,
          projectTitle: current.snapshot.project.title,
          totalBytes: usage.totalBytes,
          categories: usage.categories,
        });
      } finally {
        store.close();
      }
    }

    let trashBytes = 0;
    const trashRoot = join(root, ".trash");
    const trashEntries = await readdir(trashRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of trashEntries) {
      if (!entry.isDirectory()) continue;
      const directory = join(trashRoot, entry.name);
      const store = ProjectStore.openExisting(directory);
      if (!store) continue;
      try {
        const current = store.loadCurrent();
        if (!current) continue;
        const role = effectiveProjectRole(auth, current.snapshot.project.id, context);
        if (!role || (context && context.user.instanceRole !== "admin" && role !== "owner"))
          continue;
        trashBytes += (await directoryUsage(directory)).totalBytes;
      } finally {
        store.close();
      }
    }

    const activeProjectBytes = projects.reduce((sum, project) => sum + project.totalBytes, 0);
    const systemBytes =
      context?.user.instanceRole === "admin"
        ? (await directoryUsage(join(root, ".system"))).totalBytes
        : null;
    const reserveBytes = projectStorageReserveBytes();
    const filesystemCapacity = await diskCapacity(root);
    return {
      projects: projects.sort((left, right) => right.totalBytes - left.totalBytes),
      activeProjectBytes,
      trashBytes,
      systemBytes,
      visibleBytes: activeProjectBytes + trashBytes + (systemBytes ?? 0),
      filesystem: filesystemCapacity
        ? {
            ...filesystemCapacity,
            reserveBytes,
            generationReady: filesystemCapacity.availableBytes >= reserveBytes,
          }
        : null,
      scannedAt: new Date().toISOString(),
    };
  });
}
