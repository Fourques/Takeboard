import type {
  Approval,
  BatchApprovalDecision,
  CostAggregate,
  ProjectCostSummary,
  ProjectSnapshot,
  Run,
  RunCost,
  Shot,
  Take,
} from "@takeboard/contracts";
import { approveTake } from "./approval.js";
import { DomainError } from "./errors.js";

function effectiveCost(run: Run): RunCost {
  return run.actualCost.accuracy !== "unknown" ? run.actualCost : run.estimatedCost;
}

function aggregateCosts(runs: readonly Run[]): CostAggregate[] {
  const currencies = new Map<
    string,
    {
      knownAmount: number;
      exactRunCount: number;
      estimatedRunCount: number;
      unknownRunCount: number;
    }
  >();
  for (const run of runs) {
    const cost = effectiveCost(run);
    const aggregate = currencies.get(cost.currency) ?? {
      knownAmount: 0,
      exactRunCount: 0,
      estimatedRunCount: 0,
      unknownRunCount: 0,
    };
    if (cost.accuracy === "unknown" || cost.amount === null) {
      aggregate.unknownRunCount += 1;
    } else {
      aggregate.knownAmount += cost.amount;
      if (cost.accuracy === "exact") aggregate.exactRunCount += 1;
      else aggregate.estimatedRunCount += 1;
    }
    currencies.set(cost.currency, aggregate);
  }
  return [...currencies.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, aggregate]) => ({
      currency,
      ...aggregate,
      knownAmount: Number(aggregate.knownAmount.toFixed(6)),
      accuracy:
        aggregate.unknownRunCount > 0
          ? ("unknown" as const)
          : aggregate.estimatedRunCount > 0
            ? ("estimated" as const)
            : ("exact" as const),
    }));
}

export function summarizeProjectCosts(
  snapshot: ProjectSnapshot,
  generatedAt: string,
): ProjectCostSummary {
  const candidateShotIds = new Set(snapshot.takes.map((take) => take.shotId));
  const approvedShots = snapshot.shots.filter((shot) => shot.approvedTakeId !== null);
  const approvedDurationSeconds = approvedShots.reduce(
    (total, shot) => total + shot.durationSeconds,
    0,
  );
  const totals = aggregateCosts(snapshot.runs);
  return {
    generatedAt,
    runCount: snapshot.runs.length,
    completedRunCount: snapshot.runs.filter((run) => run.status === "completed").length,
    candidateShotCount: candidateShotIds.size,
    approvedShotCount: approvedShots.length,
    acceptanceRate: candidateShotIds.size > 0 ? approvedShots.length / candidateShotIds.size : null,
    approvedDurationSeconds,
    totals,
    finishedMinuteCosts: totals.map((total) => ({
      currency: total.currency,
      amountPerMinute:
        approvedDurationSeconds > 0 && total.accuracy !== "unknown"
          ? Number((total.knownAmount / (approvedDurationSeconds / 60)).toFixed(6))
          : null,
      accuracy: total.accuracy,
      knownAmountFloor: total.knownAmount,
    })),
    shots: snapshot.shots.map((shot) => {
      const approvedTake = snapshot.takes.find((take) => take.id === shot.approvedTakeId) ?? null;
      const runs = snapshot.runs.filter((run) => run.shotId === shot.id);
      return {
        shotId: shot.id,
        shotTitle: shot.label,
        runCount: runs.length,
        approvedTakeId: approvedTake?.id ?? null,
        approvedAssetId: approvedTake?.assetId ?? null,
        totals: aggregateCosts(runs),
      };
    }),
  };
}

export type BatchApproveInput = {
  shots: readonly Shot[];
  takes: readonly Take[];
  approvals: readonly Approval[];
  decisions: readonly BatchApprovalDecision[];
  approvalIds: readonly string[];
  at: string;
  actorUserId?: string | null;
  actorName?: string | null;
};

export type BatchApprovalResult = {
  shots: Shot[];
  takes: Take[];
  approvals: Approval[];
};

export function approveTakesBatch(input: BatchApproveInput): BatchApprovalResult {
  if (input.decisions.length === 0) {
    throw new DomainError("APPROVAL_BATCH_EMPTY", "At least one approval decision is required");
  }
  if (input.approvalIds.length !== input.decisions.length) {
    throw new DomainError("APPROVAL_ID_COUNT", "Every decision requires a unique approval ID");
  }
  const uniqueShotIds = new Set(input.decisions.map((decision) => decision.shotId));
  const uniqueTakeIds = new Set(input.decisions.map((decision) => decision.takeId));
  const uniqueApprovalIds = new Set(input.approvalIds);
  if (uniqueShotIds.size !== input.decisions.length) {
    throw new DomainError(
      "APPROVAL_DUPLICATE_SHOT",
      "A batch can contain only one decision for each shot",
    );
  }
  if (uniqueTakeIds.size !== input.decisions.length) {
    throw new DomainError(
      "APPROVAL_DUPLICATE_TAKE",
      "A take cannot be approved twice in one batch",
    );
  }
  if (uniqueApprovalIds.size !== input.approvalIds.length) {
    throw new DomainError("APPROVAL_DUPLICATE_ID", "Approval IDs must be unique");
  }

  // Validate the complete batch before mutating any derived state so callers get atomic behavior.
  for (const decision of input.decisions) {
    const shot = input.shots.find((candidate) => candidate.id === decision.shotId);
    const take = input.takes.find((candidate) => candidate.id === decision.takeId);
    if (!shot) throw new DomainError("SHOT_NOT_FOUND", `Shot ${decision.shotId} was not found`);
    if (!take) throw new DomainError("TAKE_NOT_FOUND", `Take ${decision.takeId} was not found`);
    if (take.shotId !== shot.id) {
      throw new DomainError("TAKE_SHOT_MISMATCH", "A take can only be approved for its own shot");
    }
    if (take.status === "media_missing") {
      throw new DomainError("TAKE_MEDIA_MISSING", "A take with missing media cannot be approved");
    }
  }

  let shots = input.shots.map((shot) => ({ ...shot }));
  let takes = input.takes.map((take) => ({ ...take }));
  let approvals = input.approvals.map((approval) => ({ ...approval }));
  input.decisions.forEach((decision, index) => {
    const shot = shots.find((candidate) => candidate.id === decision.shotId);
    const approvalId = input.approvalIds[index];
    if (!shot || !approvalId) return;
    const result = approveTake({
      shot,
      takes,
      approvals,
      takeId: decision.takeId,
      approvalId,
      at: input.at,
      reason: decision.reason,
      ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
      ...(input.actorName === undefined ? {} : { actorName: input.actorName }),
    });
    shots = shots.map((candidate) => (candidate.id === shot.id ? result.shot : candidate));
    takes = result.takes;
    approvals = result.approvals;
  });
  return { shots, takes, approvals };
}
