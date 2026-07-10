import {
  assertDigest,
  assertOpaqueId,
  assertRfc3339,
  parsePositiveInt64,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import {
  assertEffectJournalOutcomeSchema,
  EFFECT_JOURNAL_OUTCOME_KINDS,
} from "./effect-journal.js";
import type {
  CheckpointDurabilityReceiptV1,
  GitPromotionReceiptRefV1,
  OperationRecordV1,
  SandboxDestroyTombstoneV1,
  ExternalOperationAnchorRecordV1,
  SandboxEventV1,
  SandboxV1,
  SealedProviderHandleV1,
  StoredSafetyFenceObservationV1,
} from "./types.js";
import { SCHEMA_VERSION } from "./types.js";

export function assertExternalOperationAnchorRecordV1(
  record: ExternalOperationAnchorRecordV1,
): void {
  const base = [
    "schema_version",
    "operation_id",
    "operation_step_id",
    "operation_execution_epoch",
    "journal_sequence",
    "prior_frontier_digest",
    "record_digest",
    "frontier_digest",
    "envelope_digest",
    "recorded_at",
  ];
  const effect = ["outcome_schema_version", "outcome_schema_digest"];
  const isReadProbe = "anchor_kind" in record;
  const allowed = new Set(
    isReadProbe
      ? [...base, "anchor_kind"]
      : record.record_kind === "OUTCOME"
        ? [...base, "record_kind", ...effect, "outcome_kind"]
        : [...base, "record_kind", ...effect],
  );
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new SandboxError("validation_failed", "External anchor contains unknown fields");
  }
  if (record.schema_version !== SCHEMA_VERSION) {
    throw new SandboxError("protocol_incompatible", "External anchor schema version mismatch");
  }
  assertOpaqueId(record.operation_id, "external_anchor.operation_id", "op");
  assertOpaqueId(record.operation_step_id, "external_anchor.operation_step_id", "step");
  parsePositiveInt64(record.operation_execution_epoch, "external_anchor.operation_execution_epoch");
  parsePositiveInt64(record.journal_sequence, "external_anchor.journal_sequence");
  assertDigest(record.prior_frontier_digest, "external_anchor.prior_frontier_digest");
  assertDigest(record.record_digest, "external_anchor.record_digest");
  assertDigest(record.frontier_digest, "external_anchor.frontier_digest");
  assertDigest(record.envelope_digest, "external_anchor.envelope_digest");
  assertRfc3339(record.recorded_at, "external_anchor.recorded_at");
  if (!isReadProbe) {
    assertEffectJournalOutcomeSchema(
      record.outcome_schema_version,
      record.outcome_schema_digest,
    );
  }
  if (
    !isReadProbe &&
    record.record_kind === "OUTCOME" &&
    !EFFECT_JOURNAL_OUTCOME_KINDS.includes(record.outcome_kind)
  ) {
    throw new SandboxError("validation_failed", "External OUTCOME kind is not allowed");
  }
}

export interface RepositoryHealthV1 {
  backend: "memory" | "sqlite" | "postgres";
  schema_version: number;
  integrity: "ok";
  sandbox_count: number;
  operation_count: number;
}

export interface SandboxRepositoryTxV1 {
  databaseTime(): Date;
  getSandbox(resourceId: string): SandboxV1 | undefined;
  listSandboxes(): SandboxV1[];
  putSandbox(record: SandboxV1, expectedRevision: number | null): void;
  getHandle(resourceId: string): SealedProviderHandleV1 | undefined;
  putHandle(handle: SealedProviderHandleV1): void;
  getOperation(operationId: string): OperationRecordV1 | undefined;
  findIdempotentOperation(
    actorPrincipal: string,
    operation: string,
    resourceId: string,
    idempotencyKeySha256: string,
  ): OperationRecordV1 | undefined;
  insertOperation(record: OperationRecordV1): void;
  updateOperation(record: OperationRecordV1): void;
  compareAndSwapOperationPhase(
    operationId: string,
    expectedPhases: ReadonlyArray<OperationRecordV1["effect_phase"]>,
    nextPhase: OperationRecordV1["effect_phase"],
    updatedAt: string,
  ): OperationRecordV1;
  appendExternalAnchor(record: ExternalOperationAnchorRecordV1): void;
  listExternalAnchors(operationId: string): ExternalOperationAnchorRecordV1[];
  consumeCapabilityUse(capabilityUseSha256: string, operationId: string): void;
  getCapabilityUseOperation(capabilityUseSha256: string): string | undefined;
  consumeActivationGrant(grantUseSha256: string, operationId: string): void;
  getActivationGrantUseOperation(grantUseSha256: string): string | undefined;
  consumeCleanupGrant(grantUseSha256: string, operationId: string): void;
  getCleanupGrantUseOperation(grantUseSha256: string): string | undefined;
  putCheckpointReceipt(receipt: CheckpointDurabilityReceiptV1): void;
  getCheckpointReceipt(receiptSha256: string): CheckpointDurabilityReceiptV1 | undefined;
  putGitPromotionReceipt(receipt: GitPromotionReceiptRefV1): void;
  getGitPromotionReceipt(receiptSha256: string): GitPromotionReceiptRefV1 | undefined;
  appendSafetyFenceObservation(record: StoredSafetyFenceObservationV1): void;
  listSafetyFenceObservations(resourceId: string): StoredSafetyFenceObservationV1[];
  putDestroyTombstone(record: SandboxDestroyTombstoneV1): void;
  getDestroyTombstone(resourceId: string): SandboxDestroyTombstoneV1 | undefined;
  appendEvent(event: Omit<SandboxEventV1, "sequence">): SandboxEventV1;
  listEvents(resourceId: string): SandboxEventV1[];
}

export interface SandboxRepositoryV1 {
  readonly backend: "memory" | "sqlite" | "postgres";
  migrate(): void;
  databaseTime(): Promise<Date>;
  transaction<T>(fn: (tx: SandboxRepositoryTxV1) => T): Promise<T>;
  health(): Promise<RepositoryHealthV1>;
  close(): Promise<void>;
}
