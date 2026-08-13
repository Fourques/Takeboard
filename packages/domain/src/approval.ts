import type { Approval, Shot, Take } from "@takeboard/contracts";
import { DomainError } from "./errors.js";

export type ApproveTakeInput = {
  shot: Shot;
  takes: readonly Take[];
  approvals: readonly Approval[];
  takeId: string;
  approvalId: string;
  at: string;
  reason?: string | null;
};

export type ApprovalResult = {
  shot: Shot;
  takes: Take[];
  approvals: Approval[];
};

export function approveTake(input: ApproveTakeInput): ApprovalResult {
  const target = input.takes.find((take) => take.id === input.takeId);
  if (!target) {
    throw new DomainError("TAKE_NOT_FOUND", `Take ${input.takeId} was not found`);
  }
  if (target.shotId !== input.shot.id) {
    throw new DomainError("TAKE_SHOT_MISMATCH", "A take can only be approved for its own shot");
  }
  if (target.status === "media_missing") {
    throw new DomainError("TAKE_MEDIA_MISSING", "A take with missing media cannot be approved");
  }
  if (input.approvals.some((approval) => approval.id === input.approvalId)) {
    throw new DomainError("APPROVAL_ID_EXISTS", `Approval ${input.approvalId} already exists`);
  }

  const approvals = input.approvals.map((approval): Approval => {
    if (approval.shotId === input.shot.id && approval.status === "active") {
      return { ...approval, status: "revoked", revokedAt: input.at };
    }
    return { ...approval };
  });
  approvals.push({
    id: input.approvalId,
    shotId: input.shot.id,
    takeId: target.id,
    status: "active",
    reason: input.reason ?? null,
    createdAt: input.at,
    revokedAt: null,
  });

  const takes = input.takes.map((take): Take => {
    if (take.shotId !== input.shot.id) {
      return { ...take };
    }
    return {
      ...take,
      status:
        take.id === target.id ? "approved" : take.status === "approved" ? "candidate" : take.status,
      updatedAt: input.at,
    };
  });

  return {
    shot: {
      ...input.shot,
      status: "approved",
      approvedTakeId: target.id,
      updatedAt: input.at,
    },
    takes,
    approvals,
  };
}
