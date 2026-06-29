import type { ApprovalRecord } from "./approvals.ts";
import type { AuditEvent } from "./audit.ts";
import type { IdempotencyFingerprint, IdempotencyReplayDecision } from "./idempotency.ts";
import type { BankingIntent } from "./intents.ts";
import type { ReconciliationRecord } from "./reconciliation.ts";

export type OutboxStatus = "pending" | "processing" | "sent" | "failed";

export interface OutboxEntry {
  readonly id: string;
  readonly topic: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BankingCoreStore {
  readonly mode: "dev" | "production";
  reserveIdempotency(fingerprint: IdempotencyFingerprint): Promise<IdempotencyReplayDecision>;
  saveIntent(intent: BankingIntent, fingerprint: IdempotencyFingerprint): Promise<void>;
  getIntent(id: string): Promise<BankingIntent | undefined>;
  getIntentFingerprint(intentId: string): Promise<IdempotencyFingerprint | undefined>;
  saveApproval(approval: ApprovalRecord): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<void>;
  saveReconciliation(record: ReconciliationRecord): Promise<void>;
  enqueueOutbox(entry: OutboxEntry): Promise<void>;
  listPendingOutbox(limit?: number): Promise<readonly OutboxEntry[]>;
  markOutboxStatus(id: string, status: OutboxStatus, now?: Date): Promise<void>;
}

export interface DevOnlyStore extends BankingCoreStore {
  readonly mode: "dev";
  reset(): Promise<void>;
}
