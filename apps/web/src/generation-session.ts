import type { Run } from "@takeboard/contracts";
import type { GenerationProgress } from "./generation-model";

type ProgressRun = Pick<Run, "id" | "shotId" | "status" | "parameters" | "createdAt">;

export function batchGenerationProgress(
  runs: readonly ProgressRun[],
  shotId: string,
): GenerationProgress | null {
  const last = [...runs].reverse().find((run) => run.shotId === shotId);
  const batchId = last?.parameters.candidateBatchId;
  if (typeof batchId !== "string") return null;
  const candidates = new Map<string | number, ProgressRun>();
  for (const run of runs)
    if (run.shotId === shotId && run.parameters.candidateBatchId === batchId) {
      const index = run.parameters.candidateIndex;
      candidates.set(typeof index === "number" ? index : run.id, run);
    }
  const current = [...candidates.values()];
  if (
    current.length < 2 ||
    current.every((run) => ["completed", "failed", "cancelled", "orphaned"].includes(run.status))
  )
    return null;
  const completed = current.filter((run) => run.status === "completed").length;
  const collecting = current.filter((run) => run.status === "collecting_outputs").length;
  const failed = current.filter((run) =>
    ["failed", "cancelled", "orphaned"].includes(run.status),
  ).length;
  const running = current.length - completed - collecting - failed;
  return {
    phase: running ? "running" : "collecting",
    label: `候选结果 · ${completed}/${current.length} 已保存`,
    detail: `${running} 生成中 · ${collecting} 保存中${failed ? ` · ${failed} 失败` : ""}`,
    percent: Math.round((completed / current.length) * 100),
    elapsedSeconds: Math.max(
      0,
      Math.round((Date.now() - Date.parse(current[0]?.createdAt ?? "")) / 1000),
    ),
  };
}

export function cancellableRunIds(runs: readonly Run[], shotId: string): string[] {
  return runs
    .filter(
      (run) => run.shotId === shotId && !["completed", "failed", "cancelled"].includes(run.status),
    )
    .map((run) => run.id);
}

/** Submit in order so each request sees the revision returned by its predecessor.
 * Never retry an ambiguous submission automatically: it may already consume GPU time.
 */
export async function submitCandidates<T, R>(
  candidates: readonly T[],
  submit: (candidate: T, index: number) => Promise<R>,
  isCurrent: () => boolean = () => true,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (!isCurrent()) break;
    try {
      results.push({ status: "fulfilled", value: await submit(candidate, index) });
    } catch (reason) {
      results.push({ status: "rejected", reason });
      // Refresh/review the project before submitting any remaining candidates.
      break;
    }
  }
  return results;
}
