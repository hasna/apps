import type { ActorRef, BankingIntent } from "./intents.ts";
import { createIntentFingerprint } from "./idempotency.ts";
import type { PolicySnapshot } from "./policy.ts";

export type ApprovalDecision = "granted" | "rejected" | "expired";

export interface ApprovalInput {
  readonly id: string;
  readonly intent: BankingIntent;
  readonly requestedBy?: ActorRef;
  readonly decidedBy: ActorRef;
  readonly decision: Exclude<ApprovalDecision, "expired">;
  readonly policySnapshot: PolicySnapshot;
  readonly expiresAt: string;
  readonly decidedAt?: string;
  readonly signatureRef?: string;
  readonly reason?: string;
}

export interface ApprovalRecord {
  readonly id: string;
  readonly intentId: string;
  readonly requestedBy: ActorRef;
  readonly decidedBy: ActorRef;
  readonly intentIdempotencyKey: string;
  readonly intentPayloadHash: string;
  readonly decision: ApprovalDecision;
  readonly decidedAt: string;
  readonly expiresAt: string;
  readonly policySnapshot: PolicySnapshot;
  readonly signatureRef?: string;
  readonly reason?: string;
}

export interface ApprovalExecutionDecision {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

export function createApprovalRecord(input: ApprovalInput): ApprovalRecord {
  const fingerprint = createIntentFingerprint(input.intent);
  return {
    id: input.id,
    intentId: input.intent.id,
    requestedBy: input.requestedBy ?? input.intent.requester,
    decidedBy: input.decidedBy,
    intentIdempotencyKey: input.intent.idempotencyKey,
    intentPayloadHash: fingerprint.payloadHash,
    decision: input.decision,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
    expiresAt: input.expiresAt,
    policySnapshot: input.policySnapshot,
    ...(input.signatureRef ? { signatureRef: input.signatureRef } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export function canExecuteWithApproval(intent: BankingIntent, approval: ApprovalRecord, now = new Date()): ApprovalExecutionDecision {
  const reasons: string[] = [];
  const expiresAt = Date.parse(approval.expiresAt);
  const decidedAt = Date.parse(approval.decidedAt);

  if (approval.intentId !== intent.id) {
    reasons.push("Approval does not belong to the intent.");
  }
  if (approval.intentIdempotencyKey !== intent.idempotencyKey) {
    reasons.push("Approval idempotency key does not match the intent.");
  }
  if (approval.intentPayloadHash !== createIntentFingerprint(intent).payloadHash) {
    reasons.push("Approval payload hash does not match the current intent.");
  }
  if (approval.decision !== "granted") {
    reasons.push(`Approval is ${approval.decision}.`);
  }
  if (!Number.isFinite(decidedAt)) {
    reasons.push("Approval decidedAt timestamp is invalid.");
  }
  if (!Number.isFinite(expiresAt)) {
    reasons.push("Approval expiresAt timestamp is invalid.");
  } else if (expiresAt <= now.getTime()) {
    reasons.push("Approval is expired.");
  }
  if (approval.decidedBy.id === intent.requester.id) {
    reasons.push("Maker-checker policy requires a different approver.");
  }
  if (approval.decidedBy.type !== "human") {
    reasons.push("Approval must be decided by a human approver.");
  }
  if (approval.policySnapshot.providerId !== intent.providerId || approval.policySnapshot.intentType !== intent.type) {
    reasons.push("Approval policy snapshot does not match the intent.");
  }

  return {
    allowed: reasons.length === 0,
    reasons: reasons.length === 0 ? ["Approval permits execution."] : reasons,
  };
}
