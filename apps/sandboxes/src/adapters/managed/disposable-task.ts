import { createHash, timingSafeEqual } from "node:crypto"
import { canonicalJson, canonicalSha256, isDigest, parseCanonicalJson, snapshotCanonicalDenseArray } from "./canonical"
import { AdapterContractError, adapterError } from "./errors"
import type { Digest, ManagedProviderIdV1 } from "./types"

export const DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V1 = false as const

export const DISPOSABLE_SANDBOX_TASK_REQUEST_SCHEMA_V1 =
  "sandboxes.disposable-task-request/v1" as const
export const DISPOSABLE_SANDBOX_TASK_RECEIPT_SCHEMA_V1 =
  "sandboxes.disposable-task-receipt/v1" as const
export const DISPOSABLE_SANDBOX_TASK_EXECUTION_RECEIPT_SCHEMA_V1 =
  "sandboxes.disposable-task-execution-receipt/v1" as const
export const DISPOSABLE_TASK_AUTHORIZATION_CONSUMPTION_SCHEMA_V1 =
  "sandboxes.disposable-task-authorization-consumption/v1" as const
export const DISPOSABLE_TASK_PROVIDER_CONTACT_AUDIENCE_V1 =
  "hasna:sandboxes:disposable-task-provider-contact/v1" as const

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const UNPAIRED_SURROGATE = /[\ud800-\udfff]/u
const MAX_FILES = 32
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 512 * 1024
const MAX_PROVIDER_CONTACT_AUTH_MS = 15_000
const MAX_AUTHORITY_CLOCK_SKEW_MS = 5_000
const POSITIVE_SIGNED_INT64 = /^[1-9][0-9]{0,18}$/u
const AUTH_CONTEXT_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/u
const CREDENTIAL_CARRIER_PREFIX = /^(?:AKIA|ASIA|AIza|eyJ|gh[opsu]_|github_pat_|sk-|sk_|xox[baprs]-)/u
const RFC3339_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const ED25519_BASE64URL = /^[A-Za-z0-9_-]{86}$/u

export interface DisposableTaskFileV1 {
  path: string
  content_base64: string
  content_sha256: Digest
  mode: 0o600 | 0o644 | 0o700 | 0o755
}

export interface DisposableTaskExecV1 {
  argv: string[]
  cwd: "." | string
  wall_timeout_ms: number
  idle_timeout_ms: number
  output_limit_bytes: number
  pids_limit: number
}

export interface DisposableTaskCheckpointLimitsV1 {
  allowed_path_prefixes: string[]
  allow_file_addition: boolean
  allow_file_modification: boolean
  allow_file_deletion: boolean
  max_changed_files: number
  forbidden_content_markers_base64: string[]
  max_depth: number
  max_duration_ms: number
  max_file_bytes: number
  max_files: number
  max_total_bytes: number
}

export interface DisposableSandboxTaskRequestV1 {
  schema_version: typeof DISPOSABLE_SANDBOX_TASK_REQUEST_SCHEMA_V1
  provider: ManagedProviderIdV1
  idempotency_key_sha256: Digest
  operation_digest: Digest
  /** Opaque canonical Infinity authority envelope; Sandboxes never decodes it. */
  authority_envelope_sha256: Digest
  /** Pins the exact descendant package bytes and source tree actually executed. */
  source_manifest_sha256: Digest
  input_manifest_sha256: Digest
  environment_image_sha256: Digest
  task_bundle_sha256: Digest
  network_policy: "deny_all"
  maximum_allocations: 1
  max_runtime_ms: number
  files: DisposableTaskFileV1[]
  exec: DisposableTaskExecV1
  checkpoint: DisposableTaskCheckpointLimitsV1
}

export interface DisposableSandboxTaskExecutionReceiptCoreV1 {
  schema_version: typeof DISPOSABLE_SANDBOX_TASK_EXECUTION_RECEIPT_SCHEMA_V1
  provider: ManagedProviderIdV1
  request_sha256: Digest
  idempotency_key_sha256: Digest
  operation_digest: Digest
  authority_envelope_sha256: Digest
  source_manifest_sha256: Digest
  input_manifest_sha256: Digest
  authorization_consumption_receipt_sha256: Digest
  effect_claim_sha256: Digest
  dispatch_intent_anchor_sha256: Digest
  journal_dispatch_id_sha256: Digest
  journal_dispatch_anchor_sha256: Digest
  /** Immutable lease that performed the provider effect; never rewritten by recovery. */
  journal_claim_fence_sha256: Digest
  journal_lease_epoch: string
  provider_effect_ownership_nonce_sha256: Digest
  /** Digest actually observed in provider metadata; binds effect epoch + journal nonce. */
  provider_ownership_binding_sha256: Digest
  allocation_count: 1
  network_policy: "deny_all"
  provider_fingerprint_sha256: Digest
  broker_artifact_sha256: Digest
  broker_protocol_sha256: Digest
  authenticated_session_sha256: Digest
  execution_receipt_sha256: Digest
  workspace_readback_sha256: Digest
  output_manifest_sha256: Digest
  output_diff_sha256: Digest
  checkpoint_sha256: Digest
  checkpoint_manifest_sha256: Digest
  checkpoint_readback_sha256: Digest
  checkpoint_handoff_sha256: Digest
  result_bundle_sha256: Digest
  checkpoint_file_count: number
  checkpoint_total_bytes: number
  destroy_execution_count: 1
  get_absent: true
  list_absent: true
  deletion_proven: true
  absence_evidence_sha256: Digest
}

export interface DisposableSandboxTaskExecutionReceiptV1 extends DisposableSandboxTaskExecutionReceiptCoreV1 {
  execution_receipt_core_sha256: Digest
}

export interface DisposableSandboxTaskReceiptV1 extends DisposableSandboxTaskExecutionReceiptV1 {
  journal_outcome_anchor_sha256: Digest
  receipt_sha256: Digest
}

export interface DisposableTaskJournalDescriptionV1 {
  durability: "durable" | "volatile"
  encrypted_at_rest: boolean
  journal_identity_sha256: Digest
  restore_domain_sha256: Digest
  external_head_witness_sha256: Digest
  signer_principal: string
  signing_key_id: string
}

export interface DisposableTaskJournalPrepareInputV1 {
  idempotency_key_sha256: Digest
  request_sha256: Digest
  canonical_request_bytes: Uint8Array
  operation_digest: Digest
  authority_envelope_sha256: Digest
  source_manifest_sha256: Digest
  input_manifest_sha256: Digest
  checkpoint_policy_sha256: Digest
  provider: ManagedProviderIdV1
  provider_metadata_scope_sha256: Digest
  provider_creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  lease_owner_sha256: Digest
  lease_duration_ms: number
}

export interface DisposableTaskJournalClaimV1 {
  dispatch_id: string
  request_sha256: Digest
  lease_epoch: bigint
  claim_fence_sha256: Digest
  lease_owner_sha256: Digest
  lease_expires_at: string
  provider_metadata_scope_sha256: Digest
  provider_creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  ownership_nonce_sha256: Digest
  effect_claim_sha256: Digest
  dispatch_intent_anchor_sha256: Digest | null
  dispatch_anchor_sha256: Digest
}

export interface DisposableTaskJournalAuthorizationV1 {
  /** Exact stable bytes signed/stored before the authority is contacted. */
  canonical_consume_input_bytes: Uint8Array
  consume_input_sha256: Digest
  consume_input: DisposableTaskAuthorityConsumeInputV1
  /** Exact bytes previously bound, when authority consumption already completed. */
  stored_receipt: DisposableTaskAuthorizationReceiptEnvelopeV1 | null
}

export interface DisposableTaskJournalRecoveryV1 {
  provider_effect_claim_fence_sha256: Digest
  provider_effect_lease_epoch: bigint
  provider_effect_ownership_nonce_sha256: Digest
  expected_provider_fingerprint_sha256: Digest | null
  expected_result_bundle_sha256: Digest | null
  expected_checkpoint_handoff_sha256: Digest | null
  canonical_recovery_record_bytes: Uint8Array
  recovery_record_sha256: Digest
  canonical_signed_recovery_anchor_bytes: Uint8Array
  recovery_anchor_sha256: Digest
}

export interface DisposableTaskJournalOutcomeAnchorV1 {
  canonical_anchor_bytes: Uint8Array
  anchor_sha256: Digest
}

export interface DisposableTaskJournalCompletedV1 extends DisposableTaskJournalOutcomeAnchorV1 {
  kind: "outcome"
  request_sha256: Digest
  outcome_kind: "succeeded" | "failed_no_effect" | "failed_contained"
  execution_receipt: DisposableSandboxTaskExecutionReceiptV1 | null
  failure_code: string | null
  failure_evidence_sha256: Digest | null
}

export interface DisposableTaskJournalQuarantinedV1 extends DisposableTaskJournalOutcomeAnchorV1 {
  kind: "quarantined"
  request_sha256: Digest
  quarantine_reason: string
  quarantine_evidence_sha256: Digest
}

export type DisposableTaskJournalPrepareResultV1 =
  | ({ kind: "prepared"; recovery: false; authorization: DisposableTaskJournalAuthorizationV1 } & DisposableTaskJournalClaimV1)
  | ({
    kind: "reconcile"
    recovery: true
    prior_state: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED"
    authorization: DisposableTaskJournalAuthorizationV1
    recovery_binding: DisposableTaskJournalRecoveryV1
  } & DisposableTaskJournalClaimV1)
  | { kind: "busy"; request_sha256: Digest; retry_after: string }
  | DisposableTaskJournalCompletedV1
  | DisposableTaskJournalQuarantinedV1

export interface DisposableTaskAuthorizationReceiptEnvelopeV1 {
  canonical_receipt_bytes: Uint8Array
  receipt_sha256: Digest
}

export interface DisposableTaskAuthorityConsumeInputV1 {
  dispatch_id: string
  authority_envelope_sha256: Digest
  canonical_request_sha256: Digest
  operation_digest: Digest
  provider: ManagedProviderIdV1
  source_manifest_sha256: Digest
  input_manifest_sha256: Digest
  checkpoint_policy_sha256: Digest
  effect_claim_sha256: Digest
}

export interface DisposableSandboxTaskAuthorityPortV1 {
  describe(): {
    durability: "durable" | "volatile"
    implementation_sha256: Digest
    trust_root_sha256: Digest
  }
  /**
   * Resolves and verifies the signed authority envelope, atomically consumes one use,
   * and returns a trust-root-verified signed consumption receipt.
   */
  consumeOnce(input: Readonly<DisposableTaskAuthorityConsumeInputV1>): Promise<Readonly<DisposableTaskAuthorizationReceiptEnvelopeV1>>
}

export interface DisposableTaskOutcomeAnchorVerifierPortV1 {
  describe(): { implementation_sha256: Digest; trust_root_sha256: Digest }
  assertVerified(input: Readonly<{
    canonical_anchor_bytes: Uint8Array
    anchor_sha256: Digest
    request_sha256: Digest
    outcome_kind: DisposableTaskJournalCompletedV1["outcome_kind"]
    execution_receipt_sha256: Digest | null
  }>): Promise<void>
}

export interface CheckpointHandoffDescriptionV1 {
  durability: "durable" | "volatile"
  encrypted_at_rest: boolean
  readback_verified: boolean
  store_identity_sha256: Digest
}

export interface CheckpointHandoffInputV1 {
  dispatch_id: string
  request_sha256: Digest
  input_manifest_sha256: Digest
  effect_claim_sha256: Digest
  dispatch_intent_anchor_sha256: Digest
  journal_claim_fence_sha256: Digest
  journal_lease_epoch: bigint
  provider_effect_ownership_nonce_sha256: Digest
  provider_ownership_binding_sha256: Digest
  authorization_consumption_receipt_sha256: Digest
  provider_fingerprint_sha256: Digest
  broker_artifact_sha256: Digest
  broker_protocol_sha256: Digest
  authenticated_session_sha256: Digest
  execution_receipt_sha256: Digest
  workspace_readback_sha256: Digest
  output_manifest_sha256: Digest
  output_diff_sha256: Digest
  checkpoint_sha256: Digest
  checkpoint_manifest_sha256: Digest
  file_count: number
  total_bytes: number
  /** Canonical, broker-validated checkpoint bytes. Never included in a task receipt. */
  checkpoint_bytes: Uint8Array
}

export interface CheckpointHandoffReceiptV1 {
  schema_version: "sandboxes.checkpoint-handoff-receipt/v1"
  dispatch_id: string
  request_sha256: Digest
  input_manifest_sha256: Digest
  effect_claim_sha256: Digest
  dispatch_intent_anchor_sha256: Digest
  authorization_consumption_receipt_sha256: Digest
  journal_claim_fence_sha256: Digest
  journal_lease_epoch: string
  provider_effect_ownership_nonce_sha256: Digest
  provider_ownership_binding_sha256: Digest
  checkpoint_sha256: Digest
  checkpoint_readback_sha256: Digest
  checkpoint_manifest_sha256: Digest
  file_count: number
  total_bytes: number
  handoff_receipt_sha256: Digest
  result_bundle_sha256: Digest
  result_signature_sha256: Digest
  provider_fingerprint_sha256: Digest
  broker_artifact_sha256: Digest
  broker_protocol_sha256: Digest
  authenticated_session_sha256: Digest
  execution_receipt_sha256: Digest
  workspace_readback_sha256: Digest
  output_manifest_sha256: Digest
  output_diff_sha256: Digest
}

export interface CheckpointHandoffPortV1 {
  describe(): CheckpointHandoffDescriptionV1
  putAndReadback(input: Readonly<CheckpointHandoffInputV1>): Promise<Readonly<CheckpointHandoffReceiptV1>>
  lookupVerified(input: Readonly<{
    dispatch_id: string
    request_sha256: Digest
    expected_result_bundle_sha256: Digest | null
    expected_checkpoint_handoff_sha256: Digest | null
  }>): Promise<Readonly<CheckpointHandoffReceiptV1> | "absent">
}

export interface DurableJournalWitnessReceiptV1 {
  canonical_receipt_bytes: Uint8Array
  receipt_sha256: Digest
  sequence: bigint
  frontier_sha256: Digest
}

export interface DurableJournalWitnessPortV1 {
  describe(): {
    durability: "durable"
    restore_domain_sha256: Digest
    witness_identity_sha256: Digest
  }
  readHead(journalIdentitySha256: Digest): Promise<DurableJournalWitnessReceiptV1 | null>
  compareAndAdvance(input: Readonly<{
    journal_identity_sha256: Digest
    expected_sequence: bigint
    expected_frontier_sha256: Digest | null
    successor_sequence: bigint
    successor_frontier_sha256: Digest
    signed_anchor_bytes: Uint8Array
  }>): Promise<DurableJournalWitnessReceiptV1>
}

/**
 * Implementations must serialize by idempotency key across processes. An exact
 * replay returns the stored receipt; changed request bytes under the same key
 * fail without invoking effect.
 */
export interface DisposableTaskJournalPortV1 {
  describe(): DisposableTaskJournalDescriptionV1
  assertWitnessCurrent(witness: DurableJournalWitnessPortV1): Promise<{ witness_receipt_sha256: Digest }>
  prepareDispatch(input: Readonly<DisposableTaskJournalPrepareInputV1>): Promise<DisposableTaskJournalPrepareResultV1>
  bindAuthorizationAndMarkIntent(input: Readonly<{
    dispatch_id: string
    request_sha256: Digest
    claim_fence_sha256: Digest
    lease_epoch: bigint
    effect_claim_sha256: Digest
    authorization_receipt: DisposableTaskAuthorizationReceiptEnvelopeV1
  }>): Promise<{
    authorization_consumption_receipt_sha256: Digest
    dispatch_intent_anchor_sha256: Digest
  }>
  markDispatched(input: Readonly<{
    dispatch_id: string
    request_sha256: Digest
    claim_fence_sha256: Digest
    lease_epoch: bigint
    provider_fingerprint_sha256: Digest
    provider_metadata_scope_sha256: Digest
  }>): Promise<{ dispatch_anchor_sha256: Digest }>
  markResultPersisted(input: Readonly<{
    dispatch_id: string
    request_sha256: Digest
    claim_fence_sha256: Digest
    lease_epoch: bigint
    result_bundle_sha256: Digest
    checkpoint_handoff_sha256: Digest
  }>): Promise<{ result_persisted_anchor_sha256: Digest }>
  commitOutcome(input: Readonly<{
    dispatch_id: string
    request_sha256: Digest
    claim_fence_sha256: Digest
    lease_epoch: bigint
    outcome_kind: "succeeded" | "failed_no_effect" | "failed_contained"
    execution_receipt: DisposableSandboxTaskExecutionReceiptV1 | null
    failure_code: string | null
    failure_evidence_sha256: Digest | null
  }>): Promise<DisposableTaskJournalCompletedV1>
  quarantine(input: Readonly<{
    dispatch_id: string
    request_sha256: Digest
    claim_fence_sha256: Digest
    lease_epoch: bigint
    quarantine_reason: string
    quarantine_evidence_sha256: Digest
  }>): Promise<DisposableTaskJournalQuarantinedV1>
}

export interface DisposableSandboxTaskRunnerDescriptionV1 {
  provider: ManagedProviderIdV1
  implementation_sha256: Digest
  checkpoint_handoff_durability: "durable" | "volatile"
  checkpoint_readback_verified: boolean
}

export interface DisposableSandboxTaskRunnerV1 {
  readonly provider: ManagedProviderIdV1
  describe(): DisposableSandboxTaskRunnerDescriptionV1
  run(
    request: Readonly<DisposableSandboxTaskRequestV1>,
    context: Readonly<DisposableSandboxTaskExecutionContextV1>,
  ): Promise<DisposableSandboxTaskExecutionReceiptV1>
  /** A takeover never re-executes; it only recovers durable result bytes or contains the exact scope. */
  reconcile(
    request: Readonly<DisposableSandboxTaskRequestV1>,
    context: Readonly<DisposableSandboxTaskExecutionContextV1 & { prior_state: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED" }>,
  ): Promise<DisposableSandboxTaskExecutionReceiptV1 | "quarantined">
  /** Authority-independent, ownership-fenced cleanup. It must never create, activate, or exec. */
  contain(
    request: Readonly<DisposableSandboxTaskRequestV1>,
    context: Readonly<DisposableSandboxTaskExecutionContextV1 & { prior_state: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED" }>,
  ): Promise<Readonly<{
    absence_evidence_sha256: Digest
    get_absent: true
    list_absent: true
    conflicting_scoped_matches: 0
  }> | "quarantined">
}

export interface DisposableSandboxTaskDependenciesV1 {
  runner: DisposableSandboxTaskRunnerV1
  journal: DisposableTaskJournalPortV1
  authority: DisposableSandboxTaskAuthorityPortV1
  outcome_verifier: DisposableTaskOutcomeAnchorVerifierPortV1
  witness: DurableJournalWitnessPortV1
  lease_owner_sha256: Digest
}

export interface DisposableSandboxTaskExecutionContextV1 {
  dispatch_id: string
  journal_dispatch_id_sha256: Digest
  journal_dispatch_anchor_sha256: Digest
  journal_claim_fence_sha256: Digest
  journal_lease_epoch: bigint
  journal_lease_expires_at: string
  provider_metadata_scope_sha256: Digest
  provider_creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  ownership_nonce_sha256: Digest
  recovery_expected_result_bundle_sha256: Digest | null
  recovery_expected_checkpoint_handoff_sha256: Digest | null
  recovery_expected_provider_fingerprint_sha256: Digest | null
  authorization_consumption_receipt_sha256: Digest
  effect_claim_sha256: Digest
  dispatch_intent_anchor_sha256: Digest
  markDispatched(providerFingerprintSha256: Digest): Promise<Digest>
  markResultPersisted(input: Readonly<{
    result_bundle_sha256: Digest
    checkpoint_handoff_sha256: Digest
  }>): Promise<Digest>
}

const REQUEST_KEYS = [
  "authority_envelope_sha256",
  "checkpoint",
  "environment_image_sha256",
  "exec",
  "files",
  "idempotency_key_sha256",
  "input_manifest_sha256",
  "max_runtime_ms",
  "maximum_allocations",
  "network_policy",
  "operation_digest",
  "provider",
  "schema_version",
  "source_manifest_sha256",
  "task_bundle_sha256",
] as const

const EXECUTION_CORE_KEYS = [
  "absence_evidence_sha256",
  "allocation_count",
  "authenticated_session_sha256",
  "authorization_consumption_receipt_sha256",
  "authority_envelope_sha256",
  "broker_artifact_sha256",
  "broker_protocol_sha256",
  "checkpoint_file_count",
  "checkpoint_handoff_sha256",
  "checkpoint_manifest_sha256",
  "checkpoint_readback_sha256",
  "checkpoint_sha256",
  "checkpoint_total_bytes",
  "deletion_proven",
  "dispatch_intent_anchor_sha256",
  "destroy_execution_count",
  "execution_receipt_sha256",
  "effect_claim_sha256",
  "get_absent",
  "idempotency_key_sha256",
  "input_manifest_sha256",
  "journal_claim_fence_sha256",
  "journal_dispatch_anchor_sha256",
  "journal_dispatch_id_sha256",
  "journal_lease_epoch",
  "list_absent",
  "network_policy",
  "operation_digest",
  "output_diff_sha256",
  "output_manifest_sha256",
  "provider",
  "provider_effect_ownership_nonce_sha256",
  "provider_ownership_binding_sha256",
  "provider_fingerprint_sha256",
  "request_sha256",
  "result_bundle_sha256",
  "schema_version",
  "source_manifest_sha256",
  "workspace_readback_sha256",
] as const

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function closedRecord(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    return false
  }
  return expected.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
  })
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
}

function safeString(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && !UNPAIRED_SURROGATE.test(value) &&
    new TextEncoder().encode(value).byteLength <= maximumBytes
}

function workspacePath(value: unknown, allowRoot: boolean): value is string {
  if (!safeString(value, 4_096) || value.length === 0 || value.startsWith("/") || value.includes("\0")) return false
  if (value === ".") return allowRoot
  const segments = value.split("/")
  return segments.length <= 64 && segments.every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".." && segment !== ".git")
}

function sameDigest(left: string, right: string): boolean {
  return isDigest(left) && isDigest(right) && timingSafeEqual(
    Buffer.from(left.slice(7), "hex"),
    Buffer.from(right.slice(7), "hex"),
  )
}

function validateFile(value: unknown): DisposableTaskFileV1 {
  if (!closedRecord(value, ["content_base64", "content_sha256", "mode", "path"])) throw adapterError("validation_failed")
  if (!workspacePath(value.path, false) || !isDigest(value.content_sha256) ||
    !safeInteger(value.mode, 0, 0o777) || ![0o600, 0o644, 0o700, 0o755].includes(value.mode) ||
    typeof value.content_base64 !== "string" || !BASE64.test(value.content_base64) ||
    value.content_base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw adapterError("validation_failed")
  const bytes = Buffer.from(value.content_base64, "base64")
  if (bytes.byteLength > MAX_FILE_BYTES || !sameDigest(
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    value.content_sha256,
  )) throw adapterError("validation_failed")
  return Object.freeze({
    path: value.path,
    content_base64: value.content_base64,
    content_sha256: value.content_sha256,
    mode: value.mode as DisposableTaskFileV1["mode"],
  })
}

function validateExec(value: unknown): DisposableTaskExecV1 {
  if (!closedRecord(value, ["argv", "cwd", "idle_timeout_ms", "output_limit_bytes", "pids_limit", "wall_timeout_ms"]) ||
    !Array.isArray(value.argv) || value.argv.length < 1 || value.argv.length > 256 ||
    !workspacePath(value.cwd, true) || !safeInteger(value.wall_timeout_ms, 1, 3_600_000) ||
    !safeInteger(value.idle_timeout_ms, 1, 3_600_000) ||
    !safeInteger(value.output_limit_bytes, 1, 512 * 1024) || !safeInteger(value.pids_limit, 1, 256)) {
    throw adapterError("validation_failed")
  }
  let bytes = 0
  const argv = snapshotCanonicalDenseArray(value.argv).map((argument) => {
    if (!safeString(argument, 16_384) || argument.includes("\0")) throw adapterError("validation_failed")
    bytes += new TextEncoder().encode(argument).byteLength
    return argument
  })
  if (!argv[0]?.startsWith("/") || bytes > 65_536) throw adapterError("validation_failed")
  return Object.freeze({
    argv: Object.freeze(argv.slice()) as unknown as string[],
    cwd: value.cwd,
    wall_timeout_ms: value.wall_timeout_ms,
    idle_timeout_ms: value.idle_timeout_ms,
    output_limit_bytes: value.output_limit_bytes,
    pids_limit: value.pids_limit,
  })
}

function validateCheckpoint(value: unknown): DisposableTaskCheckpointLimitsV1 {
  if (!closedRecord(value, [
    "allow_file_addition", "allow_file_deletion", "allow_file_modification", "allowed_path_prefixes",
    "forbidden_content_markers_base64", "max_changed_files", "max_depth", "max_duration_ms",
    "max_file_bytes", "max_files", "max_total_bytes",
  ]) || !Array.isArray(value.allowed_path_prefixes) || !Array.isArray(value.forbidden_content_markers_base64) ||
    typeof value.allow_file_addition !== "boolean" || typeof value.allow_file_modification !== "boolean" ||
    typeof value.allow_file_deletion !== "boolean" ||
    !safeInteger(value.max_depth, 0, 64) || !safeInteger(value.max_duration_ms, 1, 60_000) ||
    !safeInteger(value.max_file_bytes, 1, 512 * 1024) || !safeInteger(value.max_files, 1, 10_000) ||
    !safeInteger(value.max_total_bytes, 1, 512 * 1024) ||
    !safeInteger(value.max_changed_files, 0, value.max_files)) throw adapterError("validation_failed")
  const prefixes = snapshotCanonicalDenseArray(value.allowed_path_prefixes).map((prefix) => {
    if (prefix !== "." && !workspacePath(prefix, false)) throw adapterError("validation_failed")
    return prefix
  })
  if (prefixes.length < 1 || prefixes.length > 32 || new Set(prefixes).size !== prefixes.length) {
    throw adapterError("validation_failed")
  }
  let markerBytes = 0
  const markers = snapshotCanonicalDenseArray(value.forbidden_content_markers_base64).map((marker) => {
    if (!safeString(marker, 1024) || !BASE64.test(marker)) throw adapterError("validation_failed")
    const bytes = Buffer.from(marker, "base64")
    if (bytes.byteLength < 8 || bytes.toString("base64") !== marker) throw adapterError("validation_failed")
    markerBytes += bytes.byteLength
    return marker
  })
  if (markers.length > 16 || markerBytes > 4096 || new Set(markers).size !== markers.length) {
    throw adapterError("validation_failed")
  }
  return Object.freeze({
    allowed_path_prefixes: Object.freeze(prefixes.slice()) as unknown as string[],
    allow_file_addition: value.allow_file_addition,
    allow_file_modification: value.allow_file_modification,
    allow_file_deletion: value.allow_file_deletion,
    max_changed_files: value.max_changed_files,
    forbidden_content_markers_base64: Object.freeze(markers.slice()) as unknown as string[],
    max_depth: value.max_depth,
    max_duration_ms: value.max_duration_ms,
    max_file_bytes: value.max_file_bytes,
    max_files: value.max_files,
    max_total_bytes: value.max_total_bytes,
  })
}

function outputPathAllowed(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => prefix === "." || path === prefix || path.startsWith(`${prefix}/`))
}

export function disposableTaskInputManifestSha256(filesValue: unknown): Digest {
  if (!Array.isArray(filesValue) || filesValue.length < 1 || filesValue.length > MAX_FILES) {
    throw adapterError("validation_failed")
  }
  const files = snapshotCanonicalDenseArray(filesValue).map(validateFile)
  if (new Set(files.map((file) => file.path)).size !== files.length) throw adapterError("validation_failed")
  files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
  return canonicalSha256({
    schema_version: "sandboxes.disposable-task-input-manifest/v1",
    files: files.map((file) => ({
      path: file.path,
      content_sha256: file.content_sha256,
      size_bytes: Buffer.from(file.content_base64, "base64").byteLength,
      mode: file.mode,
    })),
  })
}

export function disposableTaskCheckpointPolicySha256(value: unknown): Digest {
  return canonicalSha256({
    schema_version: "sandboxes.disposable-task-checkpoint-policy/v1",
    ...validateCheckpoint(value),
  })
}

export function disposableTaskBundleSha256(value: Pick<
  DisposableSandboxTaskRequestV1,
  "source_manifest_sha256" | "input_manifest_sha256" | "environment_image_sha256" |
  "network_policy" | "max_runtime_ms" | "exec" | "checkpoint"
>): Digest {
  if (![value.source_manifest_sha256, value.input_manifest_sha256, value.environment_image_sha256].every(isDigest) ||
    value.network_policy !== "deny_all" || !safeInteger(value.max_runtime_ms, 1, 3_600_000)) {
    throw adapterError("validation_failed")
  }
  return canonicalSha256({
    schema_version: "sandboxes.disposable-task-bundle/v1",
    source_manifest_sha256: value.source_manifest_sha256,
    input_manifest_sha256: value.input_manifest_sha256,
    environment_image_sha256: value.environment_image_sha256,
    network_policy: value.network_policy,
    max_runtime_ms: value.max_runtime_ms,
    exec: validateExec(value.exec),
    checkpoint_policy_sha256: disposableTaskCheckpointPolicySha256(value.checkpoint),
  })
}

export function disposableTaskOperationDigest(value: Pick<
  DisposableSandboxTaskRequestV1,
  "provider" | "task_bundle_sha256"
>): Digest {
  if (!["e2b", "daytona_cloud"].includes(value.provider) || !isDigest(value.task_bundle_sha256)) {
    throw adapterError("validation_failed")
  }
  return canonicalSha256({
    schema_version: "sandboxes.disposable-task-operation/v1",
    provider: value.provider,
    task_bundle_sha256: value.task_bundle_sha256,
  })
}

function parseDisposableSandboxTaskRequestUnsafe(value: unknown): Readonly<DisposableSandboxTaskRequestV1> {
  if (!closedRecord(value, REQUEST_KEYS) || value.schema_version !== DISPOSABLE_SANDBOX_TASK_REQUEST_SCHEMA_V1 ||
    !["e2b", "daytona_cloud"].includes(String(value.provider)) || value.maximum_allocations !== 1 ||
    value.network_policy !== "deny_all" || !safeInteger(value.max_runtime_ms, 1, 3_600_000) ||
    !Array.isArray(value.files) || value.files.length < 1 || value.files.length > MAX_FILES ||
    [value.idempotency_key_sha256, value.operation_digest, value.authority_envelope_sha256,
      value.source_manifest_sha256, value.input_manifest_sha256, value.environment_image_sha256,
      value.task_bundle_sha256].some((item) => !isDigest(item))) throw adapterError("validation_failed")
  const files = snapshotCanonicalDenseArray(value.files).map(validateFile)
  const uniquePaths = new Set(files.map((file) => file.path))
  const totalBytes = files.reduce((total, file) => total + Buffer.from(file.content_base64, "base64").byteLength, 0)
  if (uniquePaths.size !== files.length || totalBytes > MAX_TOTAL_BYTES) throw adapterError("validation_failed")
  const parsed = Object.freeze({
    schema_version: DISPOSABLE_SANDBOX_TASK_REQUEST_SCHEMA_V1,
    provider: value.provider as ManagedProviderIdV1,
    idempotency_key_sha256: value.idempotency_key_sha256 as Digest,
    operation_digest: value.operation_digest as Digest,
    authority_envelope_sha256: value.authority_envelope_sha256 as Digest,
    source_manifest_sha256: value.source_manifest_sha256 as Digest,
    input_manifest_sha256: value.input_manifest_sha256 as Digest,
    environment_image_sha256: value.environment_image_sha256 as Digest,
    task_bundle_sha256: value.task_bundle_sha256 as Digest,
    network_policy: "deny_all",
    maximum_allocations: 1,
    max_runtime_ms: value.max_runtime_ms,
    files: Object.freeze(files.slice()) as unknown as DisposableTaskFileV1[],
    exec: validateExec(value.exec),
    checkpoint: validateCheckpoint(value.checkpoint),
  })
  if (parsed.input_manifest_sha256 !== disposableTaskInputManifestSha256(parsed.files) ||
    parsed.files.some((file) => !outputPathAllowed(file.path, parsed.checkpoint.allowed_path_prefixes)) ||
    parsed.task_bundle_sha256 !== disposableTaskBundleSha256(parsed) ||
    parsed.operation_digest !== disposableTaskOperationDigest(parsed)) {
    throw adapterError("validation_failed")
  }
  return parsed
}

export function parseDisposableSandboxTaskRequestV1(value: unknown): Readonly<DisposableSandboxTaskRequestV1> {
  try {
    return parseDisposableSandboxTaskRequestUnsafe(value)
  } catch (cause) {
    if (cause instanceof AdapterContractError) throw cause
    throw adapterError("validation_failed")
  }
}

export function disposableSandboxTaskRequestSha256(value: unknown): Digest {
  return canonicalSha256(parseDisposableSandboxTaskRequestV1(value))
}

export function disposableSandboxTaskExecutionReceiptSha256(value: DisposableSandboxTaskExecutionReceiptCoreV1): Digest {
  if (!closedRecord(value, EXECUTION_CORE_KEYS)) throw adapterError("validation_failed")
  return canonicalSha256(value)
}

export function disposableTaskAbsenceEvidenceSha256(input: Readonly<{
  dispatch_id_sha256: Digest
  request_sha256: Digest
  provider: ManagedProviderIdV1
  provider_creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  provider_fingerprint_sha256: Digest
  provider_effect_claim_fence_sha256: Digest
  provider_effect_lease_epoch: bigint
  provider_effect_ownership_nonce_sha256: Digest
  provider_ownership_binding_sha256: Digest
  effect_claim_sha256: Digest
  dispatch_intent_anchor_sha256: Digest
  destroy_execution_count: 1
  get_absent: true
  list_absent: true
  conflicting_scoped_matches: 0
}>): Digest {
  if (!closedRecord(input, [
    "conflicting_scoped_matches", "destroy_execution_count", "dispatch_id_sha256", "dispatch_intent_anchor_sha256",
    "effect_claim_sha256", "get_absent", "immutable_fingerprint_sha256",
    "list_absent", "provider", "provider_creation_token_sha256", "provider_effect_claim_fence_sha256",
    "provider_effect_lease_epoch", "provider_effect_ownership_nonce_sha256", "provider_fingerprint_sha256",
    "provider_ownership_binding_sha256", "request_sha256",
  ]) || ![input.dispatch_id_sha256, input.request_sha256, input.provider_creation_token_sha256,
    input.immutable_fingerprint_sha256, input.effect_claim_sha256, input.dispatch_intent_anchor_sha256,
      input.provider_fingerprint_sha256, input.provider_effect_claim_fence_sha256,
      input.provider_effect_ownership_nonce_sha256, input.provider_ownership_binding_sha256].every(isDigest) ||
    typeof input.provider_effect_lease_epoch !== "bigint" ||
    input.provider_effect_lease_epoch < 1n || input.destroy_execution_count !== 1 || input.get_absent !== true ||
    input.list_absent !== true || input.conflicting_scoped_matches !== 0) throw adapterError("validation_failed")
  return canonicalSha256({ schema_version: "sandboxes.disposable-task-absence-evidence/v1", ...input })
}

export function parseDisposableSandboxTaskExecutionReceiptV1(
  value: unknown,
  requestValue: Readonly<DisposableSandboxTaskRequestV1>,
  context: Readonly<DisposableSandboxTaskExecutionContextV1>,
): Readonly<DisposableSandboxTaskExecutionReceiptV1> {
  const request = parseDisposableSandboxTaskRequestV1(requestValue)
  if (!isPlainRecord(value)) throw adapterError("integrity_failed")
  const keys = [...EXECUTION_CORE_KEYS, "execution_receipt_core_sha256"]
  if (!closedRecord(value, keys) || value.schema_version !== DISPOSABLE_SANDBOX_TASK_EXECUTION_RECEIPT_SCHEMA_V1 ||
    value.provider !== request.provider || value.request_sha256 !== disposableSandboxTaskRequestSha256(request) ||
    value.idempotency_key_sha256 !== request.idempotency_key_sha256 || value.operation_digest !== request.operation_digest ||
    value.authority_envelope_sha256 !== request.authority_envelope_sha256 ||
    value.source_manifest_sha256 !== request.source_manifest_sha256 || value.input_manifest_sha256 !== request.input_manifest_sha256 ||
    value.authorization_consumption_receipt_sha256 !== context.authorization_consumption_receipt_sha256 ||
    value.effect_claim_sha256 !== context.effect_claim_sha256 ||
    value.dispatch_intent_anchor_sha256 !== context.dispatch_intent_anchor_sha256 ||
    value.journal_dispatch_id_sha256 !== context.journal_dispatch_id_sha256 ||
    value.journal_dispatch_anchor_sha256 !== context.journal_dispatch_anchor_sha256 ||
    value.journal_claim_fence_sha256 !== context.journal_claim_fence_sha256 ||
    value.journal_lease_epoch !== context.journal_lease_epoch.toString(10) || !/^[1-9][0-9]*$/u.test(value.journal_lease_epoch) ||
    value.provider_effect_ownership_nonce_sha256 !== context.ownership_nonce_sha256 ||
    !isDigest(value.provider_ownership_binding_sha256) ||
    value.allocation_count !== 1 || value.network_policy !== "deny_all" || value.destroy_execution_count !== 1 ||
    value.get_absent !== true || value.list_absent !== true || value.deletion_proven !== true ||
    !safeInteger(value.checkpoint_file_count, 0, request.checkpoint.max_files) ||
    !safeInteger(value.checkpoint_total_bytes, 0, request.checkpoint.max_total_bytes) ||
    value.checkpoint_readback_sha256 !== value.checkpoint_sha256 ||
    [value.provider_fingerprint_sha256, value.broker_artifact_sha256, value.broker_protocol_sha256,
      value.authenticated_session_sha256, value.execution_receipt_sha256, value.workspace_readback_sha256,
      value.checkpoint_sha256, value.checkpoint_manifest_sha256, value.checkpoint_handoff_sha256,
      value.result_bundle_sha256, value.provider_effect_ownership_nonce_sha256, value.absence_evidence_sha256,
      value.provider_ownership_binding_sha256, value.output_manifest_sha256, value.output_diff_sha256,
      value.effect_claim_sha256, value.dispatch_intent_anchor_sha256,
      value.execution_receipt_core_sha256].some((item) => !isDigest(item))) {
    throw adapterError("integrity_failed")
  }
  if (value.absence_evidence_sha256 !== disposableTaskAbsenceEvidenceSha256({
    dispatch_id_sha256: context.journal_dispatch_id_sha256,
    request_sha256: value.request_sha256 as Digest,
    provider: request.provider,
    provider_creation_token_sha256: context.provider_creation_token_sha256,
    immutable_fingerprint_sha256: context.immutable_fingerprint_sha256,
    provider_fingerprint_sha256: value.provider_fingerprint_sha256 as Digest,
    provider_effect_claim_fence_sha256: context.journal_claim_fence_sha256,
    provider_effect_lease_epoch: context.journal_lease_epoch,
    provider_effect_ownership_nonce_sha256: context.ownership_nonce_sha256,
    provider_ownership_binding_sha256: value.provider_ownership_binding_sha256 as Digest,
    effect_claim_sha256: context.effect_claim_sha256,
    dispatch_intent_anchor_sha256: context.dispatch_intent_anchor_sha256,
    destroy_execution_count: 1,
    get_absent: true,
    list_absent: true,
    conflicting_scoped_matches: 0,
  })) throw adapterError("integrity_failed")
  const { execution_receipt_core_sha256: claimed, ...core } = value
  if (claimed !== canonicalSha256(core)) throw adapterError("integrity_failed")
  return Object.freeze({ ...core, execution_receipt_core_sha256: claimed }) as unknown as DisposableSandboxTaskExecutionReceiptV1
}

function finalReceipt(
  execution: DisposableSandboxTaskExecutionReceiptV1,
  journalOutcomeAnchorSha256: Digest,
): Readonly<DisposableSandboxTaskReceiptV1> {
  if (!isDigest(journalOutcomeAnchorSha256)) throw adapterError("integrity_failed")
  const core = { ...execution, journal_outcome_anchor_sha256: journalOutcomeAnchorSha256 }
  return Object.freeze({ ...core, receipt_sha256: canonicalSha256(core) })
}

export function parseDisposableSandboxTaskReceiptV1(
  value: unknown,
  requestValue: Readonly<DisposableSandboxTaskRequestV1>,
  context: Readonly<DisposableSandboxTaskExecutionContextV1>,
): Readonly<DisposableSandboxTaskReceiptV1> {
  if (!isPlainRecord(value) || !isDigest(value.journal_outcome_anchor_sha256) || !isDigest(value.receipt_sha256)) {
    throw adapterError("integrity_failed")
  }
  const execution = parseDisposableSandboxTaskExecutionReceiptV1(value, requestValue, context)
  const expected = finalReceipt(execution, value.journal_outcome_anchor_sha256)
  if (value.receipt_sha256 !== expected.receipt_sha256 || canonicalSha256(value) !== canonicalSha256(expected)) {
    throw adapterError("integrity_failed")
  }
  return expected
}

function validateJournalDescription(value: DisposableTaskJournalDescriptionV1, requireDurable: boolean): void {
  if (!closedRecord(value, ["durability", "encrypted_at_rest", "external_head_witness_sha256", "journal_identity_sha256", "restore_domain_sha256", "signer_principal", "signing_key_id"]) ||
    !["durable", "volatile"].includes(String(value.durability)) ||
    ![value.journal_identity_sha256, value.restore_domain_sha256, value.external_head_witness_sha256].every(isDigest) ||
    !safeString(value.signer_principal, 128) || !ID.test(value.signer_principal) ||
    !safeString(value.signing_key_id, 128) || !ID.test(value.signing_key_id) ||
    (requireDurable && (value.durability !== "durable" || value.encrypted_at_rest !== true))) {
    throw adapterError("integrity_failed")
  }
}

function validateAuthorityDescription(
  value: ReturnType<DisposableSandboxTaskAuthorityPortV1["describe"]>,
  requireDurable: boolean,
): void {
  if (!closedRecord(value, ["durability", "implementation_sha256", "trust_root_sha256"]) ||
    !["durable", "volatile"].includes(String(value.durability)) ||
    !isDigest(value.implementation_sha256) || !isDigest(value.trust_root_sha256) ||
    (requireDurable && value.durability !== "durable")) throw adapterError("integrity_failed")
}

function validateOutcomeVerifierDescription(
  value: ReturnType<DisposableTaskOutcomeAnchorVerifierPortV1["describe"]>,
): void {
  if (!closedRecord(value, ["implementation_sha256", "trust_root_sha256"]) ||
    !isDigest(value.implementation_sha256) || !isDigest(value.trust_root_sha256)) {
    throw adapterError("integrity_failed")
  }
}

function validateRunnerDescription(
  value: DisposableSandboxTaskRunnerDescriptionV1,
  provider: ManagedProviderIdV1,
  requireDurable: boolean,
): void {
  if (!closedRecord(value, ["checkpoint_handoff_durability", "checkpoint_readback_verified", "implementation_sha256", "provider"]) ||
    value.provider !== provider || !isDigest(value.implementation_sha256) ||
    !["durable", "volatile"].includes(String(value.checkpoint_handoff_durability)) ||
    (requireDurable && (value.checkpoint_handoff_durability !== "durable" || value.checkpoint_readback_verified !== true))) {
    throw adapterError("integrity_failed")
  }
}

function directDigest(bytes: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function validPositiveSignedInt64(value: unknown): value is string {
  return typeof value === "string" && POSITIVE_SIGNED_INT64.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n
}

function validAuthorizationContextId(value: unknown): value is string {
  return typeof value === "string" && AUTH_CONTEXT_ID.test(value) &&
    !CREDENTIAL_CARRIER_PREFIX.test(value) &&
    !(value.length > 48 && /^[A-Za-z0-9]+$/u.test(value))
}

function validCanonicalTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length === 24 && RFC3339_UTC_MILLISECONDS.test(value) &&
    new Date(value).toISOString() === value
}

function validEd25519Base64Url(value: unknown): value is string {
  if (typeof value !== "string" || !ED25519_BASE64URL.test(value)) return false
  const bytes = Buffer.from(value, "base64url")
  return bytes.byteLength === 64 && bytes.toString("base64url") === value
}

function parseAuthorizationReceipt(
  envelope: DisposableTaskAuthorizationReceiptEnvelopeV1,
  expected: DisposableTaskAuthorityConsumeInputV1,
  allowExpired = false,
): Readonly<DisposableTaskAuthorizationReceiptEnvelopeV1> {
  if (!closedRecord(envelope, ["canonical_receipt_bytes", "receipt_sha256"]) ||
    !(envelope.canonical_receipt_bytes instanceof Uint8Array) || envelope.canonical_receipt_bytes.byteLength > 16 * 1024 ||
    !isDigest(envelope.receipt_sha256)) throw adapterError("integrity_failed")
  const bytes = envelope.canonical_receipt_bytes.slice()
  if (directDigest(bytes) !== envelope.receipt_sha256) throw adapterError("integrity_failed")
  let text: string
  let parsed: unknown
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    parsed = parseCanonicalJson(text)
  } catch {
    throw adapterError("integrity_failed")
  }
  const keys = [
    "attempt_id", "attempt_lease_id", "audience", "authority_envelope_sha256", "authority_epoch",
    "canonical_request_sha256", "checkpoint_policy_sha256", "consumed_at", "dispatch_id", "effect_claim_sha256",
    "expires_at", "input_manifest_sha256", "issued_at", "key_id", "lease_epoch", "model_operation_id",
    "operation_digest", "provider", "run_id", "schema_version", "signature", "signer_incarnation", "signer_ref",
    "source_manifest_sha256",
  ] as const
  if (!closedRecord(parsed, keys) || canonicalJson(parsed) !== text) throw adapterError("integrity_failed")
  if (parsed.schema_version !== DISPOSABLE_TASK_AUTHORIZATION_CONSUMPTION_SCHEMA_V1 ||
    parsed.dispatch_id !== expected.dispatch_id ||
    parsed.authority_envelope_sha256 !== expected.authority_envelope_sha256 ||
    parsed.canonical_request_sha256 !== expected.canonical_request_sha256 || parsed.operation_digest !== expected.operation_digest ||
    parsed.provider !== expected.provider || parsed.source_manifest_sha256 !== expected.source_manifest_sha256 ||
    parsed.input_manifest_sha256 !== expected.input_manifest_sha256 ||
    parsed.checkpoint_policy_sha256 !== expected.checkpoint_policy_sha256 ||
    parsed.effect_claim_sha256 !== expected.effect_claim_sha256 ||
    parsed.audience !== DISPOSABLE_TASK_PROVIDER_CONTACT_AUDIENCE_V1 ||
    !validPositiveSignedInt64(parsed.authority_epoch) || !validPositiveSignedInt64(parsed.lease_epoch) ||
    ![parsed.run_id, parsed.attempt_id, parsed.attempt_lease_id, parsed.model_operation_id,
      parsed.signer_ref, parsed.signer_incarnation, parsed.key_id].every(validAuthorizationContextId) ||
    !validEd25519Base64Url(parsed.signature)) {
    throw adapterError("integrity_failed")
  }
  if (![parsed.issued_at, parsed.consumed_at, parsed.expires_at].every(validCanonicalTimestamp) ||
    Date.parse(parsed.issued_at as string) > Date.parse(parsed.consumed_at as string) ||
    Date.parse(parsed.consumed_at as string) > Date.now() + MAX_AUTHORITY_CLOCK_SKEW_MS ||
    Date.parse(parsed.consumed_at as string) >= Date.parse(parsed.expires_at as string) ||
    Date.parse(parsed.expires_at as string) - Date.parse(parsed.consumed_at as string) > MAX_PROVIDER_CONTACT_AUTH_MS ||
    (!allowExpired && Date.parse(parsed.expires_at as string) <= Date.now())) throw adapterError("integrity_failed")
  return Object.freeze({ canonical_receipt_bytes: bytes, receipt_sha256: envelope.receipt_sha256 })
}

function authorizationExpiresAt(envelope: DisposableTaskAuthorizationReceiptEnvelopeV1): number {
  const parsed = parseCanonicalJson(new TextDecoder("utf-8", { fatal: true }).decode(envelope.canonical_receipt_bytes))
  if (!isPlainRecord(parsed) || typeof parsed.expires_at !== "string") throw adapterError("integrity_failed")
  return Date.parse(parsed.expires_at)
}

function stableAuthorityInput(
  request: DisposableSandboxTaskRequestV1,
  requestSha256: Digest,
  dispatchId: string,
  effectClaimSha256: Digest,
): DisposableTaskAuthorityConsumeInputV1 {
  return Object.freeze({
    dispatch_id: dispatchId,
    authority_envelope_sha256: request.authority_envelope_sha256,
    canonical_request_sha256: requestSha256,
    operation_digest: request.operation_digest,
    provider: request.provider,
    source_manifest_sha256: request.source_manifest_sha256,
    input_manifest_sha256: request.input_manifest_sha256,
    checkpoint_policy_sha256: disposableTaskCheckpointPolicySha256(request.checkpoint),
    effect_claim_sha256: effectClaimSha256,
  })
}

function parseJournalAuthorization(
  value: DisposableTaskJournalAuthorizationV1,
  expected: DisposableTaskAuthorityConsumeInputV1,
): Readonly<DisposableTaskJournalAuthorizationV1> {
  if (!closedRecord(value, ["canonical_consume_input_bytes", "consume_input", "consume_input_sha256", "stored_receipt"]) ||
    !(value.canonical_consume_input_bytes instanceof Uint8Array) || value.canonical_consume_input_bytes.byteLength > 16 * 1024 ||
    !isDigest(value.consume_input_sha256) || !closedRecord(value.consume_input, [
      "authority_envelope_sha256", "canonical_request_sha256", "checkpoint_policy_sha256", "dispatch_id",
      "effect_claim_sha256", "input_manifest_sha256", "operation_digest", "provider", "source_manifest_sha256",
    ])) throw adapterError("integrity_failed")
  const bytes = value.canonical_consume_input_bytes.slice()
  const expectedBytes = new TextEncoder().encode(canonicalJson(expected))
  if (!timingSafeEqual(bytes, expectedBytes) || directDigest(bytes) !== value.consume_input_sha256 ||
    canonicalJson(value.consume_input) !== canonicalJson(expected)) throw adapterError("integrity_failed")
  const stored = value.stored_receipt === null
    ? null
    : parseAuthorizationReceipt(value.stored_receipt, expected, true)
  return Object.freeze({
    canonical_consume_input_bytes: bytes,
    consume_input_sha256: value.consume_input_sha256,
    consume_input: expected,
    stored_receipt: stored,
  })
}

function validateRecoveryBinding(
  value: DisposableTaskJournalRecoveryV1,
  claim: DisposableTaskJournalClaimV1,
  priorState: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED",
): void {
  if (!closedRecord(value, [
    "canonical_recovery_record_bytes", "canonical_signed_recovery_anchor_bytes", "expected_checkpoint_handoff_sha256",
    "expected_result_bundle_sha256",
    "expected_provider_fingerprint_sha256", "provider_effect_claim_fence_sha256", "provider_effect_lease_epoch",
    "provider_effect_ownership_nonce_sha256", "recovery_anchor_sha256", "recovery_record_sha256",
  ]) || !(value.canonical_recovery_record_bytes instanceof Uint8Array) ||
    !(value.canonical_signed_recovery_anchor_bytes instanceof Uint8Array) ||
    value.canonical_recovery_record_bytes.byteLength > 64 * 1024 ||
    value.canonical_signed_recovery_anchor_bytes.byteLength > 128 * 1024 || !isDigest(value.recovery_record_sha256) ||
    !isDigest(value.recovery_anchor_sha256) || directDigest(value.canonical_recovery_record_bytes) !== value.recovery_record_sha256 ||
    directDigest(value.canonical_signed_recovery_anchor_bytes) !== value.recovery_anchor_sha256 ||
    !isDigest(value.provider_effect_claim_fence_sha256) || typeof value.provider_effect_lease_epoch !== "bigint" ||
    value.provider_effect_lease_epoch < 1n || !isDigest(value.provider_effect_ownership_nonce_sha256) ||
    (value.expected_provider_fingerprint_sha256 !== null && !isDigest(value.expected_provider_fingerprint_sha256)) ||
    (value.expected_result_bundle_sha256 !== null && !isDigest(value.expected_result_bundle_sha256)) ||
    (value.expected_checkpoint_handoff_sha256 !== null && !isDigest(value.expected_checkpoint_handoff_sha256)) ||
    ((value.expected_result_bundle_sha256 === null) !== (value.expected_checkpoint_handoff_sha256 === null)) ||
    (["DISPATCHED", "RESULT_PERSISTED"].includes(priorState) && value.expected_provider_fingerprint_sha256 === null) ||
    (priorState === "RESULT_PERSISTED" && value.expected_result_bundle_sha256 === null)) throw adapterError("integrity_failed")
  let parsed: unknown
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(value.canonical_recovery_record_bytes)
    parsed = parseCanonicalJson(text)
    if (canonicalJson(parsed) !== text)
      throw adapterError("integrity_failed")
  } catch {
    throw adapterError("integrity_failed")
  }
  if (!closedRecord(parsed, [
    "current_claim_fence_sha256", "current_lease_epoch", "dispatch_id", "expected_checkpoint_handoff_sha256",
    "effect_claim_sha256", "expected_provider_fingerprint_sha256", "expected_result_bundle_sha256", "provider_effect_claim_fence_sha256",
    "provider_effect_lease_epoch", "provider_effect_ownership_nonce_sha256",
    "prior_state", "request_sha256", "schema_version",
  ]) || parsed.schema_version !== "sandboxes.disposable-task-recovery-anchor/v1" ||
    parsed.dispatch_id !== claim.dispatch_id || parsed.request_sha256 !== claim.request_sha256 || parsed.prior_state !== priorState ||
    parsed.effect_claim_sha256 !== claim.effect_claim_sha256 ||
    parsed.provider_effect_claim_fence_sha256 !== value.provider_effect_claim_fence_sha256 ||
    parsed.provider_effect_lease_epoch !== value.provider_effect_lease_epoch ||
    parsed.provider_effect_ownership_nonce_sha256 !== value.provider_effect_ownership_nonce_sha256 ||
    parsed.current_claim_fence_sha256 !== claim.claim_fence_sha256 || parsed.current_lease_epoch !== claim.lease_epoch ||
    parsed.expected_provider_fingerprint_sha256 !== value.expected_provider_fingerprint_sha256 ||
    parsed.expected_result_bundle_sha256 !== value.expected_result_bundle_sha256 ||
    parsed.expected_checkpoint_handoff_sha256 !== value.expected_checkpoint_handoff_sha256) throw adapterError("integrity_failed")
}

function deterministicProviderBinding(request: DisposableSandboxTaskRequestV1, requestSha256: Digest) {
  const providerMetadataScopeSha256 = canonicalSha256({
    schema_version: "sandboxes.disposable-task-provider-scope/v1",
    provider: request.provider,
    request_sha256: requestSha256,
    idempotency_key_sha256: request.idempotency_key_sha256,
  })
  return Object.freeze({
    provider_metadata_scope_sha256: providerMetadataScopeSha256,
    provider_creation_token_sha256: canonicalSha256({
      schema_version: "sandboxes.disposable-task-creation-token/v1",
      provider_metadata_scope_sha256: providerMetadataScopeSha256,
    }),
    immutable_fingerprint_sha256: canonicalSha256({
      schema_version: "sandboxes.disposable-task-provider-fingerprint/v1",
      provider_metadata_scope_sha256: providerMetadataScopeSha256,
      environment_image_sha256: request.environment_image_sha256,
      source_manifest_sha256: request.source_manifest_sha256,
      input_manifest_sha256: request.input_manifest_sha256,
    }),
  })
}

function expectedEffectClaimSha256(
  request: DisposableSandboxTaskRequestV1,
  requestSha256: Digest,
  claim: DisposableTaskJournalClaimV1,
  recovery: DisposableTaskJournalRecoveryV1 | null,
): Digest {
  return canonicalSha256({
    schema_version: "sandboxes.disposable-task-effect-claim/v1",
    dispatch_id: claim.dispatch_id,
    request_sha256: requestSha256,
    provider: request.provider,
    provider_metadata_scope_sha256: claim.provider_metadata_scope_sha256,
    provider_creation_token_sha256: claim.provider_creation_token_sha256,
    immutable_fingerprint_sha256: claim.immutable_fingerprint_sha256,
    provider_effect_claim_fence_sha256: recovery?.provider_effect_claim_fence_sha256 ?? claim.claim_fence_sha256,
    provider_effect_lease_epoch: recovery?.provider_effect_lease_epoch ?? claim.lease_epoch,
    provider_effect_ownership_nonce_sha256: recovery?.provider_effect_ownership_nonce_sha256 ?? claim.ownership_nonce_sha256,
  })
}

function executionContext(
  claim: DisposableTaskJournalClaimV1,
  authorizationReceiptSha256: Digest,
  dispatchIntentAnchorSha256: Digest,
  journal: DisposableTaskJournalPortV1,
  recovery: DisposableTaskJournalRecoveryV1 | null,
): DisposableSandboxTaskExecutionContextV1 {
  const effectFence = recovery?.provider_effect_claim_fence_sha256 ?? claim.claim_fence_sha256
  const effectEpoch = recovery?.provider_effect_lease_epoch ?? claim.lease_epoch
  const effectOwnership = recovery?.provider_effect_ownership_nonce_sha256 ?? claim.ownership_nonce_sha256
  return Object.freeze({
    dispatch_id: claim.dispatch_id,
    journal_dispatch_id_sha256: canonicalSha256(claim.dispatch_id),
    journal_dispatch_anchor_sha256: claim.dispatch_anchor_sha256,
    journal_claim_fence_sha256: effectFence,
    journal_lease_epoch: effectEpoch,
    journal_lease_expires_at: claim.lease_expires_at,
    provider_metadata_scope_sha256: claim.provider_metadata_scope_sha256,
    provider_creation_token_sha256: claim.provider_creation_token_sha256,
    immutable_fingerprint_sha256: claim.immutable_fingerprint_sha256,
    ownership_nonce_sha256: effectOwnership,
    recovery_expected_result_bundle_sha256: recovery?.expected_result_bundle_sha256 ?? null,
    recovery_expected_checkpoint_handoff_sha256: recovery?.expected_checkpoint_handoff_sha256 ?? null,
    recovery_expected_provider_fingerprint_sha256: recovery?.expected_provider_fingerprint_sha256 ?? null,
    authorization_consumption_receipt_sha256: authorizationReceiptSha256,
    effect_claim_sha256: claim.effect_claim_sha256,
    dispatch_intent_anchor_sha256: dispatchIntentAnchorSha256,
    async markDispatched(providerFingerprintSha256: Digest) {
      if (!isDigest(providerFingerprintSha256)) throw adapterError("integrity_failed")
      const result = await journal.markDispatched({
        dispatch_id: claim.dispatch_id,
        request_sha256: claim.request_sha256,
        claim_fence_sha256: claim.claim_fence_sha256,
        lease_epoch: claim.lease_epoch,
        provider_fingerprint_sha256: providerFingerprintSha256,
        provider_metadata_scope_sha256: claim.provider_metadata_scope_sha256,
      })
      if (!closedRecord(result, ["dispatch_anchor_sha256"]) || !isDigest(result.dispatch_anchor_sha256)) {
        throw adapterError("integrity_failed")
      }
      return result.dispatch_anchor_sha256
    },
    async markResultPersisted(input: { result_bundle_sha256: Digest; checkpoint_handoff_sha256: Digest }) {
      if (!isDigest(input.result_bundle_sha256) || !isDigest(input.checkpoint_handoff_sha256)) throw adapterError("integrity_failed")
      const result = await journal.markResultPersisted({
        dispatch_id: claim.dispatch_id,
        request_sha256: claim.request_sha256,
        claim_fence_sha256: claim.claim_fence_sha256,
        lease_epoch: claim.lease_epoch,
        ...input,
      })
      if (!closedRecord(result, ["result_persisted_anchor_sha256"]) || !isDigest(result.result_persisted_anchor_sha256)) {
        throw adapterError("integrity_failed")
      }
      return result.result_persisted_anchor_sha256
    },
  })
}

async function verifiedFinalReceipt(
  completed: DisposableTaskJournalCompletedV1,
  request: DisposableSandboxTaskRequestV1,
  context: DisposableSandboxTaskExecutionContextV1,
  verifier: DisposableTaskOutcomeAnchorVerifierPortV1,
): Promise<Readonly<DisposableSandboxTaskReceiptV1>> {
  if (!(completed.canonical_anchor_bytes instanceof Uint8Array) || !isDigest(completed.anchor_sha256) ||
    directDigest(completed.canonical_anchor_bytes) !== completed.anchor_sha256 || completed.request_sha256 !== disposableSandboxTaskRequestSha256(request)) {
    throw adapterError("integrity_failed")
  }
  if (completed.outcome_kind !== "succeeded" || completed.execution_receipt === null) {
    throw adapterError("provider_state_unknown", { quarantineRequired: completed.outcome_kind !== "failed_no_effect" })
  }
  const execution = parseDisposableSandboxTaskExecutionReceiptV1(completed.execution_receipt, request, context)
  await verifier.assertVerified({
    canonical_anchor_bytes: completed.canonical_anchor_bytes.slice(),
    anchor_sha256: completed.anchor_sha256,
    request_sha256: completed.request_sha256,
    outcome_kind: completed.outcome_kind,
    execution_receipt_sha256: execution.execution_receipt_core_sha256,
  })
  return finalReceipt(execution, completed.anchor_sha256)
}

async function execute(
  requestValue: DisposableSandboxTaskRequestV1,
  dependencies: DisposableSandboxTaskDependenciesV1,
  requireDurable: boolean,
): Promise<Readonly<DisposableSandboxTaskReceiptV1>> {
  const request = parseDisposableSandboxTaskRequestV1(requestValue)
  if (dependencies.runner.provider !== request.provider) throw adapterError("validation_failed")
  if (!isDigest(dependencies.lease_owner_sha256)) throw adapterError("validation_failed")
  validateJournalDescription(dependencies.journal.describe(), requireDurable)
  validateAuthorityDescription(dependencies.authority.describe(), requireDurable)
  validateOutcomeVerifierDescription(dependencies.outcome_verifier.describe())
  validateRunnerDescription(dependencies.runner.describe(), request.provider, requireDurable)
  const witnessDescription = dependencies.witness.describe()
  if (!closedRecord(witnessDescription, ["durability", "restore_domain_sha256", "witness_identity_sha256"]) ||
    witnessDescription.durability !== "durable" || !isDigest(witnessDescription.restore_domain_sha256) ||
    !isDigest(witnessDescription.witness_identity_sha256) ||
    dependencies.journal.describe().external_head_witness_sha256 !== witnessDescription.witness_identity_sha256) {
    throw adapterError("integrity_failed")
  }
  const witnessReceipt = await dependencies.journal.assertWitnessCurrent(dependencies.witness)
  if (!closedRecord(witnessReceipt, ["witness_receipt_sha256"]) || !isDigest(witnessReceipt.witness_receipt_sha256)) {
    throw adapterError("integrity_failed")
  }
  const requestSha256 = disposableSandboxTaskRequestSha256(request)
  const providerBinding = deterministicProviderBinding(request, requestSha256)
  const prepared = await dependencies.journal.prepareDispatch({
    idempotency_key_sha256: request.idempotency_key_sha256,
    request_sha256: requestSha256,
    canonical_request_bytes: new TextEncoder().encode(canonicalJson(request)),
    operation_digest: request.operation_digest,
    authority_envelope_sha256: request.authority_envelope_sha256,
    source_manifest_sha256: request.source_manifest_sha256,
    input_manifest_sha256: request.input_manifest_sha256,
    checkpoint_policy_sha256: disposableTaskCheckpointPolicySha256(request.checkpoint),
    provider: request.provider,
    ...providerBinding,
    lease_owner_sha256: dependencies.lease_owner_sha256,
    lease_duration_ms: Math.min(3_600_000, request.max_runtime_ms + 60_000),
  })
  if (prepared.kind === "busy") throw adapterError("dependency_unavailable", { retryable: true })
  if (prepared.kind === "quarantined") throw adapterError("provider_state_unknown", { quarantineRequired: true })
  if (prepared.kind === "outcome") {
    if (prepared.execution_receipt === null) throw adapterError("provider_state_unknown")
    const replayContext: DisposableSandboxTaskExecutionContextV1 = Object.freeze({
      dispatch_id: "replay",
      journal_dispatch_id_sha256: prepared.execution_receipt.journal_dispatch_id_sha256,
      journal_dispatch_anchor_sha256: prepared.execution_receipt.journal_dispatch_anchor_sha256,
      journal_claim_fence_sha256: prepared.execution_receipt.journal_claim_fence_sha256,
      journal_lease_epoch: BigInt(prepared.execution_receipt.journal_lease_epoch),
      journal_lease_expires_at: new Date(Date.now() + 1_000).toISOString(),
      provider_metadata_scope_sha256: providerBinding.provider_metadata_scope_sha256,
      provider_creation_token_sha256: providerBinding.provider_creation_token_sha256,
      immutable_fingerprint_sha256: providerBinding.immutable_fingerprint_sha256,
      ownership_nonce_sha256: prepared.execution_receipt.provider_effect_ownership_nonce_sha256,
      recovery_expected_result_bundle_sha256: null,
      recovery_expected_checkpoint_handoff_sha256: null,
      recovery_expected_provider_fingerprint_sha256: null,
      authorization_consumption_receipt_sha256: prepared.execution_receipt.authorization_consumption_receipt_sha256,
      effect_claim_sha256: prepared.execution_receipt.effect_claim_sha256,
      dispatch_intent_anchor_sha256: prepared.execution_receipt.dispatch_intent_anchor_sha256,
      markDispatched: async () => { throw adapterError("integrity_failed") },
      markResultPersisted: async () => { throw adapterError("integrity_failed") },
    })
    return verifiedFinalReceipt(prepared, request, replayContext, dependencies.outcome_verifier)
  }
  const recovery = prepared.kind === "reconcile" ? prepared.recovery_binding : null
  if (prepared.kind === "reconcile") validateRecoveryBinding(prepared.recovery_binding, prepared, prepared.prior_state)
  const expectedEffectClaim = expectedEffectClaimSha256(request, requestSha256, prepared, recovery)
  if (prepared.effect_claim_sha256 !== expectedEffectClaim) throw adapterError("integrity_failed")
  const authorityInput = stableAuthorityInput(request, requestSha256, prepared.dispatch_id, expectedEffectClaim)
  const journalAuthorization = parseJournalAuthorization(prepared.authorization, authorityInput)
  if (prepared.kind === "prepared" && journalAuthorization.stored_receipt !== null) throw adapterError("integrity_failed")
  if (prepared.kind === "reconcile" && journalAuthorization.stored_receipt === null) {
    const containmentContext = executionContext(
      prepared,
      canonicalSha256({
        schema_version: "sandboxes.disposable-task-unbound-authorization/v1",
        consume_input_sha256: journalAuthorization.consume_input_sha256,
      }),
      prepared.dispatch_intent_anchor_sha256 ?? canonicalSha256({
        schema_version: "sandboxes.disposable-task-no-dispatch-intent/v1",
        effect_claim_sha256: prepared.effect_claim_sha256,
      }),
      dependencies.journal,
      prepared.recovery_binding,
    )
    let evidence = prepared.recovery_binding.recovery_anchor_sha256
    try {
      const contained = await dependencies.runner.contain(
        request,
        Object.freeze({ ...containmentContext, prior_state: prepared.prior_state }),
      )
      if (contained !== "quarantined" && closedRecord(contained, [
        "absence_evidence_sha256", "conflicting_scoped_matches", "get_absent", "list_absent",
      ]) && isDigest(contained.absence_evidence_sha256) && contained.get_absent === true &&
        contained.list_absent === true && contained.conflicting_scoped_matches === 0) {
        evidence = contained.absence_evidence_sha256
      }
    } catch {
      // The current finalizer still records the unresolved recovery after best-effort containment.
    } finally {
      await dependencies.journal.quarantine({
        dispatch_id: prepared.dispatch_id,
        request_sha256: requestSha256,
        claim_fence_sha256: prepared.claim_fence_sha256,
        lease_epoch: prepared.lease_epoch,
        quarantine_reason: "authorization_receipt_unavailable_after_takeover",
        quarantine_evidence_sha256: evidence,
      })
    }
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }
  let authorization: DisposableTaskAuthorizationReceiptEnvelopeV1
  if (journalAuthorization.stored_receipt !== null) {
    authorization = journalAuthorization.stored_receipt
  } else {
    try {
      authorization = parseAuthorizationReceipt(await dependencies.authority.consumeOnce(authorityInput), authorityInput)
    } catch (cause) {
      throw cause instanceof AdapterContractError ? cause : adapterError("dependency_unavailable")
    }
  }
  let dispatchIntentAnchor: Digest
  if (prepared.kind === "reconcile") {
    if (prepared.dispatch_intent_anchor_sha256 === null || prepared.prior_state === "PREPARED") {
      throw adapterError("integrity_failed")
    }
    dispatchIntentAnchor = prepared.dispatch_intent_anchor_sha256
  } else {
    const bound = await dependencies.journal.bindAuthorizationAndMarkIntent({
      dispatch_id: prepared.dispatch_id,
      request_sha256: requestSha256,
      claim_fence_sha256: prepared.claim_fence_sha256,
      lease_epoch: prepared.lease_epoch,
      effect_claim_sha256: prepared.effect_claim_sha256,
      authorization_receipt: authorization,
    })
    if (!closedRecord(bound, ["authorization_consumption_receipt_sha256", "dispatch_intent_anchor_sha256"]) ||
      bound.authorization_consumption_receipt_sha256 !== authorization.receipt_sha256 ||
      !isDigest(bound.dispatch_intent_anchor_sha256)) throw adapterError("integrity_failed")
    dispatchIntentAnchor = bound.dispatch_intent_anchor_sha256
    if (authorizationExpiresAt(authorization) <= Date.now()) {
      await dependencies.journal.quarantine({
        dispatch_id: prepared.dispatch_id,
        request_sha256: requestSha256,
        claim_fence_sha256: prepared.claim_fence_sha256,
        lease_epoch: prepared.lease_epoch,
        quarantine_reason: "authorization_expired_before_provider_contact",
        quarantine_evidence_sha256: authorization.receipt_sha256,
      })
      throw adapterError("dependency_unavailable")
    }
  }
  const context = executionContext(
    prepared,
    authorization.receipt_sha256,
    dispatchIntentAnchor,
    dependencies.journal,
    prepared.kind === "reconcile" ? prepared.recovery_binding : null,
  )
  let executionReceipt: DisposableSandboxTaskExecutionReceiptV1 | "quarantined"
  try {
    const candidate = prepared.kind === "reconcile"
      ? await dependencies.runner.reconcile(request, Object.freeze({ ...context, prior_state: prepared.prior_state }))
      : await dependencies.runner.run(request, context)
    if (candidate === "quarantined") {
      await dependencies.journal.quarantine({
        dispatch_id: prepared.dispatch_id,
        request_sha256: requestSha256,
        claim_fence_sha256: prepared.claim_fence_sha256,
        lease_epoch: prepared.lease_epoch,
        quarantine_reason: "reconciliation_unresolved",
        quarantine_evidence_sha256: canonicalSha256({ request_sha256: requestSha256, state: prepared.kind }),
      })
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    executionReceipt = parseDisposableSandboxTaskExecutionReceiptV1(candidate, request, context)
  } catch (cause) {
    try {
      await dependencies.journal.quarantine({
        dispatch_id: prepared.dispatch_id,
        request_sha256: requestSha256,
        claim_fence_sha256: prepared.claim_fence_sha256,
        lease_epoch: prepared.lease_epoch,
        quarantine_reason: "provider_outcome_unresolved",
        quarantine_evidence_sha256: canonicalSha256({ request_sha256: requestSha256, code: cause instanceof AdapterContractError ? cause.code : "unknown" }),
      })
    } catch {
      // The original ambiguity remains authoritative; never retry the provider here.
    }
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }
  const completed = await dependencies.journal.commitOutcome({
    dispatch_id: prepared.dispatch_id,
    request_sha256: requestSha256,
    claim_fence_sha256: prepared.claim_fence_sha256,
    lease_epoch: prepared.lease_epoch,
    outcome_kind: "succeeded",
    execution_receipt: executionReceipt,
    failure_code: null,
    failure_evidence_sha256: null,
  })
  return verifiedFinalReceipt(completed, request, context, dependencies.outcome_verifier)
}

/** Production entry point. It cannot reach the journal or provider while admission is false. */
export function runDisposableSandboxTask(
  request: DisposableSandboxTaskRequestV1,
  dependencies: DisposableSandboxTaskDependenciesV1,
): Promise<Readonly<DisposableSandboxTaskReceiptV1>> {
  if (!Boolean(DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V1)) {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }
  return execute(request, dependencies, true)
}

/** Package-internal conformance entry point; intentionally omitted from package exports. */
export function __testOnlyRunDisposableSandboxTaskCandidateV1(
  request: DisposableSandboxTaskRequestV1,
  dependencies: DisposableSandboxTaskDependenciesV1,
): Promise<Readonly<DisposableSandboxTaskReceiptV1>> {
  return execute(request, dependencies, false)
}

// ---------------------------------------------------------------------------
// Acyclic disposable-task protocol v2
// ---------------------------------------------------------------------------

export const DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V2 = false as const
export const DISPOSABLE_SANDBOX_TASK_INTENT_SCHEMA_V2 =
  "sandboxes.disposable-task-intent/v2" as const
export const DISPOSABLE_TASK_PREPARED_SCHEMA_V2 =
  "sandboxes.disposable-task-prepared/v2" as const
export const DISPOSABLE_TASK_AUTHORIZATION_CONSUMPTION_SCHEMA_V2 =
  "sandboxes.disposable-task-authorization-consumption/v2" as const
export const DISPOSABLE_TASK_PROVIDER_CONTACT_AUDIENCE_V2 =
  "hasna:sandboxes:disposable-task-provider-contact/v2" as const
export const DISPOSABLE_TASK_BOUND_AUTHORIZATION_SCHEMA_V2 =
  "sandboxes.disposable-task-bound-authorization/v2" as const

const DISPATCH_ID_V2 = /^dt2_[0-9a-f]{64}$/u
const INTENT_V2_KEYS = [
  "checkpoint", "environment_image_sha256", "exec", "files", "idempotency_key_sha256",
  "input_manifest_sha256", "max_runtime_ms", "maximum_allocations", "network_policy",
  "operation_digest", "provider", "schema_version", "source_manifest_sha256", "task_bundle_sha256",
] as const
const PREPARED_V2_KEYS = [
  "canonical_intent_sha256", "checkpoint_policy_sha256", "dispatch_id", "effect_claim_sha256",
  "input_manifest_sha256", "operation_digest", "prepared_sha256", "provider",
  "sandbox_prepare_anchor_sha256", "schema_version", "source_manifest_sha256",
] as const
const AUTHORITY_CONSUME_V2_KEYS = [
  "dispatch_id", "canonical_intent_sha256", "sandbox_prepare_anchor_sha256",
  "authority_envelope_sha256", "operation_digest", "provider", "source_manifest_sha256",
  "input_manifest_sha256", "checkpoint_policy_sha256", "effect_claim_sha256",
] as const
const AUTHORIZATION_RECEIPT_V2_KEYS = [
  "schema_version", ...AUTHORITY_CONSUME_V2_KEYS,
  "authority_epoch", "run_id", "attempt_id", "attempt_lease_id", "lease_epoch",
  "model_operation_id", "audience", "issued_at", "consumed_at", "expires_at",
  "signer_ref", "signer_incarnation", "key_id", "signature",
] as const

export interface DisposableSandboxTaskIntentV2 {
  schema_version: typeof DISPOSABLE_SANDBOX_TASK_INTENT_SCHEMA_V2
  provider: ManagedProviderIdV1
  idempotency_key_sha256: Digest
  operation_digest: Digest
  source_manifest_sha256: Digest
  input_manifest_sha256: Digest
  environment_image_sha256: Digest
  task_bundle_sha256: Digest
  network_policy: "deny_all"
  maximum_allocations: 1
  max_runtime_ms: number
  files: DisposableTaskFileV1[]
  exec: DisposableTaskExecV1
  checkpoint: DisposableTaskCheckpointLimitsV1
}

export interface DisposableTaskPreparedIntentV2 {
  schema_version: typeof DISPOSABLE_TASK_PREPARED_SCHEMA_V2
  dispatch_id: string
  canonical_intent_sha256: Digest
  sandbox_prepare_anchor_sha256: Digest
  operation_digest: Digest
  provider: ManagedProviderIdV1
  source_manifest_sha256: Digest
  input_manifest_sha256: Digest
  checkpoint_policy_sha256: Digest
  effect_claim_sha256: Digest
  prepared_sha256: Digest
}

export interface DisposableTaskAuthorityConsumeInputV2 {
  dispatch_id: string
  canonical_intent_sha256: Digest
  sandbox_prepare_anchor_sha256: Digest
  authority_envelope_sha256: Digest
  operation_digest: Digest
  provider: ManagedProviderIdV1
  source_manifest_sha256: Digest
  input_manifest_sha256: Digest
  checkpoint_policy_sha256: Digest
  effect_claim_sha256: Digest
}

/** Both exact signed artifacts returned by the deployment-pinned Infinity port. */
export interface DisposableTaskAuthorizationArtifactsV2 {
  canonical_authority_envelope_bytes: Uint8Array
  authority_envelope_sha256: Digest
  canonical_receipt_bytes: Uint8Array
  receipt_sha256: Digest
}

export interface DisposableTaskJournalPrepareIntentInputV2 {
  idempotency_key_sha256: Digest
  canonical_intent_sha256: Digest
  canonical_intent_bytes: Uint8Array
  operation_digest: Digest
  source_manifest_sha256: Digest
  input_manifest_sha256: Digest
  checkpoint_policy_sha256: Digest
  provider: ManagedProviderIdV1
  provider_metadata_scope_sha256: Digest
  provider_creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  lease_owner_sha256: Digest
  lease_duration_ms: number
}

export interface DisposableTaskJournalClaimV2 {
  dispatch_id: string
  canonical_intent_sha256: Digest
  lease_epoch: bigint
  claim_fence_sha256: Digest
  lease_owner_sha256: Digest
  lease_expires_at: string
  provider_metadata_scope_sha256: Digest
  provider_creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  ownership_nonce_sha256: Digest
  provider_effect_claim_fence_sha256: Digest
  provider_effect_lease_epoch: bigint
  provider_effect_ownership_nonce_sha256: Digest
  effect_claim_sha256: Digest
  sandbox_prepare_anchor_sha256: Digest
  dispatch_intent_anchor_sha256: Digest | null
}

export type DisposableTaskJournalPrepareIntentResultV2 =
  | ({
    kind: "prepared"
    recovery: false
    prepared: DisposableTaskPreparedIntentV2
    stored_authorization: DisposableTaskAuthorizationArtifactsV2 | null
  } & DisposableTaskJournalClaimV2)
  | ({
    kind: "reconcile"
    recovery: true
    prior_state: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED"
    prepared: DisposableTaskPreparedIntentV2
    stored_authorization: DisposableTaskAuthorizationArtifactsV2 | null
  } & DisposableTaskJournalClaimV2)
  | { kind: "busy"; canonical_intent_sha256: Digest; retry_after: string }
  | { kind: "quarantined"; canonical_intent_sha256: Digest; quarantine_evidence_sha256: Digest }

export interface DisposableTaskJournalPortV2 {
  describe(): DisposableTaskJournalDescriptionV1
  assertWitnessCurrent(witness: DurableJournalWitnessPortV1): Promise<{ witness_receipt_sha256: Digest }>
  prepareIntentV2(input: Readonly<DisposableTaskJournalPrepareIntentInputV2>): Promise<DisposableTaskJournalPrepareIntentResultV2>
  bindAuthorizationAndMarkIntentV2(input: Readonly<{
    dispatch_id: string
    canonical_intent_sha256: Digest
    sandbox_prepare_anchor_sha256: Digest
    claim_fence_sha256: Digest
    lease_epoch: bigint
    effect_claim_sha256: Digest
    canonical_consume_input_bytes: Uint8Array
    consume_input_sha256: Digest
    authorization: DisposableTaskAuthorizationArtifactsV2
  }>): Promise<Readonly<{
    authority_envelope_sha256: Digest
    authorization_consumption_receipt_sha256: Digest
    dispatch_intent_anchor_sha256: Digest
  }>>
  quarantineAuthorizationV2(input: Readonly<{
    dispatch_id: string
    canonical_intent_sha256: Digest
    claim_fence_sha256: Digest
    lease_epoch: bigint
    quarantine_reason: "authorization_expired_before_provider_contact"
    quarantine_evidence_sha256: Digest
  }>): Promise<void>
}

export interface DisposableSandboxTaskAuthorityPortV2 {
  describe(): {
    durability: "durable" | "volatile"
    implementation_sha256: Digest
    trust_root_sha256: Digest
  }
  /** Exact replay returns byte-identical signed authorization and consumption artifacts. */
  consumeOnceV2(input: Readonly<DisposableTaskAuthorityConsumeInputV2>): Promise<Readonly<DisposableTaskAuthorizationArtifactsV2>>
}

export interface DisposableSandboxTaskPreparationDependenciesV2 {
  journal: DisposableTaskJournalPortV2
  witness: DurableJournalWitnessPortV1
  lease_owner_sha256: Digest
}

export interface DisposableSandboxTaskDispatchDependenciesV2 extends DisposableSandboxTaskPreparationDependenciesV2 {
  authority: DisposableSandboxTaskAuthorityPortV2
  expected_authority_trust_root_sha256: Digest
}

export interface DisposableSandboxTaskDispatchInputV2 {
  intent: DisposableSandboxTaskIntentV2
  prepared: DisposableTaskPreparedIntentV2
  authority_envelope_sha256: Digest
}

export interface DisposableTaskBoundAuthorizationV2 {
  schema_version: typeof DISPOSABLE_TASK_BOUND_AUTHORIZATION_SCHEMA_V2
  dispatch_id: string
  canonical_intent_sha256: Digest
  sandbox_prepare_anchor_sha256: Digest
  effect_claim_sha256: Digest
  authority_envelope_sha256: Digest
  authorization_consumption_receipt_sha256: Digest
  dispatch_intent_anchor_sha256: Digest
}

function parseDisposableSandboxTaskIntentV2(value: unknown): Readonly<DisposableSandboxTaskIntentV2> {
  if (!closedRecord(value, INTENT_V2_KEYS) || value.schema_version !== DISPOSABLE_SANDBOX_TASK_INTENT_SCHEMA_V2 ||
    !["e2b", "daytona_cloud"].includes(String(value.provider)) || value.maximum_allocations !== 1 ||
    value.network_policy !== "deny_all" || !safeInteger(value.max_runtime_ms, 1, 3_600_000) ||
    !Array.isArray(value.files) || value.files.length < 1 || value.files.length > MAX_FILES ||
    [value.idempotency_key_sha256, value.operation_digest, value.source_manifest_sha256,
      value.input_manifest_sha256, value.environment_image_sha256, value.task_bundle_sha256]
      .some((item) => !isDigest(item))) throw adapterError("validation_failed")
  const files = snapshotCanonicalDenseArray(value.files).map(validateFile)
  const totalBytes = files.reduce((total, file) => total + Buffer.from(file.content_base64, "base64").byteLength, 0)
  if (new Set(files.map((file) => file.path)).size !== files.length || totalBytes > MAX_TOTAL_BYTES) {
    throw adapterError("validation_failed")
  }
  const parsed = Object.freeze({
    schema_version: DISPOSABLE_SANDBOX_TASK_INTENT_SCHEMA_V2,
    provider: value.provider as ManagedProviderIdV1,
    idempotency_key_sha256: value.idempotency_key_sha256 as Digest,
    operation_digest: value.operation_digest as Digest,
    source_manifest_sha256: value.source_manifest_sha256 as Digest,
    input_manifest_sha256: value.input_manifest_sha256 as Digest,
    environment_image_sha256: value.environment_image_sha256 as Digest,
    task_bundle_sha256: value.task_bundle_sha256 as Digest,
    network_policy: "deny_all" as const,
    maximum_allocations: 1 as const,
    max_runtime_ms: value.max_runtime_ms as number,
    files: Object.freeze(files.slice()) as unknown as DisposableTaskFileV1[],
    exec: validateExec(value.exec),
    checkpoint: validateCheckpoint(value.checkpoint),
  })
  if (parsed.input_manifest_sha256 !== disposableTaskInputManifestSha256(parsed.files) ||
    parsed.files.some((file) => !outputPathAllowed(file.path, parsed.checkpoint.allowed_path_prefixes)) ||
    parsed.task_bundle_sha256 !== disposableTaskBundleSha256(parsed) ||
    parsed.operation_digest !== disposableTaskOperationDigest(parsed)) throw adapterError("validation_failed")
  return parsed
}

export function disposableSandboxTaskIntentSha256V2(value: unknown): Digest {
  return canonicalSha256(parseDisposableSandboxTaskIntentV2(value))
}

function preparedCoreV2(value: DisposableTaskPreparedIntentV2): Omit<DisposableTaskPreparedIntentV2, "prepared_sha256"> {
  return {
    schema_version: value.schema_version,
    dispatch_id: value.dispatch_id,
    canonical_intent_sha256: value.canonical_intent_sha256,
    sandbox_prepare_anchor_sha256: value.sandbox_prepare_anchor_sha256,
    operation_digest: value.operation_digest,
    provider: value.provider,
    source_manifest_sha256: value.source_manifest_sha256,
    input_manifest_sha256: value.input_manifest_sha256,
    checkpoint_policy_sha256: value.checkpoint_policy_sha256,
    effect_claim_sha256: value.effect_claim_sha256,
  }
}

function parsePreparedIntentV2(value: unknown, intent: DisposableSandboxTaskIntentV2): DisposableTaskPreparedIntentV2 {
  if (!closedRecord(value, PREPARED_V2_KEYS) || value.schema_version !== DISPOSABLE_TASK_PREPARED_SCHEMA_V2 ||
    typeof value.dispatch_id !== "string" || !DISPATCH_ID_V2.test(value.dispatch_id) ||
    ![value.canonical_intent_sha256, value.sandbox_prepare_anchor_sha256, value.operation_digest,
      value.source_manifest_sha256, value.input_manifest_sha256, value.checkpoint_policy_sha256,
      value.effect_claim_sha256, value.prepared_sha256].every(isDigest) ||
    value.provider !== intent.provider || value.canonical_intent_sha256 !== disposableSandboxTaskIntentSha256V2(intent) ||
    value.operation_digest !== intent.operation_digest || value.source_manifest_sha256 !== intent.source_manifest_sha256 ||
    value.input_manifest_sha256 !== intent.input_manifest_sha256 ||
    value.checkpoint_policy_sha256 !== disposableTaskCheckpointPolicySha256(intent.checkpoint)) {
    throw adapterError("integrity_failed")
  }
  const parsed = Object.freeze({
    schema_version: DISPOSABLE_TASK_PREPARED_SCHEMA_V2,
    dispatch_id: value.dispatch_id,
    canonical_intent_sha256: value.canonical_intent_sha256 as Digest,
    sandbox_prepare_anchor_sha256: value.sandbox_prepare_anchor_sha256 as Digest,
    operation_digest: value.operation_digest as Digest,
    provider: value.provider as ManagedProviderIdV1,
    source_manifest_sha256: value.source_manifest_sha256 as Digest,
    input_manifest_sha256: value.input_manifest_sha256 as Digest,
    checkpoint_policy_sha256: value.checkpoint_policy_sha256 as Digest,
    effect_claim_sha256: value.effect_claim_sha256 as Digest,
    prepared_sha256: value.prepared_sha256 as Digest,
  })
  if (canonicalSha256(preparedCoreV2(parsed)) !== parsed.prepared_sha256) throw adapterError("integrity_failed")
  return parsed
}

function providerBindingV2(intent: DisposableSandboxTaskIntentV2, intentSha256: Digest) {
  const providerMetadataScopeSha256 = canonicalSha256({
    schema_version: "sandboxes.disposable-task-provider-scope/v2",
    provider: intent.provider,
    canonical_intent_sha256: intentSha256,
    idempotency_key_sha256: intent.idempotency_key_sha256,
  })
  return Object.freeze({
    provider_metadata_scope_sha256: providerMetadataScopeSha256,
    provider_creation_token_sha256: canonicalSha256({
      schema_version: "sandboxes.disposable-task-creation-token/v2",
      provider_metadata_scope_sha256: providerMetadataScopeSha256,
    }),
    immutable_fingerprint_sha256: canonicalSha256({
      schema_version: "sandboxes.disposable-task-provider-fingerprint/v2",
      provider_metadata_scope_sha256: providerMetadataScopeSha256,
      environment_image_sha256: intent.environment_image_sha256,
      source_manifest_sha256: intent.source_manifest_sha256,
      input_manifest_sha256: intent.input_manifest_sha256,
    }),
  })
}

function validateV2Descriptions(
  dependencies: DisposableSandboxTaskPreparationDependenciesV2,
): DisposableTaskJournalDescriptionV1 {
  if (!isDigest(dependencies.lease_owner_sha256)) throw adapterError("validation_failed")
  const journal = dependencies.journal.describe()
  validateJournalDescription(journal, true)
  const witness = dependencies.witness.describe()
  if (!closedRecord(witness, ["durability", "restore_domain_sha256", "witness_identity_sha256"]) ||
    witness.durability !== "durable" || !isDigest(witness.restore_domain_sha256) ||
    !isDigest(witness.witness_identity_sha256) ||
    journal.external_head_witness_sha256 !== witness.witness_identity_sha256) {
    throw adapterError("integrity_failed")
  }
  return Object.freeze({ ...journal })
}

function recomputeEffectClaimV2(
  intent: DisposableSandboxTaskIntentV2,
  claim: DisposableTaskJournalClaimV2,
  journal: DisposableTaskJournalDescriptionV1,
): Digest {
  return canonicalSha256({
    schema_version: "sandboxes.disposable-task-effect-claim/v2",
    journal_identity_sha256: journal.journal_identity_sha256,
    restore_domain_sha256: journal.restore_domain_sha256,
    dispatch_id: claim.dispatch_id,
    canonical_intent_sha256: claim.canonical_intent_sha256,
    provider: intent.provider,
    provider_metadata_scope_sha256: claim.provider_metadata_scope_sha256,
    provider_creation_token_sha256: claim.provider_creation_token_sha256,
    immutable_fingerprint_sha256: claim.immutable_fingerprint_sha256,
    provider_effect_claim_fence_sha256: claim.provider_effect_claim_fence_sha256,
    provider_effect_lease_epoch: claim.provider_effect_lease_epoch,
    provider_effect_ownership_nonce_sha256: claim.provider_effect_ownership_nonce_sha256,
  })
}

function parsePrepareResultV2(
  value: DisposableTaskJournalPrepareIntentResultV2,
  intent: DisposableSandboxTaskIntentV2,
  journal: DisposableTaskJournalDescriptionV1,
): Exclude<DisposableTaskJournalPrepareIntentResultV2, { kind: "busy" | "quarantined" }> {
  if (value.kind === "busy") throw adapterError("dependency_unavailable", { retryable: true })
  if (value.kind === "quarantined") throw adapterError("provider_state_unknown", { quarantineRequired: true })
  const digests = [value.canonical_intent_sha256, value.claim_fence_sha256, value.lease_owner_sha256,
    value.provider_metadata_scope_sha256, value.provider_creation_token_sha256, value.immutable_fingerprint_sha256,
    value.ownership_nonce_sha256, value.provider_effect_claim_fence_sha256,
    value.provider_effect_ownership_nonce_sha256, value.effect_claim_sha256,
    value.sandbox_prepare_anchor_sha256]
  if (!DISPATCH_ID_V2.test(value.dispatch_id) || !digests.every(isDigest) || typeof value.lease_epoch !== "bigint" ||
    value.lease_epoch < 1n || typeof value.provider_effect_lease_epoch !== "bigint" ||
    value.provider_effect_lease_epoch < 1n || new Date(value.lease_expires_at).toISOString() !== value.lease_expires_at ||
    (value.dispatch_intent_anchor_sha256 !== null && !isDigest(value.dispatch_intent_anchor_sha256))) {
    throw adapterError("integrity_failed")
  }
  if ((value.kind === "prepared" && (value.recovery !== false || value.stored_authorization !== null ||
      value.dispatch_intent_anchor_sha256 !== null)) ||
    (value.kind === "reconcile" && (value.recovery !== true ||
      (value.prior_state === "PREPARED"
        ? value.stored_authorization !== null || value.dispatch_intent_anchor_sha256 !== null
        : value.stored_authorization === null || value.dispatch_intent_anchor_sha256 === null)))) {
    throw adapterError("integrity_failed")
  }
  const expectedDispatch = `dt2_${canonicalSha256({
    domain: "sandboxes.disposable-task-journal.dispatch-id/v2",
    journal_identity_sha256: journal.journal_identity_sha256,
    idempotency_key_sha256: intent.idempotency_key_sha256,
    canonical_intent_sha256: disposableSandboxTaskIntentSha256V2(intent),
  }).slice(7)}`
  const providerBinding = providerBindingV2(intent, disposableSandboxTaskIntentSha256V2(intent))
  if (value.dispatch_id !== expectedDispatch || value.canonical_intent_sha256 !== disposableSandboxTaskIntentSha256V2(intent) ||
    value.provider_metadata_scope_sha256 !== providerBinding.provider_metadata_scope_sha256 ||
    value.provider_creation_token_sha256 !== providerBinding.provider_creation_token_sha256 ||
    value.immutable_fingerprint_sha256 !== providerBinding.immutable_fingerprint_sha256 ||
    value.effect_claim_sha256 !== recomputeEffectClaimV2(intent, value, journal) ||
    value.sandbox_prepare_anchor_sha256 !== value.prepared.sandbox_prepare_anchor_sha256) {
    throw adapterError("integrity_failed")
  }
  const prepared = parsePreparedIntentV2(value.prepared, intent)
  if (prepared.dispatch_id !== value.dispatch_id || prepared.effect_claim_sha256 !== value.effect_claim_sha256) {
    throw adapterError("integrity_failed")
  }
  return Object.freeze({ ...value, prepared }) as Exclude<DisposableTaskJournalPrepareIntentResultV2, { kind: "busy" | "quarantined" }>
}

async function prepareIntentV2(
  intentValue: DisposableSandboxTaskIntentV2,
  dependencies: DisposableSandboxTaskPreparationDependenciesV2,
) {
  const intent = parseDisposableSandboxTaskIntentV2(intentValue)
  const journalDescription = validateV2Descriptions(dependencies)
  const witness = await dependencies.journal.assertWitnessCurrent(dependencies.witness)
  if (!closedRecord(witness, ["witness_receipt_sha256"]) || !isDigest(witness.witness_receipt_sha256)) {
    throw adapterError("integrity_failed")
  }
  const canonicalIntentSha256 = disposableSandboxTaskIntentSha256V2(intent)
  const result = await dependencies.journal.prepareIntentV2({
    idempotency_key_sha256: intent.idempotency_key_sha256,
    canonical_intent_sha256: canonicalIntentSha256,
    canonical_intent_bytes: new TextEncoder().encode(canonicalJson(intent)),
    operation_digest: intent.operation_digest,
    source_manifest_sha256: intent.source_manifest_sha256,
    input_manifest_sha256: intent.input_manifest_sha256,
    checkpoint_policy_sha256: disposableTaskCheckpointPolicySha256(intent.checkpoint),
    provider: intent.provider,
    ...providerBindingV2(intent, canonicalIntentSha256),
    lease_owner_sha256: dependencies.lease_owner_sha256,
    lease_duration_ms: Math.min(3_600_000, intent.max_runtime_ms + 60_000),
  })
  return { intent, result: parsePrepareResultV2(result, intent, journalDescription) }
}

/** Safe inert phase one: no authority or provider is reachable. */
export async function prepareDisposableSandboxTaskIntentV2(
  intent: DisposableSandboxTaskIntentV2,
  dependencies: DisposableSandboxTaskPreparationDependenciesV2,
): Promise<Readonly<DisposableTaskPreparedIntentV2>> {
  return (await prepareIntentV2(intent, dependencies)).result.prepared
}

function parseAuthorizationBundleV2(
  value: DisposableTaskAuthorizationArtifactsV2,
  expected: DisposableTaskAuthorityConsumeInputV2,
): DisposableTaskAuthorizationArtifactsV2 {
  if (!closedRecord(value, ["authority_envelope_sha256", "canonical_authority_envelope_bytes",
    "canonical_receipt_bytes", "receipt_sha256"]) ||
    !(value.canonical_authority_envelope_bytes instanceof Uint8Array) ||
    !(value.canonical_receipt_bytes instanceof Uint8Array) ||
    value.canonical_authority_envelope_bytes.byteLength < 1 || value.canonical_authority_envelope_bytes.byteLength > 64 * 1024 ||
    value.canonical_receipt_bytes.byteLength < 1 || value.canonical_receipt_bytes.byteLength > 16 * 1024 ||
    !isDigest(value.authority_envelope_sha256) || !isDigest(value.receipt_sha256) ||
    directDigest(value.canonical_authority_envelope_bytes) !== value.authority_envelope_sha256 ||
    value.authority_envelope_sha256 !== expected.authority_envelope_sha256 ||
    directDigest(value.canonical_receipt_bytes) !== value.receipt_sha256) throw adapterError("integrity_failed")
  let receipt: unknown
  let text: string
  try {
    const authorityText = new TextDecoder("utf-8", { fatal: true }).decode(value.canonical_authority_envelope_bytes)
    const authorityEnvelope = parseCanonicalJson(authorityText)
    if (canonicalJson(authorityEnvelope) !== authorityText) throw adapterError("integrity_failed")
    text = new TextDecoder("utf-8", { fatal: true }).decode(value.canonical_receipt_bytes)
    receipt = parseCanonicalJson(text)
  } catch {
    throw adapterError("integrity_failed")
  }
  if (!closedRecord(receipt, AUTHORIZATION_RECEIPT_V2_KEYS) || canonicalJson(receipt) !== text ||
    receipt.schema_version !== DISPOSABLE_TASK_AUTHORIZATION_CONSUMPTION_SCHEMA_V2 ||
    AUTHORITY_CONSUME_V2_KEYS.some((key) => receipt[key] !== expected[key]) ||
    receipt.audience !== DISPOSABLE_TASK_PROVIDER_CONTACT_AUDIENCE_V2 ||
    !validPositiveSignedInt64(receipt.authority_epoch) || !validPositiveSignedInt64(receipt.lease_epoch) ||
    ![receipt.run_id, receipt.attempt_id, receipt.attempt_lease_id, receipt.model_operation_id,
      receipt.signer_ref, receipt.signer_incarnation, receipt.key_id].every(validAuthorizationContextId) ||
    !validEd25519Base64Url(receipt.signature) ||
    ![receipt.issued_at, receipt.consumed_at, receipt.expires_at].every(validCanonicalTimestamp) ||
    Date.parse(receipt.issued_at as string) > Date.parse(receipt.consumed_at as string) ||
    Date.parse(receipt.consumed_at as string) > Date.now() + MAX_AUTHORITY_CLOCK_SKEW_MS ||
    Date.parse(receipt.consumed_at as string) >= Date.parse(receipt.expires_at as string) ||
    Date.parse(receipt.expires_at as string) - Date.parse(receipt.consumed_at as string) > MAX_PROVIDER_CONTACT_AUTH_MS) {
    throw adapterError("integrity_failed")
  }
  return Object.freeze({
    canonical_authority_envelope_bytes: value.canonical_authority_envelope_bytes.slice(),
    authority_envelope_sha256: value.authority_envelope_sha256,
    canonical_receipt_bytes: value.canonical_receipt_bytes.slice(),
    receipt_sha256: value.receipt_sha256,
  })
}

function authorizationExpiresAtV2(value: DisposableTaskAuthorizationArtifactsV2): number {
  const receipt = parseCanonicalJson(new TextDecoder("utf-8", { fatal: true }).decode(value.canonical_receipt_bytes))
  if (!isPlainRecord(receipt) || typeof receipt.expires_at !== "string") throw adapterError("integrity_failed")
  return Date.parse(receipt.expires_at)
}

/**
 * Authorizes one prepared task and durably witnesses DISPATCH_INTENT.
 * This boundary has no provider dependency and cannot execute the task.
 */
export async function authorizePreparedDisposableSandboxTaskV2(
  input: DisposableSandboxTaskDispatchInputV2,
  dependencies: DisposableSandboxTaskDispatchDependenciesV2,
): Promise<Readonly<DisposableTaskBoundAuthorizationV2>> {
  if (!closedRecord(input, ["authority_envelope_sha256", "intent", "prepared"]) ||
    !isDigest(input.authority_envelope_sha256)) throw adapterError("validation_failed")
  const authorityDescription = dependencies.authority.describe()
  validateAuthorityDescription(authorityDescription, true)
  if (!isDigest(dependencies.expected_authority_trust_root_sha256) ||
    authorityDescription.trust_root_sha256 !== dependencies.expected_authority_trust_root_sha256) {
    throw adapterError("integrity_failed")
  }
  const { intent, result } = await prepareIntentV2(input.intent, dependencies)
  const requestedPrepared = parsePreparedIntentV2(input.prepared, intent)
  if (requestedPrepared.prepared_sha256 !== result.prepared.prepared_sha256 ||
    canonicalJson(requestedPrepared) !== canonicalJson(result.prepared)) throw adapterError("integrity_failed")
  const consumeInput: DisposableTaskAuthorityConsumeInputV2 = Object.freeze({
    dispatch_id: result.dispatch_id,
    canonical_intent_sha256: result.canonical_intent_sha256,
    sandbox_prepare_anchor_sha256: result.sandbox_prepare_anchor_sha256,
    authority_envelope_sha256: input.authority_envelope_sha256,
    operation_digest: intent.operation_digest,
    provider: intent.provider,
    source_manifest_sha256: intent.source_manifest_sha256,
    input_manifest_sha256: intent.input_manifest_sha256,
    checkpoint_policy_sha256: disposableTaskCheckpointPolicySha256(intent.checkpoint),
    effect_claim_sha256: result.effect_claim_sha256,
  })
  const authorization = result.stored_authorization === null
    ? parseAuthorizationBundleV2(await dependencies.authority.consumeOnceV2(consumeInput), consumeInput)
    : parseAuthorizationBundleV2(result.stored_authorization, consumeInput)
  const consumeBytes = new TextEncoder().encode(canonicalJson(consumeInput))
  const bound = await dependencies.journal.bindAuthorizationAndMarkIntentV2({
    dispatch_id: result.dispatch_id,
    canonical_intent_sha256: result.canonical_intent_sha256,
    sandbox_prepare_anchor_sha256: result.sandbox_prepare_anchor_sha256,
    claim_fence_sha256: result.claim_fence_sha256,
    lease_epoch: result.lease_epoch,
    effect_claim_sha256: result.effect_claim_sha256,
    canonical_consume_input_bytes: consumeBytes,
    consume_input_sha256: directDigest(consumeBytes),
    authorization,
  })
  if (!closedRecord(bound, ["authority_envelope_sha256", "authorization_consumption_receipt_sha256",
    "dispatch_intent_anchor_sha256"]) ||
    bound.authority_envelope_sha256 !== authorization.authority_envelope_sha256 ||
    bound.authorization_consumption_receipt_sha256 !== authorization.receipt_sha256 ||
    !isDigest(bound.dispatch_intent_anchor_sha256)) throw adapterError("integrity_failed")
  if (authorizationExpiresAtV2(authorization) <= Date.now()) {
    await dependencies.journal.quarantineAuthorizationV2({
      dispatch_id: result.dispatch_id,
      canonical_intent_sha256: result.canonical_intent_sha256,
      claim_fence_sha256: result.claim_fence_sha256,
      lease_epoch: result.lease_epoch,
      quarantine_reason: "authorization_expired_before_provider_contact",
      quarantine_evidence_sha256: authorization.receipt_sha256,
    })
    throw adapterError("dependency_unavailable")
  }
  return Object.freeze({
    schema_version: DISPOSABLE_TASK_BOUND_AUTHORIZATION_SCHEMA_V2,
    dispatch_id: result.dispatch_id,
    canonical_intent_sha256: result.canonical_intent_sha256,
    sandbox_prepare_anchor_sha256: result.sandbox_prepare_anchor_sha256,
    effect_claim_sha256: result.effect_claim_sha256,
    authority_envelope_sha256: authorization.authority_envelope_sha256,
    authorization_consumption_receipt_sha256: authorization.receipt_sha256,
    dispatch_intent_anchor_sha256: bound.dispatch_intent_anchor_sha256,
  })
}

/** Production v2 dispatch remains closed until the real provider proof is reviewed. */
export function dispatchPreparedDisposableSandboxTaskV2(
  input: DisposableSandboxTaskDispatchInputV2,
  dependencies: DisposableSandboxTaskDispatchDependenciesV2,
): Promise<Readonly<DisposableTaskBoundAuthorizationV2>> {
  if (!Boolean(DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V2)) {
    return Promise.reject(adapterError("unsupported_runtime_feature"))
  }
  return authorizePreparedDisposableSandboxTaskV2(input, dependencies)
}
