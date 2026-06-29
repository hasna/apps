import type { ActorRef, BankingIntent } from "./intents.ts";
import { createIntentFingerprint } from "./idempotency.ts";
import type { PolicySnapshot } from "./policy.ts";

export type ApprovalDecision = "granted" | "rejected" | "expired";

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

export function canExecuteWithApproval(intent: BankingIntent, approval: ApprovalRecord, now = new Date()): ApprovalExecutionDecision {
  const reasons: string[] = [];

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
  if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
    reasons.push("Approval is expired.");
  }
  if (approval.decidedBy.id === intent.requester.id) {
    reasons.push("Maker-checker policy requires a different approver.");
  }
  if (approval.policySnapshot.providerId !== intent.providerId || approval.policySnapshot.intentType !== intent.type) {
    reasons.push("Approval policy snapshot does not match the intent.");
  }

  return {
    allowed: reasons.length === 0,
    reasons: reasons.length === 0 ? ["Approval permits execution."] : reasons,
  };
}
