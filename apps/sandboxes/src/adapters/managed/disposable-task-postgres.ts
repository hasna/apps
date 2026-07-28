import { SQL } from "bun"
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { canonicalJson, canonicalSha256, isDigest, parseCanonicalJson } from "./canonical"
import { adapterError } from "./errors"
import type {
  DisposableSandboxTaskExecutionReceiptV1,
  DisposableTaskJournalCompletedV1,
  DisposableTaskJournalAuthorizationV1,
  DisposableTaskAuthorizationArtifactsV2,
  DisposableTaskJournalClaimV2,
  DisposableTaskJournalPortV1,
  DisposableTaskJournalPortV2,
  DisposableTaskJournalPrepareIntentInputV2,
  DisposableTaskJournalPrepareIntentResultV2,
  DisposableTaskJournalPrepareInputV1,
  DisposableTaskJournalPrepareResultV1,
  DisposableTaskJournalQuarantinedV1,
  DurableJournalWitnessPortV1,
  DurableJournalWitnessReceiptV1,
} from "./disposable-task"
import {
  DISPOSABLE_TASK_PREPARED_SCHEMA_V2,
  disposableSandboxTaskIntentSha256V2,
  disposableTaskCheckpointPolicySha256,
  parseInfinityCanonicalJsonV2,
  parseDisposableSandboxTaskExecutionReceiptV1,
  parseDisposableSandboxTaskRequestV1,
} from "./disposable-task"
import type { Digest } from "./types"
import {
  assertPostgresClientV1,
  assertPostgresSessionV1,
  type PostgresClientV1,
  type PostgresSessionV1,
} from "./postgres-client"

const MIGRATION_NAME = "0001_disposable_task_journal.sql"
const MIGRATION_V2_NAME = "0002_disposable_task_intent_v2.sql"
const MIGRATION_V2_EFFECTS_NAME = "0003_disposable_task_effect_transitions_v2.sql"
const MIGRATION_SHA256 = "sha256:0a12943952d240bfd095ba53aa0ccb1ceb841aaa50e6c1344ad264d692cfe3a0" as const
const MIGRATION_V2_SHA256 = "sha256:b7eeb73fba4e6f231a755fa35f9f2eb366f71121773eca1cadc26f4fa3196ffe" as const
const MIGRATION_V2_EFFECTS_SHA256 = "sha256:ab1879fb3672ec2b7fcf43d435eec2b278fd804b7be3c5cd130801a86332de69" as const
const SCHEMA = "sandboxes_disposable_task_journal"
const SAFE_ROLE = /^[a-z_][a-z0-9_]{0,62}$/u
const SAFE_CLUSTER_IDENTIFIER = /^[1-9][0-9]{0,31}$/u
const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const MAX_CANONICAL_BYTES = 2 * 1024 * 1024
const EXPECTED_TABLES = ["events", "schema_migrations", "store", "tasks"] as const
const EXPECTED_TABLES_V2 = [...EXPECTED_TABLES, "events_v2", "tasks_v2"] as const
const EXPECTED_FUNCTIONS = [
  "acknowledge_witness(bigint, text, bytea, text)",
  "append_event(bigint, text, text, text, text, text, bytea, text, bytea, text)",
  "bind_authorization_and_mark_intent(text, text, text, bigint, text, bytea, text, text, bigint, text, text, bytea, text, bytea, text)",
  "commit_terminal(text, text, text, bigint, text, text, bytea, text, text, text, text, text, bytea, text, bigint, text, text, text, bytea, text, bytea, text)",
  "insert_prepared(text, text, text, text, bytea, bytea, text, text, text, text, text, text, text, text, text, text, text, bigint, text, text, timestamp with time zone, bigint, text, text, bytea, text, bytea, text)",
  "mark_dispatched(text, text, text, bigint, text, text, bigint, text, text, bytea, text, bytea, text)",
  "mark_result_persisted(text, text, text, bigint, text, text, text, bigint, text, text, bytea, text, bytea, text)",
  "reject_mutation()",
  "takeover_claim(text, text, text, bigint, text, text, text, timestamp with time zone, bigint, text, text, bytea, text, bytea, text)",
] as const
const INTENT_V2_FUNCTIONS = [
  "append_event_v2(bigint, text, text, text, text, text, bytea, text, bytea, text)",
  "bind_authorization_and_mark_intent_v2(text, text, text, text, bigint, text, bytea, text, bytea, text, bytea, text, text, bigint, text, text, bytea, text, bytea, text)",
  "guard_task_v2_update()",
  "insert_prepared_v2(text, text, text, text, bytea, text, text, text, text, text, text, text, bigint, text, text, text, text, text, text, timestamp with time zone, bigint, text, text, bytea, text, bytea, text)",
] as const
const EXPECTED_FUNCTIONS_V2 = [
  ...EXPECTED_FUNCTIONS,
  ...INTENT_V2_FUNCTIONS,
  "mark_dispatched_intent_v2(text, text, text, text, text, text, text, bigint, text, text, text, bigint, text, text, bytea, text, bytea, text)",
  "mark_result_persisted_intent_v2(text, text, text, text, text, text, text, bigint, text, text, text, text, text, text, bigint, text, text, bytea, text, bytea, text)",
  "quarantine_authorization_v2(text, text, text, text, text, bigint, text, text, bigint, text, text, bytea, text, bytea, text)",
  "takeover_claim_v2(text, text, text, text, text, bigint, text, text, text, timestamp with time zone, bigint, text, text, bytea, text, bytea, text)",
] as const
const CATALOG_RELATIONS_SHA256 = "sha256:dd66dec7abaa145ec76c1981f31531ccea7945bed4eeb35ce5f139c80a12a329" as const
const CATALOG_COLUMNS_SHA256 = "sha256:4e627e297858c85ec669e7394046f33421e641e4266461df40f4b3f5c5a54157" as const
const CATALOG_CONSTRAINTS_SHA256 = "sha256:e81ee8ebcbbbbc0b8c0965c8eb1e7ef763c58dcc7b8982798244d8cc3ba53a08" as const
const CATALOG_INDEXES_SHA256 = "sha256:e98ff7edfcc19df23895c025ee98968ef94cc117379baefdbc0f7dc600269874" as const
const CATALOG_FUNCTIONS_SHA256 = "sha256:97a5efbf70069416b2d6d63f645ece3e7c032e84fff8a964cc17d77950e3fb1e" as const
const CATALOG_TRIGGERS_SHA256 = "sha256:0a9c48c26cdca2246a06efa03b636c78f2c8853ca19f2f4e8a2bf8e0ef937cbb" as const
const CATALOG_RELATIONS_V2_SHA256 = "sha256:1511c92e2e917bf7d069e4f74aaa7dcb3c2db835089946d91921e7a7e3e1b45f" as const
const CATALOG_COLUMNS_V2_SHA256 = "sha256:be3c9c701a6b0fb4e2cfe1949ff8699c45ee7855fdb7281ea2c83644d3f38c4c" as const
const CATALOG_CONSTRAINTS_V2_SHA256 = "sha256:449c2a6619c285fdecb8b9b23209eeb0535149f091e0c270512c71643499522c" as const
const CATALOG_INDEXES_V2_SHA256 = "sha256:d67914f1cfb2f540f1c675b119cada76db16a7def7ee4f6179eb9aa9b6cf25b5" as const
const CATALOG_FUNCTIONS_V2_SHA256 = "sha256:3536f0acbede947157833326abe7e5074a284a475fc1e7ac9c74eb3e5cbda6d9" as const
const CATALOG_TRIGGERS_V2_SHA256 = "sha256:2a5991213bca0f29ec02c1adca430697c80fbf710f829d58eefb5cf4752f882e" as const

export interface DisposableTaskJournalSignerV1 {
  readonly signer_principal: string
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
  sign(bytes: Uint8Array): Uint8Array
}

export interface DisposableTaskJournalSignatureVerifierV1 {
  readonly signer_principal: string
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
  verify(bytes: Uint8Array, signature: Uint8Array): boolean
}

export interface DisposableTaskWitnessReceiptVerifierV1 {
  readonly witness_identity_sha256: Digest
  readonly restore_domain_sha256: Digest
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
  verify(bytes: Uint8Array, signature: Uint8Array): boolean
}

export interface PostgresDisposableTaskJournalOptionsV1 {
  readonly expected_migration_role: string
  readonly expected_runtime_role: string
  readonly expected_database: string
  readonly expected_journal_cluster_system_identifier: string
  readonly encrypted_at_rest: true
  readonly journal_identity_sha256: Digest
  readonly restore_domain_sha256: Digest
  readonly external_head_witness: DurableJournalWitnessPortV1
  readonly witness_receipt_verifier: DisposableTaskWitnessReceiptVerifierV1
  /** Separate least-privilege credential; the runtime role is never allowed to acknowledge witness advancement. */
  readonly witness_acknowledgement_client: PostgresClientV1
  readonly expected_witness_acknowledgement_role: string
  readonly signer: DisposableTaskJournalSignerV1
  readonly verifier: DisposableTaskJournalSignatureVerifierV1
}

export interface PostgresDisposableTaskJournalMigrationOptionsV1 {
  readonly expected_migration_role: string
  readonly expected_database: string
  readonly expected_journal_cluster_system_identifier: string
  readonly runtime_role: string
  readonly witness_acknowledgement_role: string
  readonly journal_identity_sha256: Digest
  readonly restore_domain_sha256: Digest
  readonly external_head_witness_sha256: Digest
  readonly witness_verification_key_sha256: Digest
  readonly signer_principal: string
  readonly signing_key_id: string
  readonly verification_key_sha256: Digest
  readonly encrypted_at_rest: true
  readonly migration_file?: string
}

export interface PostgresDisposableTaskJournalMigrationOptionsV2
  extends PostgresDisposableTaskJournalMigrationOptionsV1 {
  readonly migration_v2_file?: string
  readonly migration_v2_effects_file?: string
}

interface StoreRow extends Record<string, unknown> {
  journal_cluster_system_identifier: string
  journal_database_name: string
  journal_database_oid: bigint | number | string
  journal_identity_sha256: string
  restore_domain_sha256: string
  external_head_witness_sha256: string
  witness_verification_key_sha256: string
  encrypted_at_rest: boolean
  signer_principal: string
  signing_key_id: string
  verification_key_sha256: string
  head_sequence: bigint | number | string
  head_frontier_sha256: string | null
  witnessed_sequence: bigint | number | string
  witnessed_frontier_sha256: string | null
  witness_receipt_bytes: Uint8Array | null
  witness_receipt_sha256: string | null
}

interface JournalSessionIdentity extends Record<string, unknown> {
  session_user: string
  current_user: string
  current_database: string
  database_oid: bigint | number | string
  cluster_system_identifier: string
  ssl_in_use: boolean
  can_create_database: boolean
  can_create_temporary: boolean
  database_owner_member: boolean
  is_superuser: boolean
  can_create_db_role: boolean
  can_create_role: boolean
  can_replicate: boolean
  can_bypass_rls: boolean
  parent_memberships: bigint | number | string
  settable_memberships: bigint | number | string
}

interface TaskRow extends Record<string, unknown> {
  idempotency_key_sha256: string
  operation_digest: string
  dispatch_id: string
  request_sha256: string
  canonical_request_bytes: Uint8Array
  authority_consume_input_bytes: Uint8Array
  authority_consume_input_sha256: string
  authority_envelope_sha256: string
  source_manifest_sha256: string
  input_manifest_sha256: string
  provider: string
  provider_metadata_scope_sha256: string
  provider_creation_token_sha256: string
  immutable_fingerprint_sha256: string
  ownership_nonce_sha256: string
  allocation_lease_epoch: bigint | number | string
  allocation_claim_fence_sha256: string
  allocation_ownership_nonce_sha256: string
  effect_claim_sha256: string
  dispatch_intent_anchor_sha256: string | null
  dispatch_anchor_sha256: string
  state: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED" | "OUTCOME" | "QUARANTINED"
  lease_epoch: bigint | number | string
  claim_fence_sha256: string
  lease_owner_sha256: string
  lease_expires_at: Date | string
  authorization_receipt_bytes: Uint8Array | null
  authorization_consumption_receipt_sha256: string | null
  provider_fingerprint_sha256: string | null
  effect_lease_epoch: bigint | number | string | null
  effect_claim_fence_sha256: string | null
  effect_ownership_nonce_sha256: string | null
  result_bundle_sha256: string | null
  checkpoint_handoff_sha256: string | null
  result_persisted_anchor_sha256: string | null
  outcome_kind: "succeeded" | "failed_no_effect" | "failed_contained" | null
  execution_receipt_bytes: Uint8Array | null
  execution_receipt_sha256: string | null
  failure_code: string | null
  failure_evidence_sha256: string | null
  quarantine_reason: string | null
  quarantine_evidence_sha256: string | null
  outcome_anchor_bytes: Uint8Array | null
  outcome_anchor_sha256: string | null
}

interface TaskRowV2 extends Record<string, unknown> {
  idempotency_key_sha256: string
  operation_digest: string
  dispatch_id: string
  canonical_intent_sha256: string
  canonical_intent_bytes: Uint8Array
  source_manifest_sha256: string
  input_manifest_sha256: string
  checkpoint_policy_sha256: string
  provider: "e2b" | "daytona_cloud"
  provider_metadata_scope_sha256: string
  provider_creation_token_sha256: string
  immutable_fingerprint_sha256: string
  allocation_lease_epoch: bigint | number | string
  allocation_claim_fence_sha256: string
  allocation_ownership_nonce_sha256: string
  effect_claim_sha256: string
  sandbox_prepare_anchor_sha256: string
  prepared_sha256: string
  state: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED" | "QUARANTINED"
  lease_epoch: bigint | number | string
  claim_fence_sha256: string
  lease_owner_sha256: string
  lease_expires_at: Date | string
  ownership_nonce_sha256: string
  canonical_consume_input_bytes: Uint8Array | null
  consume_input_sha256: string | null
  canonical_authority_envelope_bytes: Uint8Array | null
  authority_envelope_sha256: string | null
  canonical_authorization_receipt_bytes: Uint8Array | null
  authorization_consumption_receipt_sha256: string | null
  dispatch_intent_anchor_sha256: string | null
  provider_fingerprint_sha256: string | null
  provider_dispatch_anchor_sha256: string | null
  provider_allocation_sha256: string | null
  result_bundle_sha256: string | null
  checkpoint_handoff_sha256: string | null
  result_persisted_anchor_sha256: string | null
  quarantine_reason: string | null
  quarantine_evidence_sha256: string | null
}

interface EventRow extends Record<string, unknown> {
  journal_sequence: bigint | number | string
  prior_frontier_sha256: string | null
  frontier_sha256: string
  record_kind: string
  dispatch_id: string
  request_sha256: string
  canonical_intent_sha256?: string
  journal_version?: bigint | number | string
  record_bytes: Uint8Array
  record_sha256: string
  signed_anchor_bytes: Uint8Array
  signed_anchor_sha256: string
}

interface SignedEvent {
  sequence: bigint
  prior: Digest | null
  frontier: Digest
  kind: string
  dispatchId: string
  requestSha256: Digest
  recordBytes: Uint8Array
  recordSha256: Digest
  anchorBytes: Uint8Array
  anchorSha256: Digest
}

interface BunSqlLike {
  unsafe(statement: string, parameters?: unknown[]): Promise<unknown[]>
  begin<T>(fn: (transaction: BunSqlLike) => Promise<T>): Promise<T>
  close(options?: { timeout?: number }): Promise<void>
}

/**
 * Internal, state-derived retry signal. A committed journal event may briefly
 * lead its independently persisted witness receipt. That is recoverable only
 * when the durable store proves an exact one-event gap; every other mismatch
 * remains an integrity failure.
 */
class JournalWitnessLagError extends Error {}

class BunJournalSession implements PostgresSessionV1 {
  constructor(protected readonly sql: BunSqlLike) {}
  async query<Row extends Record<string, unknown>>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<Row[]> {
    return await this.sql.unsafe(statement, [...parameters]) as Row[]
  }
}

class BunJournalClient extends BunJournalSession implements PostgresClientV1 {
  constructor(private readonly connection: BunSqlLike) {
    super(connection)
  }
  async transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    return await this.connection.begin(async (transaction) => fn(new BunJournalSession(transaction)))
  }
  async close(): Promise<void> {
    await this.connection.close({ timeout: 0 })
  }
}

function digestBytes(bytes: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right))
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length && keys.every((key) =>
    typeof key === "string" && expected.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true)
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && [...actual].sort().every((value, index) =>
    value === [...expected].sort()[index])
}

function asBytes(value: Uint8Array | Buffer): Uint8Array {
  return Uint8Array.from(value)
}

function assertDigest(value: unknown): asserts value is Digest {
  if (!isDigest(value)) throw adapterError("validation_failed")
}

function assertText(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SAFE_TEXT.test(value)) throw adapterError("validation_failed")
}

function dbBigint(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value)
  throw adapterError("integrity_failed")
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw adapterError("integrity_failed")
  return date.toISOString()
}

function canonicalBytes(value: unknown): Uint8Array {
  return bytes(canonicalJson(value))
}

function parseCanonicalBytes(value: Uint8Array): unknown {
  if (value.byteLength === 0 || value.byteLength > MAX_CANONICAL_BYTES) throw adapterError("integrity_failed")
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(value)
  } catch {
    throw adapterError("integrity_failed")
  }
  try {
    const parsed = parseCanonicalJson(text)
    if (!byteEqual(canonicalBytes(parsed), value)) throw adapterError("integrity_failed")
    return parsed
  } catch {
    throw adapterError("integrity_failed")
  }
}

function parseInfinityCanonicalBytesV2(value: Uint8Array): unknown {
  if (value.byteLength === 0 || value.byteLength > MAX_CANONICAL_BYTES) throw adapterError("integrity_failed")
  try {
    return parseInfinityCanonicalJsonV2(new TextDecoder("utf-8", { fatal: true }).decode(value))
  } catch {
    throw adapterError("integrity_failed")
  }
}

function exactExecutionReceipt(value: unknown, row: TaskRow): DisposableSandboxTaskExecutionReceiptV1 {
  if (!isDigest(row.authorization_consumption_receipt_sha256) ||
    !isDigest(row.effect_claim_sha256) || !isDigest(row.dispatch_intent_anchor_sha256) ||
    !isDigest(row.effect_claim_fence_sha256) || !isDigest(row.effect_ownership_nonce_sha256) ||
    row.effect_lease_epoch === null) throw adapterError("integrity_failed")
  const request = parseDisposableSandboxTaskRequestV1(parseCanonicalBytes(asBytes(row.canonical_request_bytes)))
  const parsed = parseDisposableSandboxTaskExecutionReceiptV1(value, request, {
    dispatch_id: row.dispatch_id,
    journal_dispatch_id_sha256: canonicalSha256(row.dispatch_id),
    journal_dispatch_anchor_sha256: row.dispatch_anchor_sha256 as Digest,
    journal_claim_fence_sha256: row.effect_claim_fence_sha256,
    journal_lease_epoch: dbBigint(row.effect_lease_epoch),
    journal_lease_expires_at: iso(row.lease_expires_at),
    provider_metadata_scope_sha256: row.provider_metadata_scope_sha256 as Digest,
    provider_creation_token_sha256: row.provider_creation_token_sha256 as Digest,
    immutable_fingerprint_sha256: row.immutable_fingerprint_sha256 as Digest,
    ownership_nonce_sha256: row.effect_ownership_nonce_sha256,
    recovery_expected_result_bundle_sha256: row.result_bundle_sha256 as Digest | null,
    recovery_expected_checkpoint_handoff_sha256: row.checkpoint_handoff_sha256 as Digest | null,
    recovery_expected_provider_fingerprint_sha256: row.provider_fingerprint_sha256 as Digest | null,
    authorization_consumption_receipt_sha256: row.authorization_consumption_receipt_sha256,
    effect_claim_sha256: row.effect_claim_sha256,
    dispatch_intent_anchor_sha256: row.dispatch_intent_anchor_sha256,
    async markDispatched() { throw adapterError("integrity_failed") },
    async markResultPersisted() { throw adapterError("integrity_failed") },
  }) as DisposableSandboxTaskExecutionReceiptV1
  if (parsed.provider_fingerprint_sha256 !== row.provider_fingerprint_sha256 ||
    parsed.checkpoint_handoff_sha256 !== row.checkpoint_handoff_sha256 ||
    parsed.result_bundle_sha256 !== row.result_bundle_sha256 ||
    parsed.provider_ownership_binding_sha256 !== canonicalSha256(
      `lease-${dbBigint(row.effect_lease_epoch).toString(10)}-${row.effect_ownership_nonce_sha256}`,
    )) throw adapterError("integrity_failed")
  return parsed
}

function validateSignerPair(
  signer: DisposableTaskJournalSignerV1,
  verifier: DisposableTaskJournalSignatureVerifierV1,
): void {
  assertText(signer.signer_principal)
  assertText(signer.signing_key_id)
  assertDigest(signer.verification_key_sha256)
  if (signer.signer_principal !== verifier.signer_principal ||
    signer.signing_key_id !== verifier.signing_key_id ||
    signer.verification_key_sha256 !== verifier.verification_key_sha256) {
    throw adapterError("integrity_failed")
  }
  const challenge = canonicalBytes({ domain: "sandboxes.disposable-task-journal.key-possession/v1" })
  const signature = signer.sign(challenge)
  if (!(signature instanceof Uint8Array) || signature.byteLength !== 64 || !verifier.verify(challenge, signature)) {
    throw adapterError("integrity_failed")
  }
}

export function createEd25519DisposableTaskJournalCryptoV1(input: Readonly<{
  signer_principal: string
  signing_key_id: string
  private_key: KeyObject | string | Uint8Array
  public_key?: KeyObject | string | Uint8Array
}>): { signer: DisposableTaskJournalSignerV1; verifier: DisposableTaskJournalSignatureVerifierV1 } {
  assertText(input.signer_principal)
  assertText(input.signing_key_id)
  const privateKey = input.private_key instanceof KeyObject
    ? input.private_key
    : createPrivateKey(input.private_key)
  const publicKey = input.public_key === undefined
    ? createPublicKey(privateKey.export({ type: "pkcs8", format: "pem" }))
    : input.public_key instanceof KeyObject
      ? input.public_key
      : createPublicKey(input.public_key)
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") {
    throw adapterError("validation_failed")
  }
  const verificationKeySha256 = digestBytes(publicKey.export({ type: "spki", format: "der" }))
  return {
    signer: {
      signer_principal: input.signer_principal,
      signing_key_id: input.signing_key_id,
      verification_key_sha256: verificationKeySha256,
      sign: (message) => Uint8Array.from(cryptoSign(null, message, privateKey)),
    },
    verifier: {
      signer_principal: input.signer_principal,
      signing_key_id: input.signing_key_id,
      verification_key_sha256: verificationKeySha256,
      verify: (message, signature) => cryptoVerify(null, message, publicKey, signature),
    },
  }
}

function packageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as unknown
      if (manifest !== null && typeof manifest === "object" && !Array.isArray(manifest) &&
        (manifest as Record<string, unknown>).name === "@hasna/sandboxes") return current
    } catch (error) {
      const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined
      if (code !== "ENOENT") throw adapterError("integrity_failed")
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw adapterError("integrity_failed")
}

function loadMigrationSource(name: string, expectedSha256: Digest): string {
  const source = readFileSync(join(packageRoot(), "migrations/disposable-task-journal", name), "utf8")
  if (digestBytes(bytes(source)) !== expectedSha256) throw adapterError("integrity_failed")
  return source
}

export function loadPostgresDisposableTaskJournalMigrationSourceV1(): string {
  return loadMigrationSource(MIGRATION_NAME, MIGRATION_SHA256)
}

export function loadPostgresDisposableTaskJournalMigrationSourceV2(): string {
  return loadMigrationSource(MIGRATION_V2_NAME, MIGRATION_V2_SHA256)
}

export function loadPostgresDisposableTaskJournalEffectTransitionsMigrationSourceV2(): string {
  return loadMigrationSource(MIGRATION_V2_EFFECTS_NAME, MIGRATION_V2_EFFECTS_SHA256)
}

function quoteIdentifier(value: string): string {
  if (!SAFE_ROLE.test(value)) throw adapterError("validation_failed")
  return `"${value}"`
}

async function assertSessionIdentity(
  client: PostgresClientV1,
  expectedRole: string,
  expectedDatabase: string,
  expectedClusterSystemIdentifier: string,
): Promise<JournalSessionIdentity> {
  if (!SAFE_ROLE.test(expectedRole) || expectedDatabase.length === 0 ||
    !SAFE_CLUSTER_IDENTIFIER.test(expectedClusterSystemIdentifier)) throw adapterError("validation_failed")
  assertPostgresClientV1(client, "disposable task journal identity check")
  const rows = await client.query<JournalSessionIdentity>(`
    SELECT session_user::text AS session_user, current_user::text AS current_user,
      current_database()::text AS current_database,
      database.oid::bigint AS database_oid,
      control.system_identifier::text AS cluster_system_identifier,
      COALESCE((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl_in_use,
      has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database,
      has_database_privilege(current_user, current_database(), 'TEMPORARY') AS can_create_temporary,
      pg_has_role(current_user, 'pg_database_owner', 'MEMBER') AS database_owner_member,
      role.rolsuper AS is_superuser, role.rolcreatedb AS can_create_db_role,
      role.rolcreaterole AS can_create_role,
      role.rolreplication AS can_replicate, role.rolbypassrls AS can_bypass_rls,
      (SELECT count(*) FROM pg_catalog.pg_auth_members membership
       WHERE membership.member = role.oid) AS parent_memberships,
      (SELECT count(*) FROM pg_catalog.pg_auth_members membership
       WHERE membership.member = role.oid AND membership.set_option) AS settable_memberships
    FROM pg_catalog.pg_roles role
    JOIN pg_catalog.pg_database database ON database.datname = current_database()
    CROSS JOIN pg_catalog.pg_control_system() control
    WHERE role.rolname = current_user
  `)
  const row = rows[0]
  if (rows.length !== 1 || row === undefined ||
    row.session_user !== expectedRole || row.current_user !== expectedRole ||
    row.current_database !== expectedDatabase ||
    row.cluster_system_identifier !== expectedClusterSystemIdentifier ||
    row.ssl_in_use !== true || row.can_create_database || row.can_create_temporary || row.database_owner_member ||
    row.is_superuser || row.can_create_db_role || row.can_create_role || row.can_replicate || row.can_bypass_rls ||
    dbBigint(row.parent_memberships) !== 0n || dbBigint(row.settable_memberships) !== 0n) {
    throw adapterError("integrity_failed")
  }
  return row
}

export async function applyPostgresDisposableTaskJournalMigrationV1(
  client: PostgresClientV1,
  options: PostgresDisposableTaskJournalMigrationOptionsV1,
): Promise<void> {
  await applyPostgresDisposableTaskJournalMigrationTarget(client, options, [{
    name: MIGRATION_NAME,
    source: options.migration_file === undefined
      ? loadPostgresDisposableTaskJournalMigrationSourceV1()
      : readFileSync(options.migration_file, "utf8"),
  }])
}

interface JournalMigrationSource {
  readonly name: string
  readonly source: string
}

async function applyPostgresDisposableTaskJournalMigrationTarget(
  client: PostgresClientV1,
  options: PostgresDisposableTaskJournalMigrationOptionsV1,
  migrations: readonly JournalMigrationSource[],
): Promise<void> {
  if (!SAFE_ROLE.test(options.expected_migration_role) || !SAFE_ROLE.test(options.runtime_role) ||
    !SAFE_ROLE.test(options.witness_acknowledgement_role) ||
    new Set([options.expected_migration_role, options.runtime_role, options.witness_acknowledgement_role]).size !== 3 ||
    options.expected_database.length === 0 ||
    !SAFE_CLUSTER_IDENTIFIER.test(options.expected_journal_cluster_system_identifier) ||
    options.encrypted_at_rest !== true) throw adapterError("validation_failed")
  for (const value of [options.journal_identity_sha256, options.restore_domain_sha256,
    options.external_head_witness_sha256, options.witness_verification_key_sha256,
    options.verification_key_sha256]) assertDigest(value)
  assertText(options.signer_principal)
  assertText(options.signing_key_id)
  const identity = await client.query<{
    session_user: string
    current_user: string
    current_database: string
    database_oid: bigint | number | string
    cluster_system_identifier: string
    ssl_in_use: boolean
    owner: string
  }>(`
    SELECT session_user::text AS session_user, current_user::text AS current_user,
      current_database()::text AS current_database,
      database.oid::bigint AS database_oid,
      control.system_identifier::text AS cluster_system_identifier,
      COALESCE((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl_in_use,
      owner.rolname::text AS owner FROM pg_catalog.pg_database database
      JOIN pg_catalog.pg_roles owner ON owner.oid = database.datdba
      CROSS JOIN pg_catalog.pg_control_system() control
      WHERE database.datname = current_database()
  `)
  const current = identity[0]
  if (identity.length !== 1 || current === undefined ||
    current.session_user !== options.expected_migration_role ||
    current.current_user !== options.expected_migration_role ||
    current.current_database !== options.expected_database || current.ssl_in_use !== true ||
    current.cluster_system_identifier !== options.expected_journal_cluster_system_identifier ||
    current.owner !== options.expected_migration_role) throw adapterError("integrity_failed")
  const checkedMigrations = migrations.map((migration) => ({
    ...migration,
    checksum: digestBytes(bytes(migration.source)),
  }))
  await client.transaction(async (session) => {
    assertPostgresSessionV1(session, "disposable task journal migration transaction")
    await session.query("SELECT pg_advisory_xact_lock(36711471343122001)")
    await session.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
    await session.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.schema_migrations (
      migration_name text PRIMARY KEY, checksum_sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`)
    const applied = await session.query<{ migration_name: string; checksum_sha256: string }>(
      `SELECT migration_name, checksum_sha256 FROM ${SCHEMA}.schema_migrations ORDER BY migration_name`,
    )
    if (applied.length > checkedMigrations.length || applied.some((migration, index) =>
      migration.migration_name !== checkedMigrations[index]?.name ||
      migration.checksum_sha256 !== checkedMigrations[index]?.checksum)) {
      throw adapterError("integrity_failed")
    }
    for (const migration of checkedMigrations.slice(applied.length)) {
      await session.query(migration.source)
      await session.query(
        `INSERT INTO ${SCHEMA}.schema_migrations(migration_name, checksum_sha256) VALUES ($1, $2)`,
        [migration.name, migration.checksum],
      )
    }
    const store = await session.query<{
      journal_cluster_system_identifier: string
      journal_database_name: string
      journal_database_oid: bigint | number | string
      journal_identity_sha256: string; restore_domain_sha256: string
      external_head_witness_sha256: string; encrypted_at_rest: boolean
      witness_verification_key_sha256: string
      signer_principal: string; signing_key_id: string; verification_key_sha256: string
    }>(
      `SELECT journal_cluster_system_identifier, journal_database_name, journal_database_oid,
        journal_identity_sha256, restore_domain_sha256, external_head_witness_sha256,
        witness_verification_key_sha256,
        encrypted_at_rest, signer_principal, signing_key_id, verification_key_sha256
       FROM ${SCHEMA}.store WHERE singleton FOR UPDATE`,
    )
    if (store.length === 0) {
      await session.query(`INSERT INTO ${SCHEMA}.store
        (singleton, journal_cluster_system_identifier, journal_database_name,
         journal_database_oid, journal_identity_sha256, restore_domain_sha256,
         external_head_witness_sha256, witness_verification_key_sha256,
         encrypted_at_rest, signer_principal,
         signing_key_id, verification_key_sha256)
        VALUES (true, $1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10)`, [
        options.expected_journal_cluster_system_identifier,
        options.expected_database,
        dbBigint(current.database_oid),
        options.journal_identity_sha256, options.restore_domain_sha256,
        options.external_head_witness_sha256, options.witness_verification_key_sha256,
        options.signer_principal,
        options.signing_key_id, options.verification_key_sha256,
      ])
    } else if (store[0]?.journal_cluster_system_identifier !==
        options.expected_journal_cluster_system_identifier ||
      store[0].journal_database_name !== options.expected_database ||
      dbBigint(store[0].journal_database_oid) !== dbBigint(current.database_oid) ||
      store[0].journal_identity_sha256 !== options.journal_identity_sha256 ||
      store[0].restore_domain_sha256 !== options.restore_domain_sha256 ||
      store[0].external_head_witness_sha256 !== options.external_head_witness_sha256 ||
      store[0].witness_verification_key_sha256 !== options.witness_verification_key_sha256 ||
      store[0].encrypted_at_rest !== true || store[0].signer_principal !== options.signer_principal ||
      store[0].signing_key_id !== options.signing_key_id ||
      store[0].verification_key_sha256 !== options.verification_key_sha256) {
      throw adapterError("integrity_failed")
    }
    const role = quoteIdentifier(options.runtime_role)
    const witnessRole = quoteIdentifier(options.witness_acknowledgement_role)
    const database = quoteIdentifier(options.expected_database)
    await session.query(`REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE ${database} FROM PUBLIC`)
    await session.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${role}, ${witnessRole} CASCADE`)
    await session.query(`REVOKE ALL ON SCHEMA ${SCHEMA} FROM PUBLIC, ${role}, ${witnessRole}`)
    await session.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${SCHEMA} FROM PUBLIC, ${role}, ${witnessRole}`)
    await session.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA ${SCHEMA} FROM PUBLIC, ${role}, ${witnessRole}`)
    await session.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`)
    await session.query(`GRANT CONNECT ON DATABASE ${database} TO ${witnessRole}`)
    await session.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${role}`)
    await session.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${witnessRole}`)
    const hasV2 = checkedMigrations.length === 3
    const tables = hasV2 ? EXPECTED_TABLES_V2 : EXPECTED_TABLES
    await session.query(`GRANT SELECT ON ${tables.map((table) => `${SCHEMA}.${table}`).join(", ")} TO ${role}`)
    const functions = hasV2 ? EXPECTED_FUNCTIONS_V2 : EXPECTED_FUNCTIONS
    for (const signature of functions.filter((identity) =>
      !identity.startsWith("acknowledge_witness(") && !identity.startsWith("append_event(") &&
      !identity.startsWith("append_event_v2(") && identity !== "reject_mutation()" &&
      identity !== "guard_task_v2_update()")) {
      await session.query(`GRANT EXECUTE ON FUNCTION ${SCHEMA}.${signature} TO ${role}`)
    }
    await session.query(`GRANT EXECUTE ON FUNCTION ${SCHEMA}.acknowledge_witness(bigint,text,bytea,text) TO ${witnessRole}`)
  })
}

export async function applyPostgresDisposableTaskJournalMigrationV2(
  client: PostgresClientV1,
  options: PostgresDisposableTaskJournalMigrationOptionsV2,
): Promise<void> {
  await applyPostgresDisposableTaskJournalMigrationTarget(client, options, [{
    name: MIGRATION_NAME,
    source: options.migration_file === undefined
      ? loadPostgresDisposableTaskJournalMigrationSourceV1()
      : readFileSync(options.migration_file, "utf8"),
  }, {
    name: MIGRATION_V2_NAME,
    source: options.migration_v2_file === undefined
      ? loadPostgresDisposableTaskJournalMigrationSourceV2()
      : readFileSync(options.migration_v2_file, "utf8"),
  }, {
    name: MIGRATION_V2_EFFECTS_NAME,
    source: options.migration_v2_effects_file === undefined
      ? loadPostgresDisposableTaskJournalEffectTransitionsMigrationSourceV2()
      : readFileSync(options.migration_v2_effects_file, "utf8"),
  }])
}

export class PostgresDisposableTaskJournalV1 implements DisposableTaskJournalPortV1, DisposableTaskJournalPortV2 {
  readonly #client: PostgresClientV1
  readonly #witnessAckClient: PostgresClientV1
  readonly #options: PostgresDisposableTaskJournalOptionsV1
  #ready = false
  #hasV2 = false

  private constructor(client: PostgresClientV1, options: PostgresDisposableTaskJournalOptionsV1) {
    this.#client = client
    this.#witnessAckClient = options.witness_acknowledgement_client
    this.#options = options
  }

  static async connect(
    url: string,
    tlsCa: string | Uint8Array,
    options: PostgresDisposableTaskJournalOptionsV1,
  ): Promise<PostgresDisposableTaskJournalV1> {
    const parsed = new URL(url)
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.searchParams.get("sslmode") !== "verify-full") {
      throw adapterError("validation_failed")
    }
    const sql = new SQL({
      url,
      max: 2,
      connectionTimeout: 10,
      tls: { ca: tlsCa, serverName: parsed.hostname, rejectUnauthorized: true },
    }) as unknown as BunSqlLike
    const client = new BunJournalClient(sql)
    try {
      return await PostgresDisposableTaskJournalV1.fromClient(client, options)
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
  }

  static async fromClient(
    client: PostgresClientV1,
    options: PostgresDisposableTaskJournalOptionsV1,
  ): Promise<PostgresDisposableTaskJournalV1> {
    if (options.encrypted_at_rest !== true) throw adapterError("validation_failed")
    if (!SAFE_ROLE.test(options.expected_migration_role) || !SAFE_ROLE.test(options.expected_runtime_role) ||
      options.expected_database.length === 0 ||
      !SAFE_CLUSTER_IDENTIFIER.test(options.expected_journal_cluster_system_identifier)) {
      throw adapterError("validation_failed")
    }
    if (!SAFE_ROLE.test(options.expected_witness_acknowledgement_role) ||
      options.expected_witness_acknowledgement_role === options.expected_runtime_role ||
      options.expected_witness_acknowledgement_role === options.expected_migration_role ||
      options.expected_runtime_role === options.expected_migration_role ||
      options.witness_acknowledgement_client === client) throw adapterError("validation_failed")
    for (const value of [options.journal_identity_sha256, options.restore_domain_sha256]) assertDigest(value)
    validateSignerPair(options.signer, options.verifier)
    const witness = options.external_head_witness.describe()
    if (witness.durability !== "durable" || witness.restore_domain_sha256 === options.restore_domain_sha256 ||
      !isDigest(witness.restore_domain_sha256) || !isDigest(witness.witness_identity_sha256)) {
      throw adapterError("integrity_failed")
    }
    const witnessVerifier = options.witness_receipt_verifier
    if (witnessVerifier.witness_identity_sha256 !== witness.witness_identity_sha256 ||
      witnessVerifier.restore_domain_sha256 !== witness.restore_domain_sha256 ||
      !isDigest(witnessVerifier.verification_key_sha256) || !SAFE_TEXT.test(witnessVerifier.signing_key_id)) {
      throw adapterError("integrity_failed")
    }
    const journal = new PostgresDisposableTaskJournalV1(client, options)
    const [runtimeIdentity, acknowledgementIdentity] = await Promise.all([
      assertSessionIdentity(client, options.expected_runtime_role, options.expected_database,
        options.expected_journal_cluster_system_identifier),
      assertSessionIdentity(options.witness_acknowledgement_client,
        options.expected_witness_acknowledgement_role, options.expected_database,
        options.expected_journal_cluster_system_identifier),
    ])
    if (dbBigint(runtimeIdentity.database_oid) !== dbBigint(acknowledgementIdentity.database_oid)) {
      throw adapterError("integrity_failed")
    }
    await journal.#assertReady(runtimeIdentity)
    journal.#ready = true
    return journal
  }

  describe() {
    return Object.freeze({
      durability: "durable" as const,
      encrypted_at_rest: true as const,
      journal_identity_sha256: this.#options.journal_identity_sha256,
      restore_domain_sha256: this.#options.restore_domain_sha256,
      external_head_witness_sha256: this.#options.external_head_witness.describe().witness_identity_sha256,
      signer_principal: this.#options.signer.signer_principal,
      signing_key_id: this.#options.signer.signing_key_id,
    })
  }

  async assertWitnessCurrent(witness: DurableJournalWitnessPortV1): Promise<{ witness_receipt_sha256: Digest }> {
    this.#requireReady()
    const expected = this.#options.external_head_witness.describe()
    const actual = witness.describe()
    if (actual.durability !== "durable" || actual.restore_domain_sha256 !== expected.restore_domain_sha256 ||
      actual.witness_identity_sha256 !== expected.witness_identity_sha256) throw adapterError("integrity_failed")
    await this.#healWitness()
    const store = await this.#store(this.#client)
    const head = await witness.readHead(this.#options.journal_identity_sha256)
    if ((head?.sequence ?? 0n) !== dbBigint(store.head_sequence) ||
      (head?.frontier_sha256 ?? null) !== store.head_frontier_sha256) throw adapterError("integrity_failed")
    return { witness_receipt_sha256: head?.receipt_sha256 ?? canonicalSha256({
      schema_version: "sandboxes.disposable-task-journal-witness-receipt/v1",
      journal_identity_sha256: this.#options.journal_identity_sha256,
      witness_identity_sha256: actual.witness_identity_sha256,
      sequence: head?.sequence ?? 0n,
      frontier_sha256: head?.frontier_sha256 ?? null,
    }) }
  }

  async prepareDispatch(input: Readonly<DisposableTaskJournalPrepareInputV1>): Promise<DisposableTaskJournalPrepareResultV1> {
    this.#requireReady()
    this.#validatePrepare(input)
    await this.#healWitness()
    const result = await this.#serializable(async (session) => {
      await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      await session.query("SELECT pg_advisory_xact_lock(36711471343122002)")
      const store = await this.#store(session)
      this.#assertAppendable(store)
      if (this.#hasV2) {
        const v2Collision = await session.query<{ dispatch_id: string }>(
          `SELECT dispatch_id FROM ${SCHEMA}.tasks_v2
           WHERE idempotency_key_sha256 = $1 OR operation_digest = $2`,
          [input.idempotency_key_sha256, input.operation_digest],
        )
        if (v2Collision.length !== 0) {
          throw adapterError("provider_state_unknown", { quarantineRequired: true })
        }
      }
      const rows = await session.query<TaskRow>(
        `SELECT * FROM ${SCHEMA}.tasks WHERE idempotency_key_sha256 = $1 OR operation_digest = $2`,
        [input.idempotency_key_sha256, input.operation_digest],
      )
      const row = rows[0]
      if (row !== undefined) {
        this.#assertExactIntent(row, input)
        if (row.state === "OUTCOME" || row.state === "QUARANTINED") return { terminal: this.#terminal(row) }
        const nowRows = await session.query<{ now: Date | string }>("SELECT clock_timestamp() AS now")
        const now = new Date(nowRows[0]?.now ?? Number.NaN)
        const expiry = new Date(row.lease_expires_at)
        if (Number.isNaN(now.getTime()) || Number.isNaN(expiry.getTime())) throw adapterError("integrity_failed")
        if (expiry.getTime() > now.getTime()) {
          return { terminal: { kind: "busy" as const, request_sha256: input.request_sha256, retry_after: expiry.toISOString() } }
        }
        const epoch = dbBigint(row.lease_epoch) + 1n
        const expires = new Date(now.getTime() + input.lease_duration_ms).toISOString()
        const ownershipNonce = digestBytes(randomBytes(32))
        const fence = canonicalSha256({
          domain: "sandboxes.disposable-task-journal.claim-fence/v1",
          dispatch_id: row.dispatch_id,
          request_sha256: input.request_sha256,
          lease_epoch: epoch,
          lease_owner_sha256: input.lease_owner_sha256,
          lease_expires_at: expires,
          ownership_nonce_sha256: ownershipNonce,
        })
        const effectLeaseEpoch = dbBigint(row.effect_lease_epoch ?? row.allocation_lease_epoch)
        const effectClaimFence = (row.effect_claim_fence_sha256 ?? row.allocation_claim_fence_sha256) as Digest
        const effectOwnershipNonce = (row.effect_ownership_nonce_sha256 ??
          row.allocation_ownership_nonce_sha256) as Digest
        const recoveryRecord = {
          schema_version: "sandboxes.disposable-task-recovery-anchor/v1",
          dispatch_id: row.dispatch_id,
          request_sha256: input.request_sha256,
          prior_state: row.state,
          effect_claim_sha256: row.effect_claim_sha256,
          provider_effect_claim_fence_sha256: effectClaimFence,
          provider_effect_lease_epoch: effectLeaseEpoch,
          provider_effect_ownership_nonce_sha256: effectOwnershipNonce,
          current_claim_fence_sha256: fence,
          current_lease_epoch: epoch,
          expected_provider_fingerprint_sha256: row.provider_fingerprint_sha256 as Digest | null,
          expected_result_bundle_sha256: row.result_bundle_sha256 as Digest | null,
          expected_checkpoint_handoff_sha256: row.checkpoint_handoff_sha256 as Digest | null,
        }
        const recoveryRecordBytes = canonicalBytes(recoveryRecord)
        const recoveryRecordSha256 = digestBytes(recoveryRecordBytes)
        const event = this.#event(store, "CLAIMED", row.dispatch_id, input.request_sha256, {
          prior_state: row.state,
          lease_epoch: epoch,
          claim_fence_sha256: fence,
          ownership_nonce_sha256: ownershipNonce,
          lease_owner_sha256: input.lease_owner_sha256,
          lease_expires_at: expires,
          recovery_record: recoveryRecord,
          recovery_record_sha256: recoveryRecordSha256,
        })
        const changed = await session.query<{ prior_state: string }>(
          `SELECT ${SCHEMA}.takeover_claim($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS prior_state`,
          [row.dispatch_id, input.request_sha256, row.claim_fence_sha256, epoch, fence,
            ownershipNonce, input.lease_owner_sha256, expires, ...this.#eventParameters(event)],
        )
        const priorState = changed[0]?.prior_state
        if (!['PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED'].includes(String(priorState))) {
          throw adapterError("integrity_failed")
        }
        return { event, terminal: {
          kind: "reconcile" as const,
          recovery: true as const,
          prior_state: priorState as "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED",
          authorization: this.#authorization(row),
          recovery_binding: {
            provider_effect_claim_fence_sha256: effectClaimFence,
            provider_effect_lease_epoch: effectLeaseEpoch,
            provider_effect_ownership_nonce_sha256: effectOwnershipNonce,
            expected_result_bundle_sha256: row.result_bundle_sha256 as Digest | null,
            expected_checkpoint_handoff_sha256: row.checkpoint_handoff_sha256 as Digest | null,
            expected_provider_fingerprint_sha256: row.provider_fingerprint_sha256 as Digest | null,
            canonical_recovery_record_bytes: recoveryRecordBytes,
            recovery_record_sha256: recoveryRecordSha256,
            canonical_signed_recovery_anchor_bytes: event.anchorBytes,
            recovery_anchor_sha256: event.anchorSha256,
          },
          ...this.#claim(row, epoch, fence, ownershipNonce, input.lease_owner_sha256, expires),
        } }
      }
      const dispatchId = `dt_${canonicalSha256({
        domain: "sandboxes.disposable-task-journal.dispatch-id/v1",
        idempotency_key_sha256: input.idempotency_key_sha256,
        request_sha256: input.request_sha256,
      }).slice(7)}`
      const nowRows = await session.query<{ expires: Date | string }>(
        "SELECT clock_timestamp() + ($1::bigint * interval '1 millisecond') AS expires", [input.lease_duration_ms],
      )
      const expires = iso(nowRows[0]?.expires ?? "")
      const epoch = 1n
      const ownershipNonce = digestBytes(randomBytes(32))
      const fence = canonicalSha256({
        domain: "sandboxes.disposable-task-journal.claim-fence/v1",
        dispatch_id: dispatchId,
        request_sha256: input.request_sha256,
        lease_epoch: epoch,
        lease_owner_sha256: input.lease_owner_sha256,
        lease_expires_at: expires,
        ownership_nonce_sha256: ownershipNonce,
      })
      const effectClaimSha256 = canonicalSha256({
        schema_version: "sandboxes.disposable-task-effect-claim/v1",
        dispatch_id: dispatchId,
        request_sha256: input.request_sha256,
        provider: input.provider,
        provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
        provider_creation_token_sha256: input.provider_creation_token_sha256,
        immutable_fingerprint_sha256: input.immutable_fingerprint_sha256,
        provider_effect_claim_fence_sha256: fence,
        provider_effect_lease_epoch: epoch,
        provider_effect_ownership_nonce_sha256: ownershipNonce,
      })
      const consumeInput = {
        dispatch_id: dispatchId,
        authority_envelope_sha256: input.authority_envelope_sha256,
        canonical_request_sha256: input.request_sha256,
        operation_digest: input.operation_digest,
        provider: input.provider,
        source_manifest_sha256: input.source_manifest_sha256,
        input_manifest_sha256: input.input_manifest_sha256,
        checkpoint_policy_sha256: input.checkpoint_policy_sha256,
        effect_claim_sha256: effectClaimSha256,
      }
      const consumeInputBytes = canonicalBytes(consumeInput)
      const consumeInputSha256 = digestBytes(consumeInputBytes)
      const dispatchAnchor = canonicalSha256({
        domain: "sandboxes.disposable-task-journal.dispatch-anchor/v1",
        journal_identity_sha256: this.#options.journal_identity_sha256,
        dispatch_id: dispatchId,
        request_sha256: input.request_sha256,
        operation_digest: input.operation_digest,
        provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
        provider_creation_token_sha256: input.provider_creation_token_sha256,
        immutable_fingerprint_sha256: input.immutable_fingerprint_sha256,
        authority_consume_input_sha256: consumeInputSha256,
      })
      const event = this.#event(store, "PREPARED", dispatchId, input.request_sha256, {
        idempotency_key_sha256: input.idempotency_key_sha256,
        operation_digest: input.operation_digest,
        authority_envelope_sha256: input.authority_envelope_sha256,
        source_manifest_sha256: input.source_manifest_sha256,
        input_manifest_sha256: input.input_manifest_sha256,
        provider: input.provider,
        provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
        provider_creation_token_sha256: input.provider_creation_token_sha256,
        immutable_fingerprint_sha256: input.immutable_fingerprint_sha256,
        authority_consume_input_sha256: consumeInputSha256,
        ownership_nonce_sha256: ownershipNonce,
        allocation_lease_epoch: epoch,
        allocation_claim_fence_sha256: fence,
        allocation_ownership_nonce_sha256: ownershipNonce,
        effect_claim_sha256: effectClaimSha256,
        dispatch_anchor_sha256: dispatchAnchor,
        lease_epoch: epoch,
        claim_fence_sha256: fence,
        lease_owner_sha256: input.lease_owner_sha256,
        lease_expires_at: expires,
      })
      await session.query(
        `SELECT ${SCHEMA}.insert_prepared($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
        [input.idempotency_key_sha256, input.operation_digest, dispatchId, input.request_sha256,
          input.canonical_request_bytes, consumeInputBytes, consumeInputSha256,
          input.authority_envelope_sha256, input.source_manifest_sha256,
          input.input_manifest_sha256, input.provider, input.provider_metadata_scope_sha256,
          input.provider_creation_token_sha256, input.immutable_fingerprint_sha256,
          ownershipNonce, effectClaimSha256, dispatchAnchor, epoch, fence, input.lease_owner_sha256, expires,
          ...this.#eventParameters(event)],
      )
      return { event, terminal: {
        kind: "prepared" as const, recovery: false as const,
        dispatch_id: dispatchId, request_sha256: input.request_sha256,
        lease_epoch: epoch, claim_fence_sha256: fence,
        lease_owner_sha256: input.lease_owner_sha256, lease_expires_at: expires,
        provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
        provider_creation_token_sha256: input.provider_creation_token_sha256,
        immutable_fingerprint_sha256: input.immutable_fingerprint_sha256,
        authorization: {
          canonical_consume_input_bytes: consumeInputBytes,
          consume_input_sha256: consumeInputSha256,
          consume_input: consumeInput,
          stored_receipt: null,
        },
        ownership_nonce_sha256: ownershipNonce,
        effect_claim_sha256: effectClaimSha256,
        dispatch_intent_anchor_sha256: null,
        dispatch_anchor_sha256: dispatchAnchor,
      } }
    })
    if (result.event !== undefined) await this.#witness(result.event)
    return result.terminal as DisposableTaskJournalPrepareResultV1
  }

  async prepareIntentV2(
    input: Readonly<DisposableTaskJournalPrepareIntentInputV2>,
  ): Promise<DisposableTaskJournalPrepareIntentResultV2> {
    this.#requireReady()
    this.#validatePrepareV2(input)
    await this.#healWitness()
    const result = await this.#serializable(async (session) => {
      await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      await session.query("SELECT pg_advisory_xact_lock(36711471343122002)")
      const store = await this.#store(session)
      this.#assertAppendable(store)
      const legacy = await session.query<{ dispatch_id: string }>(
        `SELECT dispatch_id FROM ${SCHEMA}.tasks
         WHERE idempotency_key_sha256 = $1 OR operation_digest = $2`,
        [input.idempotency_key_sha256, input.operation_digest],
      )
      if (legacy.length !== 0) throw adapterError("provider_state_unknown", { quarantineRequired: true })
      const rows = await session.query<TaskRowV2>(
        `SELECT * FROM ${SCHEMA}.tasks_v2
         WHERE idempotency_key_sha256 = $1 OR operation_digest = $2`,
        [input.idempotency_key_sha256, input.operation_digest],
      )
      if (rows.length > 1) throw adapterError("integrity_failed")
      const row = rows[0]
      if (row !== undefined) {
        this.#assertExactIntentV2(row, input)
        if (row.state === "QUARANTINED") {
          if (!isDigest(row.quarantine_evidence_sha256)) throw adapterError("integrity_failed")
          return { event: undefined, terminal: {
            kind: "quarantined" as const,
            canonical_intent_sha256: input.canonical_intent_sha256,
            quarantine_evidence_sha256: row.quarantine_evidence_sha256,
          } }
        }
        const nowRows = await session.query<{ now: Date | string }>("SELECT clock_timestamp() AS now")
        const now = new Date(nowRows[0]?.now ?? Number.NaN)
        const expiry = new Date(row.lease_expires_at)
        if (Number.isNaN(now.getTime()) || Number.isNaN(expiry.getTime())) throw adapterError("integrity_failed")
        if (expiry.getTime() > now.getTime()) {
          if (row.lease_owner_sha256 !== input.lease_owner_sha256) return { event: undefined, terminal: {
            kind: "busy" as const,
            canonical_intent_sha256: input.canonical_intent_sha256,
            retry_after: expiry.toISOString(),
          } }
          const claim = this.#claimV2(row, dbBigint(row.lease_epoch), row.claim_fence_sha256 as Digest,
            row.ownership_nonce_sha256 as Digest, row.lease_owner_sha256 as Digest, expiry.toISOString())
          if (row.state === "PREPARED") return { event: undefined, terminal: {
            kind: "prepared" as const,
            recovery: false as const,
            prepared: this.#preparedV2(row),
            stored_authorization: null,
            ...claim,
          } }
          return { event: undefined, terminal: {
            kind: "reconcile" as const,
            recovery: true as const,
            prior_state: row.state,
            prepared: this.#preparedV2(row),
            stored_authorization: this.#storedAuthorizationV2(row),
            ...claim,
          } }
        }
        const epoch = dbBigint(row.lease_epoch) + 1n
        const expires = new Date(now.getTime() + input.lease_duration_ms).toISOString()
        const ownershipNonce = digestBytes(randomBytes(32))
        const fence = canonicalSha256({
          domain: "sandboxes.disposable-task-journal.claim-fence/v2",
          dispatch_id: row.dispatch_id,
          canonical_intent_sha256: row.canonical_intent_sha256,
          lease_epoch: epoch,
          lease_owner_sha256: input.lease_owner_sha256,
          lease_expires_at: expires,
          ownership_nonce_sha256: ownershipNonce,
        })
        const event = this.#eventV2(store, "CLAIMED", row.dispatch_id,
          input.canonical_intent_sha256, {
            prior_state: row.state,
            sandbox_prepare_anchor_sha256: row.sandbox_prepare_anchor_sha256,
            effect_claim_sha256: row.effect_claim_sha256,
            lease_epoch: epoch,
            claim_fence_sha256: fence,
            ownership_nonce_sha256: ownershipNonce,
            lease_owner_sha256: input.lease_owner_sha256,
            lease_expires_at: expires,
            expected_provider_fingerprint_sha256: row.provider_fingerprint_sha256,
            expected_provider_dispatch_anchor_sha256: row.provider_dispatch_anchor_sha256,
            expected_provider_allocation_sha256: row.provider_allocation_sha256,
            expected_result_bundle_sha256: row.result_bundle_sha256,
            expected_checkpoint_handoff_sha256: row.checkpoint_handoff_sha256,
            expected_result_persisted_anchor_sha256: row.result_persisted_anchor_sha256,
          })
        const changed = await session.query<{ prior_state: string }>(
          `SELECT ${SCHEMA}.takeover_claim_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) AS prior_state`,
          [row.dispatch_id, input.canonical_intent_sha256, row.sandbox_prepare_anchor_sha256,
            row.effect_claim_sha256, row.claim_fence_sha256, epoch,
            fence, ownershipNonce, input.lease_owner_sha256, expires, ...this.#eventParameters(event)],
        )
        if (changed[0]?.prior_state !== row.state) throw adapterError("integrity_failed")
        return { event, terminal: {
          kind: "reconcile" as const,
          recovery: true as const,
          prior_state: row.state,
          prepared: this.#preparedV2(row),
          stored_authorization: this.#storedAuthorizationV2(row),
          ...this.#claimV2(row, epoch, fence, ownershipNonce, input.lease_owner_sha256, expires),
        } }
      }
      const dispatchId = `dt2_${canonicalSha256({
        domain: "sandboxes.disposable-task-journal.dispatch-id/v2",
        journal_identity_sha256: this.#options.journal_identity_sha256,
        idempotency_key_sha256: input.idempotency_key_sha256,
        canonical_intent_sha256: input.canonical_intent_sha256,
      }).slice(7)}`
      const nowRows = await session.query<{ expires: Date | string }>(
        "SELECT clock_timestamp() + ($1::bigint * interval '1 millisecond') AS expires", [input.lease_duration_ms],
      )
      const expires = iso(nowRows[0]?.expires ?? "")
      const epoch = 1n
      const ownershipNonce = digestBytes(randomBytes(32))
      const fence = canonicalSha256({
        domain: "sandboxes.disposable-task-journal.claim-fence/v2",
        dispatch_id: dispatchId,
        canonical_intent_sha256: input.canonical_intent_sha256,
        lease_epoch: epoch,
        lease_owner_sha256: input.lease_owner_sha256,
        lease_expires_at: expires,
        ownership_nonce_sha256: ownershipNonce,
      })
      const effectClaim = canonicalSha256({
        schema_version: "sandboxes.disposable-task-effect-claim/v2",
        journal_identity_sha256: this.#options.journal_identity_sha256,
        restore_domain_sha256: this.#options.restore_domain_sha256,
        dispatch_id: dispatchId,
        canonical_intent_sha256: input.canonical_intent_sha256,
        provider: input.provider,
        provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
        provider_creation_token_sha256: input.provider_creation_token_sha256,
        immutable_fingerprint_sha256: input.immutable_fingerprint_sha256,
        provider_effect_claim_fence_sha256: fence,
        provider_effect_lease_epoch: epoch,
        provider_effect_ownership_nonce_sha256: ownershipNonce,
      })
      const event = this.#eventV2(store, "PREPARED", dispatchId, input.canonical_intent_sha256, {
        idempotency_key_sha256: input.idempotency_key_sha256,
        operation_digest: input.operation_digest,
        source_manifest_sha256: input.source_manifest_sha256,
        input_manifest_sha256: input.input_manifest_sha256,
        checkpoint_policy_sha256: input.checkpoint_policy_sha256,
        provider: input.provider,
        provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
        provider_creation_token_sha256: input.provider_creation_token_sha256,
        immutable_fingerprint_sha256: input.immutable_fingerprint_sha256,
        allocation_lease_epoch: epoch,
        allocation_claim_fence_sha256: fence,
        allocation_ownership_nonce_sha256: ownershipNonce,
        effect_claim_sha256: effectClaim,
        lease_epoch: epoch,
        claim_fence_sha256: fence,
        lease_owner_sha256: input.lease_owner_sha256,
        lease_expires_at: expires,
        ownership_nonce_sha256: ownershipNonce,
      })
      const prepared = Object.freeze({
        schema_version: DISPOSABLE_TASK_PREPARED_SCHEMA_V2,
        dispatch_id: dispatchId,
        canonical_intent_sha256: input.canonical_intent_sha256,
        sandbox_prepare_anchor_sha256: event.anchorSha256,
        operation_digest: input.operation_digest,
        provider: input.provider,
        source_manifest_sha256: input.source_manifest_sha256,
        input_manifest_sha256: input.input_manifest_sha256,
        checkpoint_policy_sha256: input.checkpoint_policy_sha256,
        effect_claim_sha256: effectClaim,
        prepared_sha256: canonicalSha256({
          schema_version: DISPOSABLE_TASK_PREPARED_SCHEMA_V2,
          dispatch_id: dispatchId,
          canonical_intent_sha256: input.canonical_intent_sha256,
          sandbox_prepare_anchor_sha256: event.anchorSha256,
          operation_digest: input.operation_digest,
          provider: input.provider,
          source_manifest_sha256: input.source_manifest_sha256,
          input_manifest_sha256: input.input_manifest_sha256,
          checkpoint_policy_sha256: input.checkpoint_policy_sha256,
          effect_claim_sha256: effectClaim,
        }),
      })
      await session.query(
        `SELECT ${SCHEMA}.insert_prepared_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [input.idempotency_key_sha256, input.operation_digest, dispatchId,
          input.canonical_intent_sha256, input.canonical_intent_bytes,
          input.source_manifest_sha256, input.input_manifest_sha256, input.checkpoint_policy_sha256,
          input.provider, input.provider_metadata_scope_sha256, input.provider_creation_token_sha256,
          input.immutable_fingerprint_sha256, epoch, fence, ownershipNonce, effectClaim,
          event.anchorSha256, prepared.prepared_sha256, input.lease_owner_sha256, expires,
          ...this.#eventParameters(event)],
      )
      const rowForClaim = {
        dispatch_id: dispatchId,
        canonical_intent_sha256: input.canonical_intent_sha256,
        provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
        provider_creation_token_sha256: input.provider_creation_token_sha256,
        immutable_fingerprint_sha256: input.immutable_fingerprint_sha256,
        allocation_claim_fence_sha256: fence,
        allocation_lease_epoch: epoch,
        allocation_ownership_nonce_sha256: ownershipNonce,
        effect_claim_sha256: effectClaim,
        sandbox_prepare_anchor_sha256: event.anchorSha256,
        dispatch_intent_anchor_sha256: null,
        provider_fingerprint_sha256: null,
        provider_dispatch_anchor_sha256: null,
        provider_allocation_sha256: null,
        result_bundle_sha256: null,
        checkpoint_handoff_sha256: null,
        result_persisted_anchor_sha256: null,
      } as TaskRowV2
      return { event, terminal: {
        kind: "prepared" as const,
        recovery: false as const,
        prepared,
        stored_authorization: null,
        ...this.#claimV2(rowForClaim, epoch, fence, ownershipNonce, input.lease_owner_sha256, expires),
      } }
    })
    if (result.event !== undefined) await this.#witness(result.event)
    return result.terminal as DisposableTaskJournalPrepareIntentResultV2
  }

  async bindAuthorizationAndMarkIntentV2(
    input: Parameters<DisposableTaskJournalPortV2["bindAuthorizationAndMarkIntentV2"]>[0],
  ) {
    this.#requireReady()
    assertText(input.dispatch_id)
    for (const value of [input.canonical_intent_sha256, input.sandbox_prepare_anchor_sha256,
      input.claim_fence_sha256, input.effect_claim_sha256, input.consume_input_sha256,
      input.authorization.authority_envelope_sha256, input.authorization.receipt_sha256]) assertDigest(value)
    if (typeof input.lease_epoch !== "bigint" || input.lease_epoch < 1n) throw adapterError("validation_failed")
    const consumeBytes = asBytes(input.canonical_consume_input_bytes)
    const envelopeBytes = asBytes(input.authorization.canonical_authority_envelope_bytes)
    const receiptBytes = asBytes(input.authorization.canonical_receipt_bytes)
    parseCanonicalBytes(consumeBytes)
    parseInfinityCanonicalBytesV2(envelopeBytes)
    parseInfinityCanonicalBytesV2(receiptBytes)
    if (digestBytes(consumeBytes) !== input.consume_input_sha256 ||
      digestBytes(envelopeBytes) !== input.authorization.authority_envelope_sha256 ||
      digestBytes(receiptBytes) !== input.authorization.receipt_sha256) throw adapterError("integrity_failed")
    await this.#healWitness()
    const result = await this.#serializable(async (session) => {
      await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      await session.query("SELECT pg_advisory_xact_lock(36711471343122002)")
      const store = await this.#store(session)
      this.#assertAppendable(store)
      const rows = await session.query<TaskRowV2>(`SELECT * FROM ${SCHEMA}.tasks_v2
        WHERE dispatch_id = $1 AND canonical_intent_sha256 = $2
          AND claim_fence_sha256 = $3 AND lease_epoch = $4`,
      [input.dispatch_id, input.canonical_intent_sha256, input.claim_fence_sha256, input.lease_epoch])
      const row = rows[0]
      if (row === undefined || rows.length !== 1 || row.sandbox_prepare_anchor_sha256 !== input.sandbox_prepare_anchor_sha256 ||
        row.effect_claim_sha256 !== input.effect_claim_sha256) throw adapterError("integrity_failed")
      this.#assertConsumeInputV2(row, consumeBytes, input.authorization.authority_envelope_sha256)
      if (row.dispatch_intent_anchor_sha256 !== null) {
        const stored = this.#storedAuthorizationV2(row)
        if (stored === null || !byteEqual(asBytes(row.canonical_consume_input_bytes!), consumeBytes) ||
          row.consume_input_sha256 !== input.consume_input_sha256 ||
          !byteEqual(stored.canonical_authority_envelope_bytes, envelopeBytes) ||
          stored.authority_envelope_sha256 !== input.authorization.authority_envelope_sha256 ||
          !byteEqual(stored.canonical_receipt_bytes, receiptBytes) ||
          stored.receipt_sha256 !== input.authorization.receipt_sha256) throw adapterError("integrity_failed")
        return { event: undefined, anchor: row.dispatch_intent_anchor_sha256 as Digest }
      }
      if (row.state !== "PREPARED") throw adapterError("integrity_failed")
      const event = this.#eventV2(store, "DISPATCH_INTENT", row.dispatch_id,
        input.canonical_intent_sha256, {
          sandbox_prepare_anchor_sha256: input.sandbox_prepare_anchor_sha256,
          effect_claim_sha256: input.effect_claim_sha256,
          consume_input_sha256: input.consume_input_sha256,
          authority_envelope_sha256: input.authorization.authority_envelope_sha256,
          authorization_consumption_receipt_sha256: input.authorization.receipt_sha256,
        })
      const changed = await session.query<{ changed: number }>(
        `SELECT ${SCHEMA}.bind_authorization_and_mark_intent_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) AS changed`,
        [input.dispatch_id, input.canonical_intent_sha256, input.sandbox_prepare_anchor_sha256,
          input.claim_fence_sha256, input.lease_epoch, input.effect_claim_sha256,
          consumeBytes, input.consume_input_sha256, envelopeBytes, input.authorization.authority_envelope_sha256,
          receiptBytes, input.authorization.receipt_sha256, event.anchorSha256, ...this.#eventParameters(event)],
      )
      if (Number(changed[0]?.changed) !== 1) throw adapterError("integrity_failed")
      return { event, anchor: event.anchorSha256 }
    })
    if (result.event !== undefined) await this.#witness(result.event)
    return Object.freeze({
      authority_envelope_sha256: input.authorization.authority_envelope_sha256,
      authorization_consumption_receipt_sha256: input.authorization.receipt_sha256,
      dispatch_intent_anchor_sha256: result.anchor,
    })
  }

  async quarantineAuthorizationV2(
    input: Parameters<DisposableTaskJournalPortV2["quarantineAuthorizationV2"]>[0],
  ): Promise<void> {
    this.#requireReady()
    assertText(input.dispatch_id)
    assertText(input.quarantine_reason)
    for (const value of [input.canonical_intent_sha256, input.sandbox_prepare_anchor_sha256,
      input.effect_claim_sha256, input.claim_fence_sha256,
      input.quarantine_evidence_sha256]) assertDigest(value)
    if (typeof input.lease_epoch !== "bigint" || input.lease_epoch < 1n) throw adapterError("validation_failed")
    await this.#healWitness()
    const result = await this.#serializable(async (session) => {
      await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      await session.query("SELECT pg_advisory_xact_lock(36711471343122002)")
      const store = await this.#store(session)
      this.#assertAppendable(store)
      const rows = await session.query<TaskRowV2>(`SELECT * FROM ${SCHEMA}.tasks_v2
        WHERE dispatch_id = $1 AND canonical_intent_sha256 = $2
          AND claim_fence_sha256 = $3 AND lease_epoch = $4`,
      [input.dispatch_id, input.canonical_intent_sha256, input.claim_fence_sha256, input.lease_epoch])
      const row = rows[0]
      if (row === undefined || rows.length !== 1 ||
        row.sandbox_prepare_anchor_sha256 !== input.sandbox_prepare_anchor_sha256 ||
        row.effect_claim_sha256 !== input.effect_claim_sha256) throw adapterError("integrity_failed")
      if (row.state === "QUARANTINED") {
        if (row.quarantine_reason !== input.quarantine_reason ||
          row.quarantine_evidence_sha256 !== input.quarantine_evidence_sha256) throw adapterError("integrity_failed")
        return { event: undefined }
      }
      if (row.state !== "DISPATCH_INTENT") throw adapterError("integrity_failed")
      const event = this.#eventV2(store, "QUARANTINED", row.dispatch_id,
        input.canonical_intent_sha256, {
          sandbox_prepare_anchor_sha256: input.sandbox_prepare_anchor_sha256,
          effect_claim_sha256: input.effect_claim_sha256,
          quarantine_reason: input.quarantine_reason,
          quarantine_evidence_sha256: input.quarantine_evidence_sha256,
        })
      const changed = await session.query<{ changed: number }>(
        `SELECT ${SCHEMA}.quarantine_authorization_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS changed`,
        [input.dispatch_id, input.canonical_intent_sha256, input.sandbox_prepare_anchor_sha256,
          input.effect_claim_sha256, input.claim_fence_sha256, input.lease_epoch,
          input.quarantine_reason, input.quarantine_evidence_sha256,
          ...this.#eventParameters(event)],
      )
      if (Number(changed[0]?.changed) !== 1) throw adapterError("integrity_failed")
      return { event }
    })
    if (result.event !== undefined) await this.#witness(result.event)
  }

  async markDispatchedIntentV2(
    input: Parameters<DisposableTaskJournalPortV2["markDispatchedIntentV2"]>[0],
  ) {
    this.#requireReady()
    assertText(input.dispatch_id)
    if (input.expected_state !== "DISPATCH_INTENT" || typeof input.lease_epoch !== "bigint" ||
      input.lease_epoch < 1n) throw adapterError("validation_failed")
    for (const value of [input.canonical_intent_sha256, input.sandbox_prepare_anchor_sha256,
      input.effect_claim_sha256, input.dispatch_intent_anchor_sha256,
      input.authorization_consumption_receipt_sha256, input.claim_fence_sha256,
      input.provider_fingerprint_sha256, input.provider_metadata_scope_sha256]) assertDigest(value)
    await this.#healWitness()
    const result = await this.#serializable(async (session) => {
      await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      await session.query("SELECT pg_advisory_xact_lock(36711471343122002)")
      const store = await this.#store(session)
      this.#assertAppendable(store)
      const rows = await session.query<TaskRowV2>(`SELECT * FROM ${SCHEMA}.tasks_v2
        WHERE dispatch_id = $1 AND canonical_intent_sha256 = $2
          AND claim_fence_sha256 = $3 AND lease_epoch = $4`,
      [input.dispatch_id, input.canonical_intent_sha256, input.claim_fence_sha256, input.lease_epoch])
      const row = rows[0]
      if (row === undefined || rows.length !== 1 ||
        row.sandbox_prepare_anchor_sha256 !== input.sandbox_prepare_anchor_sha256 ||
        row.effect_claim_sha256 !== input.effect_claim_sha256 ||
        row.dispatch_intent_anchor_sha256 !== input.dispatch_intent_anchor_sha256 ||
        row.authorization_consumption_receipt_sha256 !== input.authorization_consumption_receipt_sha256 ||
        row.provider_metadata_scope_sha256 !== input.provider_metadata_scope_sha256) {
        throw adapterError("integrity_failed")
      }
      if (row.state === "DISPATCHED" || row.state === "RESULT_PERSISTED") {
        if (row.provider_fingerprint_sha256 !== input.provider_fingerprint_sha256 ||
          !isDigest(row.provider_dispatch_anchor_sha256) || !isDigest(row.provider_allocation_sha256)) {
          throw adapterError("integrity_failed")
        }
        return {
          event: undefined,
          providerDispatchAnchorSha256: row.provider_dispatch_anchor_sha256,
          providerAllocationSha256: row.provider_allocation_sha256,
        }
      }
      if (row.state !== input.expected_state) throw adapterError("integrity_failed")
      const event = this.#eventV2(store, "DISPATCHED", row.dispatch_id,
        input.canonical_intent_sha256, {
          sandbox_prepare_anchor_sha256: input.sandbox_prepare_anchor_sha256,
          effect_claim_sha256: input.effect_claim_sha256,
          dispatch_intent_anchor_sha256: input.dispatch_intent_anchor_sha256,
          authorization_consumption_receipt_sha256: input.authorization_consumption_receipt_sha256,
          claim_fence_sha256: input.claim_fence_sha256,
          lease_epoch: input.lease_epoch,
          provider_effect_claim_fence_sha256: row.allocation_claim_fence_sha256,
          provider_effect_lease_epoch: dbBigint(row.allocation_lease_epoch),
          provider_effect_ownership_nonce_sha256: row.allocation_ownership_nonce_sha256,
          provider: row.provider,
          provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
          provider_creation_token_sha256: row.provider_creation_token_sha256,
          immutable_fingerprint_sha256: row.immutable_fingerprint_sha256,
          provider_fingerprint_sha256: input.provider_fingerprint_sha256,
        })
      const changed = await session.query<{ changed: number }>(
        `SELECT ${SCHEMA}.mark_dispatched_intent_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) AS changed`,
        [input.dispatch_id, input.canonical_intent_sha256, input.sandbox_prepare_anchor_sha256,
          input.effect_claim_sha256, input.dispatch_intent_anchor_sha256,
          input.authorization_consumption_receipt_sha256, input.claim_fence_sha256,
          input.lease_epoch, input.expected_state, input.provider_fingerprint_sha256,
          input.provider_metadata_scope_sha256, ...this.#eventParameters(event)],
      )
      if (Number(changed[0]?.changed) !== 1) throw adapterError("integrity_failed")
      return {
        event,
        providerDispatchAnchorSha256: event.anchorSha256,
        providerAllocationSha256: event.recordSha256,
      }
    })
    if (result.event !== undefined) await this.#witness(result.event)
    return Object.freeze({
      provider_dispatch_anchor_sha256: result.providerDispatchAnchorSha256,
      provider_allocation_sha256: result.providerAllocationSha256,
    })
  }

  async markResultPersistedIntentV2(
    input: Parameters<DisposableTaskJournalPortV2["markResultPersistedIntentV2"]>[0],
  ) {
    this.#requireReady()
    assertText(input.dispatch_id)
    if (input.expected_state !== "DISPATCHED" || typeof input.lease_epoch !== "bigint" ||
      input.lease_epoch < 1n) throw adapterError("validation_failed")
    for (const value of [input.canonical_intent_sha256, input.sandbox_prepare_anchor_sha256,
      input.effect_claim_sha256, input.dispatch_intent_anchor_sha256,
      input.authorization_consumption_receipt_sha256, input.claim_fence_sha256,
      input.provider_fingerprint_sha256, input.provider_dispatch_anchor_sha256,
      input.provider_allocation_sha256, input.result_bundle_sha256,
      input.checkpoint_handoff_sha256]) assertDigest(value)
    await this.#healWitness()
    const result = await this.#serializable(async (session) => {
      await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      await session.query("SELECT pg_advisory_xact_lock(36711471343122002)")
      const store = await this.#store(session)
      this.#assertAppendable(store)
      const rows = await session.query<TaskRowV2>(`SELECT * FROM ${SCHEMA}.tasks_v2
        WHERE dispatch_id = $1 AND canonical_intent_sha256 = $2
          AND claim_fence_sha256 = $3 AND lease_epoch = $4`,
      [input.dispatch_id, input.canonical_intent_sha256, input.claim_fence_sha256, input.lease_epoch])
      const row = rows[0]
      if (row === undefined || rows.length !== 1 ||
        row.sandbox_prepare_anchor_sha256 !== input.sandbox_prepare_anchor_sha256 ||
        row.effect_claim_sha256 !== input.effect_claim_sha256 ||
        row.dispatch_intent_anchor_sha256 !== input.dispatch_intent_anchor_sha256 ||
        row.authorization_consumption_receipt_sha256 !== input.authorization_consumption_receipt_sha256 ||
        row.provider_fingerprint_sha256 !== input.provider_fingerprint_sha256 ||
        row.provider_dispatch_anchor_sha256 !== input.provider_dispatch_anchor_sha256 ||
        row.provider_allocation_sha256 !== input.provider_allocation_sha256) {
        throw adapterError("integrity_failed")
      }
      if (row.state === "RESULT_PERSISTED") {
        if (row.result_bundle_sha256 !== input.result_bundle_sha256 ||
          row.checkpoint_handoff_sha256 !== input.checkpoint_handoff_sha256 ||
          !isDigest(row.result_persisted_anchor_sha256)) throw adapterError("integrity_failed")
        return { event: undefined, resultPersistedAnchorSha256: row.result_persisted_anchor_sha256 }
      }
      if (row.state !== input.expected_state) throw adapterError("integrity_failed")
      const event = this.#eventV2(store, "RESULT_PERSISTED", row.dispatch_id,
        input.canonical_intent_sha256, {
          sandbox_prepare_anchor_sha256: input.sandbox_prepare_anchor_sha256,
          effect_claim_sha256: input.effect_claim_sha256,
          dispatch_intent_anchor_sha256: input.dispatch_intent_anchor_sha256,
          authorization_consumption_receipt_sha256: input.authorization_consumption_receipt_sha256,
          claim_fence_sha256: input.claim_fence_sha256,
          lease_epoch: input.lease_epoch,
          provider_fingerprint_sha256: input.provider_fingerprint_sha256,
          provider_dispatch_anchor_sha256: input.provider_dispatch_anchor_sha256,
          provider_allocation_sha256: input.provider_allocation_sha256,
          result_bundle_sha256: input.result_bundle_sha256,
          checkpoint_handoff_sha256: input.checkpoint_handoff_sha256,
        })
      const changed = await session.query<{ changed: number }>(
        `SELECT ${SCHEMA}.mark_result_persisted_intent_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) AS changed`,
        [input.dispatch_id, input.canonical_intent_sha256, input.sandbox_prepare_anchor_sha256,
          input.effect_claim_sha256, input.dispatch_intent_anchor_sha256,
          input.authorization_consumption_receipt_sha256, input.claim_fence_sha256,
          input.lease_epoch, input.expected_state, input.provider_fingerprint_sha256,
          input.provider_dispatch_anchor_sha256, input.provider_allocation_sha256,
          input.result_bundle_sha256, input.checkpoint_handoff_sha256, ...this.#eventParameters(event)],
      )
      if (Number(changed[0]?.changed) !== 1) throw adapterError("integrity_failed")
      return { event, resultPersistedAnchorSha256: event.anchorSha256 }
    })
    if (result.event !== undefined) await this.#witness(result.event)
    return Object.freeze({ result_persisted_anchor_sha256: result.resultPersistedAnchorSha256 })
  }

  async bindAuthorizationAndMarkIntent(
    input: Parameters<DisposableTaskJournalPortV1["bindAuthorizationAndMarkIntent"]>[0],
  ) {
    this.#requireReady()
    assertText(input.dispatch_id)
    assertDigest(input.request_sha256)
    assertDigest(input.claim_fence_sha256)
    assertDigest(input.effect_claim_sha256)
    if (typeof input.lease_epoch !== "bigint" || input.lease_epoch < 1n) throw adapterError("validation_failed")
    assertDigest(input.authorization_receipt.receipt_sha256)
    const receiptBytes = asBytes(input.authorization_receipt.canonical_receipt_bytes)
    parseCanonicalBytes(receiptBytes)
    if (digestBytes(receiptBytes) !== input.authorization_receipt.receipt_sha256) throw adapterError("integrity_failed")
    await this.#healWitness()
    const result = await this.#serializable(async (session) => {
      await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      await session.query("SELECT pg_advisory_xact_lock(36711471343122002)")
      const store = await this.#store(session)
      this.#assertAppendable(store)
      const rows = await session.query<TaskRow>(
        `SELECT * FROM ${SCHEMA}.tasks WHERE dispatch_id = $1
          AND lease_expires_at > clock_timestamp()
          AND state IN ('PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED')`, [input.dispatch_id],
      )
      const row = rows[0]
      if (row === undefined || rows.length !== 1 || row.request_sha256 !== input.request_sha256 ||
        row.claim_fence_sha256 !== input.claim_fence_sha256 || dbBigint(row.lease_epoch) !== input.lease_epoch ||
        row.effect_claim_sha256 !== input.effect_claim_sha256) throw adapterError("integrity_failed")
      if (row.dispatch_intent_anchor_sha256 !== null) {
        if (row.authorization_consumption_receipt_sha256 !== input.authorization_receipt.receipt_sha256 ||
          row.authorization_receipt_bytes === null || !byteEqual(asBytes(row.authorization_receipt_bytes), receiptBytes)) {
          throw adapterError("integrity_failed")
        }
        return { event: undefined, anchor: row.dispatch_intent_anchor_sha256 as Digest }
      }
      if (dbBigint(row.allocation_lease_epoch) !== input.lease_epoch ||
        row.allocation_claim_fence_sha256 !== input.claim_fence_sha256 ||
        row.allocation_ownership_nonce_sha256 !== row.ownership_nonce_sha256) {
        throw adapterError("integrity_failed")
      }
      const event = this.#event(store, "DISPATCH_INTENT", input.dispatch_id, input.request_sha256, {
        authorization_consumption_receipt_sha256: input.authorization_receipt.receipt_sha256,
        effect_claim_sha256: input.effect_claim_sha256,
        effect_lease_epoch: input.lease_epoch,
        effect_claim_fence_sha256: input.claim_fence_sha256,
        effect_ownership_nonce_sha256: row.ownership_nonce_sha256,
      })
      const changed = await session.query<{ changed: number }>(
        `SELECT ${SCHEMA}.bind_authorization_and_mark_intent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS changed`,
        [input.dispatch_id, input.request_sha256, input.claim_fence_sha256, input.lease_epoch,
          input.effect_claim_sha256, receiptBytes, input.authorization_receipt.receipt_sha256,
          event.anchorSha256, ...this.#eventParameters(event)],
      )
      if (Number(changed[0]?.changed) !== 1) throw adapterError("integrity_failed")
      return { event, anchor: event.anchorSha256 }
    })
    if (result.event !== undefined) await this.#witness(result.event)
    return {
      authorization_consumption_receipt_sha256: input.authorization_receipt.receipt_sha256,
      dispatch_intent_anchor_sha256: result.anchor,
    }
  }

  async markDispatched(input: Parameters<DisposableTaskJournalPortV1["markDispatched"]>[0]) {
    this.#requireReady()
    for (const value of [input.request_sha256, input.claim_fence_sha256,
      input.provider_fingerprint_sha256, input.provider_metadata_scope_sha256]) assertDigest(value)
    assertText(input.dispatch_id)
    if (typeof input.lease_epoch !== "bigint" || input.lease_epoch < 1n) throw adapterError("validation_failed")
    await this.#assertClaim(input.dispatch_id, input.request_sha256, input.claim_fence_sha256, input.lease_epoch)
    const row = await this.#task(input.dispatch_id)
    if (row.dispatch_anchor_sha256 === undefined) throw adapterError("integrity_failed")
    await this.#transition("DISPATCHED", input.dispatch_id, input.request_sha256,
      input.claim_fence_sha256, {
        provider_fingerprint_sha256: input.provider_fingerprint_sha256,
        provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
      }, `SELECT ${SCHEMA}.mark_dispatched($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS changed`,
      [input.dispatch_id, input.request_sha256, input.claim_fence_sha256, input.lease_epoch,
        input.provider_fingerprint_sha256, input.provider_metadata_scope_sha256])
    return { dispatch_anchor_sha256: row.dispatch_anchor_sha256 as Digest }
  }

  async markResultPersisted(input: Parameters<DisposableTaskJournalPortV1["markResultPersisted"]>[0]) {
    this.#requireReady()
    for (const value of [input.request_sha256, input.claim_fence_sha256,
      input.result_bundle_sha256, input.checkpoint_handoff_sha256]) assertDigest(value)
    assertText(input.dispatch_id)
    if (typeof input.lease_epoch !== "bigint" || input.lease_epoch < 1n) throw adapterError("validation_failed")
    await this.#assertClaim(input.dispatch_id, input.request_sha256, input.claim_fence_sha256, input.lease_epoch)
    const resultAnchor = canonicalSha256({
      domain: "sandboxes.disposable-task-journal.result-persisted/v1",
      dispatch_id: input.dispatch_id,
      request_sha256: input.request_sha256,
      result_bundle_sha256: input.result_bundle_sha256,
      checkpoint_handoff_sha256: input.checkpoint_handoff_sha256,
    })
    await this.#transition("RESULT_PERSISTED", input.dispatch_id, input.request_sha256,
      input.claim_fence_sha256, {
        result_bundle_sha256: input.result_bundle_sha256,
        checkpoint_handoff_sha256: input.checkpoint_handoff_sha256,
        result_persisted_anchor_sha256: resultAnchor,
      }, `SELECT ${SCHEMA}.mark_result_persisted($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS changed`,
      [input.dispatch_id, input.request_sha256, input.claim_fence_sha256, input.lease_epoch,
        input.result_bundle_sha256, input.checkpoint_handoff_sha256, resultAnchor])
    return { result_persisted_anchor_sha256: resultAnchor }
  }

  async commitOutcome(input: Parameters<DisposableTaskJournalPortV1["commitOutcome"]>[0]): Promise<DisposableTaskJournalCompletedV1> {
    this.#requireReady()
    this.#validateTerminalInput(input)
    await this.#assertClaim(input.dispatch_id, input.request_sha256, input.claim_fence_sha256, input.lease_epoch)
    const existing = await this.#task(input.dispatch_id)
    if (input.execution_receipt !== null) exactExecutionReceipt(input.execution_receipt, existing)
    if (existing.state === "OUTCOME") {
      const stored = this.#terminal(existing) as DisposableTaskJournalCompletedV1
      const storedExecution = stored.execution_receipt === null ? null : canonicalJson(stored.execution_receipt)
      const candidateExecution = input.execution_receipt === null ? null : canonicalJson(input.execution_receipt)
      if (stored.outcome_kind !== input.outcome_kind || storedExecution !== candidateExecution ||
        stored.failure_code !== input.failure_code || stored.failure_evidence_sha256 !== input.failure_evidence_sha256) {
        throw adapterError("integrity_failed")
      }
      return stored
    }
    if (existing.state === "QUARANTINED") throw adapterError("integrity_failed")
    const executionBytes = input.execution_receipt === null ? null : canonicalBytes(input.execution_receipt)
    const executionSha = input.execution_receipt?.execution_receipt_core_sha256 ?? null
    const completedBasis = {
      kind: "outcome" as const,
      request_sha256: input.request_sha256,
      outcome_kind: input.outcome_kind,
      execution_receipt_sha256: executionSha,
      failure_code: input.failure_code,
      failure_evidence_sha256: input.failure_evidence_sha256,
    }
    const result = await this.#terminalTransition(
      "OUTCOME", input.dispatch_id, input.request_sha256, input.claim_fence_sha256,
      completedBasis, [input.lease_epoch, input.outcome_kind, executionBytes, executionSha, input.failure_code,
        input.failure_evidence_sha256, null, null],
    )
    return {
      kind: "outcome", request_sha256: input.request_sha256,
      outcome_kind: input.outcome_kind, execution_receipt: input.execution_receipt,
      failure_code: input.failure_code, failure_evidence_sha256: input.failure_evidence_sha256,
      canonical_anchor_bytes: result.anchorBytes, anchor_sha256: result.anchorSha256,
    }
  }

  async quarantine(input: Parameters<DisposableTaskJournalPortV1["quarantine"]>[0]): Promise<DisposableTaskJournalQuarantinedV1> {
    this.#requireReady()
    assertText(input.dispatch_id)
    assertText(input.quarantine_reason)
    for (const value of [input.request_sha256, input.claim_fence_sha256,
      input.quarantine_evidence_sha256]) assertDigest(value)
    if (typeof input.lease_epoch !== "bigint" || input.lease_epoch < 1n) throw adapterError("validation_failed")
    await this.#assertClaim(input.dispatch_id, input.request_sha256, input.claim_fence_sha256, input.lease_epoch)
    const existing = await this.#task(input.dispatch_id)
    if (existing.state === "QUARANTINED") {
      const stored = this.#terminal(existing) as DisposableTaskJournalQuarantinedV1
      if (stored.quarantine_reason !== input.quarantine_reason ||
        stored.quarantine_evidence_sha256 !== input.quarantine_evidence_sha256) throw adapterError("integrity_failed")
      return stored
    }
    if (existing.state === "OUTCOME") throw adapterError("integrity_failed")
    const result = await this.#terminalTransition(
      "QUARANTINED", input.dispatch_id, input.request_sha256, input.claim_fence_sha256,
      { kind: "quarantined", request_sha256: input.request_sha256,
        quarantine_reason: input.quarantine_reason,
        quarantine_evidence_sha256: input.quarantine_evidence_sha256 },
      [input.lease_epoch, null, null, null, null, null, input.quarantine_reason, input.quarantine_evidence_sha256],
    )
    return {
      kind: "quarantined", request_sha256: input.request_sha256,
      quarantine_reason: input.quarantine_reason,
      quarantine_evidence_sha256: input.quarantine_evidence_sha256,
      canonical_anchor_bytes: result.anchorBytes, anchor_sha256: result.anchorSha256,
    }
  }

  async close(): Promise<void> {
    this.#ready = false
    await Promise.all([this.#client.close(), this.#witnessAckClient.close()]).then(() => undefined)
  }

  async #transition(
    kind: string,
    dispatchId: string,
    requestSha256: Digest,
    fence: Digest,
    payload: unknown,
    statement: string,
    baseParameters: unknown[],
  ): Promise<void> {
    await this.#healWitness()
    const result = await this.#serializable(async (session) => {
      await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      await session.query("SELECT pg_advisory_xact_lock(36711471343122002)")
      const store = await this.#store(session)
      this.#assertAppendable(store)
      const event = this.#event(store, kind, dispatchId, requestSha256, { claim_fence_sha256: fence, ...payload as object })
      const rows = await session.query<{ changed: number }>(statement,
        [...baseParameters, ...this.#eventParameters(event)])
      const changed = Number(rows[0]?.changed)
      return { event: changed === 1 ? event : undefined }
    })
    if (result.event !== undefined) await this.#witness(result.event)
  }

  async #terminalTransition(
    state: "OUTCOME" | "QUARANTINED",
    dispatchId: string,
    requestSha256: Digest,
    fence: Digest,
    payload: unknown,
    terminalParameters: unknown[],
  ): Promise<SignedEvent> {
    await this.#healWitness()
    const event = await this.#serializable(async (session) => {
      await session.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
      await session.query("SELECT pg_advisory_xact_lock(36711471343122002)")
      const store = await this.#store(session)
      this.#assertAppendable(store)
      const signed = this.#event(store, state, dispatchId, requestSha256,
        { claim_fence_sha256: fence, ...payload as object })
      const rows = await session.query<{ changed: number }>(
        `SELECT ${SCHEMA}.commit_terminal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) AS changed`,
        [dispatchId, requestSha256, fence, terminalParameters[0], state, ...terminalParameters.slice(1),
          signed.anchorBytes, signed.anchorSha256, ...this.#eventParameters(signed, true)],
      )
      if (Number(rows[0]?.changed) !== 1) throw adapterError("integrity_failed")
      return signed
    })
    await this.#witness(event)
    return event
  }

  #event(
    store: StoreRow,
    kind: string,
    dispatchId: string,
    requestSha256: Digest,
    payload: unknown,
  ): SignedEvent {
    const sequence = dbBigint(store.head_sequence) + 1n
    const prior = store.head_frontier_sha256 as Digest | null
    const record = {
      schema_version: "sandboxes.disposable-task-journal-record/v1",
      journal_identity_sha256: this.#options.journal_identity_sha256,
      restore_domain_sha256: this.#options.restore_domain_sha256,
      record_kind: kind,
      dispatch_id: dispatchId,
      request_sha256: requestSha256,
      payload,
    }
    const recordBytes = canonicalBytes(record)
    const recordSha256 = digestBytes(recordBytes)
    const unsigned = {
      schema_version: "sandboxes.disposable-task-journal-anchor/v1",
      journal_identity_sha256: this.#options.journal_identity_sha256,
      restore_domain_sha256: this.#options.restore_domain_sha256,
      journal_sequence: sequence,
      prior_frontier_sha256: prior,
      record_sha256: recordSha256,
      signer_principal: this.#options.signer.signer_principal,
      signing_key_id: this.#options.signer.signing_key_id,
    }
    const frontier = canonicalSha256(unsigned)
    const signedBasis = { ...unsigned, frontier_sha256: frontier }
    const signature = this.#options.signer.sign(canonicalBytes(signedBasis))
    if (signature.byteLength !== 64) throw adapterError("integrity_failed")
    const anchor = { ...signedBasis, signature_base64url: Buffer.from(signature).toString("base64url"), record }
    const anchorBytes = canonicalBytes(anchor)
    return {
      sequence, prior, frontier, kind, dispatchId, requestSha256,
      recordBytes, recordSha256, anchorBytes, anchorSha256: digestBytes(anchorBytes),
    }
  }

  #eventV2(
    store: StoreRow,
    kind: string,
    dispatchId: string,
    canonicalIntentSha256: Digest,
    payload: unknown,
  ): SignedEvent {
    const sequence = dbBigint(store.head_sequence) + 1n
    const prior = store.head_frontier_sha256 as Digest | null
    const record = {
      schema_version: "sandboxes.disposable-task-journal-record/v2",
      journal_identity_sha256: this.#options.journal_identity_sha256,
      restore_domain_sha256: this.#options.restore_domain_sha256,
      record_kind: kind,
      dispatch_id: dispatchId,
      canonical_intent_sha256: canonicalIntentSha256,
      payload,
    }
    const recordBytes = canonicalBytes(record)
    const recordSha256 = digestBytes(recordBytes)
    const unsigned = {
      schema_version: "sandboxes.disposable-task-journal-anchor/v2",
      journal_identity_sha256: this.#options.journal_identity_sha256,
      restore_domain_sha256: this.#options.restore_domain_sha256,
      journal_sequence: sequence,
      prior_frontier_sha256: prior,
      record_sha256: recordSha256,
      signer_principal: this.#options.signer.signer_principal,
      signing_key_id: this.#options.signer.signing_key_id,
    }
    const frontier = canonicalSha256(unsigned)
    const signedBasis = { ...unsigned, frontier_sha256: frontier }
    const signature = this.#options.signer.sign(canonicalBytes(signedBasis))
    if (signature.byteLength !== 64) throw adapterError("integrity_failed")
    const anchor = { ...signedBasis, signature_base64url: Buffer.from(signature).toString("base64url"), record }
    const anchorBytes = canonicalBytes(anchor)
    return {
      sequence, prior, frontier, kind, dispatchId, requestSha256: canonicalIntentSha256,
      recordBytes, recordSha256, anchorBytes, anchorSha256: digestBytes(anchorBytes),
    }
  }

  #eventParameters(event: SignedEvent, omitKind = false): unknown[] {
    const all = [event.sequence, event.prior, event.frontier, event.recordBytes,
      event.recordSha256, event.anchorBytes, event.anchorSha256]
    return omitKind ? [event.sequence, event.prior, event.frontier, event.kind,
      event.recordBytes, event.recordSha256, event.anchorBytes, event.anchorSha256] : all
  }

  async #witness(event: SignedEvent): Promise<void> {
    let current: DurableJournalWitnessReceiptV1 | null
    try {
      current = await this.#options.external_head_witness.readHead(this.#options.journal_identity_sha256)
    } catch {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    if (current?.sequence === event.sequence && current.frontier_sha256 === event.frontier) {
      this.#verifyWitnessReceipt(current, event)
      await this.#ackWitness(event, current)
      return
    }
    const expectedSequence = event.sequence - 1n
    if ((current?.sequence ?? 0n) !== expectedSequence ||
      (current?.frontier_sha256 ?? null) !== event.prior) throw adapterError("integrity_failed")
    let advanced: DurableJournalWitnessReceiptV1
    try {
      advanced = await this.#options.external_head_witness.compareAndAdvance({
        journal_identity_sha256: this.#options.journal_identity_sha256,
        expected_sequence: expectedSequence,
        expected_frontier_sha256: event.prior,
        successor_sequence: event.sequence,
        successor_frontier_sha256: event.frontier,
        signed_anchor_bytes: event.anchorBytes,
      })
    } catch {
      let reconciled: DurableJournalWitnessReceiptV1 | null
      try {
        reconciled = await this.#options.external_head_witness.readHead(
          this.#options.journal_identity_sha256,
        )
      } catch {
        throw adapterError("provider_state_unknown", { quarantineRequired: true })
      }
      if (reconciled?.sequence === event.sequence &&
        reconciled.frontier_sha256 === event.frontier) {
        this.#verifyWitnessReceipt(reconciled, event)
        await this.#ackWitness(event, reconciled)
        return
      }
      if ((reconciled?.sequence ?? 0n) !== expectedSequence ||
        (reconciled?.frontier_sha256 ?? null) !== event.prior) {
        throw adapterError("integrity_failed")
      }
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    if (advanced.sequence !== event.sequence || advanced.frontier_sha256 !== event.frontier) {
      throw adapterError("integrity_failed")
    }
    this.#verifyWitnessReceipt(advanced, event)
    await this.#ackWitness(event, advanced)
  }

  #verifyWitnessReceipt(receipt: DurableJournalWitnessReceiptV1, event: SignedEvent): void {
    const receiptBytes = asBytes(receipt.canonical_receipt_bytes)
    if (digestBytes(receiptBytes) !== receipt.receipt_sha256 || receipt.sequence !== event.sequence ||
      receipt.frontier_sha256 !== event.frontier) throw adapterError("integrity_failed")
    const value = parseCanonicalBytes(receiptBytes)
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw adapterError("integrity_failed")
    const record = value as Record<string, unknown>
    const signatureText = record.signature_base64url
    if (!exactKeys(record, ["schema_version", "witness_identity_sha256", "restore_domain_sha256",
      "journal_identity_sha256", "expected_sequence", "expected_frontier_sha256", "sequence",
      "frontier_sha256", "signed_anchor_sha256", "signing_key_id", "signature_base64url"]) ||
      record.schema_version !== "sandboxes.durable-journal-witness-receipt/v1" ||
      record.witness_identity_sha256 !== this.#options.external_head_witness.describe().witness_identity_sha256 ||
      record.restore_domain_sha256 !== this.#options.external_head_witness.describe().restore_domain_sha256 ||
      record.journal_identity_sha256 !== this.#options.journal_identity_sha256 ||
      record.expected_sequence !== event.sequence - 1n || record.expected_frontier_sha256 !== event.prior ||
      record.sequence !== event.sequence || record.frontier_sha256 !== event.frontier ||
      record.signed_anchor_sha256 !== event.anchorSha256 ||
      record.signing_key_id !== this.#options.witness_receipt_verifier.signing_key_id ||
      typeof signatureText !== "string") throw adapterError("integrity_failed")
    const { signature_base64url: _signature, ...unsigned } = record
    let signature: Uint8Array
    try {
      signature = Uint8Array.from(Buffer.from(signatureText, "base64url"))
      if (Buffer.from(signature).toString("base64url") !== signatureText) throw adapterError("integrity_failed")
    } catch { throw adapterError("integrity_failed") }
    if (signature.byteLength !== 64 ||
      !this.#options.witness_receipt_verifier.verify(canonicalBytes(unsigned), signature)) {
      throw adapterError("integrity_failed")
    }
  }

  async #ackWitness(event: SignedEvent, receipt: DurableJournalWitnessReceiptV1): Promise<void> {
    await this.#witnessAckClient.query(
      `SELECT ${SCHEMA}.acknowledge_witness($1,$2,$3,$4)`,
      [event.sequence, event.frontier, receipt.canonical_receipt_bytes, receipt.receipt_sha256],
    )
  }

  async #eventRows(sequence?: bigint): Promise<EventRow[]> {
    const filter = sequence === undefined ? "" : " WHERE journal_sequence = $1"
    const parameters = sequence === undefined ? [] : [sequence]
    if (!this.#hasV2) {
      return this.#client.query<EventRow>(`SELECT journal_sequence, prior_frontier_sha256,
        frontier_sha256, record_kind, dispatch_id, request_sha256, record_bytes,
        record_sha256, signed_anchor_bytes, signed_anchor_sha256, 1 AS journal_version
        FROM ${SCHEMA}.events${filter} ORDER BY journal_sequence`, parameters)
    }
    return this.#client.query<EventRow>(`SELECT * FROM (
      SELECT journal_sequence, prior_frontier_sha256, frontier_sha256, record_kind,
        dispatch_id, request_sha256, record_bytes, record_sha256,
        signed_anchor_bytes, signed_anchor_sha256, 1 AS journal_version
      FROM ${SCHEMA}.events
      UNION ALL
      SELECT journal_sequence, prior_frontier_sha256, frontier_sha256, record_kind,
        dispatch_id, canonical_intent_sha256 AS request_sha256, record_bytes, record_sha256,
        signed_anchor_bytes, signed_anchor_sha256, 2 AS journal_version
      FROM ${SCHEMA}.events_v2
    ) journal${filter} ORDER BY journal_sequence`, parameters)
  }

  async #healWitness(): Promise<void> {
    const store = await this.#store(this.#client)
    const head = dbBigint(store.head_sequence)
    const witnessed = dbBigint(store.witnessed_sequence)
    let external: DurableJournalWitnessReceiptV1 | null
    try {
      external = await this.#options.external_head_witness.readHead(this.#options.journal_identity_sha256)
    } catch {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    if (head === witnessed) {
      if ((external?.sequence ?? 0n) !== witnessed ||
        (external?.frontier_sha256 ?? null) !== store.witnessed_frontier_sha256) {
        throw adapterError("integrity_failed")
      }
      if (head === 0n) {
        if (store.witness_receipt_bytes !== null || store.witness_receipt_sha256 !== null || external !== null) {
          throw adapterError("integrity_failed")
        }
      } else {
        const eventRows = await this.#eventRows(head)
        const row = eventRows[0]
        if (row === undefined || external === null || store.witness_receipt_bytes === null ||
          store.witness_receipt_sha256 !== external.receipt_sha256 ||
          !byteEqual(asBytes(store.witness_receipt_bytes), external.canonical_receipt_bytes)) throw adapterError("integrity_failed")
        this.#verifyEvent(row, store)
        this.#verifyWitnessReceipt(external, {
          sequence: head, prior: row.prior_frontier_sha256 as Digest | null,
          frontier: row.frontier_sha256 as Digest, kind: row.record_kind,
          dispatchId: row.dispatch_id, requestSha256: row.request_sha256 as Digest,
          recordBytes: asBytes(row.record_bytes), recordSha256: row.record_sha256 as Digest,
          anchorBytes: asBytes(row.signed_anchor_bytes), anchorSha256: row.signed_anchor_sha256 as Digest,
        })
      }
      return
    }
    if (head !== witnessed + 1n) throw adapterError("integrity_failed")
    const rows = await this.#eventRows(head)
    const event = rows[0]
    if (event === undefined) throw adapterError("integrity_failed")
    this.#verifyEvent(event, store)
    await this.#witness({
      sequence: head,
      prior: event.prior_frontier_sha256 as Digest | null,
      frontier: event.frontier_sha256 as Digest,
      kind: event.record_kind,
      dispatchId: event.dispatch_id,
      requestSha256: event.request_sha256 as Digest,
      recordBytes: asBytes(event.record_bytes),
      recordSha256: event.record_sha256 as Digest,
      anchorBytes: asBytes(event.signed_anchor_bytes),
      anchorSha256: event.signed_anchor_sha256 as Digest,
    })
  }

  #verifyEvent(row: EventRow, store: StoreRow): void {
    const recordBytes = asBytes(row.record_bytes)
    const anchorBytes = asBytes(row.signed_anchor_bytes)
    if (digestBytes(recordBytes) !== row.record_sha256 || digestBytes(anchorBytes) !== row.signed_anchor_sha256) {
      throw adapterError("integrity_failed")
    }
    const value = parseCanonicalBytes(anchorBytes)
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw adapterError("integrity_failed")
    const anchor = value as Record<string, unknown>
    const signatureText = anchor.signature_base64url
    const record = anchor.record
    const version = dbBigint(row.journal_version ?? 1)
    const recordKeys = version === 2n
      ? ["schema_version", "journal_identity_sha256", "restore_domain_sha256",
          "record_kind", "dispatch_id", "canonical_intent_sha256", "payload"]
      : ["schema_version", "journal_identity_sha256", "restore_domain_sha256",
          "record_kind", "dispatch_id", "request_sha256", "payload"]
    if (!exactKeys(anchor, ["schema_version", "journal_identity_sha256", "restore_domain_sha256",
      "journal_sequence", "prior_frontier_sha256", "record_sha256", "signer_principal",
      "signing_key_id", "frontier_sha256", "signature_base64url", "record"]) ||
      anchor.schema_version !== `sandboxes.disposable-task-journal-anchor/v${version.toString(10)}` ||
      typeof signatureText !== "string" || record === null || typeof record !== "object" || Array.isArray(record) ||
      !exactKeys(record, recordKeys) ||
      (record as Record<string, unknown>).schema_version !==
        `sandboxes.disposable-task-journal-record/v${version.toString(10)}` ||
      (record as Record<string, unknown>).record_kind !== row.record_kind ||
      (record as Record<string, unknown>).dispatch_id !== row.dispatch_id ||
      (version === 1n
        ? (record as Record<string, unknown>).request_sha256
        : (record as Record<string, unknown>).canonical_intent_sha256) !== row.request_sha256 ||
      canonicalSha256(record) !== row.record_sha256 || anchor.journal_sequence !== dbBigint(row.journal_sequence) ||
      anchor.prior_frontier_sha256 !== row.prior_frontier_sha256 || anchor.frontier_sha256 !== row.frontier_sha256 ||
      anchor.journal_identity_sha256 !== store.journal_identity_sha256 ||
      anchor.restore_domain_sha256 !== store.restore_domain_sha256 ||
      anchor.signer_principal !== store.signer_principal || anchor.signing_key_id !== store.signing_key_id) {
      throw adapterError("integrity_failed")
    }
    const { signature_base64url: _signature, record: _record, frontier_sha256: frontier, ...unsigned } = anchor
    if (canonicalSha256(unsigned) !== frontier) throw adapterError("integrity_failed")
    let signature: Uint8Array
    try {
      signature = Uint8Array.from(Buffer.from(signatureText, "base64url"))
      if (Buffer.from(signature).toString("base64url") !== signatureText) throw adapterError("integrity_failed")
    } catch { throw adapterError("integrity_failed") }
    if (signature.byteLength !== 64 ||
      !this.#options.verifier.verify(canonicalBytes({ ...unsigned, frontier_sha256: frontier }), signature)) {
      throw adapterError("integrity_failed")
    }
  }

  async #verifyCatalog(): Promise<void> {
    const migrations = await this.#client.query<{ migration_name: string; checksum_sha256: string }>(
      `SELECT migration_name, checksum_sha256 FROM ${SCHEMA}.schema_migrations ORDER BY migration_name`,
    )
    const v1Checksum = MIGRATION_SHA256
    const v2Checksum = MIGRATION_V2_SHA256
    const v2EffectsChecksum = MIGRATION_V2_EFFECTS_SHA256
    const hasV2 = migrations.length === 3 && migrations[0]?.migration_name === MIGRATION_NAME &&
      migrations[0].checksum_sha256 === v1Checksum && migrations[1]?.migration_name === MIGRATION_V2_NAME &&
      migrations[1].checksum_sha256 === v2Checksum &&
      migrations[2]?.migration_name === MIGRATION_V2_EFFECTS_NAME &&
      migrations[2].checksum_sha256 === v2EffectsChecksum
    const hasOnlyV1 = migrations.length === 1 && migrations[0]?.migration_name === MIGRATION_NAME &&
      migrations[0].checksum_sha256 === v1Checksum
    if (!hasV2 && !hasOnlyV1) throw adapterError("integrity_failed")
    this.#hasV2 = hasV2
    const expectedTables: readonly string[] = hasV2 ? EXPECTED_TABLES_V2 : EXPECTED_TABLES
    const expectedFunctions: readonly string[] = hasV2 ? EXPECTED_FUNCTIONS_V2 : EXPECTED_FUNCTIONS
    const owners = await this.#client.query<{ database_owner: string; schema_owner: string }>(`
      SELECT database_owner.rolname::text AS database_owner, schema_owner.rolname::text AS schema_owner
      FROM pg_catalog.pg_database database
      JOIN pg_catalog.pg_roles database_owner ON database_owner.oid = database.datdba
      JOIN pg_catalog.pg_namespace namespace ON namespace.nspname = '${SCHEMA}'
      JOIN pg_catalog.pg_roles schema_owner ON schema_owner.oid = namespace.nspowner
      WHERE database.datname = current_database()`)
    if (owners.length !== 1 || owners[0]!.database_owner !== this.#options.expected_migration_role ||
      owners[0]!.schema_owner !== this.#options.expected_migration_role) throw adapterError("integrity_failed")
    const databaseAcls = await this.#client.query<{
      grantee: string; privilege_type: string; is_grantable: boolean
    }>(`SELECT COALESCE(grantee.rolname::text, 'PUBLIC') AS grantee,
        acl.privilege_type::text AS privilege_type, acl.is_grantable
      FROM pg_catalog.pg_database database
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        database.datacl, pg_catalog.acldefault('d', database.datdba)
      )) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
      WHERE database.datname = current_database()`)
    if (!exactStringSet(databaseAcls.map((row) =>
      `${row.grantee}:${row.privilege_type}:${String(row.is_grantable)}`), [
      `${this.#options.expected_migration_role}:CONNECT:false`,
      `${this.#options.expected_migration_role}:CREATE:false`,
      `${this.#options.expected_migration_role}:TEMPORARY:false`,
      `${this.#options.expected_runtime_role}:CONNECT:false`,
      `${this.#options.expected_witness_acknowledgement_role}:CONNECT:false`,
    ])) throw adapterError("integrity_failed")

    const relations = await this.#client.query(`SELECT relation.relname, relation.relkind,
        relation.relpersistence, access_method.amname AS access_method,
        relation.relrowsecurity, relation.relforcerowsecurity
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_am access_method ON access_method.oid = relation.relam
      WHERE namespace.nspname = '${SCHEMA}' AND relation.relkind = 'r' ORDER BY relation.relname`)
    const relationsDigest = digestBytes(bytes(JSON.stringify(relations)))
    if (relationsDigest !==
      (hasV2 ? CATALOG_RELATIONS_V2_SHA256 : CATALOG_RELATIONS_SHA256)) {
      throw adapterError("integrity_failed")
    }
    const relationOwners = await this.#client.query<{ relname: string; owner: string }>(`
      SELECT relation.relname::text AS relname, owner.rolname::text AS owner
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = relation.relowner
      WHERE namespace.nspname = '${SCHEMA}' AND relation.relkind = 'r' ORDER BY relation.relname`)
    if (!exactStringSet(relationOwners.map((row) => row.relname), expectedTables) ||
      relationOwners.some((row) => row.owner !== this.#options.expected_migration_role)) {
      throw adapterError("integrity_failed")
    }

    const columns = await this.#client.query(`SELECT relation.relname, attribute.attnum,
        attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type,
        attribute.attnotnull,
        COALESCE(pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid), '') AS default_expr,
        attribute.attidentity, attribute.attgenerated, COALESCE(attribute.attacl::text, '') AS attacl
      FROM pg_catalog.pg_attribute attribute
      JOIN pg_catalog.pg_class relation ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef default_value
        ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
      WHERE namespace.nspname = '${SCHEMA}' AND relation.relkind = 'r'
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
      ORDER BY relation.relname, attribute.attnum`)
    const columnsDigest = digestBytes(bytes(JSON.stringify(columns)))
    if (columnsDigest !==
      (hasV2 ? CATALOG_COLUMNS_V2_SHA256 : CATALOG_COLUMNS_SHA256)) throw adapterError("integrity_failed")

    const constraints = await this.#client.query(`SELECT relation.relname, constraint_row.conname,
        constraint_row.contype, constraint_row.condeferrable, constraint_row.condeferred,
        constraint_row.convalidated, pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
      FROM pg_catalog.pg_constraint constraint_row
      JOIN pg_catalog.pg_class relation ON relation.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = '${SCHEMA}' ORDER BY relation.relname, constraint_row.conname`)
    const constraintsDigest = digestBytes(bytes(JSON.stringify(constraints)))
    if (constraintsDigest !==
      (hasV2 ? CATALOG_CONSTRAINTS_V2_SHA256 : CATALOG_CONSTRAINTS_SHA256)) throw adapterError("integrity_failed")

    const indexes = await this.#client.query(`SELECT relation.relname, index_relation.relname AS index_name,
        index_row.indisunique, index_row.indisprimary, index_row.indisvalid, index_row.indisready,
        pg_catalog.pg_get_indexdef(index_relation.oid) AS definition
      FROM pg_catalog.pg_index index_row
      JOIN pg_catalog.pg_class relation ON relation.oid = index_row.indrelid
      JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = '${SCHEMA}' ORDER BY relation.relname, index_relation.relname`)
    const indexesDigest = digestBytes(bytes(JSON.stringify(indexes)))
    if (indexesDigest !==
      (hasV2 ? CATALOG_INDEXES_V2_SHA256 : CATALOG_INDEXES_SHA256)) throw adapterError("integrity_failed")

    const functions = await this.#client.query<{ identity: string; owner: string }>(`
      SELECT procedure.proname::text || '(' || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' AS identity,
        owner.rolname::text AS owner, language.lanname AS language, procedure.prosecdef,
        procedure.proconfig, pg_catalog.pg_get_functiondef(procedure.oid) AS definition
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = procedure.proowner
      JOIN pg_catalog.pg_language language ON language.oid = procedure.prolang
      WHERE namespace.nspname = '${SCHEMA}' ORDER BY identity`)
    const functionsDigest = digestBytes(bytes(JSON.stringify(functions.map(({ owner: _owner, ...row }) => row))))
    if (!exactStringSet(functions.map((row) => row.identity), expectedFunctions) ||
      functions.some((row) => row.owner !== this.#options.expected_migration_role) ||
      functionsDigest !==
        (hasV2 ? CATALOG_FUNCTIONS_V2_SHA256 : CATALOG_FUNCTIONS_SHA256)) {
      throw adapterError("integrity_failed")
    }

    const triggers = await this.#client.query(`SELECT trigger.tgname, relation.relname AS relation_name,
        trigger.tgenabled, trigger.tgisinternal, procedure.proname AS function_name,
        pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition
      FROM pg_catalog.pg_trigger trigger
      JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_proc procedure ON procedure.oid = trigger.tgfoid
      WHERE namespace.nspname = '${SCHEMA}' AND NOT trigger.tgisinternal ORDER BY trigger.tgname`)
    const triggersDigest = digestBytes(bytes(JSON.stringify(triggers)))
    if (triggersDigest !==
      (hasV2 ? CATALOG_TRIGGERS_V2_SHA256 : CATALOG_TRIGGERS_SHA256)) throw adapterError("integrity_failed")

    const relationAcls = await this.#client.query<{
      relname: string; grantee: string; privilege_type: string; is_grantable: boolean
    }>(`SELECT relation.relname::text AS relname, COALESCE(grantee.rolname::text, 'PUBLIC') AS grantee,
        acl.privilege_type::text AS privilege_type, acl.is_grantable
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl,
        pg_catalog.acldefault('r', relation.relowner))) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
      WHERE namespace.nspname = '${SCHEMA}' AND relation.relkind = 'r'`)
    const ownerPrivileges = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
    const expectedRelationAcls = expectedTables.flatMap((table) => [
      ...ownerPrivileges.map((privilege) => `${table}:${this.#options.expected_migration_role}:${privilege}:false`),
      ...(["events", "schema_migrations", "store", "tasks", "events_v2", "tasks_v2"].includes(table)
        ? [`${table}:${this.#options.expected_runtime_role}:SELECT:false`] : []),
    ])
    if (!exactStringSet(relationAcls.map((row) =>
      `${row.relname}:${row.grantee}:${row.privilege_type}:${String(row.is_grantable)}`), expectedRelationAcls)) {
      throw adapterError("integrity_failed")
    }

    const schemaAcls = await this.#client.query<{ grantee: string; privilege_type: string; is_grantable: boolean }>(`
      SELECT COALESCE(grantee.rolname::text, 'PUBLIC') AS grantee,
        acl.privilege_type::text AS privilege_type, acl.is_grantable
      FROM pg_catalog.pg_namespace namespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl,
        pg_catalog.acldefault('n', namespace.nspowner))) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee WHERE namespace.nspname = '${SCHEMA}'`)
    if (!exactStringSet(schemaAcls.map((row) =>
      `${row.grantee}:${row.privilege_type}:${String(row.is_grantable)}`), [
      `${this.#options.expected_migration_role}:CREATE:false`, `${this.#options.expected_migration_role}:USAGE:false`,
      `${this.#options.expected_runtime_role}:USAGE:false`,
      `${this.#options.expected_witness_acknowledgement_role}:USAGE:false`,
    ])) throw adapterError("integrity_failed")

    const functionAcls = await this.#client.query<{
      identity: string; grantee: string; privilege_type: string; is_grantable: boolean
    }>(`SELECT procedure.proname::text || '(' || pg_catalog.oidvectortypes(procedure.proargtypes) || ')' AS identity,
        COALESCE(grantee.rolname::text, 'PUBLIC') AS grantee,
        acl.privilege_type::text AS privilege_type, acl.is_grantable
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner))) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee WHERE namespace.nspname = '${SCHEMA}'`)
    const runtimeFunctions = new Set(expectedFunctions.filter((identity) =>
      !identity.startsWith("acknowledge_witness(") && !identity.startsWith("append_event(") &&
      !identity.startsWith("append_event_v2(") && identity !== "reject_mutation()" &&
      identity !== "guard_task_v2_update()"))
    const expectedFunctionAcls = expectedFunctions.flatMap((identity) => [
      `${identity}:${this.#options.expected_migration_role}:EXECUTE:false`,
      ...(runtimeFunctions.has(identity) ? [`${identity}:${this.#options.expected_runtime_role}:EXECUTE:false`] : []),
      ...(identity.startsWith("acknowledge_witness(")
        ? [`${identity}:${this.#options.expected_witness_acknowledgement_role}:EXECUTE:false`] : []),
    ])
    if (!exactStringSet(functionAcls.map((row) =>
      `${row.identity}:${row.grantee}:${row.privilege_type}:${String(row.is_grantable)}`), expectedFunctionAcls)) {
      throw adapterError("integrity_failed")
    }

  }

  async #assertReady(identity: JournalSessionIdentity): Promise<void> {
    await this.#verifyCatalog()
    const store = await this.#store(this.#client)
    const witness = this.#options.external_head_witness.describe()
    if (store.journal_cluster_system_identifier !==
        this.#options.expected_journal_cluster_system_identifier ||
      store.journal_database_name !== this.#options.expected_database ||
      dbBigint(store.journal_database_oid) !== dbBigint(identity.database_oid) ||
      store.journal_identity_sha256 !== this.#options.journal_identity_sha256 ||
      store.restore_domain_sha256 !== this.#options.restore_domain_sha256 ||
      store.external_head_witness_sha256 !== witness.witness_identity_sha256 ||
      store.witness_verification_key_sha256 !== this.#options.witness_receipt_verifier.verification_key_sha256 ||
      store.encrypted_at_rest !== true || store.signer_principal !== this.#options.signer.signer_principal ||
      store.signing_key_id !== this.#options.signer.signing_key_id ||
      store.verification_key_sha256 !== this.#options.signer.verification_key_sha256) {
      throw adapterError("integrity_failed")
    }
    const privileges = await this.#client.query<{
      schema_create: boolean; tasks_insert: boolean; tasks_update: boolean; tasks_delete: boolean
      events_insert: boolean; events_update: boolean; events_delete: boolean
    }>(`SELECT
      has_schema_privilege(current_user, '${SCHEMA}', 'CREATE') AS schema_create,
      has_table_privilege(current_user, '${SCHEMA}.tasks', 'INSERT') AS tasks_insert,
      has_table_privilege(current_user, '${SCHEMA}.tasks', 'UPDATE') AS tasks_update,
      has_table_privilege(current_user, '${SCHEMA}.tasks', 'DELETE') AS tasks_delete,
      has_table_privilege(current_user, '${SCHEMA}.events', 'INSERT') AS events_insert,
      has_table_privilege(current_user, '${SCHEMA}.events', 'UPDATE') AS events_update,
      has_table_privilege(current_user, '${SCHEMA}.events', 'DELETE') AS events_delete`)
    const privilege = privileges[0]
    if (privilege === undefined || privilege.schema_create || privilege.tasks_insert || privilege.tasks_update ||
      privilege.tasks_delete || privilege.events_insert || privilege.events_update || privilege.events_delete) {
      throw adapterError("integrity_failed")
    }
    const runtimeFunctions = await this.#client.query<{
      can_ack: boolean; can_append_internal: boolean; public_can_ack: boolean
    }>(`SELECT
      has_function_privilege(current_user, '${SCHEMA}.acknowledge_witness(bigint,text,bytea,text)', 'EXECUTE') AS can_ack,
      has_function_privilege(current_user, '${SCHEMA}.append_event(bigint,text,text,text,text,text,bytea,text,bytea,text)', 'EXECUTE') AS can_append_internal,
      has_function_privilege('public', '${SCHEMA}.acknowledge_witness(bigint,text,bytea,text)', 'EXECUTE') AS public_can_ack`)
    if (runtimeFunctions[0]?.can_ack !== false || runtimeFunctions[0]?.can_append_internal !== false ||
      runtimeFunctions[0]?.public_can_ack !== false) throw adapterError("integrity_failed")
    const witnessPrivileges = await this.#witnessAckClient.query<{
      can_ack: boolean; can_prepare: boolean; tasks_select: boolean; schema_create: boolean
    }>(`SELECT
      has_function_privilege(current_user, '${SCHEMA}.acknowledge_witness(bigint,text,bytea,text)', 'EXECUTE') AS can_ack,
      has_function_privilege(current_user,
        '${SCHEMA}.insert_prepared(text,text,text,text,bytea,bytea,text,text,text,text,text,text,text,text,text,text,text,bigint,text,text,timestamptz,bigint,text,text,bytea,text,bytea,text)',
        'EXECUTE') AS can_prepare,
      has_table_privilege(current_user, '${SCHEMA}.tasks', 'SELECT') AS tasks_select,
      has_schema_privilege(current_user, '${SCHEMA}', 'CREATE') AS schema_create`)
    if (witnessPrivileges[0]?.can_ack !== true || witnessPrivileges[0]?.can_prepare !== false ||
      witnessPrivileges[0]?.tasks_select !== false || witnessPrivileges[0]?.schema_create !== false) {
      throw adapterError("integrity_failed")
    }
    if (this.#hasV2) {
      const v2Privileges = await this.#client.query<{
        tasks_insert: boolean; tasks_update: boolean; tasks_delete: boolean
        events_insert: boolean; events_update: boolean; events_delete: boolean
        can_append: boolean; witness_tasks_select: boolean
      }>(`SELECT
        has_table_privilege(current_user, '${SCHEMA}.tasks_v2', 'INSERT') AS tasks_insert,
        has_table_privilege(current_user, '${SCHEMA}.tasks_v2', 'UPDATE') AS tasks_update,
        has_table_privilege(current_user, '${SCHEMA}.tasks_v2', 'DELETE') AS tasks_delete,
        has_table_privilege(current_user, '${SCHEMA}.events_v2', 'INSERT') AS events_insert,
        has_table_privilege(current_user, '${SCHEMA}.events_v2', 'UPDATE') AS events_update,
        has_table_privilege(current_user, '${SCHEMA}.events_v2', 'DELETE') AS events_delete,
        has_function_privilege(current_user,
          '${SCHEMA}.append_event_v2(bigint,text,text,text,text,text,bytea,text,bytea,text)', 'EXECUTE') AS can_append,
        has_table_privilege('${this.#options.expected_witness_acknowledgement_role}',
          '${SCHEMA}.tasks_v2', 'SELECT') AS witness_tasks_select`)
      const v2Privilege = v2Privileges[0]
      if (v2Privilege === undefined || v2Privilege.tasks_insert || v2Privilege.tasks_update ||
        v2Privilege.tasks_delete || v2Privilege.events_insert || v2Privilege.events_update ||
        v2Privilege.events_delete || v2Privilege.can_append || v2Privilege.witness_tasks_select) {
        throw adapterError("integrity_failed")
      }
    }
    const events = await this.#eventRows()
    if (BigInt(events.length) !== dbBigint(store.head_sequence)) throw adapterError("integrity_failed")
    let sequence = 1n
    let prior: string | null = null
    for (const event of events) {
      if (dbBigint(event.journal_sequence) !== sequence || event.prior_frontier_sha256 !== prior) {
        throw adapterError("integrity_failed")
      }
      this.#verifyEvent(event, store)
      prior = event.frontier_sha256
      sequence += 1n
    }
    if (prior !== store.head_frontier_sha256) throw adapterError("integrity_failed")
    const eventsV1 = events.filter((event) => dbBigint(event.journal_version ?? 1) === 1n)
    const eventsV2 = events.filter((event) => dbBigint(event.journal_version ?? 1) === 2n)
    const tasks = await this.#client.query<TaskRow>(`SELECT * FROM ${SCHEMA}.tasks ORDER BY dispatch_id`)
    const tasksByDispatch = new Map(tasks.map((task) => [task.dispatch_id, task]))
    const projected = new Map<string, TaskRow["state"]>()
    const bindings = new Map<string, Record<string, unknown>>()
    for (const event of eventsV1) {
      const task = tasksByDispatch.get(event.dispatch_id)
      if (task === undefined || task.request_sha256 !== event.request_sha256) throw adapterError("integrity_failed")
      const value = parseCanonicalBytes(asBytes(event.record_bytes))
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw adapterError("integrity_failed")
      const record = value as Record<string, unknown>
      if (record.dispatch_id !== event.dispatch_id || record.request_sha256 !== event.request_sha256 ||
        record.record_kind !== event.record_kind) throw adapterError("integrity_failed")
      const payload = record.payload
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw adapterError("integrity_failed")
      const eventBindings = payload as Record<string, unknown>
      const current = projected.get(event.dispatch_id)
      switch (event.record_kind) {
        case "PREPARED": {
          if (current !== undefined) throw adapterError("integrity_failed")
          if (eventBindings.idempotency_key_sha256 !== task.idempotency_key_sha256 ||
            eventBindings.operation_digest !== task.operation_digest || eventBindings.authority_envelope_sha256 !== task.authority_envelope_sha256 ||
            eventBindings.source_manifest_sha256 !== task.source_manifest_sha256 || eventBindings.input_manifest_sha256 !== task.input_manifest_sha256 ||
            eventBindings.provider !== task.provider || eventBindings.provider_metadata_scope_sha256 !== task.provider_metadata_scope_sha256 ||
            eventBindings.provider_creation_token_sha256 !== task.provider_creation_token_sha256 ||
            eventBindings.immutable_fingerprint_sha256 !== task.immutable_fingerprint_sha256 ||
            eventBindings.effect_claim_sha256 !== task.effect_claim_sha256 ||
            eventBindings.authority_consume_input_sha256 !== task.authority_consume_input_sha256 ||
            eventBindings.dispatch_anchor_sha256 !== task.dispatch_anchor_sha256) throw adapterError("integrity_failed")
          projected.set(event.dispatch_id, "PREPARED")
          bindings.set(event.dispatch_id, { ...eventBindings })
          break
        }
        case "CLAIMED": {
          if (!['PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED'].includes(String(current))) {
            throw adapterError("integrity_failed")
          }
          const projection = bindings.get(event.dispatch_id)
          const recoveryRecord = eventBindings.recovery_record
          if (projection === undefined || !exactKeys(eventBindings, [
            "prior_state", "lease_epoch", "claim_fence_sha256", "ownership_nonce_sha256",
            "lease_owner_sha256", "lease_expires_at", "recovery_record", "recovery_record_sha256",
          ]) || recoveryRecord === null || typeof recoveryRecord !== "object" || Array.isArray(recoveryRecord) ||
            eventBindings.prior_state !== current) throw adapterError("integrity_failed")
          const expectedRecoveryRecord = {
            schema_version: "sandboxes.disposable-task-recovery-anchor/v1",
            dispatch_id: event.dispatch_id,
            request_sha256: event.request_sha256,
            prior_state: current,
            effect_claim_sha256: projection.effect_claim_sha256,
            provider_effect_claim_fence_sha256: projection.effect_claim_fence_sha256 ??
              projection.allocation_claim_fence_sha256,
            provider_effect_lease_epoch: projection.effect_lease_epoch ?? projection.allocation_lease_epoch,
            provider_effect_ownership_nonce_sha256: projection.effect_ownership_nonce_sha256 ??
              projection.allocation_ownership_nonce_sha256,
            current_claim_fence_sha256: eventBindings.claim_fence_sha256,
            current_lease_epoch: eventBindings.lease_epoch,
            expected_provider_fingerprint_sha256: projection.provider_fingerprint_sha256 ?? null,
            expected_result_bundle_sha256: projection.result_bundle_sha256 ?? null,
            expected_checkpoint_handoff_sha256: projection.checkpoint_handoff_sha256 ?? null,
          }
          if (canonicalJson(recoveryRecord) !== canonicalJson(expectedRecoveryRecord) ||
            eventBindings.recovery_record_sha256 !== canonicalSha256(recoveryRecord)) {
            throw adapterError("integrity_failed")
          }
          Object.assign(projection, {
            lease_epoch: eventBindings.lease_epoch,
            claim_fence_sha256: eventBindings.claim_fence_sha256,
            ownership_nonce_sha256: eventBindings.ownership_nonce_sha256,
            lease_owner_sha256: eventBindings.lease_owner_sha256,
            lease_expires_at: eventBindings.lease_expires_at,
          })
          break
        }
        case "DISPATCH_INTENT": {
          if (current !== "PREPARED") throw adapterError("integrity_failed")
          const projection = bindings.get(event.dispatch_id)
          if (projection === undefined || eventBindings.effect_claim_sha256 !== projection.effect_claim_sha256) {
            throw adapterError("integrity_failed")
          }
          Object.assign(projection, eventBindings, { dispatch_intent_anchor_sha256: event.signed_anchor_sha256 })
          projected.set(event.dispatch_id, "DISPATCH_INTENT")
          break
        }
        case "DISPATCHED": {
          if (current !== "DISPATCH_INTENT") throw adapterError("integrity_failed")
          const projection = bindings.get(event.dispatch_id)
          if (projection === undefined) throw adapterError("integrity_failed")
          Object.assign(projection, eventBindings)
          projected.set(event.dispatch_id, "DISPATCHED")
          break
        }
        case "RESULT_PERSISTED":
          if (current !== "DISPATCHED") throw adapterError("integrity_failed")
          Object.assign(bindings.get(event.dispatch_id) ?? {}, eventBindings)
          projected.set(event.dispatch_id, "RESULT_PERSISTED")
          break
        case "OUTCOME":
          if (!['PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED'].includes(String(current))) {
            throw adapterError("integrity_failed")
          }
          if (task.outcome_anchor_sha256 !== event.signed_anchor_sha256) throw adapterError("integrity_failed")
          Object.assign(bindings.get(event.dispatch_id) ?? {}, eventBindings, {
            outcome_anchor_sha256: event.signed_anchor_sha256,
          })
          projected.set(event.dispatch_id, "OUTCOME")
          break
        case "QUARANTINED":
          if (!['PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED'].includes(String(current))) {
            throw adapterError("integrity_failed")
          }
          if (task.outcome_anchor_sha256 !== event.signed_anchor_sha256) throw adapterError("integrity_failed")
          Object.assign(bindings.get(event.dispatch_id) ?? {}, eventBindings, {
            outcome_anchor_sha256: event.signed_anchor_sha256,
          })
          projected.set(event.dispatch_id, "QUARANTINED")
          break
        default:
          throw adapterError("integrity_failed")
      }
    }
    if (tasks.length !== projected.size || tasks.some((task) => {
      const value = bindings.get(task.dispatch_id)
      if (projected.get(task.dispatch_id) !== task.state || value === undefined ||
        digestBytes(asBytes(task.canonical_request_bytes)) !== task.request_sha256) return true
      try { parseDisposableSandboxTaskRequestV1(parseCanonicalBytes(asBytes(task.canonical_request_bytes))) } catch { return true }
      try { this.#authorization(task) } catch { return true }
      if (task.effect_claim_sha256 !== canonicalSha256({
        schema_version: "sandboxes.disposable-task-effect-claim/v1",
        dispatch_id: task.dispatch_id,
        request_sha256: task.request_sha256,
        provider: task.provider,
        provider_metadata_scope_sha256: task.provider_metadata_scope_sha256,
        provider_creation_token_sha256: task.provider_creation_token_sha256,
        immutable_fingerprint_sha256: task.immutable_fingerprint_sha256,
        provider_effect_claim_fence_sha256: task.allocation_claim_fence_sha256,
        provider_effect_lease_epoch: dbBigint(task.allocation_lease_epoch),
        provider_effect_ownership_nonce_sha256: task.allocation_ownership_nonce_sha256,
      })) return true
      const exact: Array<[unknown, unknown]> = [
        [value.lease_epoch, dbBigint(task.lease_epoch)],
        [value.claim_fence_sha256, task.claim_fence_sha256],
        [value.ownership_nonce_sha256, task.ownership_nonce_sha256],
        [value.allocation_lease_epoch, dbBigint(task.allocation_lease_epoch)],
        [value.allocation_claim_fence_sha256, task.allocation_claim_fence_sha256],
        [value.allocation_ownership_nonce_sha256, task.allocation_ownership_nonce_sha256],
        [value.effect_claim_sha256, task.effect_claim_sha256],
        [value.dispatch_intent_anchor_sha256 ?? null, task.dispatch_intent_anchor_sha256],
        [value.lease_owner_sha256, task.lease_owner_sha256],
        [value.lease_expires_at, iso(task.lease_expires_at)],
        [value.authorization_consumption_receipt_sha256 ?? null, task.authorization_consumption_receipt_sha256],
        [value.provider_fingerprint_sha256 ?? null, task.provider_fingerprint_sha256],
        [value.effect_lease_epoch ?? null, task.effect_lease_epoch === null ? null : dbBigint(task.effect_lease_epoch)],
        [value.effect_claim_fence_sha256 ?? null, task.effect_claim_fence_sha256],
        [value.effect_ownership_nonce_sha256 ?? null, task.effect_ownership_nonce_sha256],
        [value.result_bundle_sha256 ?? null, task.result_bundle_sha256],
        [value.checkpoint_handoff_sha256 ?? null, task.checkpoint_handoff_sha256],
        [value.result_persisted_anchor_sha256 ?? null, task.result_persisted_anchor_sha256],
        [value.outcome_kind ?? null, task.outcome_kind],
        [value.execution_receipt_sha256 ?? null, task.execution_receipt_sha256],
        [value.failure_code ?? null, task.failure_code],
        [value.failure_evidence_sha256 ?? null, task.failure_evidence_sha256],
        [value.quarantine_reason ?? null, task.quarantine_reason],
        [value.quarantine_evidence_sha256 ?? null, task.quarantine_evidence_sha256],
        [value.outcome_anchor_sha256 ?? null, task.outcome_anchor_sha256],
      ]
      if (exact.some(([left, right]) => left !== right)) return true
      if ((task.authorization_receipt_bytes === null) !== (task.authorization_consumption_receipt_sha256 === null) ||
        (task.authorization_receipt_bytes !== null && digestBytes(asBytes(task.authorization_receipt_bytes)) !== task.authorization_consumption_receipt_sha256) ||
        (task.execution_receipt_bytes === null) !== (task.execution_receipt_sha256 === null)) return true
      if (task.execution_receipt_bytes !== null) {
        try {
          if (exactExecutionReceipt(parseCanonicalBytes(asBytes(task.execution_receipt_bytes)), task)
            .execution_receipt_core_sha256 !== task.execution_receipt_sha256) return true
        } catch { return true }
      }
      return false
    })) {
      throw adapterError("integrity_failed")
    }
    if (this.#hasV2) await this.#verifyProjectionV2(eventsV2)
    await this.#healWitness()
  }

  async #verifyProjectionV2(events: readonly EventRow[]): Promise<void> {
    const tasks = await this.#client.query<TaskRowV2>(`SELECT * FROM ${SCHEMA}.tasks_v2 ORDER BY dispatch_id`)
    const tasksByDispatch = new Map(tasks.map((task) => [task.dispatch_id, task]))
    const projected = new Map<string, TaskRowV2["state"]>()
    const bindings = new Map<string, Record<string, unknown>>()
    for (const event of events) {
      const task = tasksByDispatch.get(event.dispatch_id)
      if (task === undefined || task.canonical_intent_sha256 !== event.request_sha256) {
        throw adapterError("integrity_failed")
      }
      const value = parseCanonicalBytes(asBytes(event.record_bytes))
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw adapterError("integrity_failed")
      const record = value as Record<string, unknown>
      if (record.dispatch_id !== event.dispatch_id ||
        record.canonical_intent_sha256 !== event.request_sha256 || record.record_kind !== event.record_kind ||
        record.payload === null || typeof record.payload !== "object" || Array.isArray(record.payload)) {
        throw adapterError("integrity_failed")
      }
      const payload = record.payload as Record<string, unknown>
      const current = projected.get(event.dispatch_id)
      switch (event.record_kind) {
        case "PREPARED":
          if (current !== undefined || event.signed_anchor_sha256 !== task.sandbox_prepare_anchor_sha256 ||
            !exactKeys(payload, [
              "idempotency_key_sha256", "operation_digest", "source_manifest_sha256",
              "input_manifest_sha256", "checkpoint_policy_sha256", "provider",
              "provider_metadata_scope_sha256", "provider_creation_token_sha256",
              "immutable_fingerprint_sha256", "allocation_lease_epoch",
              "allocation_claim_fence_sha256", "allocation_ownership_nonce_sha256",
              "effect_claim_sha256", "lease_epoch", "claim_fence_sha256",
              "lease_owner_sha256", "lease_expires_at", "ownership_nonce_sha256",
            ])) throw adapterError("integrity_failed")
          for (const [left, right] of [
            [payload.idempotency_key_sha256, task.idempotency_key_sha256],
            [payload.operation_digest, task.operation_digest],
            [payload.source_manifest_sha256, task.source_manifest_sha256],
            [payload.input_manifest_sha256, task.input_manifest_sha256],
            [payload.checkpoint_policy_sha256, task.checkpoint_policy_sha256],
            [payload.provider, task.provider],
            [payload.provider_metadata_scope_sha256, task.provider_metadata_scope_sha256],
            [payload.provider_creation_token_sha256, task.provider_creation_token_sha256],
            [payload.immutable_fingerprint_sha256, task.immutable_fingerprint_sha256],
            [payload.allocation_lease_epoch, dbBigint(task.allocation_lease_epoch)],
            [payload.allocation_claim_fence_sha256, task.allocation_claim_fence_sha256],
            [payload.allocation_ownership_nonce_sha256, task.allocation_ownership_nonce_sha256],
            [payload.effect_claim_sha256, task.effect_claim_sha256],
          ]) if (left !== right) throw adapterError("integrity_failed")
          projected.set(event.dispatch_id, "PREPARED")
          bindings.set(event.dispatch_id, { ...payload })
          break
        case "CLAIMED": {
          if (!['PREPARED', 'DISPATCH_INTENT', 'DISPATCHED', 'RESULT_PERSISTED'].includes(String(current)) ||
            !exactKeys(payload, ["prior_state", "sandbox_prepare_anchor_sha256", "effect_claim_sha256",
              "lease_epoch", "claim_fence_sha256", "ownership_nonce_sha256", "lease_owner_sha256",
              "lease_expires_at", "expected_provider_fingerprint_sha256",
              "expected_provider_dispatch_anchor_sha256", "expected_provider_allocation_sha256",
              "expected_result_bundle_sha256", "expected_checkpoint_handoff_sha256",
              "expected_result_persisted_anchor_sha256"]) ||
            payload.prior_state !== current) throw adapterError("integrity_failed")
          const projection = bindings.get(event.dispatch_id)
          if (projection === undefined || payload.sandbox_prepare_anchor_sha256 !== task.sandbox_prepare_anchor_sha256 ||
            payload.effect_claim_sha256 !== task.effect_claim_sha256 ||
            payload.expected_provider_fingerprint_sha256 !== (projection.provider_fingerprint_sha256 ?? null) ||
            payload.expected_provider_dispatch_anchor_sha256 !== (projection.provider_dispatch_anchor_sha256 ?? null) ||
            payload.expected_provider_allocation_sha256 !== (projection.provider_allocation_sha256 ?? null) ||
            payload.expected_result_bundle_sha256 !== (projection.result_bundle_sha256 ?? null) ||
            payload.expected_checkpoint_handoff_sha256 !== (projection.checkpoint_handoff_sha256 ?? null) ||
            payload.expected_result_persisted_anchor_sha256 !==
              (projection.result_persisted_anchor_sha256 ?? null)) throw adapterError("integrity_failed")
          Object.assign(projection, {
            lease_epoch: payload.lease_epoch,
            claim_fence_sha256: payload.claim_fence_sha256,
            ownership_nonce_sha256: payload.ownership_nonce_sha256,
            lease_owner_sha256: payload.lease_owner_sha256,
            lease_expires_at: payload.lease_expires_at,
          })
          break
        }
        case "DISPATCH_INTENT": {
          if (current !== "PREPARED" || event.signed_anchor_sha256 !== task.dispatch_intent_anchor_sha256 ||
            !exactKeys(payload, ["sandbox_prepare_anchor_sha256", "effect_claim_sha256",
              "consume_input_sha256", "authority_envelope_sha256",
              "authorization_consumption_receipt_sha256"])) throw adapterError("integrity_failed")
          const projection = bindings.get(event.dispatch_id)
          if (projection === undefined || payload.sandbox_prepare_anchor_sha256 !== task.sandbox_prepare_anchor_sha256 ||
            payload.effect_claim_sha256 !== task.effect_claim_sha256) throw adapterError("integrity_failed")
          Object.assign(projection, payload, { dispatch_intent_anchor_sha256: event.signed_anchor_sha256 })
          projected.set(event.dispatch_id, "DISPATCH_INTENT")
          break
        }
        case "QUARANTINED": {
          if (current !== "DISPATCH_INTENT" || !exactKeys(payload,
            ["sandbox_prepare_anchor_sha256", "effect_claim_sha256",
              "quarantine_reason", "quarantine_evidence_sha256"]) ||
            payload.sandbox_prepare_anchor_sha256 !== task.sandbox_prepare_anchor_sha256 ||
            payload.effect_claim_sha256 !== task.effect_claim_sha256 ||
            payload.quarantine_reason !== task.quarantine_reason ||
            payload.quarantine_evidence_sha256 !== task.quarantine_evidence_sha256) {
            throw adapterError("integrity_failed")
          }
          Object.assign(bindings.get(event.dispatch_id) ?? {}, payload)
          projected.set(event.dispatch_id, "QUARANTINED")
          break
        }
        case "DISPATCHED": {
          if (current !== "DISPATCH_INTENT" ||
            event.signed_anchor_sha256 !== task.provider_dispatch_anchor_sha256 ||
            event.record_sha256 !== task.provider_allocation_sha256 || !exactKeys(payload, [
              "sandbox_prepare_anchor_sha256", "effect_claim_sha256", "dispatch_intent_anchor_sha256",
              "authorization_consumption_receipt_sha256", "claim_fence_sha256", "lease_epoch",
              "provider_effect_claim_fence_sha256", "provider_effect_lease_epoch",
              "provider_effect_ownership_nonce_sha256", "provider", "provider_metadata_scope_sha256",
              "provider_creation_token_sha256", "immutable_fingerprint_sha256",
              "provider_fingerprint_sha256",
            ])) throw adapterError("integrity_failed")
          const projection = bindings.get(event.dispatch_id)
          if (projection === undefined || payload.sandbox_prepare_anchor_sha256 !== task.sandbox_prepare_anchor_sha256 ||
            payload.effect_claim_sha256 !== task.effect_claim_sha256 ||
            payload.dispatch_intent_anchor_sha256 !== task.dispatch_intent_anchor_sha256 ||
            payload.authorization_consumption_receipt_sha256 !== task.authorization_consumption_receipt_sha256 ||
            payload.claim_fence_sha256 !== projection.claim_fence_sha256 ||
            payload.lease_epoch !== projection.lease_epoch ||
            payload.provider_effect_claim_fence_sha256 !== task.allocation_claim_fence_sha256 ||
            payload.provider_effect_lease_epoch !== dbBigint(task.allocation_lease_epoch) ||
            payload.provider_effect_ownership_nonce_sha256 !== task.allocation_ownership_nonce_sha256 ||
            payload.provider !== task.provider ||
            payload.provider_metadata_scope_sha256 !== task.provider_metadata_scope_sha256 ||
            payload.provider_creation_token_sha256 !== task.provider_creation_token_sha256 ||
            payload.immutable_fingerprint_sha256 !== task.immutable_fingerprint_sha256 ||
            payload.provider_fingerprint_sha256 !== task.provider_fingerprint_sha256) {
            throw adapterError("integrity_failed")
          }
          Object.assign(projection, payload, {
            provider_dispatch_anchor_sha256: event.signed_anchor_sha256,
            provider_allocation_sha256: event.record_sha256,
          })
          projected.set(event.dispatch_id, "DISPATCHED")
          break
        }
        case "RESULT_PERSISTED": {
          if (current !== "DISPATCHED" || event.signed_anchor_sha256 !== task.result_persisted_anchor_sha256 ||
            !exactKeys(payload, ["sandbox_prepare_anchor_sha256", "effect_claim_sha256",
              "dispatch_intent_anchor_sha256", "authorization_consumption_receipt_sha256",
              "claim_fence_sha256", "lease_epoch", "provider_fingerprint_sha256",
              "provider_dispatch_anchor_sha256", "provider_allocation_sha256",
              "result_bundle_sha256", "checkpoint_handoff_sha256"])) throw adapterError("integrity_failed")
          const projection = bindings.get(event.dispatch_id)
          if (projection === undefined || payload.sandbox_prepare_anchor_sha256 !== task.sandbox_prepare_anchor_sha256 ||
            payload.effect_claim_sha256 !== task.effect_claim_sha256 ||
            payload.dispatch_intent_anchor_sha256 !== task.dispatch_intent_anchor_sha256 ||
            payload.authorization_consumption_receipt_sha256 !== task.authorization_consumption_receipt_sha256 ||
            payload.claim_fence_sha256 !== projection.claim_fence_sha256 ||
            payload.lease_epoch !== projection.lease_epoch ||
            payload.provider_fingerprint_sha256 !== task.provider_fingerprint_sha256 ||
            payload.provider_dispatch_anchor_sha256 !== task.provider_dispatch_anchor_sha256 ||
            payload.provider_allocation_sha256 !== task.provider_allocation_sha256 ||
            payload.result_bundle_sha256 !== task.result_bundle_sha256 ||
            payload.checkpoint_handoff_sha256 !== task.checkpoint_handoff_sha256) {
            throw adapterError("integrity_failed")
          }
          Object.assign(projection, payload, { result_persisted_anchor_sha256: event.signed_anchor_sha256 })
          projected.set(event.dispatch_id, "RESULT_PERSISTED")
          break
        }
        default:
          throw adapterError("integrity_failed")
      }
    }
    if (tasks.length !== projected.size || tasks.some((task) => {
      const binding = bindings.get(task.dispatch_id)
      if (binding === undefined || projected.get(task.dispatch_id) !== task.state ||
        digestBytes(asBytes(task.canonical_intent_bytes)) !== task.canonical_intent_sha256) return true
      try {
        const intent = parseCanonicalBytes(asBytes(task.canonical_intent_bytes))
        if (disposableSandboxTaskIntentSha256V2(intent) !== task.canonical_intent_sha256) return true
        this.#assertExactIntentV2(task, {
          idempotency_key_sha256: task.idempotency_key_sha256 as Digest,
          canonical_intent_sha256: task.canonical_intent_sha256 as Digest,
          canonical_intent_bytes: asBytes(task.canonical_intent_bytes),
          operation_digest: task.operation_digest as Digest,
          source_manifest_sha256: task.source_manifest_sha256 as Digest,
          input_manifest_sha256: task.input_manifest_sha256 as Digest,
          checkpoint_policy_sha256: task.checkpoint_policy_sha256 as Digest,
          provider: task.provider,
          provider_metadata_scope_sha256: task.provider_metadata_scope_sha256 as Digest,
          provider_creation_token_sha256: task.provider_creation_token_sha256 as Digest,
          immutable_fingerprint_sha256: task.immutable_fingerprint_sha256 as Digest,
          lease_owner_sha256: task.lease_owner_sha256 as Digest,
          lease_duration_ms: 1_000,
        })
      } catch { return true }
      const exact: Array<[unknown, unknown]> = [
        [binding.lease_epoch, dbBigint(task.lease_epoch)],
        [binding.claim_fence_sha256, task.claim_fence_sha256],
        [binding.ownership_nonce_sha256, task.ownership_nonce_sha256],
        [binding.lease_owner_sha256, task.lease_owner_sha256],
        [binding.lease_expires_at, iso(task.lease_expires_at)],
        [binding.consume_input_sha256 ?? null, task.consume_input_sha256],
        [binding.authority_envelope_sha256 ?? null, task.authority_envelope_sha256],
        [binding.authorization_consumption_receipt_sha256 ?? null,
          task.authorization_consumption_receipt_sha256],
        [binding.dispatch_intent_anchor_sha256 ?? null, task.dispatch_intent_anchor_sha256],
        [binding.provider_fingerprint_sha256 ?? null, task.provider_fingerprint_sha256],
        [binding.provider_dispatch_anchor_sha256 ?? null, task.provider_dispatch_anchor_sha256],
        [binding.provider_allocation_sha256 ?? null, task.provider_allocation_sha256],
        [binding.result_bundle_sha256 ?? null, task.result_bundle_sha256],
        [binding.checkpoint_handoff_sha256 ?? null, task.checkpoint_handoff_sha256],
        [binding.result_persisted_anchor_sha256 ?? null, task.result_persisted_anchor_sha256],
        [binding.quarantine_reason ?? null, task.quarantine_reason],
        [binding.quarantine_evidence_sha256 ?? null, task.quarantine_evidence_sha256],
      ]
      return exact.some(([left, right]) => left !== right)
    })) throw adapterError("integrity_failed")
    const crossVersionCollisions = await this.#client.query<{ collisions: bigint | number | string }>(`
      SELECT count(*) AS collisions FROM ${SCHEMA}.tasks_v2 v2
      JOIN ${SCHEMA}.tasks v1 ON v1.idempotency_key_sha256 = v2.idempotency_key_sha256
        OR v1.operation_digest = v2.operation_digest`)
    if (dbBigint(crossVersionCollisions[0]?.collisions) !== 0n) throw adapterError("integrity_failed")
  }

  async #store(session: PostgresSessionV1): Promise<StoreRow> {
    const rows = await session.query<StoreRow>(`SELECT * FROM ${SCHEMA}.store WHERE singleton`)
    if (rows.length !== 1 || rows[0] === undefined) throw adapterError("integrity_failed")
    return rows[0]
  }

  #assertAppendable(store: StoreRow): void {
    const head = dbBigint(store.head_sequence)
    const witnessed = dbBigint(store.witnessed_sequence)
    if (head === witnessed && store.head_frontier_sha256 === store.witnessed_frontier_sha256) return
    if (head === witnessed + 1n &&
      store.head_frontier_sha256 !== store.witnessed_frontier_sha256) {
      throw new JournalWitnessLagError()
    }
    throw adapterError("integrity_failed")
  }

  async #task(dispatchId: string): Promise<TaskRow> {
    const rows = await this.#client.query<TaskRow>(`SELECT * FROM ${SCHEMA}.tasks WHERE dispatch_id = $1`, [dispatchId])
    if (rows.length !== 1 || rows[0] === undefined) throw adapterError("integrity_failed")
    return rows[0]
  }

  async #serializable<T>(use: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.#client.transaction(use)
      } catch (error) {
        if (error instanceof JournalWitnessLagError) {
          if (attempt === 3) throw adapterError("dependency_unavailable")
          await this.#healWitness()
          continue
        }
        const code = error !== null && typeof error === "object"
          ? ((error as { errno?: unknown; code?: unknown }).errno ?? (error as { code?: unknown }).code)
          : undefined
        if ((code !== "40001" && code !== "40P01") || attempt === 3) throw error
      }
    }
    throw adapterError("dependency_unavailable")
  }

  async #assertClaim(dispatchId: string, request: Digest, fence: Digest, epoch: bigint): Promise<TaskRow> {
    const row = await this.#task(dispatchId)
    if (row.request_sha256 !== request || row.claim_fence_sha256 !== fence || dbBigint(row.lease_epoch) !== epoch) {
      throw adapterError("integrity_failed")
    }
    return row
  }

  #validatePrepare(input: DisposableTaskJournalPrepareInputV1): void {
    for (const value of [input.idempotency_key_sha256, input.request_sha256, input.operation_digest,
      input.authority_envelope_sha256, input.source_manifest_sha256, input.input_manifest_sha256,
      input.checkpoint_policy_sha256,
      input.provider_metadata_scope_sha256, input.provider_creation_token_sha256,
      input.immutable_fingerprint_sha256, input.lease_owner_sha256]) assertDigest(value)
    if (!['e2b', 'daytona_cloud'].includes(input.provider) || !Number.isSafeInteger(input.lease_duration_ms) ||
      input.lease_duration_ms < 1_000 || input.lease_duration_ms > 3_600_000) throw adapterError("validation_failed")
    const requestBytes = asBytes(input.canonical_request_bytes)
    const request = parseDisposableSandboxTaskRequestV1(parseCanonicalBytes(requestBytes))
    if (digestBytes(requestBytes) !== input.request_sha256) throw adapterError("validation_failed")
    if (request.idempotency_key_sha256 !== input.idempotency_key_sha256 ||
      request.operation_digest !== input.operation_digest ||
      request.authority_envelope_sha256 !== input.authority_envelope_sha256 ||
      request.source_manifest_sha256 !== input.source_manifest_sha256 ||
      request.input_manifest_sha256 !== input.input_manifest_sha256 || request.provider !== input.provider) {
      throw adapterError("validation_failed")
    }
    if (disposableTaskCheckpointPolicySha256(request.checkpoint) !== input.checkpoint_policy_sha256) {
      throw adapterError("validation_failed")
    }
  }

  #validatePrepareV2(input: DisposableTaskJournalPrepareIntentInputV2): void {
    for (const value of [input.idempotency_key_sha256, input.canonical_intent_sha256,
      input.operation_digest, input.source_manifest_sha256, input.input_manifest_sha256,
      input.checkpoint_policy_sha256, input.provider_metadata_scope_sha256,
      input.provider_creation_token_sha256, input.immutable_fingerprint_sha256,
      input.lease_owner_sha256]) assertDigest(value)
    if (!['e2b', 'daytona_cloud'].includes(input.provider) || !Number.isSafeInteger(input.lease_duration_ms) ||
      input.lease_duration_ms < 1_000 || input.lease_duration_ms > 3_600_000) throw adapterError("validation_failed")
    const intentBytes = asBytes(input.canonical_intent_bytes)
    const parsed = parseCanonicalBytes(intentBytes)
    if (digestBytes(intentBytes) !== input.canonical_intent_sha256 ||
      disposableSandboxTaskIntentSha256V2(parsed) !== input.canonical_intent_sha256 ||
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw adapterError("validation_failed")
    const intent = parsed as Record<string, unknown>
    if (intent.idempotency_key_sha256 !== input.idempotency_key_sha256 ||
      intent.operation_digest !== input.operation_digest ||
      intent.source_manifest_sha256 !== input.source_manifest_sha256 ||
      intent.input_manifest_sha256 !== input.input_manifest_sha256 || intent.provider !== input.provider ||
      disposableTaskCheckpointPolicySha256(intent.checkpoint) !== input.checkpoint_policy_sha256) {
      throw adapterError("validation_failed")
    }
  }

  #assertExactIntentV2(row: TaskRowV2, input: DisposableTaskJournalPrepareIntentInputV2): void {
    if (row.idempotency_key_sha256 !== input.idempotency_key_sha256 ||
      row.operation_digest !== input.operation_digest ||
      row.canonical_intent_sha256 !== input.canonical_intent_sha256 ||
      !byteEqual(asBytes(row.canonical_intent_bytes), input.canonical_intent_bytes) ||
      row.source_manifest_sha256 !== input.source_manifest_sha256 ||
      row.input_manifest_sha256 !== input.input_manifest_sha256 ||
      row.checkpoint_policy_sha256 !== input.checkpoint_policy_sha256 || row.provider !== input.provider ||
      row.provider_metadata_scope_sha256 !== input.provider_metadata_scope_sha256 ||
      row.provider_creation_token_sha256 !== input.provider_creation_token_sha256 ||
      row.immutable_fingerprint_sha256 !== input.immutable_fingerprint_sha256) throw adapterError("validation_failed")
    const expectedEffect = canonicalSha256({
      schema_version: "sandboxes.disposable-task-effect-claim/v2",
      journal_identity_sha256: this.#options.journal_identity_sha256,
      restore_domain_sha256: this.#options.restore_domain_sha256,
      dispatch_id: row.dispatch_id,
      canonical_intent_sha256: row.canonical_intent_sha256,
      provider: row.provider,
      provider_metadata_scope_sha256: row.provider_metadata_scope_sha256,
      provider_creation_token_sha256: row.provider_creation_token_sha256,
      immutable_fingerprint_sha256: row.immutable_fingerprint_sha256,
      provider_effect_claim_fence_sha256: row.allocation_claim_fence_sha256,
      provider_effect_lease_epoch: dbBigint(row.allocation_lease_epoch),
      provider_effect_ownership_nonce_sha256: row.allocation_ownership_nonce_sha256,
    })
    const prepared = this.#preparedV2(row)
    if (row.effect_claim_sha256 !== expectedEffect || prepared.prepared_sha256 !== row.prepared_sha256 ||
      (row.state === "PREPARED" && row.dispatch_intent_anchor_sha256 !== null) ||
      (row.state !== "PREPARED" && !isDigest(row.dispatch_intent_anchor_sha256)) ||
      (row.dispatch_intent_anchor_sha256 === null) !== (row.consume_input_sha256 === null) ||
      (row.consume_input_sha256 === null) !== (row.authority_envelope_sha256 === null) ||
      (row.consume_input_sha256 === null) !== (row.authorization_consumption_receipt_sha256 === null) ||
      (row.provider_fingerprint_sha256 === null) !== (row.provider_dispatch_anchor_sha256 === null) ||
      (row.provider_fingerprint_sha256 === null) !== (row.provider_allocation_sha256 === null) ||
      (row.result_bundle_sha256 === null) !== (row.checkpoint_handoff_sha256 === null) ||
      (row.result_bundle_sha256 === null) !== (row.result_persisted_anchor_sha256 === null) ||
      (["DISPATCHED", "RESULT_PERSISTED"].includes(row.state)) !==
        (row.provider_fingerprint_sha256 !== null) ||
      (row.state === "RESULT_PERSISTED") !== (row.result_bundle_sha256 !== null)) {
      throw adapterError("integrity_failed")
    }
    if (row.dispatch_intent_anchor_sha256 !== null) {
      if (row.canonical_consume_input_bytes === null || !isDigest(row.consume_input_sha256) ||
        !isDigest(row.authority_envelope_sha256) ||
        digestBytes(asBytes(row.canonical_consume_input_bytes)) !== row.consume_input_sha256) {
        throw adapterError("integrity_failed")
      }
      this.#assertConsumeInputV2(row, asBytes(row.canonical_consume_input_bytes), row.authority_envelope_sha256)
      this.#storedAuthorizationV2(row)
    }
  }

  #preparedV2(row: TaskRowV2) {
    const core = {
      schema_version: DISPOSABLE_TASK_PREPARED_SCHEMA_V2,
      dispatch_id: row.dispatch_id,
      canonical_intent_sha256: row.canonical_intent_sha256 as Digest,
      sandbox_prepare_anchor_sha256: row.sandbox_prepare_anchor_sha256 as Digest,
      operation_digest: row.operation_digest as Digest,
      provider: row.provider,
      source_manifest_sha256: row.source_manifest_sha256 as Digest,
      input_manifest_sha256: row.input_manifest_sha256 as Digest,
      checkpoint_policy_sha256: row.checkpoint_policy_sha256 as Digest,
      effect_claim_sha256: row.effect_claim_sha256 as Digest,
    }
    const preparedSha256 = canonicalSha256(core)
    if (preparedSha256 !== row.prepared_sha256) throw adapterError("integrity_failed")
    return Object.freeze({ ...core, prepared_sha256: preparedSha256 })
  }

  #claimV2(
    row: TaskRowV2,
    epoch: bigint,
    fence: Digest,
    ownershipNonce: Digest,
    owner: Digest,
    expires: string,
  ): DisposableTaskJournalClaimV2 {
    return Object.freeze({
      dispatch_id: row.dispatch_id,
      canonical_intent_sha256: row.canonical_intent_sha256 as Digest,
      lease_epoch: epoch,
      claim_fence_sha256: fence,
      lease_owner_sha256: owner,
      lease_expires_at: expires,
      provider_metadata_scope_sha256: row.provider_metadata_scope_sha256 as Digest,
      provider_creation_token_sha256: row.provider_creation_token_sha256 as Digest,
      immutable_fingerprint_sha256: row.immutable_fingerprint_sha256 as Digest,
      ownership_nonce_sha256: ownershipNonce,
      provider_effect_claim_fence_sha256: row.allocation_claim_fence_sha256 as Digest,
      provider_effect_lease_epoch: dbBigint(row.allocation_lease_epoch),
      provider_effect_ownership_nonce_sha256: row.allocation_ownership_nonce_sha256 as Digest,
      effect_claim_sha256: row.effect_claim_sha256 as Digest,
      sandbox_prepare_anchor_sha256: row.sandbox_prepare_anchor_sha256 as Digest,
      dispatch_intent_anchor_sha256: row.dispatch_intent_anchor_sha256 as Digest | null,
      expected_provider_fingerprint_sha256: row.provider_fingerprint_sha256 as Digest | null,
      expected_provider_dispatch_anchor_sha256: row.provider_dispatch_anchor_sha256 as Digest | null,
      expected_provider_allocation_sha256: row.provider_allocation_sha256 as Digest | null,
      expected_result_bundle_sha256: row.result_bundle_sha256 as Digest | null,
      expected_checkpoint_handoff_sha256: row.checkpoint_handoff_sha256 as Digest | null,
      expected_result_persisted_anchor_sha256: row.result_persisted_anchor_sha256 as Digest | null,
    })
  }

  #storedAuthorizationV2(row: TaskRowV2): DisposableTaskAuthorizationArtifactsV2 | null {
    if (row.canonical_authority_envelope_bytes === null && row.canonical_authorization_receipt_bytes === null) return null
    if (row.canonical_authority_envelope_bytes === null || row.canonical_authorization_receipt_bytes === null ||
      !isDigest(row.authority_envelope_sha256) || !isDigest(row.authorization_consumption_receipt_sha256)) {
      throw adapterError("integrity_failed")
    }
    const envelopeBytes = asBytes(row.canonical_authority_envelope_bytes)
    const receiptBytes = asBytes(row.canonical_authorization_receipt_bytes)
    parseInfinityCanonicalBytesV2(envelopeBytes)
    parseInfinityCanonicalBytesV2(receiptBytes)
    if (digestBytes(envelopeBytes) !== row.authority_envelope_sha256 ||
      digestBytes(receiptBytes) !== row.authorization_consumption_receipt_sha256) {
      throw adapterError("integrity_failed")
    }
    return Object.freeze({
      canonical_authority_envelope_bytes: envelopeBytes,
      authority_envelope_sha256: row.authority_envelope_sha256,
      canonical_receipt_bytes: receiptBytes,
      receipt_sha256: row.authorization_consumption_receipt_sha256,
    })
  }

  #assertConsumeInputV2(row: TaskRowV2, consumeBytes: Uint8Array, authorityEnvelopeSha256: Digest): void {
    const value = parseCanonicalBytes(consumeBytes)
    if (value === null || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, [
      "dispatch_id", "canonical_intent_sha256", "sandbox_prepare_anchor_sha256",
      "authority_envelope_sha256", "operation_digest", "provider", "source_manifest_sha256",
      "input_manifest_sha256", "checkpoint_policy_sha256", "effect_claim_sha256",
    ])) throw adapterError("integrity_failed")
    const expected = {
      dispatch_id: row.dispatch_id,
      canonical_intent_sha256: row.canonical_intent_sha256,
      sandbox_prepare_anchor_sha256: row.sandbox_prepare_anchor_sha256,
      authority_envelope_sha256: authorityEnvelopeSha256,
      operation_digest: row.operation_digest,
      provider: row.provider,
      source_manifest_sha256: row.source_manifest_sha256,
      input_manifest_sha256: row.input_manifest_sha256,
      checkpoint_policy_sha256: row.checkpoint_policy_sha256,
      effect_claim_sha256: row.effect_claim_sha256,
    }
    if (canonicalJson(value) !== canonicalJson(expected)) throw adapterError("integrity_failed")
  }

  #assertExactIntent(row: TaskRow, input: DisposableTaskJournalPrepareInputV1): void {
    if (row.idempotency_key_sha256 !== input.idempotency_key_sha256 || row.operation_digest !== input.operation_digest ||
      row.request_sha256 !== input.request_sha256 || !byteEqual(asBytes(row.canonical_request_bytes), input.canonical_request_bytes) ||
      row.authority_envelope_sha256 !== input.authority_envelope_sha256 || row.source_manifest_sha256 !== input.source_manifest_sha256 ||
      row.input_manifest_sha256 !== input.input_manifest_sha256 || row.provider !== input.provider ||
      row.provider_metadata_scope_sha256 !== input.provider_metadata_scope_sha256 ||
      row.provider_creation_token_sha256 !== input.provider_creation_token_sha256 ||
      row.immutable_fingerprint_sha256 !== input.immutable_fingerprint_sha256) throw adapterError("validation_failed")
    const expectedEffectClaim = canonicalSha256({
      schema_version: "sandboxes.disposable-task-effect-claim/v1",
      dispatch_id: row.dispatch_id,
      request_sha256: row.request_sha256,
      provider: row.provider,
      provider_metadata_scope_sha256: row.provider_metadata_scope_sha256,
      provider_creation_token_sha256: row.provider_creation_token_sha256,
      immutable_fingerprint_sha256: row.immutable_fingerprint_sha256,
      provider_effect_claim_fence_sha256: row.allocation_claim_fence_sha256,
      provider_effect_lease_epoch: dbBigint(row.allocation_lease_epoch),
      provider_effect_ownership_nonce_sha256: row.allocation_ownership_nonce_sha256,
    })
    if (row.effect_claim_sha256 !== expectedEffectClaim ||
      (row.dispatch_intent_anchor_sha256 !== null && !isDigest(row.dispatch_intent_anchor_sha256)) ||
      (row.authorization_consumption_receipt_sha256 === null) !== (row.dispatch_intent_anchor_sha256 === null) ||
      (row.state === "PREPARED" && row.dispatch_intent_anchor_sha256 !== null) ||
      (["DISPATCH_INTENT", "DISPATCHED", "RESULT_PERSISTED"].includes(row.state) &&
        row.dispatch_intent_anchor_sha256 === null)) throw adapterError("integrity_failed")
  }

  #claim(row: TaskRow, epoch: bigint, fence: Digest, ownershipNonce: Digest, owner: Digest, expires: string) {
    return {
      dispatch_id: row.dispatch_id, request_sha256: row.request_sha256 as Digest,
      lease_epoch: epoch, claim_fence_sha256: fence, lease_owner_sha256: owner,
      lease_expires_at: expires,
      provider_metadata_scope_sha256: row.provider_metadata_scope_sha256 as Digest,
      provider_creation_token_sha256: row.provider_creation_token_sha256 as Digest,
      immutable_fingerprint_sha256: row.immutable_fingerprint_sha256 as Digest,
      ownership_nonce_sha256: ownershipNonce,
      effect_claim_sha256: row.effect_claim_sha256 as Digest,
      dispatch_intent_anchor_sha256: row.dispatch_intent_anchor_sha256 as Digest | null,
      dispatch_anchor_sha256: row.dispatch_anchor_sha256 as Digest,
    }
  }

  #authorization(row: TaskRow): DisposableTaskJournalAuthorizationV1 {
    const consumeBytes = asBytes(row.authority_consume_input_bytes)
    if (!isDigest(row.authority_consume_input_sha256) ||
      digestBytes(consumeBytes) !== row.authority_consume_input_sha256) throw adapterError("integrity_failed")
    const consume = parseCanonicalBytes(consumeBytes)
    if (consume === null || typeof consume !== "object" || Array.isArray(consume)) throw adapterError("integrity_failed")
    const request = parseDisposableSandboxTaskRequestV1(parseCanonicalBytes(asBytes(row.canonical_request_bytes)))
    const expectedConsume = {
      dispatch_id: row.dispatch_id,
      authority_envelope_sha256: row.authority_envelope_sha256,
      canonical_request_sha256: row.request_sha256,
      operation_digest: row.operation_digest,
      provider: row.provider,
      source_manifest_sha256: row.source_manifest_sha256,
      input_manifest_sha256: row.input_manifest_sha256,
      checkpoint_policy_sha256: disposableTaskCheckpointPolicySha256(request.checkpoint),
      effect_claim_sha256: row.effect_claim_sha256,
    }
    if (canonicalJson(consume) !== canonicalJson(expectedConsume)) throw adapterError("integrity_failed")
    const storedReceipt = row.authorization_receipt_bytes === null
      ? null
      : {
          canonical_receipt_bytes: asBytes(row.authorization_receipt_bytes),
          receipt_sha256: row.authorization_consumption_receipt_sha256 as Digest,
        }
    if (storedReceipt !== null && (!isDigest(storedReceipt.receipt_sha256) ||
      digestBytes(storedReceipt.canonical_receipt_bytes) !== storedReceipt.receipt_sha256)) {
      throw adapterError("integrity_failed")
    }
    return {
      canonical_consume_input_bytes: consumeBytes,
      consume_input_sha256: row.authority_consume_input_sha256 as Digest,
      consume_input: consume as DisposableTaskJournalAuthorizationV1["consume_input"],
      stored_receipt: storedReceipt,
    }
  }

  #terminal(row: TaskRow): DisposableTaskJournalCompletedV1 | DisposableTaskJournalQuarantinedV1 {
    if (row.outcome_anchor_bytes === null || !isDigest(row.outcome_anchor_sha256)) throw adapterError("integrity_failed")
    const anchorBytes = asBytes(row.outcome_anchor_bytes)
    if (digestBytes(anchorBytes) !== row.outcome_anchor_sha256) throw adapterError("integrity_failed")
    const anchorValue = parseCanonicalBytes(anchorBytes)
    if (anchorValue === null || typeof anchorValue !== "object" || Array.isArray(anchorValue)) {
      throw adapterError("integrity_failed")
    }
    const anchor = anchorValue as Record<string, unknown>
    const recordValue = anchor.record
    if (recordValue === null || typeof recordValue !== "object" || Array.isArray(recordValue)) {
      throw adapterError("integrity_failed")
    }
    const record = recordValue as Record<string, unknown>
    const signatureText = anchor.signature_base64url
    if (anchor.journal_identity_sha256 !== this.#options.journal_identity_sha256 ||
      anchor.restore_domain_sha256 !== this.#options.restore_domain_sha256 ||
      anchor.signer_principal !== this.#options.signer.signer_principal ||
      anchor.signing_key_id !== this.#options.signer.signing_key_id ||
      record.dispatch_id !== row.dispatch_id || record.request_sha256 !== row.request_sha256 ||
      record.record_kind !== row.state || typeof signatureText !== "string") throw adapterError("integrity_failed")
    const { signature_base64url: _signature, record: _record, frontier_sha256: frontier, ...unsigned } = anchor
    if (!isDigest(frontier) || canonicalSha256(unsigned) !== frontier) throw adapterError("integrity_failed")
    let signature: Uint8Array
    try { signature = Uint8Array.from(Buffer.from(signatureText, "base64url")) } catch { throw adapterError("integrity_failed") }
    if (signature.byteLength !== 64 ||
      !this.#options.verifier.verify(canonicalBytes({ ...unsigned, frontier_sha256: frontier }), signature)) {
      throw adapterError("integrity_failed")
    }
    const payloadValue = record.payload
    if (payloadValue === null || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
      throw adapterError("integrity_failed")
    }
    const payload = payloadValue as Record<string, unknown>
    if (row.state === "QUARANTINED") {
      if (row.quarantine_reason === null || !isDigest(row.quarantine_evidence_sha256)) throw adapterError("integrity_failed")
      if (payload.kind !== "quarantined" || payload.quarantine_reason !== row.quarantine_reason ||
        payload.quarantine_evidence_sha256 !== row.quarantine_evidence_sha256) throw adapterError("integrity_failed")
      return { kind: "quarantined", request_sha256: row.request_sha256 as Digest,
        quarantine_reason: row.quarantine_reason,
        quarantine_evidence_sha256: row.quarantine_evidence_sha256,
        canonical_anchor_bytes: anchorBytes, anchor_sha256: row.outcome_anchor_sha256 }
    }
    if (row.state !== "OUTCOME" || row.outcome_kind === null) throw adapterError("integrity_failed")
    const execution = row.execution_receipt_bytes === null ? null
      : exactExecutionReceipt(parseCanonicalBytes(asBytes(row.execution_receipt_bytes)), row)
    if (payload.kind !== "outcome" || payload.outcome_kind !== row.outcome_kind ||
      payload.execution_receipt_sha256 !== row.execution_receipt_sha256 ||
      payload.failure_code !== row.failure_code || payload.failure_evidence_sha256 !== row.failure_evidence_sha256) {
      throw adapterError("integrity_failed")
    }
    return { kind: "outcome", request_sha256: row.request_sha256 as Digest,
      outcome_kind: row.outcome_kind, execution_receipt: execution,
      failure_code: row.failure_code, failure_evidence_sha256: row.failure_evidence_sha256 as Digest | null,
      canonical_anchor_bytes: anchorBytes, anchor_sha256: row.outcome_anchor_sha256 }
  }

  #validateTerminalInput(input: Parameters<DisposableTaskJournalPortV1["commitOutcome"]>[0]): void {
    assertText(input.dispatch_id)
    assertDigest(input.request_sha256)
    assertDigest(input.claim_fence_sha256)
    if (input.outcome_kind === "succeeded") {
      if (input.execution_receipt === null || input.failure_code !== null || input.failure_evidence_sha256 !== null) {
        throw adapterError("validation_failed")
      }
      // The complete closed receipt and all request/claim bindings are verified after loading the journal row.
    } else {
      if (input.execution_receipt !== null || input.failure_code === null || input.failure_evidence_sha256 === null) {
        throw adapterError("validation_failed")
      }
      assertText(input.failure_code)
      assertDigest(input.failure_evidence_sha256)
    }
  }

  #requireReady(): void {
    if (!this.#ready) throw adapterError("dependency_unavailable")
  }
}

export const POSTGRES_DISPOSABLE_TASK_JOURNAL_MIGRATION_V1 = Object.freeze({
  name: MIGRATION_NAME,
  relative_path: `migrations/disposable-task-journal/${MIGRATION_NAME}`,
  checksum_sha256: MIGRATION_SHA256,
})

export const POSTGRES_DISPOSABLE_TASK_JOURNAL_MIGRATION_V2 = Object.freeze({
  name: MIGRATION_V2_NAME,
  relative_path: `migrations/disposable-task-journal/${MIGRATION_V2_NAME}`,
  checksum_sha256: MIGRATION_V2_SHA256,
})

export const POSTGRES_DISPOSABLE_TASK_JOURNAL_EFFECT_TRANSITIONS_MIGRATION_V2 = Object.freeze({
  name: MIGRATION_V2_EFFECTS_NAME,
  relative_path: `migrations/disposable-task-journal/${MIGRATION_V2_EFFECTS_NAME}`,
  checksum_sha256: MIGRATION_V2_EFFECTS_SHA256,
})
