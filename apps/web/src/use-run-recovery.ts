import type { ProjectSnapshot } from "@takeboard/contracts";
import { useEffect, useRef } from "react";
import { projectApi } from "./api";

type Run = Pick<
  ProjectSnapshot["runs"][number],
  "id" | "shotId" | "status" | "createdAt" | "promptId"
>;
type Options = {
  enabled: boolean;
  projectKey: string | null;
  selectedShotId: string | null;
  runs: readonly Run[];
  onResult: (result: Awaited<ReturnType<typeof projectApi.run>>, run: Run) => void;
  onPending: (run: Run | null) => void;
  onError: (error: unknown) => void;
};

/** View subscription only. Backend reconciliation survives this hook unmounting.
 * Snapshot revisions must not restart a loop midway through a multi-run batch.
 */
export function useRunRecovery(options: Options) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const { enabled, projectKey, selectedShotId } = options;
  const runSignature = JSON.stringify(
    options.runs
      .filter(
        (run) =>
          !["completed", "failed", "cancelled"].includes(run.status) &&
          (run.status !== "orphaned" || run.promptId),
      )
      .map(({ id, shotId, status, createdAt, promptId }) => ({
        id,
        shotId,
        status,
        createdAt,
        promptId,
      })),
  );

  useEffect(() => {
    if (!enabled || !projectKey) return;
    const runs = JSON.parse(runSignature) as Run[];
    callbacks.current.onPending(
      [...runs].reverse().find((run) => run.shotId === selectedShotId) ?? null,
    );
    if (!runs.length) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      for (const run of runs) {
        if (stopped) return;
        try {
          const result = await projectApi.run(projectKey, run.id);
          if (!stopped) callbacks.current.onResult(result, run);
        } catch (error) {
          if (!stopped) callbacks.current.onError(error);
          // One disconnected worker must not starve the other runs.
        }
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 3_000);
    };
    timer = window.setTimeout(() => void poll(), 1_000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [enabled, projectKey, runSignature, selectedShotId]);
}
