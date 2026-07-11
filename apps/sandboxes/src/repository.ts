import {
  assertDigest,
  assertOpaqueId,
  assertRfc3339,
  parsePositiveInt64,
  sha256,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import {
  assertEffectJournalOutcomeSchema,
  EFFECT_JOURNAL_OUTCOME_KINDS,
} from "./effect-journal.js";
import type {
  CheckpointDurabilityReceiptV1,
  ExecStreamStateV1,
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

export function assertExecStreamStateTransitionV1(
  expected: ExecStreamStateV1 | null,
  next: ExecStreamStateV1,
): void {
  if (next.schema_version !== "sandboxes.exec-stream-state/v1") {
    throw new SandboxError("protocol_incompatible", "Exec stream state schema version mismatch");
  }
  if (next.phase !== "reserved" && next.phase !== "started") {
    throw new SandboxError("validation_failed", "Exec stream state phase is invalid");
  }
  assertOpaqueId(next.exec_id, "exec_stream_state.exec_id", "exec");
  assertOpaqueId(next.start_operation_id, "exec_stream_state.start_operation_id", "op");
  assertDigest(next.start_request_sha256, "exec_stream_state.start_request_sha256");
  if (next.in_flight_operation_id !== null) {
    assertOpaqueId(next.in_flight_operation_id, "exec_stream_state.in_flight_operation_id", "op");
  }
  assertRfc3339(next.updated_at, "exec_stream_state.updated_at");
  const chainFields = [
    next.cursor,
    next.cursor_sha256,
    next.stream_root_sha256,
    next.resume_token,
    next.resume_token_sha256,
    next.next_expected_sequence,
  ];
  if (
    (next.phase === "reserved" && (
      chainFields.some((value) => value !== null) || next.terminal
    )) ||
    (next.phase === "started" && chainFields.some((value) => value === null))
  ) {
    throw new SandboxError("integrity_failed", "Exec stream phase and chain fields are inconsistent");
  }
  if (next.phase === "started") {
    if (
      sha256(next.cursor!) !== next.cursor_sha256 ||
      sha256(next.resume_token!) !== next.resume_token_sha256 ||
      next.next_expected_sequence! < 1n
    ) {
      throw new SandboxError("integrity_failed", "Exec stream chain digests or sequence differ");
    }
    assertDigest(next.stream_root_sha256!, "exec_stream_state.stream_root_sha256");
  }
  if (expected === null) return;
  if (
    expected.resource_id !== next.resource_id ||
    expected.exec_id !== next.exec_id ||
    expected.resource_lifecycle_generation !== next.resource_lifecycle_generation ||
    expected.start_operation_id !== next.start_operation_id ||
    expected.start_request_sha256 !== next.start_request_sha256
  ) {
    throw new SandboxError("integrity_failed", "Exec stream CAS changed immutable identity");
  }
  if (
    (expected.phase === "started" && next.phase !== "started") ||
    (expected.terminal && !next.terminal)
  ) {
    throw new SandboxError("integrity_failed", "Exec stream CAS regressed durable state");
  }
}

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
  getExecStreamState(resourceId: string, execId: string): ExecStreamStateV1 | undefined;
  compareAndSwapExecStreamState(
    expected: ExecStreamStateV1 | null,
    next: ExecStreamStateV1,
  ): void;
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
