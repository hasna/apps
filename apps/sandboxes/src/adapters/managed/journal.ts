import { canonicalSha256, isDigest, safeEqual } from "./canonical"
import { adapterError } from "./errors"
import type {
  AdapterCallContextV1,
  Digest,
  FailedNoEffectAuthorizationV1,
  AdapterOutcomeAnchorVerifierPortV1,
  JournalAnchorReceiptV1,
  JournalRecordV1,
  ProviderOperationV1,
  OutcomeJournalPortV1,
} from "./types"

export const EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION = "infinity.effect-journal-outcome/v1" as const
export const EFFECT_JOURNAL_OUTCOME_SCHEMA_SHA256 =
  "sha256:7ab380a0475ebf79d2ed925e20bcbb9303d78a56c358d09adbdce796e740bf20" as const

const OUTCOME_KINDS = new Set([
  "succeeded",
  "failed_effect",
  "failed_no_effect",
  "reconciliation_blocked",
])

export function failedNoEffectAuthorizationPayloadSha256(
  authorization: FailedNoEffectAuthorizationV1,
): Digest {
  return canonicalSha256({
    kind: "authoritative_failed_no_effect",
    authorization,
  })
}

function recordIdentity(record: JournalRecordV1): string {
  return canonicalSha256({
    operation_id: record.operation_id,
    operation_step_id: record.operation_step_id,
    operation_execution_epoch: record.operation_execution_epoch,
    record_kind: record.record_kind,
  })
}

export class JournalIdentityLedgerV1 {
  readonly #records = new Map<string, Digest>()

  append(record: JournalRecordV1): { duplicate: boolean } {
    const identity = recordIdentity(record)
    const digest = canonicalSha256(record)
    const existing = this.#records.get(identity)
    if (existing === undefined) {
      this.#records.set(identity, digest)
      return { duplicate: false }
    }
    if (existing !== digest) throw adapterError("integrity_failed")
    return { duplicate: true }
  }
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validateReceipt(receipt: JournalAnchorReceiptV1): void {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.record === null ||
    typeof receipt.record !== "object" ||
    !hasExactKeys(receipt, [
      "anchor_schema_version",
      "journal_sequence",
      "prior_frontier_digest",
      "record_digest",
      "frontier_digest",
      "signer_principal",
      "signing_key_id",
      "signature",
      "record",
    ]) ||
    !hasExactKeys(receipt.record, [
      "schema_version",
      "outcome_schema_version",
      "outcome_schema_sha256",
      "outcome_kind",
      "provider_receipt_sha256",
      "semantic_step",
      "operation_id",
      "operation_step_id",
      "operation_execution_epoch",
      "record_kind",
      "resource_id",
      "resource_lifecycle_generation",
      "provider_idempotency_token_sha256",
      "provider_creation_token_sha256",
      "immutable_fingerprint_sha256",
      "operation_digest",
      "request_sha256",
      "idempotency_key_sha256",
      "deadline",
      "target_sha256",
      "fence_sha256",
      "generation_transition_sha256",
      "authorization_binding_sha256",
      "payload_sha256",
    ])
  ) {
    throw adapterError("dispatch_anchor_mismatch")
  }
  const expectedFrontierDigest = canonicalSha256({
    anchor_schema_version: receipt.anchor_schema_version,
    journal_sequence: receipt.journal_sequence,
    prior_frontier_digest: receipt.prior_frontier_digest,
    record_digest: receipt.record_digest,
    signer_principal: receipt.signer_principal,
    signing_key_id: receipt.signing_key_id,
  })
  if (
    receipt.anchor_schema_version !== "infinity.effect-journal-anchor/v1" ||
    typeof receipt.journal_sequence !== "bigint" ||
    receipt.journal_sequence < 1n ||
    !isDigest(receipt.prior_frontier_digest) ||
    !isDigest(receipt.record_digest) ||
    !isDigest(receipt.frontier_digest) ||
    receipt.record.schema_version !== "sandboxes.effect-journal/v1" ||
    canonicalSha256(receipt.record) !== receipt.record_digest ||
    receipt.frontier_digest !== expectedFrontierDigest ||
    receipt.record.outcome_schema_version !== EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION ||
    receipt.record.outcome_schema_sha256 !== EFFECT_JOURNAL_OUTCOME_SCHEMA_SHA256 ||
    (receipt.record.record_kind === "OUTCOME" &&
      (receipt.record.outcome_kind === null ||
        !OUTCOME_KINDS.has(receipt.record.outcome_kind) ||
        !isDigest(receipt.record.provider_receipt_sha256))) ||
    (receipt.record.record_kind !== "OUTCOME" &&
      (receipt.record.outcome_kind !== null || receipt.record.provider_receipt_sha256 !== null))
  ) {
    throw adapterError("dispatch_anchor_mismatch")
  }
  if (
    receipt.signer_principal.length === 0 ||
    receipt.signing_key_id.length === 0 ||
    !/^[A-Za-z0-9_-]+$/u.test(receipt.signature)
  ) {
    throw adapterError("dispatch_anchor_mismatch")
  }
}

export function journalAnchorSha256(receipt: JournalAnchorReceiptV1): Digest {
  validateReceipt(receipt)
  return canonicalSha256(receipt)
}

function assertAnchorRecord(
  receipt: JournalAnchorReceiptV1,
  op: ProviderOperationV1,
  ctx: AdapterCallContextV1,
  expectedKind: JournalRecordV1["record_kind"],
): void {
  validateReceipt(receipt)
  const record = receipt.record
  const expectedFence = ctx.fence
  if (
    record.record_kind !== expectedKind ||
    record.outcome_kind !== null ||
    record.provider_receipt_sha256 !== null ||
    record.semantic_step !== op.operation ||
    record.operation_id !== op.target.operation_id ||
    record.operation_step_id !== op.target.operation_step_id ||
    record.operation_execution_epoch !== expectedFence.operation_execution_epoch ||
    record.resource_id !== op.target.resource_id ||
    record.resource_lifecycle_generation !== op.target.resource_lifecycle_generation ||
    record.provider_idempotency_token_sha256 !== op.target.provider_idempotency_token_sha256 ||
    record.provider_creation_token_sha256 !== op.target.provider_creation_token_sha256 ||
    record.immutable_fingerprint_sha256 !== op.target.immutable_fingerprint_sha256 ||
    record.operation_digest !== op.target.operation_digest ||
    record.request_sha256 !== op.request_sha256 ||
    record.idempotency_key_sha256 !== op.idempotency_key_sha256 ||
    record.deadline !== op.deadline ||
    record.target_sha256 !== canonicalSha256(op.target) ||
    record.fence_sha256 !== canonicalSha256(expectedFence) ||
    record.generation_transition_sha256 !==
      canonicalSha256(op.generation_transition ?? { kind: "no_generation_transition" }) ||
    record.authorization_binding_sha256 !== ctx.authorization_binding_sha256 ||
    !isDigest(ctx.authorization_binding_sha256)
  ) {
    throw adapterError("dispatch_anchor_mismatch")
  }
}

function validateHigherEpoch(ctx: AdapterCallContextV1, op: ProviderOperationV1): void {
  const attempt = ctx.dispatch_attempt
  if (attempt.kind === "initial") {
    if (
      attempt.operation_execution_epoch !== ctx.fence.operation_execution_epoch
    ) {
      throw adapterError("stale_operation_execution_epoch")
    }
    return
  }
  if (attempt.kind === "exact_duplicate") {
    if (
      attempt.operation_execution_epoch !== ctx.fence.operation_execution_epoch ||
      attempt.prior_record_sha256 !== journalAnchorSha256(ctx.invocation_anchor)
    ) {
      throw adapterError("dispatch_anchor_mismatch")
    }
    return
  }
  const predecessor = attempt.previous_operation_execution_epoch
  const proof = attempt.authorization
  if (
    proof.schema_version !== "sandboxes.failed-no-effect/v1" ||
    proof.outcome_kind !== "failed_no_effect" ||
    !isDigest(proof.prior_outcome_anchor_sha256) ||
    !isDigest(proof.evidence_sha256) ||
    ctx.invocation_anchor.record.payload_sha256 !== failedNoEffectAuthorizationPayloadSha256(proof)
  ) {
    throw adapterError("dispatch_anchor_mismatch")
  }
  if (
    predecessor + 1n !== ctx.fence.operation_execution_epoch ||
    proof.previous_operation_execution_epoch !== predecessor ||
    proof.successor_operation_execution_epoch !== ctx.fence.operation_execution_epoch
  ) {
    throw adapterError("stale_operation_execution_epoch")
  }
  if (
    proof.target_sha256 !== canonicalSha256(op.target) ||
    proof.request_sha256 !== op.request_sha256 ||
    proof.resource_id !== op.target.resource_id ||
    proof.provider_idempotency_token_sha256 !== op.target.provider_idempotency_token_sha256 ||
    proof.provider_creation_token_sha256 !== op.target.provider_creation_token_sha256 ||
    proof.operation_digest !== op.target.operation_digest
  ) {
    throw adapterError("operation_target_mismatch")
  }
}

export function validateAdapterCallContext(ctx: AdapterCallContextV1, op: ProviderOperationV1): void {
  if (!safeEqual(ctx.target, op.target)) throw adapterError("operation_target_mismatch")
  if (!safeEqual(ctx.fence, op.fence)) throw adapterError("operation_target_mismatch")
  if (ctx.request_sha256 !== op.request_sha256) throw adapterError("request_digest_mismatch")
  if (ctx.deadline !== op.deadline || Number.isNaN(Date.parse(ctx.deadline))) {
    throw adapterError("operation_target_mismatch")
  }
  if (
    ctx.fence.audience !== "sandboxes.runtime/v1" ||
    ctx.fence.operation_id !== op.target.operation_id ||
    ctx.fence.operation_digest !== op.target.operation_digest ||
    ctx.fence.resource_id !== op.target.resource_id ||
    ctx.fence.resource_lifecycle_generation !== op.target.resource_lifecycle_generation
  ) {
    throw adapterError("operation_target_mismatch")
  }
  const expectedInvocationKind = op.external_anchor_kind
  assertAnchorRecord(ctx.invocation_anchor, op, ctx, expectedInvocationKind)
  if (op.external_anchor_receipt_sha256 !== journalAnchorSha256(ctx.invocation_anchor)) {
    throw adapterError("dispatch_anchor_mismatch")
  }
  validateHigherEpoch(ctx, op)
}

export function outcomeRecord(
  ctx: AdapterCallContextV1,
  op: ProviderOperationV1,
  payloadSha256: Digest,
  providerReceiptSha256: Digest,
  outcomeKind: "succeeded" | "failed_effect" | "failed_no_effect" | "reconciliation_blocked" = "succeeded",
): JournalRecordV1 {
  return {
    schema_version: "sandboxes.effect-journal/v1",
    outcome_schema_version: EFFECT_JOURNAL_OUTCOME_SCHEMA_VERSION,
    outcome_schema_sha256: EFFECT_JOURNAL_OUTCOME_SCHEMA_SHA256,
    outcome_kind: outcomeKind,
    provider_receipt_sha256: providerReceiptSha256,
    semantic_step: op.operation,
    operation_id: op.target.operation_id,
    operation_step_id: op.target.operation_step_id,
    operation_execution_epoch: ctx.fence.operation_execution_epoch,
    record_kind: "OUTCOME",
    resource_id: op.target.resource_id,
    resource_lifecycle_generation: op.target.resource_lifecycle_generation,
    provider_idempotency_token_sha256: op.target.provider_idempotency_token_sha256,
    provider_creation_token_sha256: op.target.provider_creation_token_sha256,
    immutable_fingerprint_sha256: op.target.immutable_fingerprint_sha256,
    operation_digest: op.target.operation_digest,
    request_sha256: op.request_sha256,
    idempotency_key_sha256: op.idempotency_key_sha256,
    deadline: op.deadline,
    target_sha256: canonicalSha256(op.target),
    fence_sha256: canonicalSha256(ctx.fence),
    generation_transition_sha256: canonicalSha256(
      op.generation_transition ?? { kind: "no_generation_transition" },
    ),
    authorization_binding_sha256: ctx.authorization_binding_sha256,
    payload_sha256: payloadSha256,
  }
}

export async function anchorOutcome(
  ctx: AdapterCallContextV1,
  op: ProviderOperationV1,
  safeOutcome: unknown,
  journal: OutcomeJournalPortV1,
  verifier: AdapterOutcomeAnchorVerifierPortV1,
  outcomeKind: "succeeded" | "failed_effect" | "failed_no_effect" | "reconciliation_blocked" = "succeeded",
): Promise<Digest> {
  const payloadSha256 = canonicalSha256(safeOutcome)
  const candidate =
    safeOutcome !== null && typeof safeOutcome === "object"
      ? (safeOutcome as { provider_receipt_sha256?: unknown }).provider_receipt_sha256
      : undefined
  const providerReceiptSha256 = isDigest(candidate) ? candidate : payloadSha256
  const record = outcomeRecord(ctx, op, payloadSha256, providerReceiptSha256, outcomeKind)
  let receipt: JournalAnchorReceiptV1
  try {
    receipt = await journal.appendOutcome(record)
  } catch (cause) {
    throw adapterError("provider_state_unknown", {
      quarantineRequired: op.external_anchor_kind === "DISPATCHED",
      cause,
    })
  }
  validateReceipt(receipt)
  if (!safeEqual(receipt.record, record)) throw adapterError("dispatch_anchor_mismatch")
  try {
    await verifier.assertVerified(receipt, record)
  } catch {
    throw adapterError("dispatch_anchor_mismatch")
  }
  return journalAnchorSha256(receipt)
}
