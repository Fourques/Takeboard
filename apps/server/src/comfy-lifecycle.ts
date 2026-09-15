import { readdir } from "node:fs/promises";
import type { ComfyLauncher } from "./comfy-launcher.js";
import { projectDirectory } from "./project-locations.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";

/** Fail closed: collecting results and uncertain runs still need their service. */
export async function assertComfyIdle(
  root: string,
  workerId: string,
  endpoint: string,
  request: typeof fetch,
) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !projectKey(entry.name)) continue;
    const store = ProjectStore.openExisting(projectDirectory(root, entry.name));
    if (!store) throw new Error("项目状态无法确认，保留生成服务");
    try {
      const snapshot = store.loadCurrent()?.snapshot;
      if (!snapshot) throw new Error("项目状态无法确认，保留生成服务");
      if (
        snapshot.runs.some(
          (run) =>
            (!run.workerId || run.workerId === workerId) &&
            !["completed", "failed", "cancelled"].includes(run.status),
        )
      )
        throw new Error("仍有生成或结果收集任务，保留生成服务");
    } finally {
      store.close();
    }
  }
  const response = await request(`${endpoint}/queue`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("无法确认生成队列，保留服务");
  const queue = (await response.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
  if (
    !Array.isArray(queue.queue_running) ||
    !Array.isArray(queue.queue_pending) ||
    queue.queue_running.length ||
    queue.queue_pending.length
  )
    throw new Error("生成队列非空或不可确认，保留服务");
}

export async function stopOwnedIdleComfy(launcher: ComfyLauncher, idle: () => Promise<void>) {
  if (!(await launcher.canStop?.())) return false;
  await idle();
  if (!(await launcher.canStop?.())) return false;
  await launcher.stop();
  return true;
}

export async function recordInterruptedExit(root: string, workerId: string) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !projectKey(entry.name)) continue;
    const store = ProjectStore.openExisting(projectDirectory(root, entry.name));
    if (!store) continue;
    try {
      const snapshot = store.loadCurrent()?.snapshot;
      if (!snapshot) continue;
      const timestamp = new Date().toISOString();
      const affected = new Set<string>();
      for (const run of snapshot.runs) {
        if (
          (run.workerId && run.workerId !== workerId) ||
          ["completed", "failed", "cancelled"].includes(run.status)
        )
          continue;
        run.status = "orphaned";
        run.errorCode = "EXIT_INTERRUPTED";
        run.errorMessage = "退出时已结束生成服务；此结果未确认，可重新生成";
        run.updatedAt = timestamp;
        affected.add(run.shotId);
      }
      if (!affected.size) continue;
      for (const shot of snapshot.shots) {
        if (!affected.has(shot.id)) continue;
        const active = snapshot.runs.some(
          (run) =>
            run.shotId === shot.id &&
            !["completed", "failed", "cancelled", "orphaned"].includes(run.status),
        );
        if (!active)
          shot.status = shot.approvedTakeId
            ? "approved"
            : snapshot.takes.some(
                  (take) =>
                    take.shotId === shot.id && ["candidate", "approved"].includes(take.status),
                )
              ? "review"
              : "draft";
        shot.updatedAt = timestamp;
      }
      snapshot.project.updatedAt = timestamp;
      snapshot.exportedAt = timestamp;
      await store.save(snapshot, { type: "runs.exit-interrupted", payload: { workerId } });
    } finally {
      store.close();
    }
  }
}
