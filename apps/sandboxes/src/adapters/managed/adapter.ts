import { canonicalSha256, isDigest, safeEqual } from "./canonical"
import {
  MANAGED_GUEST_BROKER_BOOTSTRAP_COMMAND,
  encodeGuestBrokerRequestFrame,
  validateGuestBrokerAttestation,
} from "./broker"
import { AdapterContractError, DefinitiveProviderEffectError, adapterError } from "./errors"
import {
  anchorOutcome as appendOutcomeAnchor,
  journalAnchorSha256,
  validateAdapterCallContext,
} from "./journal"
import {
  managedProviderRequestSha256,
  providerCreationTokenSha256,
  providerEffectTokenSha256,
  providerTargetFingerprintSha256,
} from "./request"
import type {
  ActivationDispatchAuthorizationV1,
  ActivationReceiptV1,
  AdapterCallContextV1,
  AdapterDescriptorV1,
  AdapterExecHandleV1,
  AdapterObservationV1,
  AdapterProviderResourceV1,
  AdapterSandboxSpecV1,
  ByteChunkV1,
  CancelObservationV1,
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
  "expire",
  "quarantine",
  "destroy",
])

const MAX_INVENTORY_PAGES = 32
const MAX_WORKSPACE_PATH_BYTES = 4096
const MAX_WORKSPACE_SEGMENT_BYTES = 255
const MAX_EXEC_ARGV_ENTRIES = 1024
const MAX_EXEC_ARGUMENT_BYTES = 128 * 1024
const MAX_EXEC_OUTPUT_BYTES = 1024 * 1024 * 1024
const MAX_EXEC_PROCESS_LIMIT = 65_536
const MAX_INLINE_FILE_WRITE_BYTES = 64 * 1024
const MAX_FILE_READ_BYTES = 1024 * 1024
const MAX_WORKSPACE_DEPTH = 64
const PORTABLE_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const FORBIDDEN_PATH_UNICODE = /[\u202a-\u202e\u2066-\u2069\u2044\u2215\u29f8\uff0f\ufdd0-\ufdef]/u
const PRODUCTION_MANAGED_ADMISSION_ENABLED = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

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

export function reconciliationAuthorizationBinding(
  target: ProviderEffectTargetV1,
  fence: AdapterCallContextV1["fence"],
  continuationGrantSha256: Digest,
  authorizationConsumptionReceiptSha256: Digest,
): Digest {
  return canonicalSha256({
    kind: "reconciliation_continuation",
    target_sha256: canonicalSha256(target),
    fence_sha256: canonicalSha256(fence),
    continuation_grant_sha256: continuationGrantSha256,
    authorization_consumption_receipt_sha256: authorizationConsumptionReceiptSha256,
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
    !isRecord(transition) ||
    typeof transition.expected_resource_lifecycle_generation !== "bigint" ||
    typeof transition.successor_resource_lifecycle_generation !== "bigint" ||
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
  if (!isRecord(ctx) || !isRecord(op) || !isRecord(op.target) || !isRecord(op.fence)) {
    throw adapterError("validation_failed")
  }
  if (op.operation !== expected) throw adapterError("operation_target_mismatch")
  if (
    !isDigest(op.target.operation_digest) ||
    !isDigest(op.target.provider_idempotency_token_sha256) ||
    !isDigest(op.target.provider_creation_token_sha256) ||
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
  if (op.target.provider_idempotency_token_sha256 !== providerEffectTokenSha256(op)) {
    throw adapterError("operation_target_mismatch")
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
    !isRecord(observation) ||
    !isRecord(expected) ||
    typeof observation.observed_at !== "string" ||
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
    !isRecord(resource) ||
    !isRecord(resource.ownership) ||
    !isRecord(resource.network_policy) ||
    typeof resource.opaque_resource_id !== "string" ||
    resource.opaque_resource_id.length === 0 ||
    !isDigest(resource.provider_creation_token_sha256) ||
    !isDigest(resource.immutable_fingerprint_sha256) ||
    typeof resource.provider_created_at !== "string" ||
    typeof resource.provider_resource_version !== "string" ||
    !["inert", "active", "transitioning", "unknown"].includes(resource.state) ||
    !["paused", "stopped", "active", "unknown"].includes(resource.provider_runtime_state) ||
    typeof resource.owned !== "boolean" ||
    typeof resource.auto_delete_disabled !== "boolean" ||
    typeof resource.ephemeral !== "boolean" ||
    typeof resource.source_attached !== "boolean" ||
    typeof resource.credential_attached !== "boolean" ||
    typeof resource.guest_broker_bootstrapped !== "boolean" ||
    !isDigest(resource.ownership.installation_id_sha256) ||
    !isDigest(resource.ownership.provider_scope_ref_sha256) ||
    !isDigest(resource.ownership.ownership_nonce_sha256) ||
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
    !isRecord(handle) ||
    typeof handle.opaque_resource_id !== "string" ||
    typeof handle.ownership_nonce !== "string" ||
    typeof handle.create_inert_operation_id !== "string" ||
    typeof handle.provider_created_at !== "string" ||
    typeof handle.provider_resource_version !== "string" ||
    handle.adapter_id !== identity.provider ||
    handle.adapter_version !== dependencies.adapter_version ||
    handle.installation_id !== dependencies.installation_id ||
    handle.provider_scope_ref !== dependencies.provider_scope_ref ||
    handle.resource_kind !== "managed_sandbox" ||
    handle.resource_lease_id !== op.fence.resource_lease_id ||
    handle.resource_id !== op.target.resource_id ||
    handle.resource_lifecycle_generation !== op.target.resource_lifecycle_generation ||
    handle.provider_creation_token_sha256 !== op.target.provider_creation_token_sha256 ||
    handle.immutable_fingerprint_sha256 !== op.target.immutable_fingerprint_sha256 ||
    handle.opaque_resource_id.length === 0 ||
    handle.ownership_nonce.length === 0 ||
    handle.create_inert_operation_id.length === 0 ||
    !isDigest(handle.provider_creation_token_sha256) ||
    !isDigest(handle.creation_receipt_sha256) ||
    !isDigest(handle.immutable_fingerprint_sha256) ||
    !isDigest(handle.spec_sha256) ||
    handle.provider_resource_version.length === 0 ||
    Number.isNaN(Date.parse(handle.provider_created_at))
  ) {
    throw adapterError("operation_target_mismatch")
  }
}

function validateExecHandle(
  exec: AdapterExecHandleV1,
  handle: OwnedProviderHandleV1,
  identity: AdapterIdentityV1,
): void {
  if (!isRecord(exec)) throw adapterError("operation_target_mismatch")
  if (
    typeof exec.opaque_exec_id !== "string" ||
    typeof exec.started_at !== "string" ||
    typeof exec.resource_lifecycle_generation !== "bigint"
  ) {
    throw adapterError("operation_target_mismatch")
  }
  const expectedFingerprint = canonicalSha256({
    schema_version: "sandboxes.adapter-exec-handle/v1",
    adapter_id: exec.adapter_id,
    resource_id: exec.resource_id,
    resource_lifecycle_generation: exec.resource_lifecycle_generation,
    start_operation_id: exec.start_operation_id,
    start_request_sha256: exec.start_request_sha256,
    opaque_exec_id: exec.opaque_exec_id,
    started_at: exec.started_at,
  })
  if (
    exec.adapter_id !== identity.provider ||
    exec.resource_id !== handle.resource_id ||
    exec.resource_lifecycle_generation !== handle.resource_lifecycle_generation ||
    exec.opaque_exec_id.length === 0 ||
    !isDigest(exec.immutable_exec_fingerprint_sha256) ||
    exec.immutable_exec_fingerprint_sha256 !== expectedFingerprint ||
    Number.isNaN(Date.parse(exec.started_at))
  ) {
    throw adapterError("operation_target_mismatch")
  }
}

function validateProviderPage(page: ProviderResourcePageV1): void {
  if (
    !isRecord(page) ||
    !Array.isArray(page.items) ||
    page.items.length > 1000 ||
    (page.next_cursor !== undefined &&
      (typeof page.next_cursor !== "string" ||
        page.next_cursor.length === 0 ||
        page.next_cursor.length > 4096 ||
        /[\0-\x1f\x7f]/u.test(page.next_cursor)))
  ) {
    throw adapterError("provider_state_unknown", { quarantineRequired: true })
  }
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validateExecSpec(spec: ExecSpecV1, operationDeadline: string): void {
  if (!isRecord(spec)) throw adapterError("validation_failed")
  const specKeys = [
    "schema_version",
    "executable",
    "argv",
    "cwd",
    "workspace_access",
    ...(spec.stdin_object === undefined ? [] : ["stdin_object"]),
    "environment_profile_id",
    "environment_profile_sha256",
    "wall_deadline",
    "idle_timeout_ms",
    "output_limit_bytes",
    "process_limit",
    "tty",
  ]
  const wallDeadline = Date.parse(spec.wall_deadline)
  const providerDeadline = Date.parse(operationDeadline)
  const argumentBytes =
    typeof spec.executable === "string" && Array.isArray(spec.argv)
      ? Buffer.byteLength(spec.executable, "utf8") +
        spec.argv.reduce(
          (total, argument) =>
            total + (typeof argument === "string" ? Buffer.byteLength(argument, "utf8") : MAX_EXEC_ARGUMENT_BYTES + 1),
          0,
        )
      : MAX_EXEC_ARGUMENT_BYTES + 1
  if (
    !hasExactKeys(spec, specKeys) ||
    spec.schema_version !== "sandboxes.exec-spec/v1" ||
    spec.tty !== false ||
    !["read_only", "write"].includes(spec.workspace_access) ||
    !["minimal-v1", "build-v1", "test-v1"].includes(spec.environment_profile_id) ||
    !isDigest(spec.environment_profile_sha256) ||
    !Array.isArray(spec.argv) ||
    spec.argv.length > MAX_EXEC_ARGV_ENTRIES ||
    spec.argv.some((argument) => typeof argument !== "string") ||
    argumentBytes > MAX_EXEC_ARGUMENT_BYTES ||
    typeof spec.executable !== "string" ||
    !spec.executable.startsWith("/") ||
    spec.executable.includes("\0") ||
    spec.argv.some((argument) => argument.includes("\0")) ||
    !Number.isSafeInteger(spec.output_limit_bytes) ||
    spec.output_limit_bytes <= 0 ||
    spec.output_limit_bytes > MAX_EXEC_OUTPUT_BYTES ||
    !Number.isSafeInteger(spec.process_limit) ||
    spec.process_limit <= 0 ||
    spec.process_limit > MAX_EXEC_PROCESS_LIMIT ||
    !Number.isSafeInteger(spec.idle_timeout_ms) ||
    spec.idle_timeout_ms < 0 ||
    Number.isNaN(wallDeadline) ||
    Number.isNaN(providerDeadline) ||
    wallDeadline > providerDeadline
  ) {
    throw adapterError("validation_failed")
  }
  if (
    spec.stdin_object !== undefined &&
    (!hasExactKeys(spec.stdin_object, [
      "object_sha256",
      "object_version",
      "size_bytes",
      "resource_scope_sha256",
      "input_authorization_receipt_sha256",
    ]) ||
      !isDigest(spec.stdin_object.object_sha256) ||
      spec.stdin_object.object_version.length === 0 ||
      !Number.isSafeInteger(spec.stdin_object.size_bytes) ||
      spec.stdin_object.size_bytes < 0 ||
      !isDigest(spec.stdin_object.resource_scope_sha256) ||
      !isDigest(spec.stdin_object.input_authorization_receipt_sha256))
  ) {
    throw adapterError("validation_failed")
  }
  if (spec.cwd !== "") validateWorkspacePath(spec.cwd)
}

export function validateWorkspacePath(path: string, allowRoot = false): WorkspacePath {
  if (allowRoot && path === "") return path as WorkspacePath
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    /[\0-\x1f\x7f]/u.test(path) ||
    /[\ud800-\udfff]/u.test(path) ||
    FORBIDDEN_PATH_UNICODE.test(path) ||
    Array.from(path).some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint & 0xffff) >= 0xfffe
    }) ||
    path !== path.normalize("NFC") ||
    Buffer.byteLength(path, "utf8") > MAX_WORKSPACE_PATH_BYTES
  ) {
    throw adapterError("path_outside_workspace")
  }
  const segments = path.split("/")
  if (
    segments.length > MAX_WORKSPACE_DEPTH ||
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
  if (!isRecord(request)) throw adapterError("validation_failed")
  validateWorkspacePath(request.path)
  if (!Number.isSafeInteger(request.offset) || request.offset < 0) throw adapterError("validation_failed")
  if (
    !Number.isSafeInteger(request.length) ||
    request.length <= 0 ||
    request.length > MAX_FILE_READ_BYTES
  ) {
    throw adapterError("validation_failed")
  }
}

function validateFileWrite(request: FileWriteV1): void {
  if (!isRecord(request)) throw adapterError("validation_failed")
  validateWorkspacePath(request.path)
  const preconditions = [request.if_absent === true, request.expected_prior_sha256 !== undefined, request.expected_prior_revision !== undefined]
  if (
    preconditions.filter(Boolean).length !== 1 ||
    !(request.bytes instanceof Uint8Array) ||
    request.bytes.byteLength === 0 ||
    request.bytes.byteLength > MAX_INLINE_FILE_WRITE_BYTES
  ) {
    throw adapterError("validation_failed")
  }
  if (request.expected_prior_sha256 !== undefined && !isDigest(request.expected_prior_sha256)) {
    throw adapterError("validation_failed")
  }
  if (
    request.expected_prior_revision !== undefined &&
    (typeof request.expected_prior_revision !== "bigint" ||
      request.expected_prior_revision < 1n)
  ) {
    throw adapterError("validation_failed")
  }
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function snapshotData<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    throw adapterError("validation_failed")
  }
}

function snapshotContext<T extends AdapterCallContextV1>(ctx: T): T {
  if (!isRecord(ctx)) throw adapterError("validation_failed")
  try {
    const { signal, ...data } = ctx
    return {
      ...snapshotData(data),
      ...(signal === undefined ? {} : { signal }),
    } as T
  } catch {
    throw adapterError("validation_failed")
  }
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
  readonly #hermeticConformanceOnly: boolean

  constructor(
    identity: AdapterIdentityV1,
    dependencies: ManagedAdapterDependenciesV1,
    hermeticConformanceOnly = false,
  ) {
    this.#identity = { ...identity }
    this.#dependencies = {
      ...dependencies,
      admission: snapshotData(dependencies.admission),
      read_retry_policy: snapshotData(dependencies.read_retry_policy),
    }
    this.#hermeticConformanceOnly = hermeticConformanceOnly
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

  async #anchorOutcome(
    ctx: AdapterCallContextV1,
    op: ProviderOperationV1,
    safeOutcome: unknown,
    outcomeKind: "succeeded" | "failed_effect" | "failed_no_effect" | "reconciliation_blocked" = "succeeded",
  ): Promise<Digest> {
    try {
      return await appendOutcomeAnchor(
        ctx,
        op,
        safeOutcome,
        this.#dependencies.outcome_journal,
        this.#dependencies.outcome_anchor_verifier,
        outcomeKind,
      )
    } catch (cause) {
      if (MUTATING_OPERATIONS.has(op.operation)) {
        await this.#contain(ctx, op, "provider_effect_ambiguous")
      }
      if (cause instanceof AdapterContractError) throw cause
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
  }

  async #assertAdmissionVerified(): Promise<void> {
    if (!this.#dependencies.admission.admitted) throw adapterError("unsupported_runtime_feature")
    const evidenceKind = this.#dependencies.admission.evidence_kind
    if (this.#hermeticConformanceOnly) {
      if (evidenceKind !== "hermetic_conformance") {
        throw adapterError("unsupported_runtime_feature")
      }
    } else if (
      evidenceKind !== "live_conformance" ||
      !PRODUCTION_MANAGED_ADMISSION_ENABLED
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
      validateProviderPage(page)
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
      target.provider_creation_token_sha256,
    )
    if (
      resource.state !== "inert" ||
      !["paused", "stopped"].includes(resource.provider_runtime_state) ||
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
    if (cause instanceof DefinitiveProviderEffectError) {
      if (cause.outcome_kind === "failed_effect") {
        await this.#contain(_ctx, _op, "provider_effect_ambiguous")
      }
      await this.#anchorOutcome(
        _ctx,
        _op,
        {
          observation: cause.outcome_kind,
          provider_receipt_sha256: cause.provider_receipt_sha256,
        },
        cause.outcome_kind,
      )
      throw adapterError(cause.safe_code, {
        quarantineRequired: cause.outcome_kind === "failed_effect",
      })
    }
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
    ctx = snapshotContext(ctx)
    spec = snapshotData(spec)
    op = snapshotData(op)
    validateOperation(ctx, op, "create_inert")
    if (
      !isRecord(spec) ||
      !isRecord(spec.source) ||
      !isRecord(spec.environment) ||
      !isRecord(spec.network_policy) ||
      !isRecord(spec.resources) ||
      !Array.isArray(spec.input_bundle_refs)
    ) {
      throw adapterError("validation_failed")
    }
    validateEffectRequest(op, { operation: "create_inert", spec, allocation_key_sha256: allocationKey })
    if (
      !isDigest(allocationKey) ||
      spec.workspace_root !== "/workspace" ||
      spec.schema_version !== "sandboxes.runtime/v1" ||
      spec.runtime_class !== "strong_vm" ||
      spec.run_id !== op.fence.run_id ||
      spec.attempt_id !== op.fence.attempt_id ||
      spec.source.repository_ref.length === 0 ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(spec.source.commit_sha) ||
      !isDigest(spec.source.source_bundle_sha256) ||
      !isDigest(spec.environment.image_or_snapshot_sha256) ||
      !isDigest(spec.environment.toolchain_manifest_sha256) ||
      !isDigest(spec.network_policy.policy_sha256) ||
      spec.exec_concurrency !== 1 ||
      !Number.isSafeInteger(spec.max_runtime_ms) ||
      spec.max_runtime_ms <= 0 ||
      Number.isNaN(Date.parse(spec.expires_at)) ||
      Object.values(spec.resources).some((value) => !Number.isSafeInteger(value) || value <= 0) ||
      spec.input_bundle_refs.some(
        (item) => !isDigest(item.sha256) || !Number.isSafeInteger(item.size_bytes) || item.size_bytes < 0,
      )
    ) {
      throw adapterError("validation_failed")
    }
    const specSha256 = canonicalSha256(spec)
    const expectedCreationToken = providerCreationTokenSha256({
      resource_id: op.target.resource_id,
      resource_lease_id: op.fence.resource_lease_id,
      allocation_key_sha256: allocationKey,
      spec_sha256: specSha256,
    })
    if (op.target.provider_creation_token_sha256 !== expectedCreationToken) {
      throw adapterError("operation_target_mismatch")
    }
    const expectedTargetFingerprint = providerTargetFingerprintSha256({
      adapter_id: this.#identity.provider,
      adapter_version: this.#dependencies.adapter_version,
      installation_id: this.#dependencies.installation_id,
      provider_scope_ref: this.#dependencies.provider_scope_ref,
      resource_id: op.target.resource_id,
      resource_lease_id: op.fence.resource_lease_id,
      provider_creation_token_sha256: expectedCreationToken,
      spec_sha256: specSha256,
    })
    if (op.target.immutable_fingerprint_sha256 !== expectedTargetFingerprint) {
      throw adapterError("operation_target_mismatch")
    }
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "creation_metadata_labels")
      requireCapability(client, "create_stopped")
      requireCapability(client, "network_policy_readback")
      let resource = this.#selectExactCreationCandidate(
        await this.#findByCreationToken(client, op.target.provider_creation_token_sha256, ctx, op),
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
            op.target.provider_creation_token_sha256,
          )
          if (
            resource.state !== "inert" ||
            !["paused", "stopped"].includes(resource.provider_runtime_state) ||
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
              op.target.provider_creation_token_sha256,
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
            op.target.provider_creation_token_sha256,
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
      await this.#anchorOutcome(ctx, op, {
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
        spec_sha256: specSha256,
      }
    }))
  }

  async activate(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    authorization: ActivationDispatchAuthorizationV1,
    op: ProviderOperationV1,
  ): Promise<ActivationReceiptV1> {
    ctx = snapshotContext(ctx)
    handle = snapshotData(handle)
    authorization = snapshotData(authorization)
    op = snapshotData(op)
    validateOperation(ctx, op, "activate")
    validateHandle(handle, op, this.#identity, this.#dependencies)
    if (
      !isRecord(authorization) ||
      !isRecord(authorization.network_policy) ||
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
          if (!isRecord(activation)) throw adapterError("integrity_failed")
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
        const outcomeAnchor = await this.#anchorOutcome(ctx, op, {
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
    ctx = snapshotContext(ctx)
    handle = snapshotData(handle)
    op = snapshotData(op)
    validateOperation(ctx, op, "inspect")
    validateEffectRequest(op, { operation: "inspect" })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      const resource = await this.#retryRead(ctx, op, () => client.inspectResource(handle.opaque_resource_id))
      if (resource === "absent") {
        const tokenInventory = await this.#findByCreationToken(
          client,
          handle.provider_creation_token_sha256,
          ctx,
          op,
        )
        if (tokenInventory.length !== 0) {
          throw adapterError("provider_state_unknown", { quarantineRequired: true })
        }
        const providerReceiptSha256 = canonicalSha256({ observation: "absent", target: canonicalSha256(op.target) })
        return {
          observation: "absent",
          immutable_fingerprint_sha256: handle.immutable_fingerprint_sha256,
          provider_receipt_sha256: providerReceiptSha256,
          provider_outcome_anchor_sha256: journalAnchorSha256(ctx.invocation_anchor),
        }
      }
      validateProviderResourceForHandle(resource, handle, op.target, this.#dependencies)
      const providerReceiptSha256 = safeProviderReceipt(resource, op)
      return {
        observation: resource.state,
        immutable_fingerprint_sha256: resource.immutable_fingerprint_sha256,
        network_policy: resource.network_policy,
        provider_receipt_sha256: providerReceiptSha256,
        provider_outcome_anchor_sha256: journalAnchorSha256(ctx.invocation_anchor),
      }
    }))
  }

  async start_exec(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    spec: ExecSpecV1,
    op: ProviderOperationV1,
  ): Promise<AdapterExecHandleV1> {
    ctx = snapshotContext(ctx)
    handle = snapshotData(handle)
    spec = snapshotData(spec)
    op = snapshotData(op)
    validateOperation(ctx, op, "exec_start")
    validateExecSpec(spec, op.deadline)
    validateEffectRequest(op, { operation: "exec_start", spec })
    validateHandle(handle, op, this.#identity, this.#dependencies)
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
          this.#dependencies.guest_broker_authenticator,
        )
        await this.#beforeProviderMutation(ctx, op)
        providerExec = await client.startExec(handle.opaque_resource_id, broker, frame, op.target)
        if (
          !isRecord(providerExec) ||
          typeof providerExec.opaque_exec_id !== "string" ||
          providerExec.opaque_exec_id.length === 0 ||
          typeof providerExec.started_at !== "string" ||
          Number.isNaN(Date.parse(providerExec.started_at))
        ) {
          throw adapterError("integrity_failed")
        }
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }
      const receipt = canonicalSha256({
        opaque_exec_id_sha256: canonicalSha256(providerExec.opaque_exec_id),
        started_at: providerExec.started_at,
      })
      const outcomeAnchor = await this.#anchorOutcome(ctx, op, {
        observation: "accepted",
        provider_receipt_sha256: receipt,
      })
      const immutableExecFingerprintSha256 = canonicalSha256({
        schema_version: "sandboxes.adapter-exec-handle/v1",
        adapter_id: this.#identity.provider,
        resource_id: handle.resource_id,
        resource_lifecycle_generation: handle.resource_lifecycle_generation,
        start_operation_id: op.target.operation_id,
        start_request_sha256: op.request_sha256,
        opaque_exec_id: providerExec.opaque_exec_id,
        started_at: providerExec.started_at,
      })
      return {
        ...providerExec,
        immutable_exec_fingerprint_sha256: immutableExecFingerprintSha256,
        adapter_id: this.#identity.provider,
        resource_id: handle.resource_id,
        resource_lifecycle_generation: handle.resource_lifecycle_generation,
        start_operation_id: op.target.operation_id,
        start_request_sha256: op.request_sha256,
        provider_outcome_anchor_sha256: outcomeAnchor,
      }
    }))
  }

  async cancel_exec(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    exec: AdapterExecHandleV1,
    op: ProviderOperationV1,
  ): Promise<CancelObservationV1> {
    ctx = snapshotContext(ctx)
    handle = snapshotData(handle)
    exec = snapshotData(exec)
    op = snapshotData(op)
    validateOperation(ctx, op, "exec_cancel")
    validateHandle(handle, op, this.#identity, this.#dependencies)
    validateExecHandle(exec, handle, this.#identity)
    validateEffectRequest(op, {
      operation: "exec_cancel",
      exec_fingerprint_sha256: exec.immutable_exec_fingerprint_sha256,
    })
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
          this.#dependencies.guest_broker_authenticator,
        )
        await this.#beforeProviderMutation(ctx, op)
        cancellation = await client.cancelExec(handle.opaque_resource_id, broker, frame, op.target)
        if (!isRecord(cancellation) || cancellation.whole_guest_scope_terminated !== true) {
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
      const outcomeAnchor = await this.#anchorOutcome(ctx, op, {
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
    ctx = snapshotContext(ctx)
    handle = snapshotData(handle)
    op = snapshotData(op)
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
        this.#dependencies.guest_broker_authenticator,
      )
      const stat = await this.#retryRead(ctx, op, () => client.statFile(handle.opaque_resource_id, broker, frame))
      if (
        !isRecord(stat) ||
        stat.path !== checkedPath ||
        !["file", "directory", "symlink"].includes(stat.type) ||
        !Number.isSafeInteger(stat.size_bytes) ||
        stat.size_bytes < 0 ||
        stat.revision < 1n ||
        !Number.isSafeInteger(stat.mode) ||
        stat.mode < 0 ||
        stat.mode > 0o7777 ||
        (stat.sha256 !== undefined && !isDigest(stat.sha256)) ||
        (stat.symlink_target !== undefined && validateWorkspacePath(stat.symlink_target) !== stat.symlink_target) ||
        (stat.mode & 0o6000) !== 0
      ) {
        throw adapterError("integrity_failed")
      }
      return stat
    }))
  }

  read_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileReadV1,
    op: ProviderOperationV1,
  ): AsyncIterable<ByteChunkV1> {
    return this.#readFile(
      snapshotContext(ctx),
      snapshotData(handle),
      snapshotData(request),
      snapshotData(op),
    )
  }

  async *#readFile(
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
      const frame = encodeGuestBrokerRequestFrame(
        { operation: "file_read", request },
        op,
        broker,
        this.#dependencies.guest_broker_authenticator,
      )
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
        if (!isRecord(providerChunk)) throw adapterError("integrity_failed")
        const bytes = providerChunk.bytes
        total += bytes.byteLength
        if (
          !(bytes instanceof Uint8Array) ||
          bytes.byteLength === 0 ||
          bytes.byteLength > MAX_FILE_READ_BYTES ||
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
    ctx = snapshotContext(ctx)
    handle = snapshotData(handle)
    request = snapshotData(request)
    op = snapshotData(op)
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
          this.#dependencies.guest_broker_authenticator,
        )
        await this.#beforeProviderMutation(ctx, op)
        receipt = await client.writeFileAtomic(handle.opaque_resource_id, broker, frame, op.target)
      } catch (cause) {
        return this.#anchorUnknown(ctx, op, cause)
      }
      if (
        !isRecord(receipt) ||
        receipt.path !== request.path ||
        receipt.size_bytes !== request.bytes.byteLength ||
        receipt.sha256 !== canonicalSha256(request.bytes) ||
        receipt.revision < 1n
      ) {
        return this.#anchorUnknown(ctx, op, adapterError("integrity_failed"))
      }
      const providerReceiptSha256 = canonicalSha256(receipt)
      const outcomeAnchor = await this.#anchorOutcome(ctx, op, {
        observation: "completed",
        provider_receipt_sha256: providerReceiptSha256,
        file_receipt_sha256: providerReceiptSha256,
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
    ctx = snapshotContext(ctx)
    handle = snapshotData(handle)
    request = snapshotData(request)
    op = snapshotData(op)
    if (!isRecord(request)) throw adapterError("validation_failed")
    const checkedPath = validateWorkspacePath(request.path, true)
    if (
      !Number.isSafeInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 1000 ||
      (request.cursor !== undefined &&
        (typeof request.cursor !== "string" ||
          request.cursor.length === 0 ||
          request.cursor.length > 4096 ||
          /[\0-\x1f\x7f]/u.test(request.cursor)))
    ) {
      throw adapterError("validation_failed")
    }
    validateOperation(ctx, op, "file_list")
    validateEffectRequest(op, { operation: "file_list", request: { ...request, path: checkedPath } })
    validateHandle(handle, op, this.#identity, this.#dependencies)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "native_bounded_files")
      await this.#inspectExactHandle(client, ctx, op, handle)
      const broker = await this.#inspectGuestBroker(client, ctx, op, handle)
      const brokerRequest = { ...request, path: checkedPath }
      const frame = encodeGuestBrokerRequestFrame(
        { operation: "file_list", request: brokerRequest },
        op,
        broker,
        this.#dependencies.guest_broker_authenticator,
      )
      const page = await this.#retryRead(ctx, op, () => client.listFiles(handle.opaque_resource_id, broker, frame))
      if (
        !isRecord(page) ||
        !Array.isArray(page.items) ||
        page.items.length > request.limit ||
        (page.next_cursor !== undefined &&
          (typeof page.next_cursor !== "string" ||
            page.next_cursor.length === 0 ||
            page.next_cursor.length > 4096 ||
            /[\0-\x1f\x7f]/u.test(page.next_cursor)))
      ) {
        throw adapterError("integrity_failed")
      }
      for (const item of page.items) {
        if (!isRecord(item) || typeof item.path !== "string") throw adapterError("integrity_failed")
        validateWorkspacePath(item.path)
        if (!["file", "directory", "symlink"].includes(item.type)) {
          throw adapterError("integrity_failed")
        }
      }
      const paths = page.items.map((item) => item.path)
      const portablePaths = paths.map((path) => path.normalize("NFKC").toLowerCase())
      const prefix = checkedPath === "" ? "" : `${checkedPath}/`
      if (
        !safeEqual(paths, [...paths].sort()) ||
        new Set(paths).size !== paths.length ||
        new Set(portablePaths).size !== portablePaths.length ||
        paths.some((path) => checkedPath !== "" && path !== checkedPath && !path.startsWith(prefix)) ||
        (page.next_cursor !== undefined && page.next_cursor === request.cursor)
      ) {
        throw adapterError("integrity_failed")
      }
      return page
    }))
  }

  async #safetyStop(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
    expected: "expire" | "quarantine",
  ): Promise<ExpireObservationV1> {
    ctx = snapshotContext(ctx)
    handle = snapshotData(handle)
    op = snapshotData(op)
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
      const outcomeAnchor = await this.#anchorOutcome(ctx, op, {
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
    ctx = snapshotContext(ctx)
    handle = snapshotData(handle)
    op = snapshotData(op)
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
      requireCapability(client, "conditional_destroy")
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
      const outcomeAnchor = await this.#anchorOutcome(ctx, op, {
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
    ctx = snapshotContext(ctx)
    target = snapshotData(target)
    if (handle !== undefined) handle = snapshotData(handle)
    if (!safeEqual(ctx.target, target)) {
      throw adapterError("operation_target_mismatch")
    }
    this.#validateReconcileContext(ctx)
    const op = this.#reconcileOperation(ctx)
    validateAdapterCallContext(ctx, op)
    if (handle !== undefined) {
      validateHandle(handle, op, this.#identity, this.#dependencies)
    }
    if (handle !== undefined && handle.immutable_fingerprint_sha256 !== target.immutable_fingerprint_sha256) {
      throw adapterError("operation_target_mismatch")
    }
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      const observation = await this.#retryRead(ctx, op, () => client.lookupOperation(target))
      if (!["not_sent", "accepted", "completed", "not_found", "unknown"].includes(observation)) {
        throw adapterError("integrity_failed")
      }
      return {
        observation,
        target_sha256: canonicalSha256(target),
        provider_idempotency_token_sha256: target.provider_idempotency_token_sha256,
        immutable_fingerprint_sha256: target.immutable_fingerprint_sha256,
        provider_outcome_anchor_sha256: journalAnchorSha256(ctx.invocation_anchor),
      }
    }))
  }

  async list_owned_resources(ctx: ReconcileContextV1, cursor?: string): Promise<OwnedResourcePageV1> {
    ctx = snapshotContext(ctx)
    this.#validateReconcileContext(ctx)
    if (
      cursor !== undefined &&
      (cursor.length === 0 || cursor.length > 4096 || /[\0-\x1f\x7f]/u.test(cursor))
    ) {
      throw adapterError("validation_failed")
    }
    const op = this.#reconcileOperation(ctx)
    validateAdapterCallContext(ctx, op)
    return this.#withClient(ctx, op, (client) => this.#withLifecycleLock(op, async () => {
      requireCapability(client, "ownership_inventory")
      const page = await this.#retryRead(ctx, op, () => client.listOwnedResources(cursor))
      validateProviderPage(page)
      if (
        page.items.length > 1000 ||
        (page.next_cursor !== undefined && page.next_cursor === cursor)
      ) {
        throw adapterError("integrity_failed")
      }
      for (const resource of page.items) {
        if (
          resource.opaque_resource_id.length === 0 ||
          !isDigest(resource.immutable_fingerprint_sha256) ||
          !isDigest(resource.provider_creation_token_sha256)
        ) {
          throw adapterError("integrity_failed")
        }
      }
      const items = page.items.map((resource) => ({
        provider_resource_sha256: canonicalSha256(resource.opaque_resource_id),
        immutable_fingerprint_sha256: resource.immutable_fingerprint_sha256,
        state: resource.state,
      }))
      return { items, ...(page.next_cursor === undefined ? {} : { next_cursor: page.next_cursor }) }
    }))
  }

  #reconcileOperation(ctx: ReconcileContextV1): ProviderOperationV1 {
    return {
      operation: ctx.invocation_anchor.record.semantic_step,
      target: ctx.target,
      fence: ctx.fence,
      ...(ctx.generation_transition === undefined
        ? {}
        : { generation_transition: ctx.generation_transition }),
      request_sha256: ctx.request_sha256,
      idempotency_key_sha256: ctx.invocation_anchor.record.idempotency_key_sha256,
      external_anchor_kind: "READ_PROBE",
      external_anchor_receipt_sha256: journalAnchorSha256(ctx.invocation_anchor),
      deadline: ctx.deadline,
    }
  }

  #validateReconcileContext(ctx: ReconcileContextV1): void {
    if (
      !isDigest(ctx.continuation_grant_sha256) ||
      !isDigest(ctx.authorization_consumption_receipt_sha256) ||
      ctx.authorization_binding_sha256 !==
        reconciliationAuthorizationBinding(
          ctx.target,
          ctx.fence,
          ctx.continuation_grant_sha256,
          ctx.authorization_consumption_receipt_sha256,
        )
    ) {
      throw adapterError("dispatch_anchor_mismatch")
    }
  }
}
