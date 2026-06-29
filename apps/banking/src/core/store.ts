import type { ApprovalRecord } from "./approvals.ts";
import type { AuditEvent } from "./audit.ts";
import type { IdempotencyFingerprint, IdempotencyReplayDecision } from "./idempotency.ts";
import type { BankingIntent } from "./intents.ts";
import type { ReconciliationRecord } from "./reconciliation.ts";

export interface BankingCoreStore {
  readonly mode: "dev" | "production";
  reserveIdempotency(fingerprint: IdempotencyFingerprint): Promise<IdempotencyReplayDecision>;
  saveIntent(intent: BankingIntent, fingerprint: IdempotencyFingerprint): Promise<void>;
  getIntent(id: string): Promise<BankingIntent | undefined>;
  getIntentFingerprint(intentId: string): Promise<IdempotencyFingerprint | undefined>;
  saveApproval(approval: ApprovalRecord): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<void>;
  saveReconciliation(record: ReconciliationRecord): Promise<void>;
}

export interface DevOnlyStore extends BankingCoreStore {
  readonly mode: "dev";
  reset(): Promise<void>;
}
