import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { acquireProjectLock } from "./project-request-lock.js";
import { projectKey } from "./project-routes.js";
import { ProjectStore } from "./storage/project-store.js";

const terminal = new Set(["completed", "failed", "cancelled"]);

/** Owns collection independently of browser sessions. One pass at a time, bounded
 * project concurrency, and the same lock as edits/deletion/HTTP reconciliation.
 */
export function registerRunReconciler(
  app: FastifyInstance,
  root: string,
  reconcile: (key: string, runId: string) => Promise<unknown>,
  intervalMs = 3_000,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  const tick = async () => {
    const entries = await readdir(root, { withFileTypes: true });
    const keys = entries
      .filter((entry) => entry.isDirectory() && projectKey(entry.name))
      .map((entry) => entry.name);
    const worker = async () => {
      while (!stopped && keys.length) {
        const key = keys.shift();
        if (!key) return;
        let runIds: string[] = [];
        const releaseRead = await acquireProjectLock(key);
        try {
          if (stopped) return;
          const store = ProjectStore.openExisting(join(root, key));
          if (!store) continue;
          try {
            runIds =
              store
                .loadCurrent()
                ?.snapshot.runs.filter(
                  (run) => !terminal.has(run.status) && (run.status !== "orphaned" || run.promptId),
                )
                .map((run) => run.id) ?? [];
          } finally {
            store.close();
          }
        } catch (error) {
          app.log.warn({ err: error, projectKey: key }, "Cannot inspect project tasks");
          continue;
        } finally {
          releaseRead();
        }
        for (const runId of runIds) {
          if (stopped) return;
          const release = await acquireProjectLock(key);
          try {
            if (!stopped) await reconcile(key, runId);
          } catch (error) {
            // Offline endpoints and concurrently deleted projects must not stop other workers.
            app.log.warn({ err: error, projectKey: key, runId }, "Task reconciliation deferred");
          } finally {
            release();
          }
        }
      }
    };
    await Promise.all([worker(), worker()]);
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = tick()
        .catch((error) => app.log.warn({ err: error }, "Task scan deferred"))
        .finally(() => {
          inFlight = null;
          schedule();
        });
    }, intervalMs);
    timer.unref();
  };
  app.addHook("onReady", async () => schedule());
  app.addHook("preClose", async () => {
    stopped = true;
    clearTimeout(timer);
    await inFlight;
  });
}
