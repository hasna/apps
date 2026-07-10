import { canonicalSha256, isDigest, safeEqual } from "./canonical"
import { adapterError } from "./errors"
import type {
  AdapterCallContextV1,
  Digest,
  JournalAnchorReceiptV1,
  JournalRecordV1,
  ProviderOperationV1,
} from "./types"

function recordIdentity(record: JournalRecordV1): string {
  return [
    record.operation_id,
    record.operation_step_id,
    record.operation_execution_epoch.toString(10),
    record.record_kind,
  ].join("\u001f")
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

function validateReceipt(receipt: JournalAnchorReceiptV1): void {
  if (!isDigest(receipt.record_sha256) || canonicalSha256(receipt.record) !== receipt.record_sha256) {
    throw adapterError("dispatch_anchor_mismatch")
  }
  if (receipt.signer_principal.length === 0 || Number.isNaN(Date.parse(receipt.anchored_at))) {
    throw adapterError("dispatch_anchor_mismatch")
  }
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
    record.semantic_step !== op.operation ||
    record.operation_id !== op.target.operation_id ||
    record.operation_step_id !== op.target.operation_step_id ||
    record.operation_execution_epoch !== expectedFence.operation_execution_epoch ||
    record.resource_id !== op.target.resource_id ||
    record.resource_lifecycle_generation !== op.target.resource_lifecycle_generation ||
    record.provider_idempotency_token_sha256 !== op.target.provider_idempotency_token_sha256 ||
    record.immutable_fingerprint_sha256 !== op.target.immutable_fingerprint_sha256 ||
    record.operation_digest !== op.target.operation_digest ||
    record.request_sha256 !== op.request_sha256 ||
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
      attempt.operation_execution_epoch !== ctx.fence.operation_execution_epoch ||
      ctx.invocation_anchor.duplicate
    ) {
      throw adapterError("stale_operation_execution_epoch")
    }
    return
  }
  if (attempt.kind === "exact_duplicate") {
    if (
      attempt.operation_execution_epoch !== ctx.fence.operation_execution_epoch ||
      !ctx.invocation_anchor.duplicate ||
      attempt.prior_record_sha256 !== ctx.invocation_anchor.record_sha256
    ) {
      throw adapterError("dispatch_anchor_mismatch")
    }
    return
  }
  const predecessor = attempt.previous_operation_execution_epoch
  const proof = attempt.authorization
  if (
    predecessor >= ctx.fence.operation_execution_epoch ||
    proof.previous_operation_execution_epoch !== predecessor ||
    proof.successor_operation_execution_epoch !== ctx.fence.operation_execution_epoch
  ) {
    throw adapterError("stale_operation_execution_epoch")
  }
  if (
    proof.target_sha256 !== canonicalSha256(op.target) ||
    proof.resource_id !== op.target.resource_id ||
    proof.provider_idempotency_token_sha256 !== op.target.provider_idempotency_token_sha256 ||
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
  assertAnchorRecord(ctx.intent_anchor, op, ctx, "INTENT")
  assertAnchorRecord(ctx.invocation_anchor, op, ctx, expectedInvocationKind)
  if (op.external_anchor_receipt_sha256 !== ctx.invocation_anchor.record_sha256) {
    throw adapterError("dispatch_anchor_mismatch")
  }
  validateHigherEpoch(ctx, op)
}

export function outcomeRecord(
  ctx: AdapterCallContextV1,
  op: ProviderOperationV1,
  payloadSha256: Digest,
): JournalRecordV1 {
  return {
    schema_version: "sandboxes.effect-journal/v1",
    semantic_step: op.operation,
    operation_id: op.target.operation_id,
    operation_step_id: op.target.operation_step_id,
    operation_execution_epoch: ctx.fence.operation_execution_epoch,
    record_kind: "OUTCOME",
    resource_id: op.target.resource_id,
    resource_lifecycle_generation: op.target.resource_lifecycle_generation,
    provider_idempotency_token_sha256: op.target.provider_idempotency_token_sha256,
    immutable_fingerprint_sha256: op.target.immutable_fingerprint_sha256,
    operation_digest: op.target.operation_digest,
    request_sha256: op.request_sha256,
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
): Promise<Digest> {
  const record = outcomeRecord(ctx, op, canonicalSha256(safeOutcome))
  let receipt: JournalAnchorReceiptV1
  try {
    receipt = await ctx.outcome_journal.appendOutcome(record)
  } catch (cause) {
    throw adapterError("provider_state_unknown", {
      quarantineRequired: op.external_anchor_kind === "DISPATCHED",
      cause,
    })
  }
  validateReceipt(receipt)
  if (!safeEqual(receipt.record, record)) throw adapterError("dispatch_anchor_mismatch")
  return receipt.record_sha256
}
