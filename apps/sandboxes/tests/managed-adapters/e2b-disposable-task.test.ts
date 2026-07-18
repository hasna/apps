import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { canonicalSha256, parseCanonicalJson } from "../../src/adapters/managed/canonical"
import {
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
  e2bGuestBrokerBootstrapCommandV1,
  e2bGuestBrokerCheckpointHashesV1,
} from "../../src/adapters/managed/e2b-guest-broker"
import {
  DaytonaMailboxBoundaryErrorV1,
  E2bWorkspaceBootstrapBoundaryErrorV1,
} from "../../src/adapters/managed/e2b-broker-artifact-control"
import {
  __testOnlyCreateE2bDisposableSandboxTaskRunnerV1,
  __testOnlyCreateManagedDisposableSandboxTaskRunnerV1,
  type E2bDisposableBrokerPortV1,
  type E2bDisposableControlPortV1,
} from "../../src/adapters/managed/e2b-disposable-task"
import {
  DISPOSABLE_TASK_AUTHORIZATION_CONSUMPTION_SCHEMA_V2,
  DISPOSABLE_TASK_PROVIDER_CONTACT_AUDIENCE_V2,
  authorizePreparedDisposableSandboxTaskV2,
  disposableSandboxTaskIntentSha256V2,
  disposableTaskBundleSha256,
  disposableTaskCheckpointPolicySha256,
  disposableTaskInputManifestSha256,
  disposableTaskOperationDigest,
  createDisposableSandboxTaskExecutionContextV2,
  type CheckpointHandoffInputV1,
  type CheckpointHandoffPortV1,
  type DisposableSandboxTaskExecutionContextV1,
  type DisposableSandboxTaskIntentV2,
  type DisposableSandboxTaskRequestV1,
  type DisposableTaskJournalPortV2,
} from "../../src/adapters/managed/disposable-task"
import type { AdapterProviderResourceV1, ProviderEffectTargetV1 } from "../../src/adapters/managed/types"
import {
  DAYTONA_EXECUTION_IDENTITY_ATTESTATION_COMMAND_V1,
  DaytonaOfficialResourceAccessBridgeV1,
  daytonaRoleCommandV1,
} from "../../src/adapters/managed/daytona-disposable-task"

const d = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const

function authorityEnvelopeBytes(provider: DisposableSandboxTaskRequestV1["provider"]): Uint8Array {
  return new TextEncoder().encode(infinityCanonicalJson({ proof: canonicalSha256({ provider }) }))
}

function infinityCanonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(infinityCanonicalJson).join(",")}]`
  if (typeof value !== "object") throw new TypeError("unsafe fixture")
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${infinityCanonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`
}

function request(
  checkpointOverrides: Partial<DisposableSandboxTaskRequestV1["checkpoint"]> = {},
  provider: DisposableSandboxTaskRequestV1["provider"] = "e2b",
): DisposableSandboxTaskRequestV1 {
  const content = Buffer.from("bounded-live-proof\n", "utf8")
  const files = [{ path: "proof.txt", content_base64: content.toString("base64"), content_sha256: d(content), mode: 0o600 as const }]
  const exec = { argv: ["/usr/bin/true"], cwd: "." as const, wall_timeout_ms: 5_000, idle_timeout_ms: 5_000, output_limit_bytes: 4_096, pids_limit: 4 }
  const checkpoint = {
    allowed_path_prefixes: ["."], allow_file_addition: true, allow_file_modification: true,
    allow_file_deletion: true, max_changed_files: 32, forbidden_content_markers_base64: [],
    max_depth: 4, max_duration_ms: 10_000, max_file_bytes: 64 * 1024, max_files: 32, max_total_bytes: 128 * 1024,
    ...checkpointOverrides,
  }
  const value = {
    schema_version: "sandboxes.disposable-task-request/v1" as const,
    provider,
    idempotency_key_sha256: d("idem"),
    operation_digest: d("placeholder"),
    authority_envelope_sha256: d(authorityEnvelopeBytes(provider)),
    source_manifest_sha256: d("descendant-package-and-source-manifest"),
    input_manifest_sha256: disposableTaskInputManifestSha256(files),
    environment_image_sha256: d("base-template-mapping"),
    task_bundle_sha256: d("placeholder"),
    network_policy: "deny_all" as const,
    maximum_allocations: 1 as const,
    max_runtime_ms: 120_000,
    files, exec, checkpoint,
  }
  value.task_bundle_sha256 = disposableTaskBundleSha256(value)
  value.operation_digest = disposableTaskOperationDigest(value)
  return value
}

function context(events: string[]): DisposableSandboxTaskExecutionContextV1 {
  return {
    dispatch_id: "dispatch-1",
    journal_dispatch_id_sha256: canonicalSha256("dispatch-1"),
    journal_dispatch_anchor_sha256: d("dispatch-anchor"),
    journal_claim_fence_sha256: d("claim-fence"),
    journal_lease_epoch: 1n,
    journal_lease_expires_at: "2099-01-01T00:10:00.000Z",
    provider_metadata_scope_sha256: d("metadata-scope"),
    provider_creation_token_sha256: d("creation-token"),
    immutable_fingerprint_sha256: d("immutable-fingerprint"),
    ownership_nonce_sha256: d("ownership-nonce"),
    recovery_expected_result_bundle_sha256: null,
    recovery_expected_checkpoint_handoff_sha256: null,
    recovery_expected_provider_fingerprint_sha256: null,
    authorization_consumption_receipt_sha256: d("authorization-consumption"),
    effect_claim_sha256: d("effect-claim"),
    dispatch_intent_anchor_sha256: d("dispatch-intent"),
    async markDispatched() { events.push("mark-dispatched"); return d("dispatched") },
    async markResultPersisted() { events.push("mark-result"); return d("result-persisted") },
  }
}

async function v2Context(
  events: string[],
  requestValue: DisposableSandboxTaskRequestV1,
  leaseExpiresAt = "2099-01-01T00:10:00.000Z",
) {
  const provider = requestValue.provider
  const intent: DisposableSandboxTaskIntentV2 = {
    schema_version: "sandboxes.disposable-task-intent/v2",
    provider,
    idempotency_key_sha256: requestValue.idempotency_key_sha256,
    operation_digest: requestValue.operation_digest,
    source_manifest_sha256: requestValue.source_manifest_sha256,
    input_manifest_sha256: requestValue.input_manifest_sha256,
    environment_image_sha256: requestValue.environment_image_sha256,
    task_bundle_sha256: requestValue.task_bundle_sha256,
    network_policy: requestValue.network_policy,
    maximum_allocations: requestValue.maximum_allocations,
    max_runtime_ms: requestValue.max_runtime_ms,
    files: requestValue.files,
    exec: requestValue.exec,
    checkpoint: requestValue.checkpoint,
  }
  const journalIdentitySha256 = d(`v2-journal-${provider}`)
  const restoreDomainSha256 = d(`v2-restore-${provider}`)
  const canonicalIntentSha256 = disposableSandboxTaskIntentSha256V2(intent)
  const dispatchId = `dt2_${canonicalSha256({
    domain: "sandboxes.disposable-task-journal.dispatch-id/v2",
    journal_identity_sha256: journalIdentitySha256,
    idempotency_key_sha256: intent.idempotency_key_sha256,
    canonical_intent_sha256: canonicalIntentSha256,
  }).slice(7)}`
  const sandboxPrepareAnchorSha256 = d(`v2-prepare-${provider}`)
  const claimFenceSha256 = d(`v2-claim-fence-${provider}`)
  const effectOwnershipNonceSha256 = d("ownership-nonce")
  const providerMetadataScopeSha256 = canonicalSha256({
    schema_version: "sandboxes.disposable-task-provider-scope/v2",
    provider,
    canonical_intent_sha256: canonicalIntentSha256,
    idempotency_key_sha256: intent.idempotency_key_sha256,
  })
  const providerCreationTokenSha256 = canonicalSha256({
    schema_version: "sandboxes.disposable-task-creation-token/v2",
    provider_metadata_scope_sha256: providerMetadataScopeSha256,
  })
  const immutableFingerprintSha256 = canonicalSha256({
    schema_version: "sandboxes.disposable-task-provider-fingerprint/v2",
    provider_metadata_scope_sha256: providerMetadataScopeSha256,
    environment_image_sha256: intent.environment_image_sha256,
    source_manifest_sha256: intent.source_manifest_sha256,
    input_manifest_sha256: intent.input_manifest_sha256,
  })
  const effectClaimSha256 = canonicalSha256({
    schema_version: "sandboxes.disposable-task-effect-claim/v2",
    journal_identity_sha256: journalIdentitySha256,
    restore_domain_sha256: restoreDomainSha256,
    dispatch_id: dispatchId,
    canonical_intent_sha256: canonicalIntentSha256,
    provider,
    provider_metadata_scope_sha256: providerMetadataScopeSha256,
    provider_creation_token_sha256: providerCreationTokenSha256,
    immutable_fingerprint_sha256: immutableFingerprintSha256,
    provider_effect_claim_fence_sha256: claimFenceSha256,
    provider_effect_lease_epoch: 1n,
    provider_effect_ownership_nonce_sha256: effectOwnershipNonceSha256,
  })
  const preparedCore = {
    schema_version: "sandboxes.disposable-task-prepared/v2" as const,
    dispatch_id: dispatchId,
    canonical_intent_sha256: canonicalIntentSha256,
    sandbox_prepare_anchor_sha256: sandboxPrepareAnchorSha256,
    operation_digest: intent.operation_digest,
    provider,
    source_manifest_sha256: intent.source_manifest_sha256,
    input_manifest_sha256: intent.input_manifest_sha256,
    checkpoint_policy_sha256: disposableTaskCheckpointPolicySha256(intent.checkpoint),
    effect_claim_sha256: effectClaimSha256,
  }
  const prepared = { ...preparedCore, prepared_sha256: canonicalSha256(preparedCore) }
  const claim = {
    kind: "prepared" as const,
    recovery: false as const,
    dispatch_id: dispatchId,
    canonical_intent_sha256: canonicalIntentSha256,
    lease_epoch: 1n,
    claim_fence_sha256: claimFenceSha256,
    lease_owner_sha256: d(`v2-lease-owner-${provider}`),
    lease_expires_at: leaseExpiresAt,
    provider_metadata_scope_sha256: providerMetadataScopeSha256,
    provider_creation_token_sha256: providerCreationTokenSha256,
    immutable_fingerprint_sha256: immutableFingerprintSha256,
    ownership_nonce_sha256: d(`v2-current-ownership-${provider}`),
    provider_effect_claim_fence_sha256: claimFenceSha256,
    provider_effect_lease_epoch: 1n,
    provider_effect_ownership_nonce_sha256: effectOwnershipNonceSha256,
    effect_claim_sha256: effectClaimSha256,
    sandbox_prepare_anchor_sha256: sandboxPrepareAnchorSha256,
    dispatch_intent_anchor_sha256: null,
    expected_provider_fingerprint_sha256: null,
    expected_provider_dispatch_anchor_sha256: null,
    expected_provider_allocation_sha256: null,
    expected_result_bundle_sha256: null,
    expected_checkpoint_handoff_sha256: null,
    expected_result_persisted_anchor_sha256: null,
  }
  let dispatchedInput: Parameters<DisposableTaskJournalPortV2["markDispatchedIntentV2"]>[0] | undefined
  let resultInput: Parameters<DisposableTaskJournalPortV2["markResultPersistedIntentV2"]>[0] | undefined
  const journal = {
    describe: () => ({
      durability: "durable" as const, encrypted_at_rest: true,
      journal_identity_sha256: journalIdentitySha256, restore_domain_sha256: restoreDomainSha256,
      external_head_witness_sha256: d("v2-witness"), signer_principal: "v2-journal",
      signing_key_id: "v2-key",
    }),
    async assertWitnessCurrent() { return { witness_receipt_sha256: d("v2-witness-receipt") } },
    async prepareIntentV2() {
      return { ...claim, prepared, stored_authorization: null }
    },
    async bindAuthorizationAndMarkIntentV2(input: Parameters<DisposableTaskJournalPortV2["bindAuthorizationAndMarkIntentV2"]>[0]) {
      return {
        authority_envelope_sha256: requestValue.authority_envelope_sha256,
        authorization_consumption_receipt_sha256: input.authorization.receipt_sha256,
        dispatch_intent_anchor_sha256: d(`v2-intent-anchor-${provider}`),
      }
    },
    async quarantineAuthorizationV2() { throw new Error("unused V2 quarantine") },
    async markDispatchedIntentV2(input: Parameters<DisposableTaskJournalPortV2["markDispatchedIntentV2"]>[0]) {
      events.push("mark-dispatched")
      dispatchedInput = input
      return {
        provider_dispatch_anchor_sha256: d(`v2-dispatch-anchor-${provider}`),
        provider_allocation_sha256: d(`v2-allocation-${provider}`),
      }
    },
    async markResultPersistedIntentV2(input: Parameters<DisposableTaskJournalPortV2["markResultPersistedIntentV2"]>[0]) {
      events.push("mark-result")
      resultInput = input
      return { result_persisted_anchor_sha256: d(`v2-result-anchor-${provider}`) }
    },
  } satisfies DisposableTaskJournalPortV2
  const envelopeBytes = authorityEnvelopeBytes(provider)
  if (d(envelopeBytes) !== requestValue.authority_envelope_sha256) throw new Error("invalid V2 request fixture")
  const authority = {
    describe: () => ({
      durability: "durable" as const,
      implementation_sha256: d("v2-authority-implementation"),
      trust_root_sha256: d("v2-authority-trust-root"),
    }),
    async consumeOnceV2(input: Record<string, unknown>) {
      const now = Date.now()
      const receipt = {
        schema_version: DISPOSABLE_TASK_AUTHORIZATION_CONSUMPTION_SCHEMA_V2,
        ...input,
        authority_epoch: "1",
        run_id: "run-v2",
        attempt_id: "attempt-v2",
        attempt_lease_id: "attempt-lease-v2",
        lease_epoch: "1",
        model_operation_id: "model-operation-v2",
        audience: DISPOSABLE_TASK_PROVIDER_CONTACT_AUDIENCE_V2,
        issued_at: new Date(now - 1_000).toISOString(),
        consumed_at: new Date(now).toISOString(),
        expires_at: new Date(now + 10_000).toISOString(),
        signer_ref: "infinity-authority-v2",
        signer_incarnation: "incarnation-v2",
        key_id: "authority-key-v2",
        signature: "A".repeat(86),
      }
      const canonicalReceiptBytes = new TextEncoder().encode(infinityCanonicalJson(receipt))
      return {
        canonical_authority_envelope_bytes: envelopeBytes,
        authority_envelope_sha256: requestValue.authority_envelope_sha256,
        canonical_receipt_bytes: canonicalReceiptBytes,
        receipt_sha256: d(canonicalReceiptBytes),
      }
    },
  }
  const witness = {
    describe: () => ({
      durability: "durable" as const,
      restore_domain_sha256: d("v2-witness-restore"),
      witness_identity_sha256: d("v2-witness"),
    }),
    async readHead() { return null },
    async compareAndAdvance() { throw new Error("unused") },
  }
  const boundAuthorization = await authorizePreparedDisposableSandboxTaskV2({
    intent,
    prepared,
    authority_envelope_sha256: requestValue.authority_envelope_sha256,
  }, {
    journal,
    authority,
    expected_authority_trust_root_sha256: d("v2-authority-trust-root"),
    witness,
    lease_owner_sha256: claim.lease_owner_sha256,
  })
  return {
    context: createDisposableSandboxTaskExecutionContextV2({
      intent,
      request: requestValue,
      prepared,
      boundAuthorization,
      claim: { ...claim, dispatch_intent_anchor_sha256: boundAuthorization.dispatch_intent_anchor_sha256 },
      journal,
    }),
    get dispatchedInput() { return dispatchedInput },
    get resultInput() { return resultInput },
  }
}

class FakeControl implements E2bDisposableControlPortV1 {
  readonly events: string[]
  alive = false
  createCalls = 0
  destroyCalls = 0
  target: ProviderEffectTargetV1 | undefined
  resource: AdapterProviderResourceV1 | undefined
  collision: AdapterProviderResourceV1 | undefined
  collisionAlive = false
  addCollision = false
  substituteOwnershipOnActivate = false
  constructor(events: string[]) { this.events = events }

  async createInert(input: Parameters<E2bDisposableControlPortV1["createInert"]>[0]) {
    this.events.push("create")
    this.createCalls += 1
    this.alive = true
    this.target = input.target
    this.resource = {
      opaque_resource_id: "raw-provider-id-must-not-escape",
      provider_creation_token_sha256: input.target.provider_creation_token_sha256,
      immutable_fingerprint_sha256: input.target.immutable_fingerprint_sha256,
      provider_created_at: "2026-07-11T00:00:00.000Z",
      provider_resource_version: d("resource-version"),
      state: "inert",
      provider_runtime_state: "paused",
      network_policy: { mode: "deny_all", policy_sha256: input.initial_network_policy.policy_sha256, enforced_outside_guest: true, public_ingress: false, dns_denied: true, observed_at: "2026-07-11T00:00:00.000Z" },
      auto_delete_disabled: true,
      ephemeral: false,
      owned: true,
      source_attached: false,
      credential_attached: false,
      guest_broker_bootstrapped: false,
      ownership: {
        installation_id_sha256: d("installation"),
        provider_scope_ref_sha256: d("scope"),
        ownership_nonce_sha256: canonicalSha256(input.ownership.ownership_nonce),
      },
    }
    if (this.addCollision) {
      this.collision = {
        ...this.resource,
        opaque_resource_id: "wrong-nonce-collision-must-survive",
        ownership: { ...this.resource.ownership, ownership_nonce_sha256: d("wrong-ownership") },
      }
      this.collisionAlive = true
    }
    return this.resource
  }
  async activateResource() {
    this.events.push("activate")
    const activated = { ...this.resource!, state: "active" as const, provider_runtime_state: "active" as const }
    if (this.substituteOwnershipOnActivate) {
      activated.ownership = { ...activated.ownership, ownership_nonce_sha256: d("substituted-ownership") }
      this.resource = activated
    }
    return activated
  }
  async destroyResource(id: string, _version: string, _target: ProviderEffectTargetV1, expectedOwnershipNonceSha256: `sha256:${string}`) {
    this.events.push("destroy")
    if (id === this.resource?.opaque_resource_id) {
      if (this.resource.ownership.ownership_nonce_sha256 !== expectedOwnershipNonceSha256) throw new Error("ownership CAS failed")
      this.alive = false
    }
    if (id === this.collision?.opaque_resource_id) this.collisionAlive = false
    this.destroyCalls += 1
  }
  async inspectResource(id: string) {
    this.events.push("get")
    if (this.alive && id === this.resource?.opaque_resource_id) return this.resource
    if (this.collisionAlive && id === this.collision?.opaque_resource_id) return this.collision
    return "absent" as const
  }
  async findByCreationToken() {
    this.events.push("list")
    return { items: [...(this.alive ? [this.resource!] : []), ...(this.collisionAlive ? [this.collision!] : [])] }
  }
}

class FakeHandoff implements CheckpointHandoffPortV1 {
  readonly events: string[]
  fail = false
  calls = 0
  stored: Awaited<ReturnType<CheckpointHandoffPortV1["putAndReadback"]>> | undefined
  checkpointBytes: Uint8Array | undefined
  constructor(events: string[]) { this.events = events }
  describe() { return { durability: "durable" as const, encrypted_at_rest: true, readback_verified: true, store_identity_sha256: d("store") } }
  async putAndReadback(input: CheckpointHandoffInputV1) {
    this.events.push("handoff")
    this.calls += 1
    if (this.fail) throw new Error("provider text")
    this.checkpointBytes = input.checkpoint_bytes.slice()
    const receipt = {
      schema_version: "sandboxes.checkpoint-handoff-receipt/v1" as const,
      dispatch_id: input.dispatch_id,
      request_sha256: input.request_sha256,
      input_manifest_sha256: input.input_manifest_sha256,
      effect_claim_sha256: input.effect_claim_sha256,
      dispatch_intent_anchor_sha256: input.dispatch_intent_anchor_sha256,
      authorization_consumption_receipt_sha256: input.authorization_consumption_receipt_sha256,
      journal_claim_fence_sha256: input.journal_claim_fence_sha256,
      journal_lease_epoch: input.journal_lease_epoch.toString(10),
      provider_effect_ownership_nonce_sha256: input.provider_effect_ownership_nonce_sha256,
      provider_ownership_binding_sha256: input.provider_ownership_binding_sha256,
      checkpoint_sha256: input.checkpoint_sha256,
      checkpoint_readback_sha256: input.checkpoint_sha256,
      checkpoint_manifest_sha256: input.checkpoint_manifest_sha256,
      file_count: input.file_count,
      total_bytes: input.total_bytes,
      handoff_receipt_sha256: d("handoff"),
      result_bundle_sha256: d("result-bundle"),
      result_signature_sha256: d("result-signature"),
      provider_fingerprint_sha256: input.provider_fingerprint_sha256,
      broker_artifact_sha256: input.broker_artifact_sha256,
      broker_protocol_sha256: input.broker_protocol_sha256,
      authenticated_session_sha256: input.authenticated_session_sha256,
      execution_receipt_sha256: input.execution_receipt_sha256,
      workspace_readback_sha256: input.workspace_readback_sha256,
      output_manifest_sha256: input.output_manifest_sha256,
      output_diff_sha256: input.output_diff_sha256,
    }
    this.stored = receipt
    return receipt
  }
  async lookupVerified(input: Parameters<CheckpointHandoffPortV1["lookupVerified"]>[0]) {
    if (this.stored === undefined) return "absent" as const
    if (input.expected_result_bundle_sha256 !== null && input.expected_result_bundle_sha256 !== this.stored.result_bundle_sha256) return "absent" as const
    if (input.expected_checkpoint_handoff_sha256 !== null && input.expected_checkpoint_handoff_sha256 !== this.stored.handoff_receipt_sha256) return "absent" as const
    return this.stored
  }
}

type WorkspaceMutation = "none" | "modify-add" | "chmod" | "delete" | "deep" | "escape" | "oversize" | "canary"

function broker(events: string[], mutation: WorkspaceMutation): E2bDisposableBrokerPortV1 {
  const files = new Map<string, Buffer>()
  let exactDestructionPort: object | undefined
  const assertExactDestructionPort = (value: object): void => {
    const descriptor = Object.getOwnPropertyDescriptor(value, "destroyAndProveAbsent")
    if (Reflect.ownKeys(value).length !== 1 || descriptor?.get !== undefined ||
      descriptor?.set !== undefined || typeof descriptor?.value !== "function") {
      throw new Error("broker received an ambient destruction object")
    }
  }
  return {
    async loadArtifact() { events.push("artifact-load"); return new Uint8Array([1, 2, 3]) },
    async install(control, artifact) {
      assertExactDestructionPort(control.destruction)
      exactDestructionPort = control.destruction
      events.push("destruction-port-exact")
      events.push("artifact-install"); artifact.fill(0)
      return { path: "/opt/hasna/bin/sandboxes-broker-v1", artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1, byte_length: 65_714, mode: 0o500, owner: "root", group: "root" }
    },
    async withSession(_commands, destruction, _attestation, _binding, _key, use) {
      assertExactDestructionPort(destruction)
      if (destruction !== exactDestructionPort) throw new Error("broker destruction capability changed")
      events.push("session")
      return use({ exchangeAuthenticatedLine: async () => new Uint8Array() }, { schema_version: "sandboxes.e2b-guest-broker-response/v1", protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1, session_binding_sha256: d("session"), request_id: "startup", sequence: 0, nonce_sha256: d("nonce"), operation: "startup", ok: true, result: { uid: 0, gid: 0, verified_fd: true, artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1, production_admission: false }, mac_sha256: d("mac") })
    },
    async exchange(_session, input) {
      events.push(input.operation)
      if (input.operation === "file_write") {
        const content = Buffer.from(String(input.payload.content_base64), "base64"); files.set(String(input.payload.path), content)
        return response(input, { path: input.payload.path, size: content.length, mode: input.payload.mode, sha256: d(content) })
      }
      if (input.operation === "file_read") {
        const content = files.get(String(input.payload.path))!
        return response(input, { path: input.payload.path, offset: 0, size: content.length, total_size: content.length, sha256: d(content), content_base64: content.toString("base64") })
      }
      if (input.operation === "exec") {
        if (mutation === "modify-add") {
          files.set("proof.txt", Buffer.from("modified\n"))
          files.set("generated.txt", Buffer.from("generated\n"))
        } else if (mutation === "delete") files.delete("proof.txt")
        else if (mutation === "deep") files.set("one/two/deep.txt", Buffer.from("deep"))
        else if (mutation === "escape") files.set("../escape.txt", Buffer.from("escape"))
        else if (mutation === "oversize") files.set("large.bin", Buffer.alloc(70 * 1024, 7))
        else if (mutation === "canary") files.set("leak.txt", Buffer.from("prefix-CANARY-LEAK-suffix"))
        return response(input, { status: "exited", exit_code: 0, stdout_base64: "", stderr_base64: "", output_truncated: false, destroy_required: false, checkpoint_eligible: true, process_quiescence_sha256: d("process") })
      }
      const checkpointFiles = [...files]
        .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map(([path, content]) => ({ path, size: content.length, sha256: d(content), content_base64: content.toString("base64") }))
      const manifest = checkpointFiles.map(({ path, size, sha256 }) => ({
        path, size, sha256,
        mode: mutation === "chmod" && path === "proof.txt" ? 0o644 : 0o600,
      }))
      const hashes = e2bGuestBrokerCheckpointHashesV1(
        manifest,
        checkpointFiles.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
      )
      return response(input, { checkpoint_sha256: hashes.checkpoint_sha256, manifest_sha256: hashes.manifest_sha256, files: checkpointFiles, manifest, file_count: checkpointFiles.length, total_bytes: checkpointFiles.reduce((n, f) => n + f.size, 0), process_baseline_sha256: d("process"), process_quiescence_sha256: d("process"), unexpected_process_count: 0, provider_snapshot_is_canonical: false })
    },
  }
}

function response(input: Parameters<E2bDisposableBrokerPortV1["exchange"]>[1], result: Record<string, unknown>) {
  return { schema_version: "sandboxes.e2b-guest-broker-response/v1" as const, protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1, session_binding_sha256: input.session_binding_sha256, request_id: input.request_id, sequence: input.sequence, nonce_sha256: input.nonce_sha256, operation: input.operation, ok: true, result, mac_sha256: d("mac") }
}

function make(mutation: WorkspaceMutation = "none") {
  const events: string[] = []
  const control = new FakeControl(events)
  const handoff = new FakeHandoff(events)
  const runner = __testOnlyCreateE2bDisposableSandboxTaskRunnerV1({
    control, checkpoint_handoff: handoff, broker: broker(events, mutation),
    resource_access: { async withResource(_id, use) { events.push("with-resource"); return use({ files: {} as never, commands: {} as never }) } },
    template_mapping_attested: true,
    installation_id: "installation-v1", provider_scope_ref: "scope-v1", implementation_sha256: d("descendant-package"),
    architecture: "amd64", resources: { cpu_millis: 1_000, memory_bytes: 512 * 1024 * 1024, disk_bytes: 1024 * 1024 * 1024, pids: 64, open_files: 256, output_bytes: 128 * 1024 },
    random_bytes: (length) => new Uint8Array(length).fill(7),
  })
  return { events, control, handoff, runner }
}

function makeDaytona(
  mutation: WorkspaceMutation = "none",
  brokerFactory: (events: string[]) => E2bDisposableBrokerPortV1 =
    (events) => broker(events, mutation),
) {
  const events: string[] = []
  const control = new FakeControl(events)
  const handoff = new FakeHandoff(events)
  const runner = __testOnlyCreateManagedDisposableSandboxTaskRunnerV1({
    provider: "daytona_cloud",
    control, checkpoint_handoff: handoff, broker: brokerFactory(events),
    resource_access: { async withResource(_id, use) { events.push("with-resource"); return use({ files: {} as never, commands: {} as never }) } },
    template_mapping_attested: true,
    installation_id: "installation-v1", provider_scope_ref: "scope-v1", implementation_sha256: d("descendant-package"),
    architecture: "amd64", resources: { cpu_millis: 1_000, memory_bytes: 512 * 1024 * 1024, disk_bytes: 1024 * 1024 * 1024, pids: 64, open_files: 256, output_bytes: 128 * 1024 },
    random_bytes: (length) => new Uint8Array(length).fill(7),
  })
  return { events, control, handoff, runner }
}

describe("E2B disposable task candidate", () => {
  test("uses reviewed lifecycle, persists result before exact-once dual absence, and sanitizes receipt", async () => {
    const { events, control, handoff, runner } = make()
    const result = await runner.run(request(), context(events))
    expect(control.createCalls).toBe(1)
    expect(control.destroyCalls).toBe(1)
    expect(handoff.calls).toBe(1)
    expect(events.indexOf("file_read")).toBeLessThan(events.indexOf("exec"))
    expect(events.indexOf("handoff")).toBeLessThan(events.indexOf("destroy"))
    expect(events).toContain("mark-dispatched")
    expect(events).toContain("mark-result")
    expect(events).toContain("destruction-port-exact")
    expect(result).toMatchObject({ allocation_count: 1, network_policy: "deny_all", broker_artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1, checkpoint_readback_sha256: result.checkpoint_sha256, destroy_execution_count: 1, get_absent: true, list_absent: true, deletion_proven: true })
    const text = JSON.stringify(result)
    for (const forbidden of ["raw-provider-id", "stdout", "stderr", "apiKey", "provider_resource_id"]) expect(text).not.toContain(forbidden)
  })

  test("routes provider allocation and persisted result through the V2 journal port", async () => {
    const { events, runner } = make()
    const requestValue = request()
    const v2 = await v2Context(events, requestValue)
    await runner.run(requestValue, v2.context)
    expect(v2.dispatchedInput).toMatchObject({
      expected_state: "DISPATCH_INTENT",
      dispatch_id: v2.context.dispatch_id,
      canonical_intent_sha256: v2.context.canonical_intent_sha256,
      sandbox_prepare_anchor_sha256: v2.context.sandbox_prepare_anchor_sha256,
      effect_claim_sha256: v2.context.effect_claim_sha256,
    })
    expect(v2.resultInput).toMatchObject({
      expected_state: "DISPATCHED",
      provider_dispatch_anchor_sha256: d("v2-dispatch-anchor-e2b"),
      provider_allocation_sha256: d("v2-allocation-e2b"),
    })
    expect(events.indexOf("create")).toBeLessThan(events.indexOf("mark-dispatched"))
    expect(events.indexOf("mark-dispatched")).toBeLessThan(events.indexOf("activate"))
    expect(events.indexOf("handoff")).toBeLessThan(events.indexOf("mark-result"))
    expect(events.indexOf("mark-result")).toBeLessThan(events.indexOf("destroy"))
  })

  test("rejects a changed V1 request or copied V2 context before provider allocation", async () => {
    const { events, control, runner } = make()
    const requestValue = request()
    const v2 = await v2Context(events, requestValue)
    const changedRequest = request({ max_total_bytes: requestValue.checkpoint.max_total_bytes - 1 })

    await expect(runner.run(changedRequest, v2.context)).rejects.toMatchObject({ code: "integrity_failed" })
    expect(control.createCalls).toBe(0)

    await expect(runner.run(requestValue, { ...v2.context })).rejects.toMatchObject({ code: "integrity_failed" })
    expect(control.createCalls).toBe(0)
    expect(events).not.toContain("create")
  })

  test("atomically consumes one V2 provider-allocation admission", async () => {
    const sequential = make()
    const sequentialRequest = request()
    const sequentialV2 = await v2Context(sequential.events, sequentialRequest)
    await sequential.runner.run(sequentialRequest, sequentialV2.context)
    await expect(sequential.runner.run(sequentialRequest, sequentialV2.context))
      .rejects.toMatchObject({ code: "integrity_failed" })
    expect(sequential.control.createCalls).toBe(1)

    const concurrent = make()
    const concurrentRequest = request()
    const concurrentV2 = await v2Context(concurrent.events, concurrentRequest)
    const results = await Promise.allSettled([
      concurrent.runner.run(concurrentRequest, concurrentV2.context),
      concurrent.runner.run(concurrentRequest, concurrentV2.context),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(concurrent.control.createCalls).toBe(1)
  })

  test("rejects an expired V2 journal claim before provider allocation", async () => {
    const { events, control, runner } = make()
    const requestValue = request()
    const v2 = await v2Context(events, requestValue, new Date(Date.now() - 1).toISOString())

    await expect(runner.run(requestValue, v2.context)).rejects.toMatchObject({ code: "integrity_failed" })
    expect(control.createCalls).toBe(0)
    expect(events).not.toContain("create")
  })

  test("contains and proves absence when durable handoff fails", async () => {
    const { control, handoff, runner } = make(); handoff.fail = true
    await expect(runner.run(request(), context([]))).rejects.toMatchObject({ code: "provider_state_unknown", quarantine_required: true })
    expect(control.destroyCalls).toBe(1)
    expect(control.alive).toBe(false)
  })

  test("recovery never executes and reconstructs only from durable result", async () => {
    const { events, control, handoff, runner } = make()
    const ctx = context(events)
    const original = await runner.run(request(), ctx)
    const execCount = events.filter((event) => event === "exec").length
    const recovered = await runner.reconcile(request(), {
      ...ctx,
      prior_state: "RESULT_PERSISTED",
      recovery_expected_result_bundle_sha256: handoff.stored?.result_bundle_sha256 ?? null,
      recovery_expected_checkpoint_handoff_sha256: handoff.stored?.handoff_receipt_sha256 ?? null,
      recovery_expected_provider_fingerprint_sha256: handoff.stored?.provider_fingerprint_sha256 ?? null,
    })
    expect(recovered).not.toBe("quarantined")
    expect(events.filter((event) => event === "exec")).toHaveLength(execCount)
    expect(handoff.stored?.checkpoint_sha256).toBe(original.checkpoint_sha256)
    expect(control.alive).toBe(false)
  })

  test("recovery with no handoff still contains the exact leaked resource before quarantine", async () => {
    const { events, control, handoff, runner } = make()
    const ctx = context(events)
    const original = await runner.run(request(), ctx)
    const execCount = events.filter((event) => event === "exec").length
    control.alive = true
    handoff.stored = undefined
    handoff.checkpointBytes = undefined
    const recovered = await runner.reconcile(request(), {
      ...ctx,
      prior_state: "DISPATCHED",
      recovery_expected_provider_fingerprint_sha256: original.provider_fingerprint_sha256,
    })
    expect(recovered).toBe("quarantined")
    expect(events.filter((event) => event === "exec")).toHaveLength(execCount)
    expect(control.alive).toBe(false)
  })

  test("never destroys a same-token resource with the wrong ownership nonce", async () => {
    const { control, runner } = make()
    control.addCollision = true
    await expect(runner.run(request(), context([]))).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(control.collisionAlive).toBe(true)
    expect(control.destroyCalls).toBe(1)
  })

  test("ownership substitution during activation fails before guest access", async () => {
    const { events, control, runner } = make()
    control.substituteOwnershipOnActivate = true
    await expect(runner.run(request(), context([]))).rejects.toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
    })
    expect(events).not.toContain("with-resource")
    expect(control.alive).toBe(true)
    expect(control.destroyCalls).toBe(0)
  })

  test("persists modified and added coding output and recovers it after sandbox deletion", async () => {
    const { events, control, handoff, runner } = make("modify-add")
    const ctx = context(events)
    const result = await runner.run(request(), ctx)
    expect(result.checkpoint_file_count).toBe(2)
    expect(result.output_diff_sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    const checkpoint = new TextDecoder().decode(handoff.checkpointBytes)
    expect(checkpoint).toContain("generated.txt")
    expect(checkpoint).toContain(Buffer.from("modified\n").toString("base64"))
    const bundle = parseCanonicalJson(checkpoint) as Record<string, unknown>
    expect(bundle.output_mode).toBe("delta_from_input")
    expect(bundle.input_manifest_sha256).toBe(request().input_manifest_sha256)
    expect(bundle.input_manifest).toEqual([{
      path: "proof.txt",
      content_sha256: request().files[0]!.content_sha256,
      size_bytes: Buffer.from(request().files[0]!.content_base64, "base64").byteLength,
      mode: 0o600,
    }])
    expect(control.alive).toBe(false)
    const recovered = await runner.reconcile(request(), {
      ...ctx,
      prior_state: "RESULT_PERSISTED",
      recovery_expected_result_bundle_sha256: handoff.stored?.result_bundle_sha256 ?? null,
      recovery_expected_checkpoint_handoff_sha256: handoff.stored?.handoff_receipt_sha256 ?? null,
      recovery_expected_provider_fingerprint_sha256: handoff.stored?.provider_fingerprint_sha256 ?? null,
    })
    expect(recovered).not.toBe("quarantined")
    if (recovered !== "quarantined") expect(recovered.output_manifest_sha256).toBe(result.output_manifest_sha256)
  })

  test("records a mode-only output modification against the embedded input baseline", async () => {
    const { handoff, runner } = make("chmod")
    await runner.run(request(), context([]))
    const bundle = parseCanonicalJson(new TextDecoder().decode(handoff.checkpointBytes)) as {
      output_diff: Array<Record<string, unknown>>
    }
    expect(bundle.output_diff).toEqual([{
      kind: "modified",
      path: "proof.txt",
      before_sha256: request().files[0]!.content_sha256,
      after_sha256: request().files[0]!.content_sha256,
      before_mode: 0o600,
      after_mode: 0o644,
    }])
  })

  test("permits a policy-authorized deletion and checkpoints an empty workspace", async () => {
    const { handoff, runner } = make("delete")
    const requestValue = request()
    const result = await runner.run(requestValue, context([]))
    expect(result.checkpoint_file_count).toBe(0)
    expect(result.checkpoint_total_bytes).toBe(0)
    const expectedDiff = [{
      kind: "deleted",
      path: "proof.txt",
      before_sha256: requestValue.files[0]!.content_sha256,
      after_sha256: null,
      before_mode: 0o600,
      after_mode: null,
    }]
    const expectedDiffSha256 = canonicalSha256({
      schema_version: "sandboxes.disposable-task-output-diff/v1",
      changes: expectedDiff,
    })
    const bundle = parseCanonicalJson(new TextDecoder().decode(handoff.checkpointBytes)) as {
      output_diff: Array<Record<string, unknown>>
      output_diff_sha256: string
    }
    expect(bundle.output_diff).toEqual(expectedDiff)
    expect(bundle.output_diff_sha256).toBe(expectedDiffSha256)
    expect(handoff.stored?.output_diff_sha256).toBe(expectedDiffSha256)
    expect(result.output_diff_sha256).toBe(expectedDiffSha256)
  })

  test("rejects additions, escapes, oversize output, and forbidden canary content outside policy", async () => {
    const cases: Array<[WorkspaceMutation, Partial<DisposableSandboxTaskRequestV1["checkpoint"]>]> = [
      ["modify-add", { allow_file_addition: false }],
      ["deep", { max_depth: 1 }],
      ["escape", {}],
      ["oversize", {}],
      ["canary", { forbidden_content_markers_base64: [Buffer.from("CANARY-LEAK").toString("base64")] }],
    ]
    for (const [mutation, policy] of cases) {
      const { control, runner } = make(mutation)
      await expect(runner.run(request(policy), context([]))).rejects.toMatchObject({
        code: "provider_state_unknown",
        quarantine_required: true,
      })
      expect(control.alive).toBe(false)
    }
  })
})

describe("Daytona disposable task candidate", () => {
  test("routes provider allocation and persisted result through the V2 journal port", async () => {
    const { events, runner } = makeDaytona()
    const requestValue = request({}, "daytona_cloud")
    const v2 = await v2Context(events, requestValue)
    await runner.run(requestValue, v2.context)
    expect(v2.dispatchedInput).toMatchObject({
      expected_state: "DISPATCH_INTENT",
      canonical_intent_sha256: v2.context.canonical_intent_sha256,
      sandbox_prepare_anchor_sha256: v2.context.sandbox_prepare_anchor_sha256,
    })
    expect(v2.resultInput).toMatchObject({
      expected_state: "DISPATCHED",
      provider_dispatch_anchor_sha256: d("v2-dispatch-anchor-daytona_cloud"),
      provider_allocation_sha256: d("v2-allocation-daytona_cloud"),
    })
    expect(events.indexOf("create")).toBeLessThan(events.indexOf("mark-dispatched"))
    expect(events.indexOf("mark-dispatched")).toBeLessThan(events.indexOf("activate"))
    expect(events.indexOf("handoff")).toBeLessThan(events.indexOf("mark-result"))
    expect(events.indexOf("mark-result")).toBeLessThan(events.indexOf("destroy"))
  })

  test("maps Daytona directory metadata to the exact workspace control type", async () => {
    const commands: string[] = []
    const sdkCwds: Array<string | undefined> = []
    const brokerOutput: string[] = []
    const sessions: string[] = []
    const sessionCommands: string[] = []
    const uploads: Uint8Array[] = []
    const uploadReferences: Uint8Array[] = []
    const mailboxFiles = new Map<string, Buffer>()
    let deletedSessions = 0
    const bridge = new DaytonaOfficialResourceAccessBridgeV1({
      async get() {
        return {
          id: "daytona-directory-mapping",
          fs: {
            async uploadFile(value: Uint8Array, path: string) {
              uploadReferences.push(value)
              uploads.push(Uint8Array.from(value))
              if (path.includes("/request-")) {
                mailboxFiles.set(path.replace("/request-", "/response-"), Buffer.from('{"schema_version":"test"}\n'))
              } else if (path.includes("/close-")) {
                mailboxFiles.set(path.replace("/close-", "/closed-"), Buffer.from("sandboxes.daytona-mailbox/v1 closed=true\n"))
              }
            },
            async downloadFile(path: string) { return Buffer.from(mailboxFiles.get(path)!) },
            async deleteFile(path: string) { mailboxFiles.delete(path) },
            async getFileDetails(path: string) {
              const mailbox = mailboxFiles.get(path)
              if (mailbox !== undefined) {
                return {
                  name: path.split("/").at(-1)!, isDir: false, mode: "-rw-------",
                  permissions: "0600", owner: "daytona", group: "daytona", size: mailbox.byteLength,
                }
              }
              if (path.startsWith("/tmp/.hasna-daytona-upload-v1/")) {
                throw Object.assign(new Error("not found"), { statusCode: 404 })
              }
              return path === "/workspace"
                ? {
                    name: "workspace", isDir: true, mode: "drwx------", permissions: "0700",
                    owner: "65534", group: "65534", size: 4096,
                  }
                : {
                    name: "sandboxes-broker-v1", isDir: false, mode: "-r-x------", permissions: "0500",
                    owner: "0", group: "0", size: 65_714,
                  }
            },
          },
          process: {
            async executeCommand(command: string, cwd?: string) {
              commands.push(command)
              sdkCwds.push(cwd)
              if (command.includes("sandboxes.daytona-account/v1")) {
                return {
                  exitCode: 0,
                  result: "sandboxes.daytona-account/v1 uid=1000 gid=1000\n",
                }
              }
              return { exitCode: 0, result: "" }
            },
            async createSession(value: string) { sessions.push(value) },
            async executeSessionCommand(_sessionId: string, value: { command: string }) {
              sessionCommands.push(value.command)
              return { cmdId: "mailbox-command-v1", stdout: "", stderr: "" }
            },
            async getSessionCommand() { return { exitCode: 0 } },
            async deleteSession() { deletedSessions += 1 },
          },
        } as never
      },
    })
    const info = await bridge.withResource("daytona-directory-mapping", async (surface) => {
      const value = await surface.files.getInfo("/workspace", {
        requestTimeoutMs: 20_000,
        user: "root",
      })
      const artifact = await surface.files.getInfo("/opt/hasna/bin/sandboxes-broker-v1", {
        requestTimeoutMs: 20_000,
        user: "root",
      })
      expect(artifact).toMatchObject({ mode: 0o500, owner: "root", group: "root" })
      await surface.commands.run("/usr/bin/true", {
        background: false, cwd: "/", envs: {}, requestTimeoutMs: 20_000,
        timeoutMs: 20_000, user: "root",
      })
      await surface.commands.run("/usr/bin/true", {
        background: false, cwd: "/workspace", envs: {}, requestTimeoutMs: 20_000,
        timeoutMs: 20_000, user: "user",
      })
      const background = await surface.commands.run(e2bGuestBrokerBootstrapCommandV1(), {
        background: true, cwd: "/workspace", envs: {}, requestTimeoutMs: 20_000,
        timeoutMs: 20_000, user: "root", stdin: true,
        onStdout(value: string) { brokerOutput.push(value) }, onStderr() {},
      } as never) as unknown as {
        sendStdin(value: Uint8Array): Promise<void>
        closeStdin(): Promise<void>
        wait(): Promise<{ exitCode: number }>
        disconnect(): Promise<void>
      }
      await background.sendStdin(new Uint8Array(72).fill(0xa5))
      await background.closeStdin()
      expect((await background.wait()).exitCode).toBe(0)
      await background.disconnect()
      return value
    })
    expect(commands.slice(0, 4)).toEqual([
      DAYTONA_EXECUTION_IDENTITY_ATTESTATION_COMMAND_V1,
      expect.stringContaining("sandboxes.daytona-account/v1"),
      daytonaRoleCommandV1("/usr/bin/true", "root"),
      daytonaRoleCommandV1("/usr/bin/true", "user", "/workspace"),
    ])
    expect(commands).toHaveLength(5)
    expect(commands[4]).toContain("sandboxes.daytona-mailbox/v1 ready=true")
    expect(sdkCwds).toEqual(["/", "/", "/", "/", "/"])
    expect(sessions).toEqual(["hasna-sandboxes-mailbox-v1"])
    expect(sessionCommands).toHaveLength(1)
    expect(sessionCommands[0]).toContain("/opt/hasna/bin/daytona-broker-v1")
    expect(sessionCommands[0]).toContain("/proc/self/fd/%d")
    expect(sessionCommands[0]).toContain("os.O_NOFOLLOW")
    expect(uploads[0]).toEqual(new Uint8Array(72).fill(0xa5))
    expect(new TextDecoder().decode(uploads[1])).toBe("sandboxes.daytona-mailbox/v1 close=true\n")
    expect(uploadReferences[0]).toEqual(new Uint8Array(72))
    expect(uploadReferences[1]).toEqual(new Uint8Array(Buffer.byteLength("sandboxes.daytona-mailbox/v1 close=true\n")))
    expect(brokerOutput).toEqual(['{"schema_version":"test"}\n'])
    expect(deletedSessions).toBe(0)
    expect(info).toMatchObject({
      path: "/workspace", name: "workspace", type: "dir", mode: 0o700,
      owner: "nobody", group: "nogroup",
    })
  })

  test("preserves exact D/I/E/P bindings through checkpoint handoff and dual absence", async () => {
    const { events, control, handoff, runner } = makeDaytona()
    const result = await runner.run(request({}, "daytona_cloud"), context(events))
    expect(runner.describe().provider).toBe("daytona_cloud")
    expect(result).toMatchObject({
      provider: "daytona_cloud",
      allocation_count: 1,
      destroy_execution_count: 1,
      get_absent: true,
      list_absent: true,
      deletion_proven: true,
    })
    expect(control.createCalls).toBe(1)
    expect(control.destroyCalls).toBe(1)
    expect(handoff.calls).toBe(1)
    expect(events.indexOf("handoff")).toBeLessThan(events.indexOf("destroy"))
    expect(JSON.stringify(result)).not.toContain("raw-provider-id")
  })

  test("preserves only a bounded guest failure phase and safe cause code after cleanup", async () => {
    const providerDiagnostic = "provider-secret-workspace-diagnostic"
    const { control, runner } = makeDaytona("none", (events) => ({
      ...broker(events, "none"),
      async install() {
        const unsafe = new E2bWorkspaceBootstrapBoundaryErrorV1(
          "integrity_failed",
          "workspace_provision",
        )
        Object.defineProperty(unsafe, "provider_detail", {
          enumerable: true,
          value: providerDiagnostic,
        })
        throw unsafe
      },
    }))
    let failure: unknown
    try {
      await runner.run(request({}, "daytona_cloud"), context([]))
    } catch (cause) {
      failure = cause
    }
    expect(failure).toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
      phase: "workspace_provision",
      safe_cause_code: "integrity_failed",
    })
    expect(JSON.stringify(failure)).not.toContain(providerDiagnostic)
    expect((failure as Error).cause).toBeUndefined()
    expect(control.destroyCalls).toBe(1)
    expect(control.alive).toBe(false)
  })

  test("preserves a sanitized mailbox phase through exact cleanup", async () => {
    const providerDiagnostic = "provider-secret-mailbox-diagnostic"
    const { control, runner } = makeDaytona("none", (events) => ({
      ...broker(events, "none"),
      async withSession() {
        const unsafe = new DaytonaMailboxBoundaryErrorV1("mailbox_exchange")
        Object.defineProperty(unsafe, "provider_detail", {
          enumerable: true,
          value: providerDiagnostic,
        })
        throw unsafe
      },
    }))
    let failure: unknown
    try {
      await runner.run(request({}, "daytona_cloud"), context([]))
    } catch (cause) {
      failure = cause
    }
    expect(failure).toMatchObject({
      code: "provider_state_unknown",
      quarantine_required: true,
      phase: "mailbox_exchange",
      safe_cause_code: "integrity_failed",
    })
    expect(JSON.stringify(failure)).not.toContain(providerDiagnostic)
    expect((failure as Error).cause).toBeUndefined()
    expect(control.destroyCalls).toBe(1)
    expect(control.alive).toBe(false)
  })
})
