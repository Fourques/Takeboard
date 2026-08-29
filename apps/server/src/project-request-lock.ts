import { join, resolve } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ProjectStore } from "./storage/project-store.js";

const projectTails = new Map<string, Promise<void>>();

export async function acquireProjectLock(projectKey: string) {
  const previous = projectTails.get(projectKey) ?? Promise.resolve();
  let releaseGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  projectTails.set(projectKey, tail);
  await previous.catch(() => undefined);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseGate();
    if (projectTails.get(projectKey) === tail) projectTails.delete(projectKey);
  };
}

export async function acquireProjectLocks(projectKeys: string[]) {
  const releases: Array<() => void> = [];
  try {
    for (const key of [...new Set(projectKeys)].sort()) {
      releases.push(await acquireProjectLock(key));
    }
  } catch (error) {
    for (const release of releases.reverse()) release();
    throw error;
  }
  return () => {
    for (const release of releases.reverse()) release();
  };
}

function lockedProjectKey(request: FastifyRequest) {
  const pathname = request.url.split("?", 1)[0] ?? "";
  if (
    request.method === "POST" &&
    (pathname === "/api/projects" ||
      pathname === "/api/projects/import" ||
      /^\/api\/projects\/trash\/[^/]+\/restore$/.test(pathname))
  ) {
    return "__catalog__";
  }
  const match = /^\/api\/projects\/([^/]+)(?:\/(.+))?$/.exec(pathname);
  if (!match) return null;
  const [, encodedKey, remainder] = match;
  const writesProject =
    request.method !== "GET" || remainder?.startsWith("runs/") || remainder === "export";
  if (!writesProject || !encodedKey) return null;
  try {
    return decodeURIComponent(encodedKey);
  } catch {
    return null;
  }
}

export function registerProjectRequestLock(app: FastifyInstance, projectsRoot: string) {
  const root = resolve(projectsRoot);
  const releases = new WeakMap<FastifyRequest, () => void>();

  app.addHook("onRequest", async (request) => {
    const key = lockedProjectKey(request);
    if (key) releases.set(request, await acquireProjectLock(key));
  });
  app.addHook("preHandler", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const key = lockedProjectKey(request);
    const supplied = request.headers["x-takeboard-revision"];
    if (
      !key ||
      typeof supplied !== "string" ||
      !/^\d+$/.test(supplied) ||
      !/^[a-z0-9][a-z0-9-]{0,80}\.takeboard$/.test(key)
    )
      return;
    const store = ProjectStore.openExisting(join(root, key));
    if (!store) return;
    try {
      const currentRevision = store.currentRevision();
      const expectedRevision = Number(supplied);
      if (currentRevision !== null && expectedRevision !== currentRevision) {
        return await reply.code(409).send({
          error: `项目已在其他设备更新到 r${currentRevision}，已阻止覆盖旧版本`,
          code: "REVISION_CONFLICT",
          currentRevision,
          expectedRevision,
        });
      }
    } finally {
      store.close();
    }
  });
  app.addHook("onResponse", async (request) => {
    releases.get(request)?.();
    releases.delete(request);
  });
  app.addHook("onRequestAbort", async (request) => {
    releases.get(request)?.();
    releases.delete(request);
  });
}
