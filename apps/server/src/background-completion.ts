import { readdir } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { projectDirectory } from "./project-locations.js";
import { acquireProjectLock } from "./project-request-lock.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";

export async function hasUnfinishedWork(root: string) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !projectKey(entry.name)) continue;
    const release = await acquireProjectLock(entry.name);
    try {
      const store = ProjectStore.openExisting(projectDirectory(root, entry.name));
      if (!store) throw new Error("无法读取项目，保留后台服务");
      try {
        const snapshot = store.loadCurrent()?.snapshot;
        if (!snapshot) throw new Error("项目状态未知，保留后台服务");
        if (snapshot.runs.some((run) => run.status === "orphaned"))
          throw new Error("生成已中断，结束退出收尾");
        if (snapshot.runs.some((run) => !["completed", "failed", "cancelled"].includes(run.status)))
          return true;
      } finally {
        store.close();
      }
    } finally {
      release();
    }
  }
  return false;
}

export class BackgroundCompletion {
  private revision = 0;
  active = false;
  interrupted = false;
  resume() {
    this.active = false;
    this.interrupted = false;
    this.revision++;
  }
  async drain(
    pending: () => Promise<boolean>,
    close: () => Promise<void>,
    wait = () => new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    maxWaitMs = 30 * 60_000,
  ) {
    const revision = ++this.revision;
    this.active = true;
    const deadline = Date.now() + maxWaitMs;
    while (this.active && revision === this.revision) {
      let busy = false;
      try {
        busy = await pending();
      } catch {
        this.interrupted = true;
      }
      if (Date.now() >= deadline && busy) this.interrupted = true;
      if (!this.active || revision !== this.revision) return;
      if (!busy || this.interrupted) {
        await close();
        return;
      }
      await wait();
    }
  }
}
const controllers = new WeakMap<FastifyInstance, BackgroundCompletion>();
export function registerBackgroundCompletion(app: FastifyInstance) {
  const controller = new BackgroundCompletion();
  controllers.set(app, controller);
  app.post("/api/runtime/resume", async () => {
    controller.resume();
    return { resumed: true };
  });
  app.addHook("preHandler", async (request, reply) => {
    if (
      controller.active &&
      request.routeOptions.url === "/api/projects/:key/shots/:shotId/generate"
    )
      return reply.code(409).send({ error: "后台正在保存生成结果，请重新打开项目后继续创作" });
  });
}
export function completionFor(app: FastifyInstance) {
  const value = controllers.get(app);
  if (!value) throw new Error("Missing completion controller");
  return value;
}
