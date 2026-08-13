import type { Run, RunStatus } from "@takeboard/contracts";
import { DomainError } from "./errors.js";

const allowedTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  draft: ["validating", "cancelled"],
  validating: ["uploading_inputs", "queued", "failed", "cancelled"],
  uploading_inputs: ["queued", "failed", "cancelled"],
  queued: ["running", "failed", "cancelled", "orphaned"],
  running: ["collecting_outputs", "failed", "cancelled", "orphaned"],
  collecting_outputs: ["completed", "failed", "orphaned"],
  completed: [],
  failed: [],
  cancelled: [],
  orphaned: ["reconciling", "cancelled"],
  reconciling: [
    "queued",
    "running",
    "collecting_outputs",
    "completed",
    "failed",
    "cancelled",
    "orphaned",
  ],
};

export function canTransitionRun(from: RunStatus, to: RunStatus) {
  return allowedTransitions[from].includes(to);
}

export type RunTransitionDetails = {
  at: string;
  errorCode?: string;
  errorMessage?: string;
};

export function transitionRun(run: Run, nextStatus: RunStatus, details: RunTransitionDetails): Run {
  if (!canTransitionRun(run.status, nextStatus)) {
    throw new DomainError(
      "INVALID_RUN_TRANSITION",
      `Run cannot transition from ${run.status} to ${nextStatus}`,
    );
  }

  if (nextStatus === "failed" && !details.errorCode) {
    throw new DomainError("RUN_FAILURE_WITHOUT_CODE", "A failed run must record an error code");
  }

  const failed = nextStatus === "failed";
  return {
    ...run,
    status: nextStatus,
    updatedAt: details.at,
    errorCode: failed ? (details.errorCode ?? null) : null,
    errorMessage: failed ? (details.errorMessage ?? null) : null,
  };
}
