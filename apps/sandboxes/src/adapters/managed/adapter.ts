import { canonicalSha256, isDigest, safeEqual } from "./canonical"
import {
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  encodeGuestBrokerRequestFrame,
  validateGuestBrokerAttestation,
} from "./broker"
import { AdapterContractError, adapterError } from "./errors"
import { anchorOutcome, validateAdapterCallContext } from "./journal"
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

function validateNetworkObservation(
  observation: NetworkPolicyObservationV1,
  expected: NetworkPolicyV1,
): void {
  if (
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

function safeProviderReceipt(resource: AdapterProviderResourceV1): Digest {
  return canonicalSha256({
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
  })
}

function validateProviderResource(
  resource: AdapterProviderResourceV1,
  target: ProviderEffectTargetV1,
): void {
  if (
    resource.opaque_resource_id.length === 0 ||
    !resource.owned ||
    resource.provider_creation_token_sha256 !== target.provider_idempotency_token_sha256 ||
    resource.immutable_fingerprint_sha256 !== target.immutable_fingerprint_sha256 ||
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
): void {
  validateProviderResource(resource, target)
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
    handle.provider_creation_token_sha256 !== op.target.provider_idempotency_token_sha256 ||
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
    provider_creation_token_sha256: target.provider_idempotency_token_sha256,
    immutable_fingerprint_sha256: target.immutable_fingerprint_sha256,
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
    return {
      adapter_id: this.#identity.provider,
      adapter_version: this.#dependencies.adapter_version,
      adapter_build_sha256: this.#dependencies.adapter_build_sha256,
      sdk_package: this.#identity.sdkPackage,
      sdk_version: this.#identity.sdkVersion,
      runtime_class: "strong_vm",
      architecture: ["arm64", "amd64"],
      admission: this.#dependencies.admission.admitted ? "enabled" : "disabled",
      admission_evidence_sha256: this.#dependencies.admission.evidence_sha256,
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

  async #withClient<T>(
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
    use: (client: ManagedProviderControlPortV1) => Promise<T>,
  ): Promise<T> {
    if (!this.#dependencies.admission.admitted) throw adapterError("unsupported_runtime_feature")
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
    validateProviderResourceForHandle(resource, handle, op.target)
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

  #selectExactCreationCandidate(
    resources: AdapterProviderResourceV1[],
    target: ProviderEffectTargetV1,
  ): AdapterProviderResourceV1 | undefined {
    if (resources.length === 0) return undefined
    if (resources.length !== 1) throw adapterError("provider_state_unknown", { quarantineRequired: true })
    const resource = resources[0]
    if (resource === undefined) throw adapterError("integrity_failed")
    validateProviderResource(resource, target)
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

  async #anchorUnknown(ctx: AdapterCallContextV1, op: ProviderOperationV1, cause: unknown): Promise<never> {
    await anchorOutcome(ctx, op, {
      observation: "unknown",
      target_sha256: canonicalSha256(op.target),
      quarantine_required: true,
    })
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
    if (!isDigest(allocationKey) || spec.workspace_root !== "/workspace" || spec.schema_version !== "sandboxes.runtime/v1") {
      throw adapterError("validation_failed")
    }
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "creation_metadata_labels")
      requireCapability(client, "started_locked_inert_compensation")
      requireCapability(client, "network_policy_readback")
      let resource = this.#selectExactCreationCandidate(
        await this.#findByCreationToken(client, op.target.provider_idempotency_token_sha256, ctx, op),
        op.target,
      )
      if (resource === undefined) {
        await this.#guard(ctx, op, "before_provider_mutation")
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
          validateProviderResource(resource, op.target)
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
            resource = this.#selectExactCreationCandidate(candidates, op.target)
          } catch (candidateCause) {
            return this.#anchorUnknown(ctx, op, candidateCause)
          }
          if (resource === undefined) return this.#anchorUnknown(ctx, op, cause)
        }
      }

      const providerReceiptSha256 = safeProviderReceipt(resource)
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
      !isDigest(authorization.activation_grant_sha256)
    ) {
      throw adapterError("operation_target_mismatch")
    }
    if (ctx.authorization_binding_sha256 !== activationAuthorizationBinding(op.target, authorization)) {
      throw adapterError("dispatch_anchor_mismatch")
    }
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
        requireCapability(client, "network_policy_readback")
        requireCapability(client, "fixed_bootstrap_broker")
        requireCapability(client, "typed_broker_frames")
        let activated: AdapterProviderResourceV1
        let broker: GuestBrokerAttestationV1
        try {
          const before = await this.#retryRead(ctx, op, () => client.inspectResource(handle.opaque_resource_id))
          if (before === "absent") throw adapterError("provider_state_unknown", { quarantineRequired: true })
          validateProviderResourceForHandle(before, handle, op.target)
          await this.#guard(ctx, op, "before_provider_mutation")
          const policy = await client.applyNetworkPolicy(handle.opaque_resource_id, authorization.network_policy)
          validateNetworkObservation(policy, authorization.network_policy)
          await this.#guard(ctx, op, "before_provider_mutation")
          activated = await client.activateResource(handle.opaque_resource_id)
          validateProviderResourceForHandle(activated, handle, op.target)
          validateNetworkObservation(activated.network_policy, authorization.network_policy)
          if (activated.state !== "active") throw adapterError("provider_state_unknown", { quarantineRequired: true })
          await this.#guard(ctx, op, "before_provider_mutation")
          broker = await client.bootstrapGuestBroker(
            handle.opaque_resource_id,
            MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
            handle.immutable_fingerprint_sha256,
          )
          validateGuestBrokerAttestation(broker, handle.immutable_fingerprint_sha256)
        } catch (cause) {
          return this.#anchorUnknown(ctx, op, cause)
        }
        const providerReceiptSha256 = safeProviderReceipt(activated)
        const outcomeAnchor = await anchorOutcome(ctx, op, {
          observation: "active",
          provider_receipt_sha256: providerReceiptSha256,
          network_policy_sha256: activated.network_policy.policy_sha256,
          guest_broker_attestation_sha256: canonicalSha256(broker),
        })
        return {
          observation: "active" as const,
          immutable_fingerprint_sha256: activated.immutable_fingerprint_sha256,
          network_policy: activated.network_policy,
          activation_grant_sha256: authorization.activation_grant_sha256,
          guest_broker_attestation_sha256: canonicalSha256(broker),
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
      validateProviderResourceForHandle(resource, handle, op.target)
      const providerReceiptSha256 = safeProviderReceipt(resource)
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
          handle.immutable_fingerprint_sha256,
        )
        await this.#guard(ctx, op, "before_provider_mutation")
        providerExec = await client.startExec(handle.opaque_resource_id, broker, frame)
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
    validateHandle(handle, op, this.#identity, this.#dependencies)
    validateExecHandle(exec, handle, this.#identity)
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw adapterError("validation_failed")
    const iterable = await this.#withClient(ctx, op, async (client) => {
      await this.#inspectExactHandle(client, ctx, op, handle)
      const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
      const frame = encodeGuestBrokerRequestFrame(
        { operation: "exec_stream", exec },
        handle.immutable_fingerprint_sha256,
      )
      await this.#guard(ctx, op, "before_provider_read")
      return client.streamExec(handle.opaque_resource_id, broker, frame)
    })
    let totalBytes = 0
    let lastSequence = 0n
    let completed = false
    try {
      for await (const frame of iterable) {
        if (frame.sequence !== lastSequence + 1n) throw adapterError("integrity_failed")
        lastSequence = frame.sequence
        if (frame.stream === "stdout" || frame.stream === "stderr") {
          totalBytes += frame.bytes.byteLength
          if (totalBytes > maxBytes) throw adapterError("output_limit_exceeded")
        } else {
          completed = true
        }
        yield frame
      }
    } finally {
      await anchorOutcome(ctx, op, {
        observation: completed ? "completed" : "detached",
        exec_fingerprint_sha256: exec.immutable_exec_fingerprint_sha256,
        last_sequence: lastSequence,
        total_bytes: totalBytes,
      })
    }
  }

  async cancel_exec(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    exec: AdapterExecHandleV1,
    op: ProviderOperationV1,
  ): Promise<CancelObservationV1> {
    validateOperation(ctx, op, "exec_cancel")
    validateHandle(handle, op, this.#identity, this.#dependencies)
    validateExecHandle(exec, handle, this.#identity)
    return this.#withClient(ctx, op, async (client) => {
      requireCapability(client, "whole_guest_cancel")
      let cancellation
      try {
        await this.#inspectExactHandle(client, ctx, op, handle)
        const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
        const frame = encodeGuestBrokerRequestFrame(
          { operation: "exec_cancel", exec },
          handle.immutable_fingerprint_sha256,
        )
        await this.#guard(ctx, op, "before_provider_mutation")
        cancellation = await client.cancelExec(handle.opaque_resource_id, broker, frame)
        if (!cancellation.whole_guest_scope_terminated) {
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
    })
  }

  async stat_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    path: WorkspacePath,
    op: ProviderOperationV1,
  ): Promise<FileStatV1> {
    const checkedPath = validateWorkspacePath(path)
    validateOperation(ctx, op, "file_stat")
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, async (client) => {
      requireCapability(client, "native_bounded_files")
      await this.#inspectExactHandle(client, ctx, op, handle)
      const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
      const frame = encodeGuestBrokerRequestFrame(
        { operation: "file_stat", path: checkedPath },
        handle.immutable_fingerprint_sha256,
      )
      const stat = await this.#retryRead(ctx, op, () => client.statFile(handle.opaque_resource_id, broker, frame))
      if (stat.path !== checkedPath || stat.size_bytes < 0 || stat.revision < 1n) throw adapterError("integrity_failed")
      await anchorOutcome(ctx, op, { observation: "completed", stat_sha256: canonicalSha256(stat) })
      return stat
    })
  }

  async *read_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileReadV1,
    op: ProviderOperationV1,
  ): AsyncIterable<ByteChunkV1> {
    validateFileRead(request)
    validateOperation(ctx, op, "file_read")
    validateHandle(handle, op, this.#identity, this.#dependencies)
    const iterable = await this.#withClient(ctx, op, async (client) => {
      requireCapability(client, "native_bounded_files")
      await this.#inspectExactHandle(client, ctx, op, handle)
      const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
      const frame = encodeGuestBrokerRequestFrame(
        { operation: "file_read", request },
        handle.immutable_fingerprint_sha256,
      )
      await this.#guard(ctx, op, "before_provider_read")
      return client.readFile(handle.opaque_resource_id, broker, frame)
    })
    let offset = request.offset
    let total = 0
    let completed = false
    try {
      for await (const bytes of iterable) {
        total += bytes.byteLength
        if (total > request.length) throw adapterError("integrity_failed")
        yield { offset, bytes, sha256: canonicalSha256(bytes) }
        offset += bytes.byteLength
      }
      completed = true
    } finally {
      await anchorOutcome(ctx, op, {
        observation: completed ? "completed" : "detached",
        path_sha256: canonicalSha256(request.path),
        offset: request.offset,
        returned_bytes: total,
      })
    }
  }

  async write_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileWriteV1,
    op: ProviderOperationV1,
  ): Promise<FileWriteReceiptV1> {
    validateFileWrite(request)
    validateOperation(ctx, op, "file_write")
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, async (client) => {
      requireCapability(client, "native_bounded_files")
      requireCapability(client, "atomic_file_write")
      let receipt: FileWriteReceiptV1
      try {
        const resource = await this.#inspectExactHandle(client, ctx, op, handle)
        if (resource.state !== "active") throw adapterError("provider_state_unknown", { quarantineRequired: true })
        const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
        const frame = encodeGuestBrokerRequestFrame(
          { operation: "file_write", request },
          handle.immutable_fingerprint_sha256,
        )
        await this.#guard(ctx, op, "before_provider_mutation")
        receipt = await client.writeFileAtomic(handle.opaque_resource_id, broker, frame)
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
    })
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
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, async (client) => {
      requireCapability(client, "native_bounded_files")
      await this.#inspectExactHandle(client, ctx, op, handle)
      const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
      const brokerRequest = { ...request, path: checkedPath }
      const frame = encodeGuestBrokerRequestFrame(
        { operation: "file_list", request: brokerRequest },
        handle.immutable_fingerprint_sha256,
      )
      const page = await this.#retryRead(ctx, op, () => client.listFiles(handle.opaque_resource_id, broker, frame))
      if (page.items.length > request.limit) throw adapterError("integrity_failed")
      for (const item of page.items) validateWorkspacePath(item.path)
      const paths = page.items.map((item) => item.path)
      if (!safeEqual(paths, [...paths].sort())) throw adapterError("integrity_failed")
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
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, async (client) => {
      requireCapability(client, "provider_snapshot_hint")
      let snapshot
      try {
        await this.#inspectExactHandle(client, ctx, op, handle)
        await this.#guard(ctx, op, "before_provider_mutation")
        snapshot = await client.createSnapshotHint(handle.opaque_resource_id)
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
    })
  }

  async #safetyStop(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
    expected: "expire" | "quarantine",
  ): Promise<ExpireObservationV1> {
    validateOperation(ctx, op, expected)
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      if (!client.capabilities.non_destructive_pause && !client.capabilities.stop_preserves_filesystem) {
        throw adapterError("unsupported_runtime_feature")
      }
      let stopped: AdapterProviderResourceV1
      try {
        await this.#inspectExactHandle(client, ctx, op, handle)
        await this.#guard(ctx, op, "before_provider_mutation")
        stopped = await client.pauseOrStopResource(handle.opaque_resource_id)
        validateProviderResourceForHandle(stopped, handle, op.target)
        if (stopped.state !== "inert") throw adapterError("provider_state_unknown", { quarantineRequired: true })
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }
      const providerReceiptSha256 = safeProviderReceipt(stopped)
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        observation: "safety_stopped",
        provider_receipt_sha256: providerReceiptSha256,
      })
      return {
        observation: "safety_stopped",
        immutable_fingerprint_sha256: stopped.immutable_fingerprint_sha256,
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
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "conditional_destroy")
      try {
        await this.#inspectExactHandle(client, ctx, op, handle)
        await this.#guard(ctx, op, "before_provider_mutation")
        await client.destroyResource(handle.opaque_resource_id, handle.provider_resource_version)
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }

      let absent = false
      const attempts = this.#dependencies.read_retry_policy.max_attempts
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await this.#guard(ctx, op, "before_provider_read")
          const observation = await client.inspectResource(handle.opaque_resource_id)
          if (observation === "absent") {
            absent = true
            break
          }
          validateProviderResourceForHandle(observation, handle, op.target)
        } catch {
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
      })
      const outcomeAnchor = await anchorOutcome(ctx, op, {
        terminal_condition: "verified_absent",
        provider_receipt_sha256: providerReceiptSha256,
      })
      return {
        terminal_condition: "verified_absent",
        immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
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
