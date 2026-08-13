import type { FastifyInstance, FastifyRequest } from "fastify";

const projectTails = new Map<string, Promise<void>>();

async function acquireProjectLock(projectKey: string) {
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

function lockedProjectKey(request: FastifyRequest) {
  const pathname = request.url.split("?", 1)[0] ?? "";
  const match = /^\/api\/projects\/([^/]+)\/(.+)$/.exec(pathname);
  if (!match) return null;
  const [, encodedKey, remainder] = match;
  const writesProject = request.method !== "GET" || remainder?.startsWith("runs/");
  if (!writesProject || !encodedKey) return null;
  try {
    return decodeURIComponent(encodedKey);
  } catch {
    return null;
  }
}

export function registerProjectRequestLock(app: FastifyInstance) {
  const releases = new WeakMap<FastifyRequest, () => void>();

  app.addHook("onRequest", async (request) => {
    const key = lockedProjectKey(request);
    if (key) releases.set(request, await acquireProjectLock(key));
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
