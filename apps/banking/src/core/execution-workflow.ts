import { createApprovalRecord, canExecuteWithApproval, type ApprovalRecord } from "./approvals.ts";
import { appendAuditLedgerEvent, type AuditEvent } from "./audit.ts";
import type { IntentEnvelope } from "./builders.ts";
import { hashPayload } from "./idempotency.ts";
import type { ActorRef, BankingIntent } from "./intents.ts";
import type { ProviderEvent, ReconciliationRecord } from "./reconciliation.ts";
import { createReconciliationHook } from "./reconciliation.ts";
import type { BankingCoreStore, OutboxEntry } from "./store.ts";

export type ExecutionWorkflowStatus =
  | "submitted"
  | "approval_required"
  | "denied"
  | "replay"
  | "conflict"
  | "approved"
  | "dry_run_ready"
  | "dry_run_sent"
  | "cancelled"
  | "retry_pending"
  | "reconciled";

export interface ExecutionWorkflowResult {
  readonly status: ExecutionWorkflowStatus;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly reasons: readonly string[];
  readonly outboxId?: string;
  readonly approvalId?: string;
  readonly reconciliationId?: string;
}

export interface SubmitExecutionInput<TIntent extends BankingIntent = BankingIntent> {
  readonly store: BankingCoreStore;
  readonly envelope: IntentEnvelope<TIntent>;
  readonly actor: ActorRef;
  readonly now?: Date;
}

export interface ApproveExecutionInput {
  readonly store: BankingCoreStore;
  readonly intentId: string;
  readonly decidedBy: ActorRef;
  readonly decision: "granted" | "rejected";
  readonly expiresAt: string;
  readonly reason?: string;
  readonly signatureRef?: string;
  readonly now?: Date;
}

export interface ExecuteDryRunInput {
  readonly store: BankingCoreStore;
  readonly outboxId: string;
  readonly actor: ActorRef;
  readonly now?: Date;
}

export interface CancelExecutionInput {
  readonly store: BankingCoreStore;
  readonly intentId: string;
  readonly actor: ActorRef;
  readonly reason: string;
  readonly now?: Date;
}

export interface RetryExecutionInput {
  readonly store: BankingCoreStore;
  readonly outboxId: string;
  readonly actor: ActorRef;
  readonly reason: string;
  readonly now?: Date;
}

export interface ReconcileExecutionInput {
  readonly store: BankingCoreStore;
  readonly intentId?: string;
  readonly providerEvent: ProviderEvent;
  readonly expectedIntent?: BankingIntent;
  readonly actor: ActorRef;
  readonly now?: Date;
}

export async function submitExecutionRequest(input: SubmitExecutionInput): Promise<ExecutionWorkflowResult> {
  const { store, envelope, actor } = input;
  const replay = await store.reserveIdempotency(envelope.fingerprint);
  if (replay.status === "conflict") {
    return {
      status: "conflict",
      intentId: envelope.intent.id,
      idempotencyKey: envelope.fingerprint.key,
      reasons: [replay.reason ?? "Idempotency conflict."],
    };
  }
  if (replay.status === "replay") {
    return {
      status: "replay",
      intentId: envelope.intent.id,
      idempotencyKey: envelope.fingerprint.key,
      reasons: ["Existing idempotency reservation matches this request."],
    };
  }

  await store.saveIntent(envelope.intent, envelope.fingerprint);
  await store.appendAuditEvent(audit({
    type: "intent.created",
    actor,
    subjectId: envelope.intent.id,
    metadata: {
      providerId: envelope.intent.providerId,
      intentType: envelope.intent.type,
      idempotencyKey: envelope.intent.idempotencyKey,
      policyDecision: envelope.policyDecision.kind,
      policySnapshot: envelope.policyDecision.snapshot,
    },
    ...maybeNow(input.now),
  }));

  if (envelope.policyDecision.kind === "deny") {
    return {
      status: "denied",
      intentId: envelope.intent.id,
      idempotencyKey: envelope.fingerprint.key,
      reasons: envelope.policyDecision.reasons,
    };
  }
  if (envelope.policyDecision.kind === "requires_approval") {
    return {
      status: "approval_required",
      intentId: envelope.intent.id,
      idempotencyKey: envelope.fingerprint.key,
      reasons: envelope.policyDecision.reasons,
    };
  }

  const outbox = dryRunOutbox(envelope.intent, envelope.policyDecision.snapshot.ruleHash, input.now);
  await store.enqueueOutbox(outbox);
  return {
    status: "dry_run_ready",
    intentId: envelope.intent.id,
    idempotencyKey: envelope.fingerprint.key,
    outboxId: outbox.id,
    reasons: ["Policy allowed the request; dry-run execution plan queued with provider side effects disabled."],
  };
}

export async function approveExecutionRequest(input: ApproveExecutionInput): Promise<ExecutionWorkflowResult> {
  const intent = await requireIntent(input.store, input.intentId);
  const fingerprint = await input.store.getIntentFingerprint(intent.id);
  if (!fingerprint) throw new Error(`Intent fingerprint is missing: ${intent.id}`);
  const approval = createApprovalRecord({
    id: `approval_${hashPayload({ intentId: intent.id, decidedBy: input.decidedBy, at: input.now?.toISOString() }).slice(0, 20)}`,
    intent,
    decidedBy: input.decidedBy,
    decision: input.decision,
    policySnapshot: {
      evaluatedAt: (input.now ?? new Date()).toISOString(),
      providerId: intent.providerId,
      intentType: intent.type,
      liveMode: false,
      environment: "sandbox",
      requireApprovalForProviderSideEffects: true,
      ruleHash: `approval:${fingerprint.payloadHash}`,
    },
    expiresAt: input.expiresAt,
    decidedAt: (input.now ?? new Date()).toISOString(),
    ...(input.signatureRef ? { signatureRef: input.signatureRef } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
  await input.store.saveApproval(approval);
  await input.store.appendAuditEvent(audit({
    type: "approval.decided",
    actor: input.decidedBy,
    subjectId: intent.id,
    metadata: { approvalId: approval.id, decision: approval.decision, reason: approval.reason },
    ...maybeNow(input.now),
  }));

  const execution = canExecuteWithApproval(intent, approval, input.now);
  if (!execution.allowed) {
    return { status: "approved", intentId: intent.id, idempotencyKey: intent.idempotencyKey, approvalId: approval.id, reasons: execution.reasons };
  }

  const outbox = dryRunOutbox(intent, approval.policySnapshot.ruleHash, input.now, approval);
  await input.store.enqueueOutbox(outbox);
  return {
    status: "dry_run_ready",
    intentId: intent.id,
    idempotencyKey: intent.idempotencyKey,
    approvalId: approval.id,
    outboxId: outbox.id,
    reasons: ["Approval permits execution; dry-run execution plan queued with provider side effects disabled."],
  };
}

export async function executeDryRunOutbox(input: ExecuteDryRunInput): Promise<ExecutionWorkflowResult> {
  await input.store.markOutboxStatus(input.outboxId, "processing", input.now);
  await input.store.markOutboxStatus(input.outboxId, "sent", input.now);
  await input.store.appendAuditEvent(audit({
    type: "provider.submitted",
    actor: input.actor,
    subjectId: input.outboxId,
    metadata: { providerSideEffectsEnabled: false, execution: "dry_run_only" },
    ...maybeNow(input.now),
  }));
  return {
    status: "dry_run_sent",
    intentId: input.outboxId,
    idempotencyKey: input.outboxId,
    outboxId: input.outboxId,
    reasons: ["Dry-run plan marked sent; no provider side effects were executed."],
  };
}

export async function cancelExecutionRequest(input: CancelExecutionInput): Promise<ExecutionWorkflowResult> {
  const intent = await requireIntent(input.store, input.intentId);
  await input.store.appendAuditEvent(audit({
    type: "workflow.cancelled",
    actor: input.actor,
    subjectId: intent.id,
    metadata: { reason: input.reason },
    ...maybeNow(input.now),
  }));
  return { status: "cancelled", intentId: intent.id, idempotencyKey: intent.idempotencyKey, reasons: [input.reason] };
}

export async function retryExecutionOutbox(input: RetryExecutionInput): Promise<ExecutionWorkflowResult> {
  await input.store.markOutboxStatus(input.outboxId, "pending", input.now);
  await input.store.appendAuditEvent(audit({
    type: "workflow.retry_requested",
    actor: input.actor,
    subjectId: input.outboxId,
    metadata: { reason: input.reason },
    ...maybeNow(input.now),
  }));
  return {
    status: "retry_pending",
    intentId: input.outboxId,
    idempotencyKey: input.outboxId,
    outboxId: input.outboxId,
    reasons: [input.reason],
  };
}

export async function reconcileExecution(input: ReconcileExecutionInput): Promise<ExecutionWorkflowResult> {
  const expectedAmount = input.expectedIntent && "amount" in input.expectedIntent ? input.expectedIntent.amount : undefined;
  const record: ReconciliationRecord = createReconciliationHook({
    ...(input.intentId ? { intentId: input.intentId } : {}),
    providerEvent: input.providerEvent,
    ...(expectedAmount ? { expectedAmount } : {}),
  });
  await input.store.saveReconciliation(record);
  await input.store.appendAuditEvent(audit({
    type: "reconciliation.updated",
    actor: input.actor,
    subjectId: input.intentId ?? input.providerEvent.id,
    metadata: { reconciliationId: record.id, status: record.status, reasons: record.reasons },
    ...maybeNow(input.now),
  }));
  return {
    status: "reconciled",
    intentId: input.intentId ?? input.providerEvent.id,
    idempotencyKey: record.providerEventId,
    reconciliationId: record.id,
    reasons: record.reasons,
  };
}

async function requireIntent(store: BankingCoreStore, intentId: string): Promise<BankingIntent> {
  const intent = await store.getIntent(intentId);
  if (!intent) throw new Error(`Intent does not exist: ${intentId}`);
  return intent;
}

function dryRunOutbox(intent: BankingIntent, policySnapshotHash: string, now = new Date(), approval?: ApprovalRecord): OutboxEntry {
  const createdAt = now.toISOString();
  return {
    id: `outbox_${hashPayload({ intentId: intent.id, approvalId: approval?.id, policySnapshotHash }).slice(0, 20)}`,
    topic: "provider.dry_run",
    status: "pending",
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
    payload: {
      intentId: intent.id,
      providerId: intent.providerId,
      intentType: intent.type,
      approvalId: approval?.id,
      policySnapshotHash,
      providerSideEffectsEnabled: false,
      executionMode: "dry_run_only",
      releaseGates: ["approval", "idempotency", "audit", "provider_sandbox", "reconciliation", "rollback_disable"],
    },
  };
}

function audit(input: {
  readonly type: AuditEvent["type"];
  readonly actor: ActorRef;
  readonly subjectId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly now?: Date;
}): AuditEvent {
  return appendAuditLedgerEvent({
    id: `audit_${hashPayload({ type: input.type, subjectId: input.subjectId, metadata: input.metadata, at: input.now?.toISOString() }).slice(0, 20)}`,
    type: input.type,
    actor: input.actor,
    occurredAt: (input.now ?? new Date()).toISOString(),
    subjectId: input.subjectId,
    metadata: input.metadata,
  });
}

function maybeNow(now: Date | undefined): { readonly now?: Date } {
  return now ? { now } : {};
}
