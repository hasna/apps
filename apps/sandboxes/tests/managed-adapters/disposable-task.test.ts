import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { canonicalJson, canonicalSha256 } from "../../src/adapters/managed/canonical"
import {
  DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V1,
  DISPOSABLE_TASK_AUTHORIZATION_CONSUMPTION_SCHEMA_V1,
  DISPOSABLE_TASK_PROVIDER_CONTACT_AUDIENCE_V1,
  __testOnlyRunDisposableSandboxTaskCandidateV1,
  disposableSandboxTaskExecutionReceiptSha256,
  disposableTaskAbsenceEvidenceSha256,
  disposableTaskBundleSha256,
  disposableTaskCheckpointPolicySha256,
  disposableTaskInputManifestSha256,
  disposableTaskOperationDigest,
  runDisposableSandboxTask,
  type DisposableSandboxTaskAuthorityPortV1,
  type DisposableSandboxTaskExecutionContextV1,
  type DisposableSandboxTaskExecutionReceiptV1,
  type DisposableSandboxTaskRequestV1,
  type DisposableSandboxTaskRunnerV1,
  type DisposableTaskJournalPortV1,
} from "../../src/adapters/managed/disposable-task"
import { AdapterContractError } from "../../src/adapters/managed/errors"

const d = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const

function request(overrides: Partial<DisposableSandboxTaskRequestV1> = {}): DisposableSandboxTaskRequestV1 {
  const content = Buffer.from("export const answer = 42\n", "utf8")
  const files = [{
    path: "src/answer.ts",
    content_base64: content.toString("base64"),
    content_sha256: d(content),
    mode: 0o600 as const,
  }]
  const exec = {
    argv: ["/usr/bin/true"],
    cwd: "." as const,
    wall_timeout_ms: 5_000,
    idle_timeout_ms: 5_000,
    output_limit_bytes: 4_096,
    pids_limit: 4,
  }
  const checkpoint = {
    allowed_path_prefixes: ["."],
    allow_file_addition: true,
    allow_file_modification: true,
    allow_file_deletion: true,
    max_changed_files: 32,
    forbidden_content_markers_base64: [],
    max_depth: 4,
    max_duration_ms: 10_000,
    max_file_bytes: 64 * 1024,
    max_files: 32,
    max_total_bytes: 128 * 1024,
  }
  const inputManifest = disposableTaskInputManifestSha256(files)
  const base = {
    schema_version: "sandboxes.disposable-task-request/v1" as const,
    provider: "e2b" as const,
    idempotency_key_sha256: d("idempotency"),
    authority_envelope_sha256: d("authority-envelope"),
    source_manifest_sha256: d("descendant-package-source-manifest"),
    input_manifest_sha256: inputManifest,
    environment_image_sha256: d("image"),
    task_bundle_sha256: d("placeholder"),
    operation_digest: d("placeholder"),
    network_policy: "deny_all" as const,
    maximum_allocations: 1 as const,
    max_runtime_ms: 120_000,
    files,
    exec,
    checkpoint,
  }
  base.task_bundle_sha256 = disposableTaskBundleSha256(base)
  base.operation_digest = disposableTaskOperationDigest(base)
  return { ...base, ...overrides }
}

function execution(
  value: DisposableSandboxTaskRequestV1,
  authorizationConsumption: `sha256:${string}`,
  dispatchAnchor: `sha256:${string}`,
  claimFence: `sha256:${string}` = d("claim-fence"),
  leaseEpoch = 1n,
  ownershipNonce: `sha256:${string}` = d("ownership-effect"),
  effectClaim: `sha256:${string}` = d("effect-claim"),
  dispatchIntent: `sha256:${string}` = d("dispatch-intent"),
  binding: Pick<DisposableSandboxTaskExecutionContextV1, "dispatch_id" | "provider_creation_token_sha256" | "immutable_fingerprint_sha256"> = {
    dispatch_id: "dispatch-default",
    provider_creation_token_sha256: d("creation-default"),
    immutable_fingerprint_sha256: d("immutable-default"),
  },
): DisposableSandboxTaskExecutionReceiptV1 {
  const requestSha256 = d(canonicalJson(value))
  const dispatchIdSha256 = canonicalSha256(binding.dispatch_id)
  const core = {
    schema_version: "sandboxes.disposable-task-execution-receipt/v1" as const,
    provider: value.provider,
    request_sha256: requestSha256,
    idempotency_key_sha256: value.idempotency_key_sha256,
    operation_digest: value.operation_digest,
    authority_envelope_sha256: value.authority_envelope_sha256,
    source_manifest_sha256: value.source_manifest_sha256,
    input_manifest_sha256: value.input_manifest_sha256,
    authorization_consumption_receipt_sha256: authorizationConsumption,
    effect_claim_sha256: effectClaim,
    dispatch_intent_anchor_sha256: dispatchIntent,
    journal_dispatch_id_sha256: dispatchIdSha256,
    journal_dispatch_anchor_sha256: dispatchAnchor,
    journal_claim_fence_sha256: claimFence,
    journal_lease_epoch: leaseEpoch.toString(10),
    provider_effect_ownership_nonce_sha256: ownershipNonce,
    provider_ownership_binding_sha256: d("provider-ownership-binding"),
    allocation_count: 1 as const,
    network_policy: "deny_all" as const,
    provider_fingerprint_sha256: d("provider-fingerprint"),
    broker_artifact_sha256: d("artifact"),
    broker_protocol_sha256: d("protocol"),
    authenticated_session_sha256: d("session"),
    execution_receipt_sha256: d("exec"),
    workspace_readback_sha256: d("readback"),
    output_manifest_sha256: d("output-manifest"),
    output_diff_sha256: d("output-diff"),
    checkpoint_sha256: d("checkpoint"),
    checkpoint_manifest_sha256: d("manifest"),
    checkpoint_readback_sha256: d("checkpoint"),
    checkpoint_handoff_sha256: d("handoff"),
    result_bundle_sha256: d("result-bundle"),
    checkpoint_file_count: 1,
    checkpoint_total_bytes: 24,
    destroy_execution_count: 1 as const,
    get_absent: true as const,
    list_absent: true as const,
    deletion_proven: true as const,
    absence_evidence_sha256: disposableTaskAbsenceEvidenceSha256({
      dispatch_id_sha256: dispatchIdSha256,
      request_sha256: requestSha256,
      provider: value.provider,
      provider_creation_token_sha256: binding.provider_creation_token_sha256,
      immutable_fingerprint_sha256: binding.immutable_fingerprint_sha256,
      provider_fingerprint_sha256: d("provider-fingerprint"),
      provider_effect_claim_fence_sha256: claimFence,
      provider_effect_lease_epoch: leaseEpoch,
      provider_effect_ownership_nonce_sha256: ownershipNonce,
      provider_ownership_binding_sha256: d("provider-ownership-binding"),
      effect_claim_sha256: effectClaim,
      dispatch_intent_anchor_sha256: dispatchIntent,
      destroy_execution_count: 1,
      get_absent: true,
      list_absent: true,
      conflicting_scoped_matches: 0,
    }),
  }
  return { ...core, execution_receipt_core_sha256: disposableSandboxTaskExecutionReceiptSha256(core) }
}

class Authority implements DisposableSandboxTaskAuthorityPortV1 {
  calls = 0
  unavailable = false
  nowOffsetMs = 0
  receiptOverrides: Record<string, unknown> = {}
  describe() {
    return {
      durability: "durable" as const,
      implementation_sha256: d("infinity-authority-implementation"),
      trust_root_sha256: d("infinity-authority-trust-root"),
    }
  }
  async consumeOnce(input: Parameters<DisposableSandboxTaskAuthorityPortV1["consumeOnce"]>[0]) {
    this.calls += 1
    if (this.unavailable) throw new Error("authority unavailable")
    const now = Date.now() + this.nowOffsetMs
    const core = {
      schema_version: DISPOSABLE_TASK_AUTHORIZATION_CONSUMPTION_SCHEMA_V1,
      dispatch_id: input.dispatch_id,
      authority_envelope_sha256: input.authority_envelope_sha256,
      canonical_request_sha256: input.canonical_request_sha256,
      operation_digest: input.operation_digest,
      provider: input.provider,
      source_manifest_sha256: input.source_manifest_sha256,
      input_manifest_sha256: input.input_manifest_sha256,
      checkpoint_policy_sha256: input.checkpoint_policy_sha256,
      effect_claim_sha256: input.effect_claim_sha256,
      authority_epoch: "1",
      run_id: "run-1",
      attempt_id: "attempt-1",
      attempt_lease_id: "attempt-lease-1",
      lease_epoch: "1",
      model_operation_id: "model-operation-1",
      audience: DISPOSABLE_TASK_PROVIDER_CONTACT_AUDIENCE_V1,
      issued_at: new Date(now - 1_000).toISOString(),
      consumed_at: new Date(now).toISOString(),
      expires_at: new Date(now + 10_000).toISOString(),
      signer_ref: "infinity-authority",
      signer_incarnation: "incarnation-1",
      key_id: "authority-key-1",
      signature: "A".repeat(86),
      ...this.receiptOverrides,
    }
    const canonical_receipt_bytes = new TextEncoder().encode(canonicalJson(core))
    return { canonical_receipt_bytes, receipt_sha256: d(canonical_receipt_bytes) }
  }
}

class MemoryJournal implements DisposableTaskJournalPortV1 {
  prepareCalls = 0
  effects = 0
  commits = 0
  failures = 0
  readonly rows = new Map<string, {
    request: string
    dispatch: {
      dispatch_id: string; dispatch_anchor_sha256: `sha256:${string}`
      lease_epoch: bigint; claim_fence_sha256: `sha256:${string}`; lease_owner_sha256: `sha256:${string}`; lease_expires_at: string
      provider_metadata_scope_sha256: `sha256:${string}`; provider_creation_token_sha256: `sha256:${string}`; immutable_fingerprint_sha256: `sha256:${string}`
      ownership_nonce_sha256: `sha256:${string}`
      effect_claim_sha256: `sha256:${string}`; dispatch_intent_anchor_sha256: `sha256:${string}` | null
    }
    state: "PREPARED" | "DISPATCH_INTENT"
    authorization: {
      input: Parameters<DisposableSandboxTaskAuthorityPortV1["consumeOnce"]>[0]
      bytes: Uint8Array
      receipt: Awaited<ReturnType<DisposableSandboxTaskAuthorityPortV1["consumeOnce"]>> | null
    }
    completed?: { execution_receipt: DisposableSandboxTaskExecutionReceiptV1; canonical_anchor_bytes: Uint8Array; anchor_sha256: `sha256:${string}` }
  }>()

  describe() {
    return {
      durability: "volatile" as const, encrypted_at_rest: false, journal_identity_sha256: d("memory-journal"),
      restore_domain_sha256: d("memory-restore"), external_head_witness_sha256: d("memory-witness"),
      signer_principal: "test:journal", signing_key_id: "test-key",
    }
  }

  async prepareDispatch(input: Parameters<DisposableTaskJournalPortV1["prepareDispatch"]>[0]) {
    this.prepareCalls += 1
    const old = this.rows.get(input.idempotency_key_sha256)
    if (old !== undefined) {
      if (old.request !== input.request_sha256) throw new Error("idempotency_conflict")
      if (old.completed !== undefined) return {
        kind: "outcome" as const, request_sha256: input.request_sha256, outcome_kind: "succeeded" as const,
        failure_code: null, failure_evidence_sha256: null, ...old.completed,
      }
      const recoveryCore = {
        schema_version: "sandboxes.disposable-task-recovery-anchor/v1",
        dispatch_id: old.dispatch.dispatch_id,
        request_sha256: input.request_sha256,
        prior_state: old.state,
        effect_claim_sha256: old.dispatch.effect_claim_sha256,
        provider_effect_claim_fence_sha256: old.dispatch.claim_fence_sha256,
        provider_effect_lease_epoch: old.dispatch.lease_epoch,
        provider_effect_ownership_nonce_sha256: old.dispatch.ownership_nonce_sha256,
        current_claim_fence_sha256: old.dispatch.claim_fence_sha256,
        current_lease_epoch: old.dispatch.lease_epoch,
        expected_result_bundle_sha256: null,
        expected_checkpoint_handoff_sha256: null,
        expected_provider_fingerprint_sha256: null,
      }
      const canonical_recovery_record_bytes = new TextEncoder().encode(canonicalJson(recoveryCore))
      return {
        kind: "reconcile" as const, recovery: true as const, prior_state: old.state,
        request_sha256: input.request_sha256, ...old.dispatch,
        authorization: {
          canonical_consume_input_bytes: old.authorization.bytes,
          consume_input_sha256: d(old.authorization.bytes),
          consume_input: old.authorization.input,
          stored_receipt: old.authorization.receipt,
        },
        recovery_binding: {
          provider_effect_claim_fence_sha256: old.dispatch.claim_fence_sha256,
          provider_effect_lease_epoch: old.dispatch.lease_epoch,
          provider_effect_ownership_nonce_sha256: old.dispatch.ownership_nonce_sha256,
          expected_result_bundle_sha256: null,
          expected_checkpoint_handoff_sha256: null,
          expected_provider_fingerprint_sha256: null,
          canonical_recovery_record_bytes,
          recovery_record_sha256: d(canonical_recovery_record_bytes),
          canonical_signed_recovery_anchor_bytes: canonical_recovery_record_bytes.slice(),
          recovery_anchor_sha256: d(canonical_recovery_record_bytes),
        },
      }
    }
    const dispatchBase = {
      dispatch_id: `dispatch-${this.rows.size + 1}`,
      dispatch_anchor_sha256: d(`dispatch:${input.request_sha256}`),
      lease_epoch: 1n,
      claim_fence_sha256: d(`fence:${input.request_sha256}`),
      lease_owner_sha256: input.lease_owner_sha256,
      lease_expires_at: "2099-01-01T00:10:00.000Z",
      provider_metadata_scope_sha256: input.provider_metadata_scope_sha256,
      provider_creation_token_sha256: input.provider_creation_token_sha256,
      immutable_fingerprint_sha256: input.immutable_fingerprint_sha256,
      ownership_nonce_sha256: d(`ownership:${input.request_sha256}`),
    }
    const effect_claim_sha256 = canonicalSha256({
      schema_version: "sandboxes.disposable-task-effect-claim/v1",
      dispatch_id: dispatchBase.dispatch_id,
      request_sha256: input.request_sha256,
      provider: input.provider,
      provider_metadata_scope_sha256: dispatchBase.provider_metadata_scope_sha256,
      provider_creation_token_sha256: dispatchBase.provider_creation_token_sha256,
      immutable_fingerprint_sha256: dispatchBase.immutable_fingerprint_sha256,
      provider_effect_claim_fence_sha256: dispatchBase.claim_fence_sha256,
      provider_effect_lease_epoch: dispatchBase.lease_epoch,
      provider_effect_ownership_nonce_sha256: dispatchBase.ownership_nonce_sha256,
    })
    const dispatch = {
      ...dispatchBase,
      effect_claim_sha256,
      dispatch_intent_anchor_sha256: null as `sha256:${string}` | null,
    }
    const authorityInput = {
      dispatch_id: dispatch.dispatch_id,
      authority_envelope_sha256: input.authority_envelope_sha256,
      canonical_request_sha256: input.request_sha256,
      operation_digest: input.operation_digest,
      provider: input.provider,
      source_manifest_sha256: input.source_manifest_sha256,
      input_manifest_sha256: input.input_manifest_sha256,
      checkpoint_policy_sha256: input.checkpoint_policy_sha256,
      effect_claim_sha256,
    }
    const bytes = new TextEncoder().encode(canonicalJson(authorityInput))
    const authorization = { input: authorityInput, bytes, receipt: null }
    this.rows.set(input.idempotency_key_sha256, { request: input.request_sha256, dispatch, authorization, state: "PREPARED" })
    return {
      kind: "prepared" as const, recovery: false as const, request_sha256: input.request_sha256, ...dispatch,
      authorization: {
        canonical_consume_input_bytes: bytes,
        consume_input_sha256: d(bytes),
        consume_input: authorityInput,
        stored_receipt: null,
      },
    }
  }

  async bindAuthorizationAndMarkIntent(input: Parameters<DisposableTaskJournalPortV1["bindAuthorizationAndMarkIntent"]>[0]) {
    const row = [...this.rows.values()].find((candidate) => candidate.dispatch.dispatch_id === input.dispatch_id)
    if (row === undefined) throw new Error("missing row")
    row.authorization.receipt = input.authorization_receipt
    const dispatch_intent_anchor_sha256 = d(`intent:${input.effect_claim_sha256}`)
    row.dispatch.dispatch_intent_anchor_sha256 = dispatch_intent_anchor_sha256
    row.state = "DISPATCH_INTENT"
    return {
      authorization_consumption_receipt_sha256: input.authorization_receipt.receipt_sha256,
      dispatch_intent_anchor_sha256,
    }
  }

  async assertWitnessCurrent() { return { witness_receipt_sha256: d("witness-current") } }

  async markDispatched(input: Parameters<DisposableTaskJournalPortV1["markDispatched"]>[0]) {
    return { dispatch_anchor_sha256: d(`dispatched:${input.dispatch_id}`) }
  }

  async markResultPersisted(input: Parameters<DisposableTaskJournalPortV1["markResultPersisted"]>[0]) {
    return { result_persisted_anchor_sha256: d(`result:${input.dispatch_id}`) }
  }

  async commitOutcome(input: Parameters<DisposableTaskJournalPortV1["commitOutcome"]>[0]) {
    this.commits += 1
    const row = [...this.rows.values()].find((candidate) => candidate.dispatch.dispatch_id === input.dispatch_id)
    if (row === undefined || row.request !== input.request_sha256) throw new Error("journal_conflict")
    if (row.completed !== undefined) return { kind: "outcome" as const, request_sha256: input.request_sha256, outcome_kind: "succeeded" as const, failure_code: null, failure_evidence_sha256: null, ...row.completed }
    if (input.execution_receipt === null) throw new Error("missing receipt")
    const anchorCore = {
      schema_version: "sandboxes.disposable-task-outcome-anchor/v1",
      dispatch_id: input.dispatch_id,
      request_sha256: input.request_sha256,
      execution_receipt_sha256: input.execution_receipt.execution_receipt_core_sha256,
      outcome: "succeeded",
    }
    const canonical_anchor_bytes = new TextEncoder().encode(canonicalJson(anchorCore))
    row.completed = {
      execution_receipt: input.execution_receipt,
      canonical_anchor_bytes,
      anchor_sha256: d(canonical_anchor_bytes),
    }
    return { kind: "outcome" as const, request_sha256: input.request_sha256, outcome_kind: "succeeded" as const, failure_code: null, failure_evidence_sha256: null, ...row.completed }
  }

  async quarantine(input: Parameters<DisposableTaskJournalPortV1["quarantine"]>[0]) {
    this.failures += 1
    const canonical_anchor_bytes = new TextEncoder().encode(canonicalJson(input))
    return { kind: "quarantined" as const, request_sha256: input.request_sha256, quarantine_reason: input.quarantine_reason, quarantine_evidence_sha256: input.quarantine_evidence_sha256, canonical_anchor_bytes, anchor_sha256: d(canonical_anchor_bytes) }
  }
}

function runner(callCounter: { value: number }): DisposableSandboxTaskRunnerV1 {
  return {
    provider: "e2b",
    describe() {
      return {
        provider: "e2b",
        implementation_sha256: d("descendant-e2b-runner"),
        checkpoint_handoff_durability: "volatile",
        checkpoint_readback_verified: true,
      }
    },
    async run(value, context) {
      callCounter.value += 1
      return execution(value, context.authorization_consumption_receipt_sha256, context.journal_dispatch_anchor_sha256,
        context.journal_claim_fence_sha256, context.journal_lease_epoch, context.ownership_nonce_sha256,
        context.effect_claim_sha256, context.dispatch_intent_anchor_sha256, context)
    },
    async reconcile(value, context) {
      return execution(value, context.authorization_consumption_receipt_sha256, context.journal_dispatch_anchor_sha256,
        context.journal_claim_fence_sha256, context.journal_lease_epoch, context.ownership_nonce_sha256,
        context.effect_claim_sha256, context.dispatch_intent_anchor_sha256, context)
    },
    async contain() {
      return { absence_evidence_sha256: d("contained"), get_absent: true, list_absent: true, conflicting_scoped_matches: 0 }
    },
  }
}

const outcomeVerifier = {
  describe: () => ({ implementation_sha256: d("outcome-verifier"), trust_root_sha256: d("journal-trust") }),
  async assertVerified() {},
}

const witness = {
  describe: () => ({ durability: "durable" as const, restore_domain_sha256: d("witness-restore"), witness_identity_sha256: d("memory-witness") }),
  async readHead() { return null },
  async compareAndAdvance(input: { successor_sequence: bigint; successor_frontier_sha256: `sha256:${string}` }) {
    const core = { sequence: input.successor_sequence, frontier_sha256: input.successor_frontier_sha256 }
    const canonical_receipt_bytes = new TextEncoder().encode(canonicalJson(core))
    return { ...core, canonical_receipt_bytes, receipt_sha256: d(canonical_receipt_bytes) }
  },
}

function dependencies(calls: { value: number }, journal = new MemoryJournal(), authority = new Authority()) {
  return { runner: runner(calls), journal, authority, outcome_verifier: outcomeVerifier, witness, lease_owner_sha256: d("test-executor") }
}

describe("provider-neutral disposable task surface", () => {
  test("production gate is false and blocks before authority, journal, or provider", async () => {
    expect(DISPOSABLE_SANDBOX_TASK_PRODUCTION_ADMISSION_V1).toBe(false)
    const calls = { value: 0 }
    const journal = new MemoryJournal()
    const authority = new Authority()
    await expect(runDisposableSandboxTask(request(), dependencies(calls, journal, authority)))
      .rejects.toMatchObject({ code: "unsupported_runtime_feature" })
    expect(calls.value).toBe(0)
    expect(authority.calls).toBe(0)
    expect(journal.prepareCalls).toBe(0)
  })

  test("consumes authority after durable dispatch and returns only closed sanitized evidence", async () => {
    const input = request()
    const calls = { value: 0 }
    const result = await __testOnlyRunDisposableSandboxTaskCandidateV1(input, dependencies(calls))
    expect(calls.value).toBe(1)
    expect(result).toMatchObject({
      authority_envelope_sha256: input.authority_envelope_sha256,
      source_manifest_sha256: input.source_manifest_sha256,
      input_manifest_sha256: input.input_manifest_sha256,
      allocation_count: 1,
      destroy_execution_count: 1,
      deletion_proven: true,
    })
    const serialized = JSON.stringify(result)
    for (const forbidden of ["sandboxId", "apiKey", "stdout", "stderr", "run_id", "attempt_id", "provider_resource_id"]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test("completed replay is byte-identical without re-consuming authority or reaching provider", async () => {
    const input = request()
    const calls = { value: 0 }
    const journal = new MemoryJournal()
    const authority = new Authority()
    const deps = dependencies(calls, journal, authority)
    const first = await __testOnlyRunDisposableSandboxTaskCandidateV1(input, deps)
    const second = await __testOnlyRunDisposableSandboxTaskCandidateV1(structuredClone(input), deps)
    expect(calls.value).toBe(1)
    expect(authority.calls).toBe(1)
    expect(journal.commits).toBe(1)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  test("changed request under the same key conflicts before authority or provider", async () => {
    const input = request()
    const changedDraft = request({ idempotency_key_sha256: input.idempotency_key_sha256 })
    changedDraft.files[0] = { ...changedDraft.files[0]!, content_base64: Buffer.from("changed").toString("base64"), content_sha256: d("changed") }
    const calls = { value: 0 }
    const journal = new MemoryJournal()
    const authority = new Authority()
    const deps = dependencies(calls, journal, authority)
    await __testOnlyRunDisposableSandboxTaskCandidateV1(input, deps)
    await expect(__testOnlyRunDisposableSandboxTaskCandidateV1(changedDraft, deps)).rejects.toBeInstanceOf(AdapterContractError)
    expect(calls.value).toBe(1)
    expect(authority.calls).toBe(1)
  })

  test("rejects caller-asserted manifest, bundle, or operation digests", async () => {
    for (const changed of [
      request({ input_manifest_sha256: d("false-input") }),
      request({ task_bundle_sha256: d("false-bundle") }),
      request({ operation_digest: d("false-operation") }),
    ]) {
      await expect(__testOnlyRunDisposableSandboxTaskCandidateV1(changed, dependencies({ value: 0 })))
        .rejects.toMatchObject({ code: "validation_failed" })
    }
  })

  test("rejects a receipt with one changed opaque authority binding", async () => {
    const input = request()
    const calls = { value: 0 }
    const bad = runner(calls)
    bad.run = async (value, context) => ({
      ...execution(value, context.authorization_consumption_receipt_sha256, context.journal_dispatch_anchor_sha256),
      authority_envelope_sha256: d("other"),
    })
    const deps = dependencies(calls)
    deps.runner = bad
    await expect(__testOnlyRunDisposableSandboxTaskCandidateV1(input, deps)).rejects.toBeInstanceOf(AdapterContractError)
  })

  test("authority receipt binds checkpoint policy and stable dispatch identity exactly", async () => {
    const input = request()
    const authority = new Authority()
    await __testOnlyRunDisposableSandboxTaskCandidateV1(input, dependencies({ value: 0 }, new MemoryJournal(), authority))
    expect(authority.calls).toBe(1)
    expect(disposableTaskCheckpointPolicySha256(input.checkpoint)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test("rejects malformed signed currentness and provider-contact receipt fields", async () => {
    for (const receiptOverrides of [
      { audience: "wrong-audience" },
      { authority_epoch: "0" },
      { lease_epoch: "9223372036854775808" },
      { run_id: "A".repeat(49) },
      { signer_ref: "sk-secret-shaped" },
      { signature: "A".repeat(85) },
    ]) {
      const authority = new Authority()
      authority.receiptOverrides = receiptOverrides
      const calls = { value: 0 }
      await expect(__testOnlyRunDisposableSandboxTaskCandidateV1(
        request(), dependencies(calls, new MemoryJournal(), authority),
      )).rejects.toMatchObject({ code: "integrity_failed" })
      expect(calls.value).toBe(0)
    }
  })

  test("rejects an authority receipt consumed beyond the bounded future clock skew", async () => {
    const authority = new Authority()
    authority.nowOffsetMs = 6_000
    const calls = { value: 0 }
    await expect(__testOnlyRunDisposableSandboxTaskCandidateV1(
      request(), dependencies(calls, new MemoryJournal(), authority),
    )).rejects.toMatchObject({ code: "integrity_failed" })
    expect(calls.value).toBe(0)
  })

  test("takeover reuses exact stored authorization while the authority is down", async () => {
    const input = request()
    const calls = { value: 0 }
    const journal = new MemoryJournal()
    const authority = new Authority()
    const first = dependencies(calls, journal, authority)
    first.runner.run = async () => { throw new Error("crash after authorization bind") }
    await expect(__testOnlyRunDisposableSandboxTaskCandidateV1(input, first)).rejects.toMatchObject({
      code: "provider_state_unknown",
    })
    expect(authority.calls).toBe(1)
    authority.unavailable = true
    const recovered = await __testOnlyRunDisposableSandboxTaskCandidateV1(input, dependencies(calls, journal, authority))
    expect(recovered.deletion_proven).toBe(true)
    expect(authority.calls).toBe(1)
  })

  test("takeover without a bound receipt contains and quarantines without authority contact", async () => {
    const input = request()
    const journal = new MemoryJournal()
    const authority = new Authority()
    const prepared = await journal.prepareDispatch({
      idempotency_key_sha256: input.idempotency_key_sha256,
      request_sha256: d(canonicalJson(input)),
      canonical_request_bytes: new TextEncoder().encode(canonicalJson(input)),
      operation_digest: input.operation_digest,
      authority_envelope_sha256: input.authority_envelope_sha256,
      source_manifest_sha256: input.source_manifest_sha256,
      input_manifest_sha256: input.input_manifest_sha256,
      checkpoint_policy_sha256: disposableTaskCheckpointPolicySha256(input.checkpoint),
      provider: input.provider,
      provider_metadata_scope_sha256: d("scope"),
      provider_creation_token_sha256: d("creation"),
      immutable_fingerprint_sha256: d("fingerprint"),
      lease_owner_sha256: d("owner"),
      lease_duration_ms: 60_000,
    })
    expect(prepared.kind).toBe("prepared")
    let contained = 0
    const deps = dependencies({ value: 0 }, journal, authority)
    deps.runner.contain = async () => {
      contained += 1
      return { absence_evidence_sha256: d("contained"), get_absent: true, list_absent: true, conflicting_scoped_matches: 0 }
    }
    await expect(__testOnlyRunDisposableSandboxTaskCandidateV1(input, deps)).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(contained).toBe(1)
    expect(authority.calls).toBe(0)
  })
})
