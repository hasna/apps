import { expect, test } from "bun:test"
import { SQL } from "bun"
import { createHash, generateKeyPairSync } from "node:crypto"
import { readFileSync } from "node:fs"
import { canonicalJson, canonicalSha256, parseCanonicalJson } from "../../src/adapters/managed/canonical"
import {
  PostgresDisposableTaskJournalV1,
  applyPostgresDisposableTaskJournalMigrationV1,
  createEd25519DisposableTaskJournalCryptoV1,
  type DisposableTaskJournalSignerV1,
} from "../../src/adapters/managed/disposable-task-postgres"
import type {
  DisposableSandboxTaskExecutionReceiptV1,
  DisposableTaskJournalClaimV1,
  DisposableTaskJournalPrepareInputV1,
  DisposableTaskJournalRecoveryV1,
  DurableJournalWitnessReceiptV1,
  DurableJournalWitnessPortV1,
} from "../../src/adapters/managed/disposable-task"
import {
  __testOnlyRunDisposableSandboxTaskCandidateV1,
  disposableTaskBundleSha256,
  disposableTaskAbsenceEvidenceSha256,
  disposableTaskInputManifestSha256,
  disposableTaskOperationDigest,
  parseDisposableSandboxTaskRequestV1,
} from "../../src/adapters/managed/disposable-task"
import type { Digest } from "../../src/adapters/managed/types"
import type { PostgresClientV1, PostgresSessionV1 } from "../../src/repository-postgres"

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
}

const POSTGRES_ENABLED = [
  "SANDBOXES_POSTGRES_MIGRATION_URL", "SANDBOXES_POSTGRES_RUNTIME_URL",
  "SANDBOXES_POSTGRES_WITNESS_ACK_URL", "SANDBOXES_POSTGRES_DATABASE",
  "SANDBOXES_POSTGRES_MIGRATION_ROLE", "SANDBOXES_POSTGRES_RUNTIME_ROLE",
  "SANDBOXES_POSTGRES_WITNESS_ACK_ROLE", "SANDBOXES_POSTGRES_TLS_CA_FILE",
].every((name) => Boolean(process.env[name]))

interface SqlLike {
  unsafe(statement: string, parameters?: unknown[]): Promise<unknown[]>
  begin<T>(fn: (sql: SqlLike) => Promise<T>): Promise<T>
  close(options?: { timeout?: number }): Promise<void>
}

class Client implements PostgresClientV1 {
  readonly #sql: SqlLike
  constructor(url: string, ca: Uint8Array) {
    const parsed = new URL(url)
    this.#sql = new SQL({
      url,
      max: 1,
      tls: { ca, serverName: parsed.hostname, rejectUnauthorized: true },
    }) as unknown as SqlLike
  }
  async query<Row extends Record<string, unknown>>(statement: string, parameters: readonly unknown[] = []): Promise<Row[]> {
    return await this.#sql.unsafe(statement, [...parameters]) as Row[]
  }
  async transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T> {
    return await this.#sql.begin(async (sql) => fn({
      query: async <Row extends Record<string, unknown>>(statement: string, parameters: readonly unknown[] = []) =>
        await sql.unsafe(statement, [...parameters]) as Row[],
    }))
  }
  async close(): Promise<void> { await this.#sql.close({ timeout: 0 }) }
}

const d = (value: string | Uint8Array): Digest =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`

function assertRecovery(
  recovery: DisposableTaskJournalRecoveryV1,
  effect: DisposableTaskJournalClaimV1,
  current: DisposableTaskJournalClaimV1,
  priorState: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED",
): void {
  expect(recovery.provider_effect_claim_fence_sha256).toBe(effect.claim_fence_sha256)
  expect(recovery.provider_effect_lease_epoch).toBe(effect.lease_epoch)
  expect(recovery.provider_effect_ownership_nonce_sha256).toBe(effect.ownership_nonce_sha256)
  expect(d(recovery.canonical_recovery_record_bytes)).toBe(recovery.recovery_record_sha256)
  expect(d(recovery.canonical_signed_recovery_anchor_bytes)).toBe(recovery.recovery_anchor_sha256)
  const record = parseCanonicalJson(new TextDecoder().decode(recovery.canonical_recovery_record_bytes)) as Record<string, unknown>
  expect(record).toEqual({
    schema_version: "sandboxes.disposable-task-recovery-anchor/v1",
    dispatch_id: current.dispatch_id,
    request_sha256: current.request_sha256,
    prior_state: priorState,
    effect_claim_sha256: effect.effect_claim_sha256,
    provider_effect_claim_fence_sha256: effect.claim_fence_sha256,
    provider_effect_lease_epoch: effect.lease_epoch,
    provider_effect_ownership_nonce_sha256: effect.ownership_nonce_sha256,
    current_claim_fence_sha256: current.claim_fence_sha256,
    current_lease_epoch: current.lease_epoch,
    expected_provider_fingerprint_sha256: recovery.expected_provider_fingerprint_sha256,
    expected_result_bundle_sha256: recovery.expected_result_bundle_sha256,
    expected_checkpoint_handoff_sha256: recovery.expected_checkpoint_handoff_sha256,
  })
  const signed = parseCanonicalJson(new TextDecoder().decode(
    recovery.canonical_signed_recovery_anchor_bytes,
  )) as { record: { payload: Record<string, unknown> } }
  expect(signed.record.payload.recovery_record_sha256).toBe(recovery.recovery_record_sha256)
  expect(signed.record.payload.recovery_record).toEqual(record)
}

class Witness implements DurableJournalWitnessPortV1 {
  head: DurableJournalWitnessReceiptV1 | null = null
  unavailable = false
  addSignedExtraField = false
  readonly restoreDomain = d("independent-witness-restore-domain")
  readonly identity = d("durable-witness")
  constructor(readonly signer: DisposableTaskJournalSignerV1) {}
  describe() {
    return { durability: "durable" as const, restore_domain_sha256: this.restoreDomain, witness_identity_sha256: this.identity }
  }
  async readHead() { return this.head }
  async compareAndAdvance(input: Parameters<DurableJournalWitnessPortV1["compareAndAdvance"]>[0]) {
    if (this.unavailable) throw new Error("witness unavailable")
    expect(this.head?.sequence ?? 0n).toBe(input.expected_sequence)
    expect(this.head?.frontier_sha256 ?? null).toBe(input.expected_frontier_sha256)
    const unsigned = {
      schema_version: "sandboxes.durable-journal-witness-receipt/v1",
      witness_identity_sha256: this.identity,
      restore_domain_sha256: this.restoreDomain,
      journal_identity_sha256: input.journal_identity_sha256,
      expected_sequence: input.expected_sequence,
      expected_frontier_sha256: input.expected_frontier_sha256,
      sequence: input.successor_sequence,
      frontier_sha256: input.successor_frontier_sha256,
      signed_anchor_sha256: d(input.signed_anchor_bytes),
      signing_key_id: this.signer.signing_key_id,
      ...(this.addSignedExtraField ? { extra_signed_field: "forbidden" } : {}),
    }
    const receiptBytes = new TextEncoder().encode(canonicalJson({
      ...unsigned,
      signature_base64url: Buffer.from(this.signer.sign(new TextEncoder().encode(canonicalJson(unsigned)))).toString("base64url"),
    }))
    this.head = {
      canonical_receipt_bytes: receiptBytes,
      receipt_sha256: d(receiptBytes),
      sequence: input.successor_sequence,
      frontier_sha256: input.successor_frontier_sha256,
    }
    return this.head
  }
}

function prepare(seed: string, overrides: Partial<DisposableTaskJournalPrepareInputV1> = {}): DisposableTaskJournalPrepareInputV1 {
  const content = Buffer.from(`export const seed = ${JSON.stringify(seed)}\n`, "utf8")
  const files = [{
    path: "src/task.ts", content_base64: content.toString("base64"),
    content_sha256: d(content), mode: 0o600 as const,
  }]
  const request = {
    schema_version: "sandboxes.disposable-task-request/v1" as const,
    provider: "e2b" as const,
    idempotency_key_sha256: d(`idempotency:${seed}`),
    operation_digest: d("placeholder"),
    authority_envelope_sha256: d(`authority:${seed}`),
    source_manifest_sha256: d(`source:${seed}`),
    input_manifest_sha256: disposableTaskInputManifestSha256(files),
    environment_image_sha256: d("e2b-template-image"),
    task_bundle_sha256: d("placeholder"),
    network_policy: "deny_all" as const,
    maximum_allocations: 1 as const,
    max_runtime_ms: 60_000,
    files,
    exec: { argv: ["/usr/bin/true"], cwd: "." as const, wall_timeout_ms: 5_000,
      idle_timeout_ms: 5_000, output_limit_bytes: 4_096, pids_limit: 4 },
    checkpoint: {
      allowed_path_prefixes: ["src"],
      allow_file_addition: true,
      allow_file_modification: true,
      allow_file_deletion: false,
      max_changed_files: 32,
      forbidden_content_markers_base64: [],
      max_depth: 4,
      max_duration_ms: 10_000,
      max_file_bytes: 65_536,
      max_files: 32,
      max_total_bytes: 131_072,
    },
  }
  request.task_bundle_sha256 = disposableTaskBundleSha256(request)
  request.operation_digest = disposableTaskOperationDigest(request)
  const canonical = new TextEncoder().encode(canonicalJson(request))
  return {
    idempotency_key_sha256: request.idempotency_key_sha256,
    request_sha256: d(canonical),
    canonical_request_bytes: canonical,
    operation_digest: request.operation_digest,
    authority_envelope_sha256: request.authority_envelope_sha256,
    source_manifest_sha256: request.source_manifest_sha256,
    input_manifest_sha256: request.input_manifest_sha256,
    checkpoint_policy_sha256: d(canonicalJson({
      schema_version: "sandboxes.disposable-task-checkpoint-policy/v1",
      ...request.checkpoint,
    })),
    provider: request.provider,
    provider_metadata_scope_sha256: d(`scope:${seed}`),
    provider_creation_token_sha256: d(`creation:${seed}`),
    immutable_fingerprint_sha256: d(`fingerprint:${seed}`),
    lease_owner_sha256: d(`owner:${seed}`),
    lease_duration_ms: 60_000,
    ...overrides,
  }
}

function execution(
  request: DisposableTaskJournalPrepareInputV1,
  claim: Extract<Awaited<ReturnType<PostgresDisposableTaskJournalV1["prepareDispatch"]>>, { kind: "prepared" }>,
  authorizationReceiptSha256: Digest,
  dispatchIntentAnchorSha256: Digest,
  providerFingerprintSha256: Digest,
): DisposableSandboxTaskExecutionReceiptV1 {
  const core = {
    schema_version: "sandboxes.disposable-task-execution-receipt/v1" as const,
    provider: request.provider,
    request_sha256: request.request_sha256,
    idempotency_key_sha256: request.idempotency_key_sha256,
    operation_digest: request.operation_digest,
    authority_envelope_sha256: request.authority_envelope_sha256,
    source_manifest_sha256: request.source_manifest_sha256,
    input_manifest_sha256: request.input_manifest_sha256,
    authorization_consumption_receipt_sha256: authorizationReceiptSha256,
    effect_claim_sha256: claim.effect_claim_sha256,
    dispatch_intent_anchor_sha256: dispatchIntentAnchorSha256,
    journal_dispatch_anchor_sha256: claim.dispatch_anchor_sha256,
    journal_dispatch_id_sha256: canonicalSha256(claim.dispatch_id),
    journal_claim_fence_sha256: claim.claim_fence_sha256,
    journal_lease_epoch: claim.lease_epoch.toString(10),
    provider_effect_ownership_nonce_sha256: claim.ownership_nonce_sha256,
    provider_ownership_binding_sha256: canonicalSha256(
      `lease-${claim.lease_epoch.toString(10)}-${claim.ownership_nonce_sha256}`,
    ),
    allocation_count: 1 as const,
    network_policy: "deny_all" as const,
    provider_fingerprint_sha256: providerFingerprintSha256,
    broker_artifact_sha256: d("broker-artifact"),
    broker_protocol_sha256: d("broker-protocol"),
    authenticated_session_sha256: d("authenticated-session"),
    execution_receipt_sha256: d("provider-execution"),
    workspace_readback_sha256: d("workspace-readback"),
    output_manifest_sha256: d("output-manifest"),
    output_diff_sha256: d("output-diff"),
    checkpoint_sha256: d("checkpoint"),
    checkpoint_manifest_sha256: d("checkpoint-manifest"),
    checkpoint_readback_sha256: d("checkpoint"),
    checkpoint_handoff_sha256: d("checkpoint-handoff"),
    result_bundle_sha256: d("result-bundle"),
    checkpoint_file_count: 1,
    checkpoint_total_bytes: 32,
    destroy_execution_count: 1 as const,
    get_absent: true as const,
    list_absent: true as const,
    deletion_proven: true as const,
    absence_evidence_sha256: disposableTaskAbsenceEvidenceSha256({
      dispatch_id_sha256: canonicalSha256(claim.dispatch_id),
      request_sha256: request.request_sha256,
      provider: request.provider,
      provider_creation_token_sha256: request.provider_creation_token_sha256,
      immutable_fingerprint_sha256: request.immutable_fingerprint_sha256,
      provider_fingerprint_sha256: providerFingerprintSha256,
      provider_effect_claim_fence_sha256: claim.claim_fence_sha256,
      provider_effect_lease_epoch: claim.lease_epoch,
      provider_effect_ownership_nonce_sha256: claim.ownership_nonce_sha256,
      provider_ownership_binding_sha256: canonicalSha256(
        `lease-${claim.lease_epoch.toString(10)}-${claim.ownership_nonce_sha256}`,
      ),
      effect_claim_sha256: claim.effect_claim_sha256,
      dispatch_intent_anchor_sha256: dispatchIntentAnchorSha256,
      destroy_execution_count: 1,
      get_absent: true,
      list_absent: true,
      conflicting_scoped_matches: 0,
    }),
  }
  return { ...core, execution_receipt_core_sha256: canonicalSha256(core) }
}

test.skipIf(!POSTGRES_ENABLED)("real PostgreSQL disposable journal is fenced, durable, witnessed, and fail-closed", async () => {
  const config = {
    migrationUrl: required("SANDBOXES_POSTGRES_MIGRATION_URL"),
    runtimeUrl: required("SANDBOXES_POSTGRES_RUNTIME_URL"),
    witnessAckUrl: required("SANDBOXES_POSTGRES_WITNESS_ACK_URL"),
    database: required("SANDBOXES_POSTGRES_DATABASE"),
    migrationRole: required("SANDBOXES_POSTGRES_MIGRATION_ROLE"),
    runtimeRole: required("SANDBOXES_POSTGRES_RUNTIME_ROLE"),
    witnessAckRole: required("SANDBOXES_POSTGRES_WITNESS_ACK_ROLE"),
    ca: readFileSync(required("SANDBOXES_POSTGRES_TLS_CA_FILE")),
  }
  const migration = new Client(config.migrationUrl, config.ca)
  const runtimeA = new Client(config.runtimeUrl, config.ca)
  const runtimeB = new Client(config.runtimeUrl, config.ca)
  const witnessAck = new Client(config.witnessAckUrl, config.ca)
  const keys = generateKeyPairSync("ed25519")
  const crypto = createEd25519DisposableTaskJournalCryptoV1({
    signer_principal: "sandboxes-journal",
    signing_key_id: "test-key-v1",
    private_key: keys.privateKey,
    public_key: keys.publicKey,
  })
  const witnessKeys = generateKeyPairSync("ed25519")
  const witnessCrypto = createEd25519DisposableTaskJournalCryptoV1({
    signer_principal: "independent-witness",
    signing_key_id: "witness-key-v1",
    private_key: witnessKeys.privateKey,
    public_key: witnessKeys.publicKey,
  })
  const witness = new Witness(witnessCrypto.signer)
  const journalIdentity = d("journal-identity")
  const restoreDomain = d("journal-restore-domain")
  const options = {
    expected_migration_role: config.migrationRole,
    expected_runtime_role: config.runtimeRole,
    expected_database: config.database,
    encrypted_at_rest: true as const,
    journal_identity_sha256: journalIdentity,
    restore_domain_sha256: restoreDomain,
    external_head_witness: witness,
    witness_receipt_verifier: {
      witness_identity_sha256: witness.identity,
      restore_domain_sha256: witness.restoreDomain,
      signing_key_id: witnessCrypto.verifier.signing_key_id,
      verification_key_sha256: witnessCrypto.verifier.verification_key_sha256,
      verify: witnessCrypto.verifier.verify,
    },
    witness_acknowledgement_client: witnessAck,
    expected_witness_acknowledgement_role: config.witnessAckRole,
    ...crypto,
  }
  try {
    await applyPostgresDisposableTaskJournalMigrationV1(migration, {
      expected_migration_role: config.migrationRole,
      expected_database: config.database,
      runtime_role: config.runtimeRole,
      witness_acknowledgement_role: config.witnessAckRole,
      journal_identity_sha256: journalIdentity,
      restore_domain_sha256: restoreDomain,
      external_head_witness_sha256: witness.identity,
      witness_verification_key_sha256: witnessCrypto.verifier.verification_key_sha256,
      signer_principal: crypto.signer.signer_principal,
      signing_key_id: crypto.signer.signing_key_id,
      verification_key_sha256: crypto.signer.verification_key_sha256,
      encrypted_at_rest: true,
    })
    const a = await PostgresDisposableTaskJournalV1.fromClient(runtimeA, options)
    const b = await PostgresDisposableTaskJournalV1.fromClient(runtimeB, options)
    const expectCatalogRestartRejected = async (): Promise<void> => {
      const runtime = new Client(config.runtimeUrl, config.ca)
      const acknowledgement = new Client(config.witnessAckUrl, config.ca)
      try {
        await expect(PostgresDisposableTaskJournalV1.fromClient(runtime, {
          ...options,
          witness_acknowledgement_client: acknowledgement,
        })).rejects.toMatchObject({ code: "integrity_failed" })
      } finally {
        await Promise.allSettled([runtime.close(), acknowledgement.close()])
      }
    }

    // A paused caller cannot mutate after another process takes the expired lease.
    const staleInput = prepare("stale-claim", { lease_duration_ms: 1_000 })
    const stale = await a.prepareDispatch(staleInput)
    if (stale.kind !== "prepared") throw new Error("missing stale-claim fixture")
    await Bun.sleep(1_100)
    const replacement = await b.prepareDispatch({
      ...staleInput,
      lease_owner_sha256: d("replacement-owner"),
      lease_duration_ms: 60_000,
    })
    expect(replacement.kind).toBe("reconcile")
    if (replacement.kind !== "reconcile") throw new Error("missing first PREPARED takeover")
    assertRecovery(replacement.recovery_binding, stale, replacement, "PREPARED")
    expect(replacement.authorization.stored_receipt).toBeNull()
    await migration.query(`UPDATE sandboxes_disposable_task_journal.tasks
      SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE dispatch_id = $1`, [stale.dispatch_id])
    const thirdUnboundClaim = await a.prepareDispatch({
      ...staleInput,
      lease_owner_sha256: d("third-unbound-owner"),
      lease_duration_ms: 60_000,
    })
    if (thirdUnboundClaim.kind !== "reconcile") throw new Error("missing second PREPARED takeover")
    expect(thirdUnboundClaim.lease_epoch).toBe(3n)
    assertRecovery(thirdUnboundClaim.recovery_binding, stale, thirdUnboundClaim, "PREPARED")
    expect(thirdUnboundClaim.authorization.stored_receipt).toBeNull()
    const replacementAuthorization = new TextEncoder().encode(canonicalJson({ replacement: true }))
    await expect(a.bindAuthorizationAndMarkIntent({
      dispatch_id: thirdUnboundClaim.dispatch_id,
      request_sha256: thirdUnboundClaim.request_sha256,
      claim_fence_sha256: thirdUnboundClaim.claim_fence_sha256,
      lease_epoch: thirdUnboundClaim.lease_epoch,
      effect_claim_sha256: thirdUnboundClaim.effect_claim_sha256,
      authorization_receipt: {
        canonical_receipt_bytes: replacementAuthorization,
        receipt_sha256: d(replacementAuthorization),
      },
    })).rejects.toMatchObject({ code: "integrity_failed" })
    const unboundAfterRejectedBind = await migration.query<{
      state: string; authorization_consumption_receipt_sha256: string | null
      dispatch_intent_anchor_sha256: string | null; count: bigint | string
    }>(`SELECT task.state, task.authorization_consumption_receipt_sha256,
        task.dispatch_intent_anchor_sha256,
        (SELECT count(*) FROM sandboxes_disposable_task_journal.events event
         WHERE event.dispatch_id = task.dispatch_id AND event.record_kind = 'DISPATCH_INTENT') AS count
      FROM sandboxes_disposable_task_journal.tasks task WHERE task.dispatch_id = $1`, [thirdUnboundClaim.dispatch_id])
    expect(unboundAfterRejectedBind).toHaveLength(1)
    expect(unboundAfterRejectedBind[0]).toMatchObject({
      state: "PREPARED", authorization_consumption_receipt_sha256: null,
      dispatch_intent_anchor_sha256: null,
    })
    expect(BigInt(unboundAfterRejectedBind[0]!.count)).toBe(0n)
    const staleAuthorization = new TextEncoder().encode(canonicalJson({ stale: true }))
    await expect(a.bindAuthorizationAndMarkIntent({
      dispatch_id: stale.dispatch_id,
      request_sha256: stale.request_sha256,
      claim_fence_sha256: stale.claim_fence_sha256,
      lease_epoch: stale.lease_epoch,
      effect_claim_sha256: stale.effect_claim_sha256,
      authorization_receipt: { canonical_receipt_bytes: staleAuthorization, receipt_sha256: d(staleAuthorization) },
    })).rejects.toBeDefined()

    // Authorization binds the immutable provider-effect claim before provider create; later
    // finalizer leases can change repeatedly without rewriting provider ownership.
    const authorizedPreparedBase = prepare("authorized-prepared")
    const authorizedPreparedRequest = parseDisposableSandboxTaskRequestV1(parseCanonicalJson(
      new TextDecoder().decode(authorizedPreparedBase.canonical_request_bytes),
    ))
    const authorizedPreparedScope = canonicalSha256({
      schema_version: "sandboxes.disposable-task-provider-scope/v1",
      provider: authorizedPreparedRequest.provider,
      request_sha256: authorizedPreparedBase.request_sha256,
      idempotency_key_sha256: authorizedPreparedRequest.idempotency_key_sha256,
    })
    const authorizedPreparedInput = {
      ...authorizedPreparedBase,
      provider_metadata_scope_sha256: authorizedPreparedScope,
      provider_creation_token_sha256: canonicalSha256({
        schema_version: "sandboxes.disposable-task-creation-token/v1",
        provider_metadata_scope_sha256: authorizedPreparedScope,
      }),
      immutable_fingerprint_sha256: canonicalSha256({
        schema_version: "sandboxes.disposable-task-provider-fingerprint/v1",
        provider_metadata_scope_sha256: authorizedPreparedScope,
        environment_image_sha256: authorizedPreparedRequest.environment_image_sha256,
        source_manifest_sha256: authorizedPreparedRequest.source_manifest_sha256,
        input_manifest_sha256: authorizedPreparedRequest.input_manifest_sha256,
      }),
    }
    const authorizedPrepared = await a.prepareDispatch(authorizedPreparedInput)
    if (authorizedPrepared.kind !== "prepared") throw new Error("missing authorized PREPARED fixture")
    const authorizedPreparedNow = Date.now()
    const authorizedPreparedBytes = new TextEncoder().encode(canonicalJson({
      schema_version: "sandboxes.disposable-task-authorization-consumption/v1",
      dispatch_id: authorizedPrepared.dispatch_id,
      authority_envelope_sha256: authorizedPreparedInput.authority_envelope_sha256,
      canonical_request_sha256: authorizedPreparedInput.request_sha256,
      operation_digest: authorizedPreparedInput.operation_digest,
      provider: authorizedPreparedInput.provider,
      source_manifest_sha256: authorizedPreparedInput.source_manifest_sha256,
      input_manifest_sha256: authorizedPreparedInput.input_manifest_sha256,
      checkpoint_policy_sha256: authorizedPreparedInput.checkpoint_policy_sha256,
      effect_claim_sha256: authorizedPrepared.effect_claim_sha256,
      authority_epoch: "1", run_id: "run-intent", attempt_id: "attempt-intent",
      attempt_lease_id: "attempt-lease-intent", lease_epoch: "1",
      model_operation_id: "model-operation-intent",
      audience: "hasna:sandboxes:disposable-task-provider-contact/v1",
      signer_ref: "infinity-authority", signer_incarnation: "incarnation-1",
      key_id: "authority-key-1", signature: "A".repeat(86),
      issued_at: new Date(authorizedPreparedNow - 1_000).toISOString(),
      consumed_at: new Date(authorizedPreparedNow).toISOString(),
      expires_at: new Date(authorizedPreparedNow + 10_000).toISOString(),
    }))
    await a.bindAuthorizationAndMarkIntent({
      dispatch_id: authorizedPrepared.dispatch_id,
      request_sha256: authorizedPrepared.request_sha256,
      claim_fence_sha256: authorizedPrepared.claim_fence_sha256,
      lease_epoch: authorizedPrepared.lease_epoch,
      effect_claim_sha256: authorizedPrepared.effect_claim_sha256,
      authorization_receipt: {
        canonical_receipt_bytes: authorizedPreparedBytes,
        receipt_sha256: d(authorizedPreparedBytes),
      },
    })
    await migration.query(`UPDATE sandboxes_disposable_task_journal.tasks
      SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE dispatch_id = $1`,
      [authorizedPrepared.dispatch_id])
    const authorizedPreparedTakeover2 = await b.prepareDispatch({
      ...authorizedPreparedInput,
      lease_owner_sha256: d("authorized-prepared-owner-2"),
    })
    if (authorizedPreparedTakeover2.kind !== "reconcile") throw new Error("missing authorized PREPARED takeover 2")
    assertRecovery(authorizedPreparedTakeover2.recovery_binding,
      authorizedPrepared, authorizedPreparedTakeover2, "DISPATCH_INTENT")
    expect(authorizedPreparedTakeover2.authorization.stored_receipt?.receipt_sha256)
      .toBe(d(authorizedPreparedBytes))
    await migration.query(`UPDATE sandboxes_disposable_task_journal.tasks
      SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE dispatch_id = $1`,
      [authorizedPrepared.dispatch_id])
    const authorizedPreparedTakeover3 = await a.prepareDispatch({
      ...authorizedPreparedInput,
      lease_owner_sha256: d("authorized-prepared-owner-3"),
    })
    if (authorizedPreparedTakeover3.kind !== "reconcile") throw new Error("missing authorized PREPARED takeover 3")
    expect(authorizedPreparedTakeover3.lease_epoch).toBe(3n)
    assertRecovery(authorizedPreparedTakeover3.recovery_binding,
      authorizedPrepared, authorizedPreparedTakeover3, "DISPATCH_INTENT")
    await migration.query(`UPDATE sandboxes_disposable_task_journal.tasks
      SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE dispatch_id = $1`,
      [authorizedPrepared.dispatch_id])
    let intentRecoveryRunCalls = 0
    let intentRecoveryReconcileCalls = 0
    await expect(__testOnlyRunDisposableSandboxTaskCandidateV1(authorizedPreparedRequest, {
      journal: b,
      witness,
      lease_owner_sha256: d("authorized-prepared-owner-4"),
      authority: {
        describe: () => ({ durability: "durable" as const,
          implementation_sha256: d("stored-intent-authority"), trust_root_sha256: d("stored-intent-trust") }),
        async consumeOnce() { throw new Error("stored DISPATCH_INTENT authorization must not be consumed again") },
      },
      outcome_verifier: {
        describe: () => ({ implementation_sha256: d("intent-outcome-verifier"), trust_root_sha256: d("intent-outcome-trust") }),
        async assertVerified() { throw new Error("DISPATCH_INTENT recovery has no successful outcome") },
      },
      runner: {
        provider: "e2b" as const,
        describe: () => ({ provider: "e2b" as const, implementation_sha256: d("intent-recovery-runner"),
          checkpoint_handoff_durability: "durable" as const, checkpoint_readback_verified: true }),
        async run() {
          intentRecoveryRunCalls += 1
          throw new Error("DISPATCH_INTENT recovery must not redispatch through run")
        },
        async reconcile(_request, context) {
          intentRecoveryReconcileCalls += 1
          expect(context.prior_state).toBe("DISPATCH_INTENT")
          expect(context.effect_claim_sha256).toBe(authorizedPrepared.effect_claim_sha256)
          expect(context.dispatch_intent_anchor_sha256)
            .toBe(authorizedPreparedTakeover3.dispatch_intent_anchor_sha256 as Digest)
          return "quarantined" as const
        },
        async contain() { return "quarantined" as const },
      },
    })).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
    expect(intentRecoveryRunCalls).toBe(0)
    expect(intentRecoveryReconcileCalls).toBe(1)

    // Conflicting concurrent intent binds produce one immutable winner and one signed event.
    const concurrentInput = prepare("concurrent-intent")
    const concurrentClaim = await a.prepareDispatch(concurrentInput)
    if (concurrentClaim.kind !== "prepared") throw new Error("missing concurrent intent fixture")
    const concurrentA = new TextEncoder().encode(canonicalJson({ authorization: "concurrent-a" }))
    const concurrentB = new TextEncoder().encode(canonicalJson({ authorization: "concurrent-b" }))
    const concurrentResults = await Promise.allSettled([
      a.bindAuthorizationAndMarkIntent({
        dispatch_id: concurrentClaim.dispatch_id,
        request_sha256: concurrentClaim.request_sha256,
        claim_fence_sha256: concurrentClaim.claim_fence_sha256,
        lease_epoch: concurrentClaim.lease_epoch,
        effect_claim_sha256: concurrentClaim.effect_claim_sha256,
        authorization_receipt: { canonical_receipt_bytes: concurrentA, receipt_sha256: d(concurrentA) },
      }),
      b.bindAuthorizationAndMarkIntent({
        dispatch_id: concurrentClaim.dispatch_id,
        request_sha256: concurrentClaim.request_sha256,
        claim_fence_sha256: concurrentClaim.claim_fence_sha256,
        lease_epoch: concurrentClaim.lease_epoch,
        effect_claim_sha256: concurrentClaim.effect_claim_sha256,
        authorization_receipt: { canonical_receipt_bytes: concurrentB, receipt_sha256: d(concurrentB) },
      }),
    ])
    expect(concurrentResults.filter((item) => item.status === "fulfilled")).toHaveLength(1)
    expect(concurrentResults.filter((item) => item.status === "rejected")).toHaveLength(1)
    const concurrentRows = await migration.query<{
      state: string; authorization_consumption_receipt_sha256: string
      dispatch_intent_anchor_sha256: string; count: bigint | string
    }>(`SELECT task.state, task.authorization_consumption_receipt_sha256,
        task.dispatch_intent_anchor_sha256,
        (SELECT count(*) FROM sandboxes_disposable_task_journal.events event
         WHERE event.dispatch_id = task.dispatch_id AND event.record_kind = 'DISPATCH_INTENT') AS count
      FROM sandboxes_disposable_task_journal.tasks task WHERE task.dispatch_id = $1`, [concurrentClaim.dispatch_id])
    expect(concurrentRows[0]?.state).toBe("DISPATCH_INTENT")
    expect([d(concurrentA), d(concurrentB)]).toContain(concurrentRows[0]?.authorization_consumption_receipt_sha256 as Digest)
    expect(concurrentRows[0]?.dispatch_intent_anchor_sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(BigInt(concurrentRows[0]?.count ?? -1)).toBe(1n)

    // A durable provider intent and result survive two finalizer takeovers without a
    // second DISPATCHED transition or any rewrite of the original effect identity.
    const durableResultBase = prepare("durable-result-double-takeover")
    const durableRequest = parseDisposableSandboxTaskRequestV1(parseCanonicalJson(
      new TextDecoder().decode(durableResultBase.canonical_request_bytes),
    ))
    const durableProviderScope = canonicalSha256({
      schema_version: "sandboxes.disposable-task-provider-scope/v1",
      provider: durableRequest.provider,
      request_sha256: durableResultBase.request_sha256,
      idempotency_key_sha256: durableRequest.idempotency_key_sha256,
    })
    const durableResultInput = {
      ...durableResultBase,
      provider_metadata_scope_sha256: durableProviderScope,
      provider_creation_token_sha256: canonicalSha256({
        schema_version: "sandboxes.disposable-task-creation-token/v1",
        provider_metadata_scope_sha256: durableProviderScope,
      }),
      immutable_fingerprint_sha256: canonicalSha256({
        schema_version: "sandboxes.disposable-task-provider-fingerprint/v1",
        provider_metadata_scope_sha256: durableProviderScope,
        environment_image_sha256: durableRequest.environment_image_sha256,
        source_manifest_sha256: durableRequest.source_manifest_sha256,
        input_manifest_sha256: durableRequest.input_manifest_sha256,
      }),
    }
    const durableResult = await b.prepareDispatch(durableResultInput)
    if (durableResult.kind !== "prepared") throw new Error("missing durable result fixture")
    const authorizationNow = Date.now()
    const durableResultAuthorization = new TextEncoder().encode(canonicalJson({
      schema_version: "sandboxes.disposable-task-authorization-consumption/v1",
      dispatch_id: durableResult.dispatch_id,
      authority_envelope_sha256: durableResultInput.authority_envelope_sha256,
      canonical_request_sha256: durableResultInput.request_sha256,
      operation_digest: durableResultInput.operation_digest,
      provider: durableResultInput.provider,
      source_manifest_sha256: durableResultInput.source_manifest_sha256,
      input_manifest_sha256: durableResultInput.input_manifest_sha256,
      checkpoint_policy_sha256: durableResultInput.checkpoint_policy_sha256,
      effect_claim_sha256: durableResult.effect_claim_sha256,
      authority_epoch: "1",
      run_id: "run-1",
      attempt_id: "attempt-1",
      attempt_lease_id: "attempt-lease-1",
      lease_epoch: "1",
      model_operation_id: "model-operation-1",
      audience: "hasna:sandboxes:disposable-task-provider-contact/v1",
      signer_ref: "infinity-authority",
      signer_incarnation: "incarnation-1",
      key_id: "authority-key-1",
      signature: "A".repeat(86),
      issued_at: new Date(authorizationNow - 1_000).toISOString(),
      consumed_at: new Date(authorizationNow).toISOString(),
      expires_at: new Date(authorizationNow + 10_000).toISOString(),
    }))
    const durableIntent = await b.bindAuthorizationAndMarkIntent({
      dispatch_id: durableResult.dispatch_id,
      request_sha256: durableResult.request_sha256,
      claim_fence_sha256: durableResult.claim_fence_sha256,
      lease_epoch: durableResult.lease_epoch,
      effect_claim_sha256: durableResult.effect_claim_sha256,
      authorization_receipt: {
        canonical_receipt_bytes: durableResultAuthorization,
        receipt_sha256: d(durableResultAuthorization),
      },
    })
    expect(durableIntent.dispatch_intent_anchor_sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    const durableProviderFingerprint = canonicalSha256({
      opaque_resource_id: "e2b-durable-resource",
      immutable_fingerprint_sha256: durableResultInput.immutable_fingerprint_sha256,
      provider_created_at: "2026-07-11T20:00:00.000Z",
    })
    expect(durableProviderFingerprint).not.toBe(durableResultInput.immutable_fingerprint_sha256)
    await b.markDispatched({
      dispatch_id: durableResult.dispatch_id,
      request_sha256: durableResult.request_sha256,
      claim_fence_sha256: durableResult.claim_fence_sha256,
      lease_epoch: durableResult.lease_epoch,
      provider_fingerprint_sha256: durableProviderFingerprint,
      provider_metadata_scope_sha256: durableResultInput.provider_metadata_scope_sha256,
    })
    const durableResultBundle = d("durable-result-bundle")
    const durableResultHandoff = d("durable-result-handoff")
    await b.markResultPersisted({
      dispatch_id: durableResult.dispatch_id,
      request_sha256: durableResult.request_sha256,
      claim_fence_sha256: durableResult.claim_fence_sha256,
      lease_epoch: durableResult.lease_epoch,
      result_bundle_sha256: durableResultBundle,
      checkpoint_handoff_sha256: durableResultHandoff,
    })
    await migration.query(`UPDATE sandboxes_disposable_task_journal.tasks
      SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE dispatch_id = $1`,
      [durableResult.dispatch_id])
    const durableResultTakeover2 = await a.prepareDispatch({
      ...durableResultInput,
      lease_owner_sha256: d("durable-result-owner-2"),
    })
    if (durableResultTakeover2.kind !== "reconcile") throw new Error("missing durable result takeover 2")
    assertRecovery(durableResultTakeover2.recovery_binding, durableResult, durableResultTakeover2, "RESULT_PERSISTED")
    expect(durableResultTakeover2.recovery_binding.expected_provider_fingerprint_sha256)
      .toBe(durableProviderFingerprint)
    expect(durableResultTakeover2.recovery_binding.expected_result_bundle_sha256).toBe(durableResultBundle)
    expect(durableResultTakeover2.recovery_binding.expected_checkpoint_handoff_sha256).toBe(durableResultHandoff)
    await migration.query(`UPDATE sandboxes_disposable_task_journal.tasks
      SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE dispatch_id = $1`,
      [durableResult.dispatch_id])
    let composedRunCalls = 0
    let composedReconcileCalls = 0
    await expect(__testOnlyRunDisposableSandboxTaskCandidateV1(durableRequest, {
      journal: b,
      witness,
      lease_owner_sha256: d("durable-result-owner-3"),
      authority: {
        describe: () => ({
          durability: "durable" as const,
          implementation_sha256: d("stored-authority-implementation"),
          trust_root_sha256: d("stored-authority-trust-root"),
        }),
        async consumeOnce() { throw new Error("stored authorization must not be consumed again") },
      },
      outcome_verifier: {
        describe: () => ({
          implementation_sha256: d("outcome-verifier-implementation"),
          trust_root_sha256: d("outcome-verifier-trust-root"),
        }),
        async assertVerified() { throw new Error("quarantined recovery has no successful outcome") },
      },
      runner: {
        provider: "e2b" as const,
        describe: () => ({
          provider: "e2b" as const,
          implementation_sha256: d("recovery-runner-implementation"),
          checkpoint_handoff_durability: "durable" as const,
          checkpoint_readback_verified: true,
        }),
        async run() {
          composedRunCalls += 1
          throw new Error("recovery must not redispatch through run")
        },
        async reconcile(_request, context) {
          composedReconcileCalls += 1
          expect(context.prior_state).toBe("RESULT_PERSISTED")
          expect(context.journal_claim_fence_sha256).toBe(durableResult.claim_fence_sha256)
          expect(context.journal_lease_epoch).toBe(durableResult.lease_epoch)
          expect(context.ownership_nonce_sha256).toBe(durableResult.ownership_nonce_sha256)
          expect(context.recovery_expected_provider_fingerprint_sha256)
            .toBe(durableProviderFingerprint)
          expect(context.recovery_expected_result_bundle_sha256).toBe(durableResultBundle)
          expect(context.recovery_expected_checkpoint_handoff_sha256).toBe(durableResultHandoff)
          return "quarantined" as const
        },
        async contain() { return "quarantined" as const },
      },
    })).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
    expect(composedRunCalls).toBe(0)
    expect(composedReconcileCalls).toBe(1)
    const persistedRecovery = await migration.query<{
      state: string; lease_epoch: bigint | string; effect_lease_epoch: bigint | string
      effect_claim_fence_sha256: string; effect_ownership_nonce_sha256: string
    }>(`SELECT state, lease_epoch, effect_lease_epoch, effect_claim_fence_sha256,
       effect_ownership_nonce_sha256 FROM sandboxes_disposable_task_journal.tasks WHERE dispatch_id = $1`,
      [durableResult.dispatch_id])
    expect(persistedRecovery[0]).toMatchObject({
      state: "QUARANTINED",
      effect_claim_fence_sha256: durableResult.claim_fence_sha256,
      effect_ownership_nonce_sha256: durableResult.ownership_nonce_sha256,
    })
    expect(BigInt(persistedRecovery[0]!.lease_epoch)).toBe(3n)
    expect(BigInt(persistedRecovery[0]!.effect_lease_epoch)).toBe(durableResult.lease_epoch)
    const dispatchCounts = await migration.query<{ record_kind: string; event_count: bigint | string }>(
      `SELECT record_kind, count(*) AS event_count FROM sandboxes_disposable_task_journal.events
       WHERE dispatch_id = $1 GROUP BY record_kind`, [durableResult.dispatch_id],
    )
    expect(Object.fromEntries(dispatchCounts.map((row) => [row.record_kind, Number(row.event_count)])))
      .toMatchObject({ PREPARED: 1, DISPATCH_INTENT: 1, DISPATCHED: 1, RESULT_PERSISTED: 1, CLAIMED: 2,
        QUARANTINED: 1 })

    // Same-key contenders serialize. Only one receives the initial execution claim.
    const raceInput = prepare("race")
    const [one, two] = await Promise.all([a.prepareDispatch(raceInput), b.prepareDispatch(structuredClone(raceInput))])
    expect([one.kind, two.kind].sort()).toEqual(["busy", "prepared"])
    const claim = one.kind === "prepared" ? one : two
    if (claim.kind !== "prepared") throw new Error("missing prepared claim")
    expect(claim.lease_epoch).toBe(1n)
    expect(claim.ownership_nonce_sha256).toMatch(/^sha256:[0-9a-f]{64}$/)

    // Changed request under one key conflicts before a second allocation/dispatch row.
    await expect(a.prepareDispatch(prepare("changed", {
      idempotency_key_sha256: raceInput.idempotency_key_sha256,
    }))).rejects.toMatchObject({ code: "validation_failed" })

    const authorizationBytes = new TextEncoder().encode(canonicalJson({ authorization: "consumed", lease_epoch: 1n }))
    const authorizationSha = d(authorizationBytes)
    const raceProviderFingerprint = canonicalSha256({
      opaque_resource_id: "e2b-race-resource",
      immutable_fingerprint_sha256: raceInput.immutable_fingerprint_sha256,
      provider_created_at: "2026-07-11T20:01:00.000Z",
    })
    expect(raceProviderFingerprint).not.toBe(raceInput.immutable_fingerprint_sha256)
    await expect(a.markDispatched({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      provider_fingerprint_sha256: raceProviderFingerprint,
      provider_metadata_scope_sha256: raceInput.provider_metadata_scope_sha256,
    })).rejects.toBeDefined()
    const raceIntent = await a.bindAuthorizationAndMarkIntent({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      effect_claim_sha256: claim.effect_claim_sha256,
      authorization_receipt: { canonical_receipt_bytes: authorizationBytes, receipt_sha256: authorizationSha },
    })
    const intentHead = witness.head?.sequence
    const intentEventCount = await migration.query<{ count: bigint | string }>(
      `SELECT count(*) AS count FROM sandboxes_disposable_task_journal.events
       WHERE dispatch_id = $1 AND record_kind = 'DISPATCH_INTENT'`, [claim.dispatch_id],
    )
    expect(BigInt(intentEventCount[0]?.count ?? -1)).toBe(1n)
    expect(await b.bindAuthorizationAndMarkIntent({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      effect_claim_sha256: claim.effect_claim_sha256,
      authorization_receipt: { canonical_receipt_bytes: authorizationBytes, receipt_sha256: authorizationSha },
    })).toEqual(raceIntent)
    expect(witness.head?.sequence).toBe(intentHead)
    const changedAuthorization = new TextEncoder().encode(canonicalJson({ authorization: "changed", lease_epoch: 1n }))
    await expect(b.bindAuthorizationAndMarkIntent({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      effect_claim_sha256: claim.effect_claim_sha256,
      authorization_receipt: { canonical_receipt_bytes: changedAuthorization, receipt_sha256: d(changedAuthorization) },
    })).rejects.toMatchObject({ code: "integrity_failed" })
    await expect(b.bindAuthorizationAndMarkIntent({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      effect_claim_sha256: d("changed-effect-claim"),
      authorization_receipt: { canonical_receipt_bytes: authorizationBytes, receipt_sha256: authorizationSha },
    })).rejects.toMatchObject({ code: "integrity_failed" })
    expect(witness.head?.sequence).toBe(intentHead)
    await a.markDispatched({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      provider_fingerprint_sha256: raceProviderFingerprint,
      provider_metadata_scope_sha256: raceInput.provider_metadata_scope_sha256,
    })
    expect(await b.markDispatched({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      provider_fingerprint_sha256: raceProviderFingerprint,
      provider_metadata_scope_sha256: raceInput.provider_metadata_scope_sha256,
    })).toEqual({ dispatch_anchor_sha256: claim.dispatch_anchor_sha256 })
    await expect(b.markDispatched({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      provider_fingerprint_sha256: d("conflicting-live-provider-fingerprint"),
      provider_metadata_scope_sha256: raceInput.provider_metadata_scope_sha256,
    })).rejects.toBeDefined()
    await a.markResultPersisted({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      result_bundle_sha256: d("result-bundle"),
      checkpoint_handoff_sha256: d("checkpoint-handoff"),
    })
    const receipt = execution(raceInput, claim, authorizationSha,
      raceIntent.dispatch_intent_anchor_sha256, raceProviderFingerprint)
    const { deletion_proven: _omittedDeletionProof, ...forgedReceipt } = receipt
    await expect(a.commitOutcome({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      outcome_kind: "succeeded",
      execution_receipt: forgedReceipt as unknown as DisposableSandboxTaskExecutionReceiptV1,
      failure_code: null,
      failure_evidence_sha256: null,
    })).rejects.toMatchObject({ code: "integrity_failed" })
    const completed = await a.commitOutcome({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      outcome_kind: "succeeded",
      execution_receipt: receipt,
      failure_code: null,
      failure_evidence_sha256: null,
    })
    expect(completed.canonical_anchor_bytes.byteLength).toBeGreaterThan(100)
    expect(d(completed.canonical_anchor_bytes)).toBe(completed.anchor_sha256)
    expect(await b.prepareDispatch(raceInput)).toEqual(completed)
    expect(await a.commitOutcome({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      outcome_kind: "succeeded",
      execution_receipt: structuredClone(receipt),
      failure_code: null,
      failure_evidence_sha256: null,
    })).toEqual(completed)
    await expect(a.commitOutcome({
      dispatch_id: claim.dispatch_id,
      request_sha256: claim.request_sha256,
      claim_fence_sha256: claim.claim_fence_sha256,
      lease_epoch: claim.lease_epoch,
      outcome_kind: "failed_contained",
      execution_receipt: null,
      failure_code: "changed-terminal",
      failure_evidence_sha256: d("changed-terminal"),
    })).rejects.toMatchObject({ code: "integrity_failed" })

    const healthyRestartRuntime = new Client(config.runtimeUrl, config.ca)
    const healthyRestartWitnessAck = new Client(config.witnessAckUrl, config.ca)
    const healthyRestart = await PostgresDisposableTaskJournalV1.fromClient(healthyRestartRuntime, {
      ...options,
      witness_acknowledgement_client: healthyRestartWitnessAck,
    })
    expect(await healthyRestart.prepareDispatch(raceInput)).toEqual(completed)
    await Promise.allSettled([healthyRestartRuntime.close(), healthyRestartWitnessAck.close()])

    await migration.query(`ALTER FUNCTION sandboxes_disposable_task_journal.mark_dispatched(
      text,text,text,bigint,text,text,bigint,text,text,bytea,text,bytea,text) SET search_path = public`)
    await expectCatalogRestartRejected()
    await migration.query(`ALTER FUNCTION sandboxes_disposable_task_journal.mark_dispatched(
      text,text,text,bigint,text,text,bigint,text,text,bytea,text,bytea,text) SET search_path = pg_catalog`)

    await migration.query("GRANT SELECT ON sandboxes_disposable_task_journal.store TO PUBLIC")
    await expectCatalogRestartRejected()
    await migration.query("REVOKE SELECT ON sandboxes_disposable_task_journal.store FROM PUBLIC")

    await migration.query("ALTER TABLE sandboxes_disposable_task_journal.events DISABLE TRIGGER events_immutable")
    await expectCatalogRestartRejected()
    await migration.query("ALTER TABLE sandboxes_disposable_task_journal.events ENABLE TRIGGER events_immutable")

    await migration.query(`ALTER TABLE sandboxes_disposable_task_journal.store
      ALTER COLUMN signer_principal TYPE varchar(128)`)
    await expectCatalogRestartRejected()
    await migration.query(`ALTER TABLE sandboxes_disposable_task_journal.store
      ALTER COLUMN signer_principal TYPE text`)

    await migration.query(`ALTER TABLE sandboxes_disposable_task_journal.tasks
      DROP CONSTRAINT tasks_effect_claim_sha256_check`)
    await expectCatalogRestartRejected()
    await migration.query(`ALTER TABLE sandboxes_disposable_task_journal.tasks
      ADD CONSTRAINT tasks_effect_claim_sha256_check
      CHECK (effect_claim_sha256 ~ '^sha256:[0-9a-f]{64}$'::text)`)

    await migration.query(`CREATE INDEX unexpected_task_created_at
      ON sandboxes_disposable_task_journal.tasks(created_at)`)
    await expectCatalogRestartRejected()
    await migration.query("DROP INDEX sandboxes_disposable_task_journal.unexpected_task_created_at")

    const migrationChecksum = await migration.query<{ checksum_sha256: string }>(`
      SELECT checksum_sha256 FROM sandboxes_disposable_task_journal.schema_migrations
      WHERE migration_name = '0001_disposable_task_journal.sql'`)
    await migration.query(`UPDATE sandboxes_disposable_task_journal.schema_migrations
      SET checksum_sha256 = $1 WHERE migration_name = '0001_disposable_task_journal.sql'`,
      [d("forged-journal-migration-checksum")])
    await expectCatalogRestartRejected()
    await migration.query(`UPDATE sandboxes_disposable_task_journal.schema_migrations
      SET checksum_sha256 = $1 WHERE migration_name = '0001_disposable_task_journal.sql'`,
      [migrationChecksum[0]!.checksum_sha256])

    // A crash after the DB append but before external acknowledgement is healed without re-appending.
    witness.unavailable = true
    const crashInput = prepare("witness-crash")
    await expect(a.prepareDispatch(crashInput)).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    witness.unavailable = false
    await a.assertWitnessCurrent(witness)
    const afterCrash = await a.prepareDispatch(crashInput)
    expect(afterCrash.kind).toBe("busy")

    // External head ahead of a restored/rewound database fails closed.
    const witnessed = witness.head
    if (witnessed === null) throw new Error("missing witnessed head")
    await migration.query(`UPDATE sandboxes_disposable_task_journal.store
      SET head_sequence = head_sequence - 1,
          head_frontier_sha256 = witnessed_frontier_sha256,
          witnessed_sequence = witnessed_sequence - 1
      WHERE singleton`)
    await expect(a.assertWitnessCurrent(witness)).rejects.toMatchObject({ code: "integrity_failed" })
    // Restore the exact physical head so teardown/open checks do not conceal the intended rewind assertion.
    await migration.query(`UPDATE sandboxes_disposable_task_journal.store SET
      head_sequence = $1, head_frontier_sha256 = $2,
      witnessed_sequence = $1, witnessed_frontier_sha256 = $2 WHERE singleton`,
      [witnessed.sequence, witnessed.frontier_sha256])

    // Runtime role can execute narrow transitions but has no raw table mutation capability.
    await expect(runtimeA.query(`UPDATE sandboxes_disposable_task_journal.tasks SET state = 'OUTCOME'`)).rejects.toBeDefined()
    await expect(runtimeA.query(`DELETE FROM sandboxes_disposable_task_journal.events`)).rejects.toBeDefined()
    await expect(runtimeA.query(`SELECT sandboxes_disposable_task_journal.acknowledge_witness(1, $1, $2, $3)`,
      [d("forged-witness"), new Uint8Array([1]), d("forged-receipt")])).rejects.toBeDefined()

    // A fresh process reconstructs the signed projection and rejects an orphaned physical task/event pair.
    await migration.query("ALTER TABLE sandboxes_disposable_task_journal.tasks DISABLE TRIGGER tasks_delete_guard")
    await migration.query("DELETE FROM sandboxes_disposable_task_journal.tasks WHERE dispatch_id = $1", [claim.dispatch_id])
    await migration.query("ALTER TABLE sandboxes_disposable_task_journal.tasks ENABLE TRIGGER tasks_delete_guard")
    const restartRuntime = new Client(config.runtimeUrl, config.ca)
    const restartWitnessAck = new Client(config.witnessAckUrl, config.ca)
    await expect(PostgresDisposableTaskJournalV1.fromClient(restartRuntime, {
      ...options,
      witness_acknowledgement_client: restartWitnessAck,
    })).rejects.toMatchObject({ code: "integrity_failed" })
    await Promise.allSettled([restartRuntime.close(), restartWitnessAck.close()])

    witness.addSignedExtraField = true
    await expect(a.prepareDispatch(prepare("invalid-witness-envelope")))
      .rejects.toMatchObject({ code: "integrity_failed" })
  } finally {
    await Promise.allSettled([runtimeA.close(), runtimeB.close(), witnessAck.close(), migration.close()])
  }
})
