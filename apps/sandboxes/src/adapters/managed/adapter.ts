import { canonicalSha256, isDigest, safeEqual } from "./canonical"
import {
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  encodeGuestBrokerRequestFrame,
  validateGuestBrokerAttestation,
} from "./broker"
import { AdapterContractError, adapterError } from "./errors"
import { anchorOutcome, validateAdapterCallContext } from "./journal"
import { managedProviderRequestSha256 } from "./request"
import { OFFICIAL_SDK_CONTRACT_GAPS } from "./sdk-pins"
import type {
  ActivationDispatchAuthorizationV1,
  ActivationReceiptV1,
  AdapterCallContextV1,
  AdapterDescriptorV1,
  AdapterExecHandleV1,
  AdapterExecStreamFrameV1,
  AdapterObservationV1,
  AdapterProviderResourceV1,
  AdapterSandboxSpecV1,
  ByteChunkV1,
  CancelObservationV1,
  CheckpointHintObservationV1,
  DestroyContextV1,
  DestroyObservationV1,
  Digest,
  ExecSpecV1,
  ExpireObservationV1,
  FileListV1,
  FilePageV1,
  FileReadV1,
  FileStatV1,
  FileWriteReceiptV1,
  FileWriteV1,
  GuestBrokerAttestationV1,
  InventoryReconciliationV1,
  ManagedAdapterDependenciesV1,
  ManagedProviderRequestV1,
  ManagedProviderAdapterV1,
  ManagedProviderControlPortV1,
  ManagedProviderIdV1,
  NetworkPolicyObservationV1,
  NetworkPolicyV1,
  OwnedProviderHandleV1,
  OwnedResourcePageV1,
  ProviderCapabilitiesV1,
  ProviderEffectTargetV1,
  ProviderOperationNameV1,
  ProviderOperationObservationV1,
  ProviderOperationV1,
  ProviderResourcePageV1,
  QuarantineObservationV1,
  ReconcileContextV1,
  WorkspacePath,
} from "./types"

const GENERATION_CHANGING_OPERATIONS = new Set<ProviderOperationNameV1>([
  "create_inert",
  "activate",
  "expire",
  "quarantine",
  "destroy",
])

const MUTATING_OPERATIONS = new Set<ProviderOperationNameV1>([
  "create_inert",
  "activate",
  "exec_start",
  "exec_cancel",
  "file_write",
  "checkpoint_hint",
  "expire",
  "quarantine",
  "destroy",
])

const SAFE_GUEST_ENVIRONMENT_NAMES = new Set(["HOME", "LANG", "LC_ALL", "PATH", "TERM", "TZ"])
const MAX_INVENTORY_PAGES = 32
const MAX_WORKSPACE_PATH_BYTES = 4096
const MAX_WORKSPACE_SEGMENT_BYTES = 255
const PORTABLE_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu

export const INERT_DENY_ALL_POLICY: NetworkPolicyV1 = {
  mode: "deny_all",
  policy_sha256: canonicalSha256({
    schema_version: "sandboxes.inert-network/v1",
    allow_public_ingress: false,
    deny_dns: true,
    deny_egress: true,
  }),
}

export function capabilityAuthorizationBinding(target: ProviderEffectTargetV1): Digest {
  return canonicalSha256({
    kind: "capability_consumption",
    target_sha256: canonicalSha256(target),
    authorization_consumption_receipt_sha256: target.authorization_consumption_receipt_sha256,
  })
}

export function activationAuthorizationBinding(
  target: ProviderEffectTargetV1,
  authorization: ActivationDispatchAuthorizationV1,
): Digest {
  return canonicalSha256({
    kind: "activation",
    target_sha256: canonicalSha256(target),
    activation_grant_sha256: authorization.activation_grant_sha256,
    authorization_consumption_receipt_sha256:
      authorization.authorization_consumption_receipt_sha256,
    network_policy: authorization.network_policy,
  })
}

export function cleanupAuthorizationBinding(
  target: ProviderEffectTargetV1,
  cleanupGrantSha256: Digest,
  cleanupBasisSha256: Digest,
): Digest {
  return canonicalSha256({
    kind: "cleanup",
    target_sha256: canonicalSha256(target),
    cleanup_grant_sha256: cleanupGrantSha256,
    cleanup_basis_sha256: cleanupBasisSha256,
    authorization_consumption_receipt_sha256: target.authorization_consumption_receipt_sha256,
  })
}

interface AdapterIdentityV1 {
  provider: ManagedProviderIdV1
  sdkPackage: string
  sdkVersion: string
}

function requireCapability<K extends keyof ProviderCapabilitiesV1>(
  client: ManagedProviderControlPortV1,
  capability: K,
): void {
  if (!client.capabilities[capability]) throw adapterError("unsupported_runtime_feature")
}

function validateGeneration(op: ProviderOperationV1): void {
  const changesGeneration = GENERATION_CHANGING_OPERATIONS.has(op.operation)
  if (!changesGeneration) {
    if (op.generation_transition !== undefined) throw adapterError("operation_target_mismatch")
    return
  }
  const transition = op.generation_transition
  if (
    transition === undefined ||
    transition.successor_resource_lifecycle_generation !== op.target.resource_lifecycle_generation ||
    transition.successor_resource_lifecycle_generation !== op.fence.resource_lifecycle_generation ||
    transition.successor_resource_lifecycle_generation !==
      transition.expected_resource_lifecycle_generation + 1n
  ) {
    throw adapterError("stale_resource_lifecycle_generation")
  }
}

function validateOperation(
  ctx: AdapterCallContextV1,
  op: ProviderOperationV1,
  expected: ProviderOperationNameV1,
): void {
  if (op.operation !== expected) throw adapterError("operation_target_mismatch")
  if (
    !isDigest(op.target.operation_digest) ||
    !isDigest(op.target.provider_idempotency_token_sha256) ||
    !isDigest(op.target.immutable_fingerprint_sha256) ||
    !isDigest(op.target.authorization_consumption_receipt_sha256) ||
    !isDigest(op.request_sha256) ||
    !isDigest(op.idempotency_key_sha256) ||
    !isDigest(op.external_anchor_receipt_sha256) ||
    op.target.operation_id.length === 0 ||
    op.target.operation_step_id.length === 0 ||
    op.target.resource_id.length === 0
  ) {
    throw adapterError("validation_failed")
  }
  const shouldMutate = MUTATING_OPERATIONS.has(expected)
  if (op.external_anchor_kind !== (shouldMutate ? "DISPATCHED" : "READ_PROBE")) {
    throw adapterError("dispatch_anchor_required")
  }
  validateGeneration(op)
  validateAdapterCallContext(ctx, op)
  if (shouldMutate && ctx.dispatch_attempt.kind === "exact_duplicate") {
    throw adapterError("dispatch_anchor_mismatch")
  }
  if (ctx.signal?.aborted === true) throw adapterError("validation_failed")
}

function validateEffectRequest(op: ProviderOperationV1, request: ManagedProviderRequestV1): void {
  if (request.operation !== op.operation || op.request_sha256 !== managedProviderRequestSha256(request)) {
    throw adapterError("request_digest_mismatch")
  }
}

function validateNetworkObservation(
  observation: NetworkPolicyObservationV1,
  expected: NetworkPolicyV1,
): void {
  if (
    !isDigest(expected.policy_sha256) ||
    !isDigest(observation.policy_sha256) ||
    observation.mode !== expected.mode ||
    observation.policy_sha256 !== expected.policy_sha256 ||
    !observation.enforced_outside_guest ||
    observation.public_ingress ||
    (expected.mode === "deny_all" && !observation.dns_denied) ||
    Number.isNaN(Date.parse(observation.observed_at))
  ) {
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }
}

function safeProviderReceipt(resource: AdapterProviderResourceV1, op: ProviderOperationV1): Digest {
  return canonicalSha256({
    target_sha256: canonicalSha256(op.target),
    generation_transition_sha256: canonicalSha256(
      op.generation_transition ?? { kind: "no_generation_transition" },
    ),
    provider_creation_token_sha256: resource.provider_creation_token_sha256,
    immutable_fingerprint_sha256: resource.immutable_fingerprint_sha256,
    provider_created_at: resource.provider_created_at,
    provider_resource_version: resource.provider_resource_version,
    state: resource.state,
    provider_runtime_state: resource.provider_runtime_state,
    network_policy: resource.network_policy,
    auto_delete_disabled: resource.auto_delete_disabled,
    ephemeral: resource.ephemeral,
    owned: resource.owned,
    source_attached: resource.source_attached,
    credential_attached: resource.credential_attached,
    guest_broker_bootstrapped: resource.guest_broker_bootstrapped,
    ownership: resource.ownership,
  })
}

function expectedProviderOwnership(
  installationId: string,
  providerScopeRef: string,
  ownershipNonce: string,
): AdapterProviderResourceV1["ownership"] {
  return {
    installation_id_sha256: canonicalSha256(installationId),
    provider_scope_ref_sha256: canonicalSha256(providerScopeRef),
    ownership_nonce_sha256: canonicalSha256(ownershipNonce),
  }
}

function validateProviderResource(
  resource: AdapterProviderResourceV1,
  target: ProviderEffectTargetV1,
  expectedOwnership: AdapterProviderResourceV1["ownership"],
  expectedCreationToken?: Digest,
): void {
  if (
    resource.opaque_resource_id.length === 0 ||
    !resource.owned ||
    (expectedCreationToken !== undefined && resource.provider_creation_token_sha256 !== expectedCreationToken) ||
    resource.immutable_fingerprint_sha256 !== target.immutable_fingerprint_sha256 ||
    !safeEqual(resource.ownership, expectedOwnership) ||
    !resource.auto_delete_disabled ||
    resource.ephemeral ||
    resource.source_attached ||
    resource.credential_attached ||
    resource.provider_resource_version.length === 0 ||
    Number.isNaN(Date.parse(resource.provider_created_at))
  ) {
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }
}

function validateProviderResourceForHandle(
  resource: AdapterProviderResourceV1,
  handle: OwnedProviderHandleV1,
  target: ProviderEffectTargetV1,
  dependencies: ManagedAdapterDependenciesV1,
): void {
  validateProviderResource(
    resource,
    target,
    expectedProviderOwnership(
      dependencies.installation_id,
      dependencies.provider_scope_ref,
      handle.ownership_nonce,
    ),
    handle.provider_creation_token_sha256,
  )
  if (
    resource.opaque_resource_id !== handle.opaque_resource_id ||
    resource.provider_created_at !== handle.provider_created_at ||
    resource.provider_resource_version !== handle.provider_resource_version
  ) {
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }
}

function validateHandle(
  handle: OwnedProviderHandleV1,
  op: ProviderOperationV1,
  identity: AdapterIdentityV1,
  dependencies: ManagedAdapterDependenciesV1,
): void {
  if (
    handle.adapter_id !== identity.provider ||
    handle.adapter_version !== dependencies.adapter_version ||
    handle.installation_id !== dependencies.installation_id ||
    handle.provider_scope_ref !== dependencies.provider_scope_ref ||
    handle.resource_id !== op.target.resource_id ||
    handle.resource_lifecycle_generation !== op.target.resource_lifecycle_generation ||
    handle.immutable_fingerprint_sha256 !== op.target.immutable_fingerprint_sha256 ||
    handle.opaque_resource_id.length === 0
  ) {
    throw adapterError("operation_target_mismatch")
  }
}

function validateExecHandle(
  exec: AdapterExecHandleV1,
  handle: OwnedProviderHandleV1,
  identity: AdapterIdentityV1,
): void {
  if (
    exec.adapter_id !== identity.provider ||
    exec.resource_id !== handle.resource_id ||
    exec.resource_lifecycle_generation !== handle.resource_lifecycle_generation ||
    exec.opaque_exec_id.length === 0 ||
    !isDigest(exec.immutable_exec_fingerprint_sha256)
  ) {
    throw adapterError("operation_target_mismatch")
  }
}

function validateExecSpec(spec: ExecSpecV1): void {
  if (
    spec.tty !== false ||
    !isDigest(spec.environment_profile_sha256) ||
    !isDigest(spec.stdin_sha256) ||
    !spec.executable.startsWith("/") ||
    spec.executable.includes("\0") ||
    spec.argv.some((argument) => argument.includes("\0")) ||
    spec.output_limit_bytes <= 0 ||
    spec.process_limit <= 0 ||
    spec.idle_timeout_ms < 0 ||
    Number.isNaN(Date.parse(spec.wall_deadline))
  ) {
    throw adapterError("validation_failed")
  }
  if (spec.cwd !== "") validateWorkspacePath(spec.cwd)
  for (const [name, value] of Object.entries(spec.environment)) {
    if (!SAFE_GUEST_ENVIRONMENT_NAMES.has(name) || value.includes("\0")) {
      throw adapterError("validation_failed")
    }
  }
}

export function validateWorkspacePath(path: string, allowRoot = false): WorkspacePath {
  if (allowRoot && path === "") return path as WorkspacePath
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\0-\x1f\x7f]/u.test(path) ||
    path !== path.normalize("NFC") ||
    Buffer.byteLength(path, "utf8") > MAX_WORKSPACE_PATH_BYTES
  ) {
    throw adapterError("path_outside_workspace")
  }
  const segments = path.split("/")
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        PORTABLE_DEVICE_NAME.test(segment) ||
        Buffer.byteLength(segment, "utf8") > MAX_WORKSPACE_SEGMENT_BYTES,
    )
  ) {
    throw adapterError("path_outside_workspace")
  }
  return path as WorkspacePath
}

function validateFileRead(request: FileReadV1): void {
  validateWorkspacePath(request.path)
  if (!Number.isSafeInteger(request.offset) || request.offset < 0) throw adapterError("validation_failed")
  if (!Number.isSafeInteger(request.length) || request.length <= 0) throw adapterError("validation_failed")
}

function validateFileWrite(request: FileWriteV1): void {
  validateWorkspacePath(request.path)
  const preconditions = [request.if_absent === true, request.expected_prior_sha256 !== undefined, request.expected_prior_revision !== undefined]
  if (preconditions.filter(Boolean).length !== 1 || request.bytes.byteLength === 0) {
    throw adapterError("validation_failed")
  }
  if (request.expected_prior_sha256 !== undefined && !isDigest(request.expected_prior_sha256)) {
    throw adapterError("validation_failed")
  }
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function lifecycleLockKey(
  identity: AdapterIdentityV1,
  dependencies: ManagedAdapterDependenciesV1,
  target: ProviderEffectTargetV1,
): Digest {
  return canonicalSha256({
    schema_version: "sandboxes.adapter-lifecycle-lock/v1",
    provider: identity.provider,
    installation_id: dependencies.installation_id,
    provider_scope_ref: dependencies.provider_scope_ref,
    resource_id: target.resource_id,
  })
}

export class ManagedProviderAdapter implements ManagedProviderAdapterV1 {
  readonly #identity: AdapterIdentityV1
  readonly #dependencies: ManagedAdapterDependenciesV1

  constructor(identity: AdapterIdentityV1, dependencies: ManagedAdapterDependenciesV1) {
    this.#identity = identity
    this.#dependencies = dependencies
    if (dependencies.admission.exact_sdk_version !== identity.sdkVersion) {
      throw adapterError("unsupported_runtime_feature")
    }
    if (
      dependencies.installation_id.length === 0 ||
      dependencies.provider_scope_ref.length === 0 ||
      !isDigest(dependencies.adapter_build_sha256) ||
      !isDigest(dependencies.admission.evidence_sha256) ||
      dependencies.read_retry_policy.max_attempts < 1
    ) {
      throw adapterError("validation_failed")
    }
  }

  async descriptor(): Promise<AdapterDescriptorV1> {
    let liveAdmissionVerified = false
    if (
      this.#dependencies.admission.admitted &&
      this.#dependencies.admission.evidence_kind === "live_conformance"
    ) {
      try {
        await this.#assertAdmissionVerified()
        liveAdmissionVerified = true
      } catch {
        liveAdmissionVerified = false
      }
    }
    return {
      adapter_id: this.#identity.provider,
      adapter_version: this.#dependencies.adapter_version,
      adapter_build_sha256: this.#dependencies.adapter_build_sha256,
      sdk_package: this.#identity.sdkPackage,
      sdk_version: this.#identity.sdkVersion,
      runtime_class: "strong_vm",
      architecture: liveAdmissionVerified ? ["arm64", "amd64"] : [],
      admission: liveAdmissionVerified ? "enabled" : "disabled",
      admission_evidence_sha256: this.#dependencies.admission.evidence_sha256,
      live_capability_evidence_verified: liveAdmissionVerified,
      mandatory_capability_claims: {
        strong_vm: liveAdmissionVerified,
        outside_guest_network_enforcement: liveAdmissionVerified,
        whole_guest_cancel: liveAdmissionVerified,
        atomic_bounded_files: liveAdmissionVerified,
        ownership_reconciliation: liveAdmissionVerified,
        destructive_semantics: liveAdmissionVerified,
      },
      provider_results_are_canonical_state: false,
      provider_snapshot_is_canonical_checkpoint: false,
    }
  }

  async #guard(
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
    phase: "after_anchor" | "before_provider_read" | "before_provider_mutation",
  ): Promise<void> {
    try {
      await this.#dependencies.effect_guard.assertCurrent(ctx, op, phase)
    } catch (cause) {
      if (cause instanceof AdapterContractError) throw cause
      throw adapterError("stale_operation_execution_epoch")
    }
  }

  #withLifecycleLock<T>(op: ProviderOperationV1, use: () => Promise<T>): Promise<T> {
    return this.#dependencies.lifecycle_lock.withLock(
      lifecycleLockKey(this.#identity, this.#dependencies, op.target),
      use,
    )
  }

  async #verifyExternalAnchors(ctx: AdapterCallContextV1, op: ProviderOperationV1): Promise<void> {
    try {
      await this.#dependencies.journal_anchor_verifier.assertVerified(ctx, op)
    } catch {
      throw adapterError("dispatch_anchor_mismatch")
    }
  }

  async #beforeProviderMutation(ctx: AdapterCallContextV1, op: ProviderOperationV1): Promise<void> {
    await this.#guard(ctx, op, "before_provider_mutation")
    try {
      await this.#dependencies.physical_safety_gate.assertOpen(ctx, op)
    } catch (cause) {
      if (cause instanceof AdapterContractError) throw cause
      throw adapterError("stale_operation_execution_epoch")
    }
  }

  async #contain(
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
    reason: "provider_effect_ambiguous" | "output_limit" | "whole_guest_cancel_unproven",
  ): Promise<void> {
    try {
      await this.#dependencies.physical_safety_gate.contain(ctx, op, reason)
    } catch {
      // Containment failure cannot make an ambiguous effect safe or produce an outcome.
    }
  }

  async #assertAdmissionVerified(): Promise<void> {
    if (!this.#dependencies.admission.admitted) throw adapterError("unsupported_runtime_feature")
    if (
      this.#dependencies.admission.evidence_kind === "live_conformance" &&
      OFFICIAL_SDK_CONTRACT_GAPS[this.#identity.provider].admission === "disabled"
    ) {
      throw adapterError("unsupported_runtime_feature")
    }
    try {
      await this.#dependencies.admission_verifier.assertAdmitted({
        provider: this.#identity.provider,
        sdk_version: this.#identity.sdkVersion,
        adapter_build_sha256: this.#dependencies.adapter_build_sha256,
        evidence_sha256: this.#dependencies.admission.evidence_sha256,
        evidence_kind: this.#dependencies.admission.evidence_kind,
      })
    } catch {
      throw adapterError("unsupported_runtime_feature")
    }
  }

  async #withClient<T>(
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
    use: (client: ManagedProviderControlPortV1) => Promise<T>,
  ): Promise<T> {
    await this.#assertAdmissionVerified()
    await this.#verifyExternalAnchors(ctx, op)
    await this.#guard(ctx, op, "after_anchor")
    try {
      return await this.#dependencies.credential_port.withAuthenticatedClient(this.#identity.provider, async (client) => {
        if (client.provider_id !== this.#identity.provider) throw adapterError("operation_target_mismatch")
        return use(client)
      })
    } catch (cause) {
      if (cause instanceof AdapterContractError) throw cause
      throw adapterError("dependency_unavailable", { retryable: true })
    }
  }

  async #retryRead<T>(
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
    read: () => Promise<T>,
  ): Promise<T> {
    const policy = this.#dependencies.read_retry_policy
    let lastError: unknown
    for (let attempt = 1; attempt <= policy.max_attempts; attempt += 1) {
      try {
        await this.#guard(ctx, op, "before_provider_read")
        return await read()
      } catch (cause) {
        if (cause instanceof AdapterContractError) throw cause
        lastError = cause
        if (attempt === policy.max_attempts) break
        const backoff = Math.min(policy.max_delay_ms, policy.base_delay_ms * 2 ** (attempt - 1))
        await delay(backoff)
      }
    }
    throw adapterError("provider_unavailable", { retryable: true, cause: lastError })
  }

  async #findByCreationToken(
    client: ManagedProviderControlPortV1,
    token: Digest,
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
  ): Promise<AdapterProviderResourceV1[]> {
    requireCapability(client, "exact_creation_token_lookup")
    const resources: AdapterProviderResourceV1[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (let pageCount = 0; pageCount < MAX_INVENTORY_PAGES; pageCount += 1) {
      const page: ProviderResourcePageV1 = await this.#retryRead(ctx, op, () =>
        client.findByCreationToken(token, cursor),
      )
      resources.push(...page.items)
      if (page.next_cursor === undefined) return resources
      if (cursors.has(page.next_cursor)) throw adapterError("integrity_failed")
      cursors.add(page.next_cursor)
      cursor = page.next_cursor
    }
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }

  async #inspectExactHandle(
    client: ManagedProviderControlPortV1,
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
    handle: OwnedProviderHandleV1,
  ): Promise<AdapterProviderResourceV1> {
    const resource = await this.#retryRead(ctx, op, () => client.inspectResource(handle.opaque_resource_id))
    if (resource === "absent") throw adapterError("provider_state_unknown", { quarantineRequired: true })
    validateProviderResourceForHandle(resource, handle, op.target, this.#dependencies)
    try {
      await this.#dependencies.network_policy_verifier.assertAuthorized(ctx, op, resource.network_policy)
    } catch (cause) {
      if (cause instanceof AdapterContractError) throw cause
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    return resource
  }

  async #inspectGuestBroker(
    client: ManagedProviderControlPortV1,
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
    handle: OwnedProviderHandleV1,
  ): Promise<GuestBrokerAttestationV1> {
    requireCapability(client, "fixed_bootstrap_broker")
    requireCapability(client, "typed_broker_frames")
    const broker = await this.#retryRead(ctx, op, () => client.inspectGuestBroker(handle.opaque_resource_id))
    if (broker === "absent") throw adapterError("provider_state_unknown", { quarantineRequired: true })
    validateGuestBrokerAttestation(broker, handle.immutable_fingerprint_sha256)
    return broker
  }

  async #findExactHandleByCreationToken(
    client: ManagedProviderControlPortV1,
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
    handle: OwnedProviderHandleV1,
  ): Promise<AdapterProviderResourceV1> {
    const resources = await this.#findByCreationToken(
      client,
      handle.provider_creation_token_sha256,
      ctx,
      op,
    )
    if (resources.length !== 1) throw adapterError("provider_state_unknown", { quarantineRequired: true })
    const resource = resources[0]
    if (resource === undefined) throw adapterError("provider_state_unknown", { quarantineRequired: true })
    validateProviderResourceForHandle(resource, handle, op.target, this.#dependencies)
    return resource
  }

  #selectExactCreationCandidate(
    resources: AdapterProviderResourceV1[],
    target: ProviderEffectTargetV1,
    ownershipNonce: Digest,
  ): AdapterProviderResourceV1 | undefined {
    if (resources.length === 0) return undefined
    if (resources.length !== 1) throw adapterError("provider_state_unknown", { quarantineRequired: true })
    const resource = resources[0]
    if (resource === undefined) throw adapterError("integrity_failed")
    validateProviderResource(
      resource,
      target,
      expectedProviderOwnership(
        this.#dependencies.installation_id,
        this.#dependencies.provider_scope_ref,
        ownershipNonce,
      ),
      target.provider_idempotency_token_sha256,
    )
    if (
      resource.state !== "inert" ||
      !["started_locked", "paused", "stopped"].includes(resource.provider_runtime_state) ||
      resource.guest_broker_bootstrapped
    ) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    validateNetworkObservation(resource.network_policy, INERT_DENY_ALL_POLICY)
    return resource
  }

  async #anchorUnknown(_ctx: AdapterCallContextV1, _op: ProviderOperationV1, cause: unknown): Promise<never> {
    // Ambiguous mutation deliberately remains DISPATCHED-without-OUTCOME.
    // Recovery may append reconciliation_blocked only after authenticated
    // provider/journal evidence; the adapter must not fabricate an outcome.
    await this.#contain(_ctx, _op, "provider_effect_ambiguous")
    if (cause instanceof AdapterContractError && cause.code === "stale_operation_execution_epoch") {
      throw cause
    }
    if (
      cause instanceof AdapterContractError &&
      cause.code === "provider_state_unknown" &&
      cause.quarantine_required
    ) {
      throw cause
    }
    throw adapterError("provider_state_unknown", { quarantineRequired: true, cause })
  }

  async create_inert(
    ctx: AdapterCallContextV1,
    spec: AdapterSandboxSpecV1,
    op: ProviderOperationV1,
    allocationKey: Digest,
  ): Promise<OwnedProviderHandleV1> {
    validateOperation(ctx, op, "create_inert")
    validateEffectRequest(op, { operation: "create_inert", spec, allocation_key_sha256: allocationKey })
    if (!isDigest(allocationKey) || spec.workspace_root !== "/workspace" || spec.schema_version !== "sandboxes.runtime/v1") {
      throw adapterError("validation_failed")
    }
    if (
      !isDigest(spec.spec_sha256) ||
      !isDigest(spec.environment_image_or_snapshot_sha256) ||
      !isDigest(spec.network_policy.policy_sha256) ||
      !Number.isSafeInteger(spec.max_runtime_ms) ||
      spec.max_runtime_ms <= 0
    ) {
      throw adapterError("validation_failed")
    }
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "creation_metadata_labels")
      requireCapability(client, "started_locked_inert_compensation")
      requireCapability(client, "network_policy_readback")
      let resource = this.#selectExactCreationCandidate(
        await this.#findByCreationToken(client, op.target.provider_idempotency_token_sha256, ctx, op),
        op.target,
        allocationKey,
      )
      if (resource === undefined) {
        await this.#beforeProviderMutation(ctx, op)
        try {
          resource = await client.createInert({
            target: op.target,
            spec,
            allocation_key_sha256: allocationKey,
            ownership: {
              installation_id: this.#dependencies.installation_id,
              provider_scope_ref: this.#dependencies.provider_scope_ref,
              ownership_nonce: allocationKey,
            },
            initial_network_policy: INERT_DENY_ALL_POLICY,
          })
          validateProviderResource(
            resource,
            op.target,
            expectedProviderOwnership(
              this.#dependencies.installation_id,
              this.#dependencies.provider_scope_ref,
              allocationKey,
            ),
            op.target.provider_idempotency_token_sha256,
          )
          if (
            resource.state !== "inert" ||
            !["started_locked", "paused", "stopped"].includes(resource.provider_runtime_state) ||
            resource.guest_broker_bootstrapped
          ) {
            throw adapterError("provider_state_unknown", { quarantineRequired: true })
          }
          validateNetworkObservation(resource.network_policy, INERT_DENY_ALL_POLICY)
        } catch (cause) {
          let candidates: AdapterProviderResourceV1[]
          try {
            candidates = await this.#findByCreationToken(
              client,
              op.target.provider_idempotency_token_sha256,
              ctx,
              op,
            )
          } catch (lookupCause) {
            return this.#anchorUnknown(ctx, op, lookupCause)
          }
          try {
            resource = this.#selectExactCreationCandidate(candidates, op.target, allocationKey)
          } catch (candidateCause) {
            return this.#anchorUnknown(ctx, op, candidateCause)
          }
          if (resource === undefined) return this.#anchorUnknown(ctx, op, cause)
        }
      }

      try {
        const confirmed = this.#selectExactCreationCandidate(
          await this.#findByCreationToken(
            client,
            op.target.provider_idempotency_token_sha256,
            ctx,
            op,
          ),
          op.target,
          allocationKey,
        )
        if (confirmed === undefined || confirmed.opaque_resource_id !== resource.opaque_resource_id) {
          throw adapterError("provider_state_unknown", { quarantineRequired: true })
        }
        const inspected = await this.#retryRead(ctx, op, () =>
          client.inspectResource(confirmed.opaque_resource_id),
        )
        if (inspected === "absent") throw adapterError("provider_state_unknown", { quarantineRequired: true })
        const inspectedExact = this.#selectExactCreationCandidate([inspected], op.target, allocationKey)
        if (
          inspectedExact === undefined ||
          inspectedExact.opaque_resource_id !== confirmed.opaque_resource_id ||
          inspectedExact.provider_created_at !== confirmed.provider_created_at ||
          inspectedExact.provider_resource_version !== confirmed.provider_resource_version
        ) {
          throw adapterError("provider_state_unknown", { quarantineRequired: true })
        }
        resource = inspectedExact
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }

      const providerReceiptSha256 = safeProviderReceipt(resource, op)
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        observation: "completed",
        provider_receipt_sha256: providerReceiptSha256,
        immutable_fingerprint_sha256: resource.immutable_fingerprint_sha256,
      })
      return {
        adapter_id: this.#identity.provider,
        adapter_version: this.#dependencies.adapter_version,
        installation_id: this.#dependencies.installation_id,
        provider_scope_ref: this.#dependencies.provider_scope_ref,
        resource_kind: "managed_sandbox",
        opaque_resource_id: resource.opaque_resource_id,
        ownership_nonce: allocationKey,
        create_inert_operation_id: op.target.operation_id,
        provider_creation_token_sha256: resource.provider_creation_token_sha256,
        creation_receipt_sha256: providerReceiptSha256,
        provider_created_at: resource.provider_created_at,
        provider_resource_version: resource.provider_resource_version,
        immutable_fingerprint_sha256: resource.immutable_fingerprint_sha256,
        resource_lease_id: op.fence.resource_lease_id,
        resource_id: op.target.resource_id,
        resource_lifecycle_generation: op.target.resource_lifecycle_generation,
        generation_transition_sha256: canonicalSha256(op.generation_transition),
        spec_sha256: spec.spec_sha256,
        provider_outcome_anchor_sha256: outcomeAnchor,
      }
    }))
  }

  async activate(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    authorization: ActivationDispatchAuthorizationV1,
    op: ProviderOperationV1,
  ): Promise<ActivationReceiptV1> {
    validateOperation(ctx, op, "activate")
    validateHandle(handle, op, this.#identity, this.#dependencies)
    if (
      authorization.authorization_consumption_receipt_sha256 !==
        op.target.authorization_consumption_receipt_sha256 ||
      !isDigest(authorization.activation_grant_sha256) ||
      !isDigest(authorization.network_policy.policy_sha256)
    ) {
      throw adapterError("operation_target_mismatch")
    }
    if (ctx.authorization_binding_sha256 !== activationAuthorizationBinding(op.target, authorization)) {
      throw adapterError("dispatch_anchor_mismatch")
    }
    validateEffectRequest(op, { operation: "activate", authorization })
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
        requireCapability(client, "network_policy_readback")
        requireCapability(client, "fixed_bootstrap_broker")
        requireCapability(client, "typed_broker_frames")
        requireCapability(client, "idempotent_activation_continuation")
        let activated: AdapterProviderResourceV1
        let broker: GuestBrokerAttestationV1
        try {
          const before = await this.#retryRead(ctx, op, () => client.inspectResource(handle.opaque_resource_id))
          if (before === "absent") throw adapterError("provider_state_unknown", { quarantineRequired: true })
          validateProviderResourceForHandle(before, handle, op.target, this.#dependencies)
          await this.#beforeProviderMutation(ctx, op)
          const activation = await client.activateCompensated(
            handle.opaque_resource_id,
            authorization.network_policy,
            MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
            handle.immutable_fingerprint_sha256,
            op.target,
          )
          activated = activation.resource
          broker = activation.guest_broker
          validateProviderResourceForHandle(activated, handle, op.target, this.#dependencies)
          validateNetworkObservation(activation.network_policy, authorization.network_policy)
          validateNetworkObservation(activated.network_policy, authorization.network_policy)
          if (activated.state !== "active") throw adapterError("provider_state_unknown", { quarantineRequired: true })
          validateGuestBrokerAttestation(broker, handle.immutable_fingerprint_sha256)
        } catch (cause) {
          return this.#anchorUnknown(ctx, op, cause)
        }
        const providerReceiptSha256 = safeProviderReceipt(activated, op)
        const outcomeAnchor = await anchorOutcome(ctx, op, {
          observation: "active",
          provider_receipt_sha256: providerReceiptSha256,
          network_policy_sha256: activated.network_policy.policy_sha256,
          guest_broker_attestation_sha256: canonicalSha256(broker),
          generation_transition_sha256: canonicalSha256(op.generation_transition),
        })
        return {
          observation: "active" as const,
          immutable_fingerprint_sha256: activated.immutable_fingerprint_sha256,
          network_policy: activated.network_policy,
          activation_grant_sha256: authorization.activation_grant_sha256,
          guest_broker_attestation_sha256: canonicalSha256(broker),
          generation_transition_sha256: canonicalSha256(op.generation_transition),
          provider_receipt_sha256: providerReceiptSha256,
          provider_outcome_anchor_sha256: outcomeAnchor,
        }
    }))
  }

  async inspect(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<AdapterObservationV1> {
    validateOperation(ctx, op, "inspect")
    validateEffectRequest(op, { operation: "inspect" })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, async (client) => {
      const resource = await this.#retryRead(ctx, op, () => client.inspectResource(handle.opaque_resource_id))
      if (resource === "absent") {
        const providerReceiptSha256 = canonicalSha256({ observation: "absent", target: canonicalSha256(op.target) })
        const outcomeAnchor = await anchorOutcome(ctx, op, {
          observation: "absent",
          provider_receipt_sha256: providerReceiptSha256,
        })
        return {
          observation: "absent",
          immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
          provider_receipt_sha256: providerReceiptSha256,
          provider_outcome_anchor_sha256: outcomeAnchor,
        }
      }
      validateProviderResourceForHandle(resource, handle, op.target, this.#dependencies)
      const providerReceiptSha256 = safeProviderReceipt(resource, op)
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        observation: resource.state,
        provider_receipt_sha256: providerReceiptSha256,
      })
      return {
        observation: resource.state,
        immutable_fingerprint_sha256: resource.immutable_fingerprint_sha256,
        network_policy: resource.network_policy,
        provider_receipt_sha256: providerReceiptSha256,
        provider_outcome_anchor_sha256: outcomeAnchor,
      }
    })
  }

  async start_exec(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    spec: ExecSpecV1,
    op: ProviderOperationV1,
  ): Promise<AdapterExecHandleV1> {
    validateOperation(ctx, op, "exec_start")
    validateEffectRequest(op, { operation: "exec_start", spec })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    validateExecSpec(spec)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "typed_argv_exec")
      let providerExec
      try {
        const resource = await this.#inspectExactHandle(client, ctx, op, handle)
        if (resource.state !== "active") throw adapterError("provider_state_unknown", { quarantineRequired: true })
        const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
        const frame = encodeGuestBrokerRequestFrame(
          { operation: "exec_start", spec },
          op,
          broker,
        )
        await this.#beforeProviderMutation(ctx, op)
        providerExec = await client.startExec(handle.opaque_resource_id, broker, frame, op.target)
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }
      const receipt = canonicalSha256({
        immutable_exec_fingerprint_sha256: providerExec.immutable_exec_fingerprint_sha256,
        started_at: providerExec.started_at,
      })
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        observation: "accepted",
        provider_receipt_sha256: receipt,
      })
      return {
        ...providerExec,
        adapter_id: this.#identity.provider,
        resource_id: handle.resource_id,
        resource_lifecycle_generation: handle.resource_lifecycle_generation,
        start_operation_id: op.target.operation_id,
        start_request_sha256: op.request_sha256,
        provider_outcome_anchor_sha256: outcomeAnchor,
      }
    }))
  }

  async *stream_exec(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    exec: AdapterExecHandleV1,
    op: ProviderOperationV1,
    maxBytes: number,
  ): AsyncIterable<AdapterExecStreamFrameV1> {
    validateOperation(ctx, op, "exec_stream")
    validateEffectRequest(op, {
      operation: "exec_stream",
      exec_fingerprint_sha256: exec.immutable_exec_fingerprint_sha256,
      max_bytes: maxBytes,
    })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    validateExecHandle(exec, handle, this.#identity)
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw adapterError("validation_failed")
    const frames = await this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      await this.#inspectExactHandle(client, ctx, op, handle)
      const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
      const requestFrame = encodeGuestBrokerRequestFrame(
        { operation: "exec_stream", exec, max_bytes: maxBytes },
        op,
        broker,
      )
      const iterator = client
        .streamExec(handle.opaque_resource_id, broker, requestFrame, op.target)
        [Symbol.asyncIterator]()
      const buffered: AdapterExecStreamFrameV1[] = []
      let totalBytes = 0
      let lastSequence = 0n
      let completed = false
      while (true) {
        await this.#guard(ctx, op, "before_provider_read")
        const next = await iterator.next()
        if (next.done) break
        const providerFrame = next.value
        if (providerFrame.sequence !== lastSequence + 1n || completed) {
          throw adapterError("integrity_failed")
        }
        lastSequence = providerFrame.sequence
        if (providerFrame.stream === "stdout" || providerFrame.stream === "stderr") {
          totalBytes += providerFrame.bytes.byteLength
          if (totalBytes > maxBytes) {
            await this.#contain(ctx, op, "output_limit")
            throw adapterError("output_limit_exceeded")
          }
        } else {
          completed = true
        }
        buffered.push(providerFrame)
      }
      if (!completed) throw adapterError("provider_state_unknown", { quarantineRequired: true })
      await anchorOutcome(ctx, op, {
        observation: "completed",
        exec_fingerprint_sha256: exec.immutable_exec_fingerprint_sha256,
        last_sequence: lastSequence,
        total_bytes: totalBytes,
      })
      return buffered
    }))
    for (const frame of frames) yield frame
  }

  async cancel_exec(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    exec: AdapterExecHandleV1,
    op: ProviderOperationV1,
  ): Promise<CancelObservationV1> {
    validateOperation(ctx, op, "exec_cancel")
    validateEffectRequest(op, {
      operation: "exec_cancel",
      exec_fingerprint_sha256: exec.immutable_exec_fingerprint_sha256,
    })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    validateExecHandle(exec, handle, this.#identity)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "whole_guest_cancel")
      let cancellation
      try {
        await this.#inspectExactHandle(client, ctx, op, handle)
        const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
        const frame = encodeGuestBrokerRequestFrame(
          { operation: "exec_cancel", exec },
          op,
          broker,
        )
        await this.#beforeProviderMutation(ctx, op)
        cancellation = await client.cancelExec(handle.opaque_resource_id, broker, frame, op.target)
        if (!cancellation.whole_guest_scope_terminated) {
          await this.#contain(ctx, op, "whole_guest_cancel_unproven")
          throw adapterError("provider_state_unknown", { quarantineRequired: true })
        }
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }
      const providerReceiptSha256 = canonicalSha256({
        exec_fingerprint_sha256: exec.immutable_exec_fingerprint_sha256,
        whole_guest_scope_terminated: true,
      })
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        observation: "whole_guest_scope_terminated",
        provider_receipt_sha256: providerReceiptSha256,
      })
      return {
        observation: "whole_guest_scope_terminated",
        exec_fingerprint_sha256: exec.immutable_exec_fingerprint_sha256,
        provider_receipt_sha256: providerReceiptSha256,
        provider_outcome_anchor_sha256: outcomeAnchor,
      }
    }))
  }

  async stat_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    path: WorkspacePath,
    op: ProviderOperationV1,
  ): Promise<FileStatV1> {
    const checkedPath = validateWorkspacePath(path)
    validateOperation(ctx, op, "file_stat")
    validateEffectRequest(op, { operation: "file_stat", path: checkedPath })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "native_bounded_files")
      await this.#inspectExactHandle(client, ctx, op, handle)
      const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
      const frame = encodeGuestBrokerRequestFrame(
        { operation: "file_stat", path: checkedPath },
        op,
        broker,
      )
      const stat = await this.#retryRead(ctx, op, () => client.statFile(handle.opaque_resource_id, broker, frame))
      if (
        stat.path !== checkedPath ||
        stat.size_bytes < 0 ||
        stat.revision < 1n ||
        (stat.sha256 !== undefined && !isDigest(stat.sha256)) ||
        (stat.symlink_target !== undefined && validateWorkspacePath(stat.symlink_target) !== stat.symlink_target) ||
        (stat.mode & 0o6000) !== 0
      ) {
        throw adapterError("integrity_failed")
      }
      await anchorOutcome(ctx, op, { observation: "completed", stat_sha256: canonicalSha256(stat) })
      return stat
    }))
  }

  async *read_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileReadV1,
    op: ProviderOperationV1,
  ): AsyncIterable<ByteChunkV1> {
    validateFileRead(request)
    validateOperation(ctx, op, "file_read")
    validateEffectRequest(op, { operation: "file_read", request })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    const chunks = await this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "native_bounded_files")
      await this.#inspectExactHandle(client, ctx, op, handle)
      const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
      const frame = encodeGuestBrokerRequestFrame({ operation: "file_read", request }, op, broker)
      const iterator = client.readFile(handle.opaque_resource_id, broker, frame)[Symbol.asyncIterator]()
      const buffered: ByteChunkV1[] = []
      let offset = request.offset
      let total = 0
      let totalFileSha256: Digest | undefined
      let fileRevision: bigint | undefined
      while (true) {
        await this.#guard(ctx, op, "before_provider_read")
        const next = await iterator.next()
        if (next.done) break
        const providerChunk = next.value
        const bytes = providerChunk.bytes
        total += bytes.byteLength
        if (
          bytes.byteLength === 0 ||
          total > request.length ||
          !isDigest(providerChunk.total_file_sha256) ||
          providerChunk.file_revision < 1n ||
          (totalFileSha256 !== undefined && totalFileSha256 !== providerChunk.total_file_sha256) ||
          (fileRevision !== undefined && fileRevision !== providerChunk.file_revision)
        ) {
          throw adapterError("integrity_failed")
        }
        totalFileSha256 = providerChunk.total_file_sha256
        fileRevision = providerChunk.file_revision
        buffered.push({
          offset,
          bytes,
          sha256: canonicalSha256(bytes),
          total_file_sha256: totalFileSha256,
          file_revision: fileRevision,
        })
        offset += bytes.byteLength
      }
      await anchorOutcome(ctx, op, {
        observation: "completed",
        path_sha256: canonicalSha256(request.path),
        offset: request.offset,
        returned_bytes: total,
      })
      return buffered
    }))
    for (const chunk of chunks) yield chunk
  }

  async write_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileWriteV1,
    op: ProviderOperationV1,
  ): Promise<FileWriteReceiptV1> {
    validateFileWrite(request)
    validateOperation(ctx, op, "file_write")
    validateEffectRequest(op, { operation: "file_write", request })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "native_bounded_files")
      requireCapability(client, "atomic_file_write")
      let receipt: FileWriteReceiptV1
      try {
        const resource = await this.#inspectExactHandle(client, ctx, op, handle)
        if (resource.state !== "active") throw adapterError("provider_state_unknown", { quarantineRequired: true })
        const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
        const frame = encodeGuestBrokerRequestFrame(
          { operation: "file_write", request },
          op,
          broker,
        )
        await this.#beforeProviderMutation(ctx, op)
        receipt = await client.writeFileAtomic(handle.opaque_resource_id, broker, frame, op.target)
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }
      if (
        receipt.path !== request.path ||
        receipt.size_bytes !== request.bytes.byteLength ||
        receipt.sha256 !== canonicalSha256(request.bytes) ||
        receipt.revision < 1n
      ) {
        return this.#anchorUnknown(ctx, op, adapterError("integrity_failed"))
      }
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        observation: "completed",
        file_receipt_sha256: canonicalSha256(receipt),
      })
      return { ...receipt, provider_outcome_anchor_sha256: outcomeAnchor }
    }))
  }

  async list_files(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileListV1,
    op: ProviderOperationV1,
  ): Promise<FilePageV1> {
    const checkedPath = validateWorkspacePath(request.path, true)
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1000) {
      throw adapterError("validation_failed")
    }
    validateOperation(ctx, op, "file_list")
    validateEffectRequest(op, { operation: "file_list", request: { ...request, path: checkedPath } })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, async (client) => {
      requireCapability(client, "native_bounded_files")
      await this.#inspectExactHandle(client, ctx, op, handle)
      const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
      const brokerRequest = { ...request, path: checkedPath }
      const frame = encodeGuestBrokerRequestFrame(
        { operation: "file_list", request: brokerRequest },
        op,
        broker,
      )
      const page = await this.#retryRead(ctx, op, () => client.listFiles(handle.opaque_resource_id, broker, frame))
      if (page.items.length > request.limit) throw adapterError("integrity_failed")
      for (const item of page.items) validateWorkspacePath(item.path)
      const paths = page.items.map((item) => item.path)
      const prefix = checkedPath === "" ? "" : `${checkedPath}/`
      if (
        !safeEqual(paths, [...paths].sort()) ||
        new Set(paths).size !== paths.length ||
        paths.some((path) => checkedPath !== "" && path !== checkedPath && !path.startsWith(prefix)) ||
        (page.next_cursor !== undefined && page.next_cursor === request.cursor)
      ) {
        throw adapterError("integrity_failed")
      }
      await anchorOutcome(ctx, op, { observation: "completed", page_sha256: canonicalSha256(page) })
      return page
    })
  }

  async checkpoint_hint(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<CheckpointHintObservationV1> {
    validateOperation(ctx, op, "checkpoint_hint")
    validateEffectRequest(op, { operation: "checkpoint_hint" })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "provider_snapshot_hint")
      let snapshot
      try {
        await this.#inspectExactHandle(client, ctx, op, handle)
        await this.#beforeProviderMutation(ctx, op)
        snapshot = await client.createSnapshotHint(handle.opaque_resource_id, op.target)
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }
      const snapshotIdSha256 = canonicalSha256(snapshot.opaque_snapshot_id)
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        observation: "provider_snapshot_hint",
        provider_snapshot_id_sha256: snapshotIdSha256,
        provider_receipt_sha256: snapshot.provider_receipt_sha256,
        canonical_checkpoint: false,
        cleanup_authority: false,
      })
      return {
        canonical_checkpoint: false,
        cleanup_authority: false,
        provider_snapshot_id_sha256: snapshotIdSha256,
        provider_receipt_sha256: snapshot.provider_receipt_sha256,
        provider_outcome_anchor_sha256: outcomeAnchor,
      }
    }))
  }

  async #safetyStop(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
    expected: "expire" | "quarantine",
  ): Promise<ExpireObservationV1> {
    validateOperation(ctx, op, expected)
    validateEffectRequest(op, { operation: expected })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      if (!client.capabilities.non_destructive_pause && !client.capabilities.stop_preserves_filesystem) {
        throw adapterError("unsupported_runtime_feature")
      }
      let stopped: AdapterProviderResourceV1
      try {
        await this.#inspectExactHandle(client, ctx, op, handle)
        await this.#beforeProviderMutation(ctx, op)
        stopped = await client.pauseOrStopResource(handle.opaque_resource_id, op.target)
        validateProviderResourceForHandle(stopped, handle, op.target, this.#dependencies)
        if (stopped.state !== "inert") throw adapterError("provider_state_unknown", { quarantineRequired: true })
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }
      const providerReceiptSha256 = safeProviderReceipt(stopped, op)
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        observation: "safety_stopped",
        provider_receipt_sha256: providerReceiptSha256,
      })
      return {
        observation: "safety_stopped",
        immutable_fingerprint_sha256: stopped.immutable_fingerprint_sha256,
        generation_transition_sha256: canonicalSha256(op.generation_transition),
        provider_receipt_sha256: providerReceiptSha256,
        provider_outcome_anchor_sha256: outcomeAnchor,
      }
    }))
  }

  expire(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<ExpireObservationV1> {
    return this.#safetyStop(ctx, handle, op, "expire")
  }

  quarantine(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<QuarantineObservationV1> {
    return this.#safetyStop(ctx, handle, op, "quarantine")
  }

  async destroy(
    ctx: DestroyContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<DestroyObservationV1> {
    validateOperation(ctx, op, "destroy")
    validateHandle(handle, op, this.#identity, this.#dependencies)
    if (!isDigest(ctx.cleanup_grant_sha256) || !isDigest(ctx.cleanup_basis_sha256)) {
      throw adapterError("cleanup_grant_mismatch")
    }
    if (
      ctx.authorization_binding_sha256 !==
      cleanupAuthorizationBinding(op.target, ctx.cleanup_grant_sha256, ctx.cleanup_basis_sha256)
    ) {
      throw adapterError("dispatch_anchor_mismatch")
    }
    validateEffectRequest(op, {
      operation: "destroy",
      cleanup_grant_sha256: ctx.cleanup_grant_sha256,
      cleanup_basis_sha256: ctx.cleanup_basis_sha256,
    })
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "locked_destroy_compensation")
      try {
        const enumerated = await this.#findExactHandleByCreationToken(client, ctx, op, handle)
        const inspected = await this.#inspectExactHandle(client, ctx, op, handle)
        if (
          enumerated.opaque_resource_id !== inspected.opaque_resource_id ||
          enumerated.provider_created_at !== inspected.provider_created_at ||
          enumerated.provider_resource_version !== inspected.provider_resource_version
        ) {
          throw adapterError("provider_state_unknown", { quarantineRequired: true })
        }
        await this.#beforeProviderMutation(ctx, op)
        await client.destroyResource(handle.opaque_resource_id, handle.provider_resource_version, op.target)
      } catch (cause) {
        if (cause instanceof AdapterContractError && cause.code === "stale_operation_execution_epoch") {
          throw cause
        }
        return this.#anchorUnknown(ctx, op, cause)
      }

      let absent = false
      const attempts = this.#dependencies.read_retry_policy.max_attempts
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await this.#guard(ctx, op, "before_provider_read")
          const observation = await client.inspectResource(handle.opaque_resource_id)
          if (observation === "absent") {
            const remaining = await this.#findByCreationToken(
              client,
              handle.provider_creation_token_sha256,
              ctx,
              op,
            )
            if (remaining.length === 0) {
              absent = true
              break
            }
            throw adapterError("provider_state_unknown", { quarantineRequired: true })
          }
          validateProviderResourceForHandle(observation, handle, op.target, this.#dependencies)
        } catch (cause) {
          if (cause instanceof AdapterContractError && cause.code === "stale_operation_execution_epoch") {
            throw cause
          }
          if (cause instanceof AdapterContractError) return this.#anchorUnknown(ctx, op, cause)
          // A failed read is not absence proof. The bounded loop can try another read.
        }
        if (attempt < attempts) {
          const policy = this.#dependencies.read_retry_policy
          await delay(Math.min(policy.max_delay_ms, policy.base_delay_ms * 2 ** (attempt - 1)))
        }
      }
      if (!absent) return this.#anchorUnknown(ctx, op, adapterError("provider_state_unknown"))
      const providerReceiptSha256 = canonicalSha256({
        terminal_condition: "verified_absent",
        immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
        provider_resource_version: handle.provider_resource_version,
        target_sha256: canonicalSha256(op.target),
        generation_transition_sha256: canonicalSha256(op.generation_transition),
      })
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        terminal_condition: "verified_absent",
        provider_receipt_sha256: providerReceiptSha256,
      })
      return {
        terminal_condition: "verified_absent",
        immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
        generation_transition_sha256: canonicalSha256(op.generation_transition),
        provider_receipt_sha256: providerReceiptSha256,
        provider_outcome_anchor_sha256: outcomeAnchor,
      }
    }))
  }

  async lookup_operation(
    ctx: ReconcileContextV1,
    target: ProviderEffectTargetV1,
    handle?: OwnedProviderHandleV1,
  ): Promise<ProviderOperationObservationV1> {
    if (!safeEqual(ctx.target, target) || ctx.authorization_consumption_receipt_sha256 !== target.authorization_consumption_receipt_sha256) {
      throw adapterError("operation_target_mismatch")
    }
    if (handle !== undefined && handle.immutable_fingerprint_sha256 !== target.immutable_fingerprint_sha256) {
      throw adapterError("operation_target_mismatch")
    }
    const op = this.#reconcileOperation(ctx)
    validateAdapterCallContext(ctx, op)
    return this.#withClient(ctx, op, async (client) => {
      const observation = await this.#retryRead(ctx, op, () => client.lookupOperation(target))
      const outcomeAnchor = await anchorOutcome(ctx, op, { observation, target_sha256: canonicalSha256(target) })
      return {
        observation,
        target_sha256: canonicalSha256(target),
        provider_idempotency_token_sha256: target.provider_idempotency_token_sha256,
        immutable_fingerprint_sha256: target.immutable_fingerprint_sha256,
        provider_outcome_anchor_sha256: outcomeAnchor,
      }
    })
  }

  async list_owned_resources(ctx: ReconcileContextV1, cursor?: string): Promise<OwnedResourcePageV1> {
    const op = this.#reconcileOperation(ctx)
    validateAdapterCallContext(ctx, op)
    return this.#withClient(ctx, op, async (client) => {
      requireCapability(client, "ownership_inventory")
      const page = await this.#retryRead(ctx, op, () => client.listOwnedResources(cursor))
      const items = page.items.map((resource) => ({
        provider_resource_sha256: canonicalSha256(resource.opaque_resource_id),
        immutable_fingerprint_sha256: resource.immutable_fingerprint_sha256,
        state: resource.state,
      }))
      await anchorOutcome(ctx, op, { observation: "completed", inventory_sha256: canonicalSha256(items) })
      return { items, ...(page.next_cursor === undefined ? {} : { next_cursor: page.next_cursor }) }
    })
  }

  async reconcile_inventory(
    ctx: AdapterCallContextV1,
    knownFingerprints: ReadonlyMap<Digest, string>,
  ): Promise<InventoryReconciliationV1> {
    const op: ProviderOperationV1 = {
      operation: "inspect",
      target: ctx.target,
      fence: ctx.fence,
      request_sha256: ctx.request_sha256,
      idempotency_key_sha256: canonicalSha256({ operation_id: ctx.target.operation_id, kind: "inventory" }),
      external_anchor_kind: "READ_PROBE",
      external_anchor_receipt_sha256: ctx.invocation_anchor.record_sha256,
      deadline: ctx.deadline,
    }
    validateOperation(ctx, op, "inspect")
    return this.#withClient(ctx, op, async (client) => {
      requireCapability(client, "ownership_inventory")
      const resources: AdapterProviderResourceV1[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      for (let pageCount = 0; pageCount < MAX_INVENTORY_PAGES; pageCount += 1) {
        const page = await this.#retryRead(ctx, op, () => client.listOwnedResources(cursor))
        resources.push(...page.items)
        if (page.next_cursor === undefined) {
          const findings = resources.map((resource) => {
            const resourceId = knownFingerprints.get(resource.immutable_fingerprint_sha256)
            return {
              provider_resource_sha256: canonicalSha256(resource.opaque_resource_id),
              immutable_fingerprint_sha256: resource.immutable_fingerprint_sha256,
              disposition: resourceId === undefined ? ("quarantine_required" as const) : ("known" as const),
              ...(resourceId === undefined ? {} : { resource_id: resourceId }),
            }
          })
          await anchorOutcome(ctx, op, { observation: "completed", findings_sha256: canonicalSha256(findings) })
          return { findings, complete: true }
        }
        if (cursors.has(page.next_cursor)) throw adapterError("integrity_failed")
        cursors.add(page.next_cursor)
        cursor = page.next_cursor
      }
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    })
  }

  #reconcileOperation(ctx: ReconcileContextV1): ProviderOperationV1 {
    return {
      operation: ctx.invocation_anchor.record.semantic_step,
      target: ctx.target,
      fence: ctx.fence,
      request_sha256: ctx.invocation_anchor.record.request_sha256,
      idempotency_key_sha256: canonicalSha256({
        operation_id: ctx.target.operation_id,
        continuation_grant_sha256: ctx.continuation_grant_sha256,
      }),
      external_anchor_kind: "READ_PROBE",
      external_anchor_receipt_sha256: ctx.invocation_anchor.record_sha256,
      deadline: ctx.fence.operation_execution_expires_at,
    }
  }
}
