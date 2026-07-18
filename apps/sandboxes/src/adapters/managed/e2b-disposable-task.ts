import { createHash, randomBytes } from "node:crypto"
import { canonicalJson, canonicalSha256, isDigest } from "./canonical"
import {
  E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
  E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
  e2bGuestBrokerCheckpointHashesV1,
  exchangeE2bGuestBrokerRequestV1,
  loadE2bGuestBrokerArtifactV1,
  type E2bGuestBrokerRequestInputV1,
  type E2bGuestBrokerResponseFrameV1,
  type E2bGuestBrokerAuthenticatedLineExchangePortV1,
} from "./e2b-guest-broker"
import {
  E2bWorkspaceBootstrapBoundaryErrorV1,
  DaytonaMailboxBoundaryErrorV1,
  installExactDaytonaGuestBrokerArtifactV1,
  installExactE2bGuestBrokerArtifactV1,
  type E2bGuestBrokerArtifactAttestationV1,
  type E2bGuestBrokerArtifactControlPortV1,
  type E2bSandboxDestroyAndProveAbsentPortV1,
  type E2bWorkspaceBootstrapPhaseV1,
  type DaytonaMailboxBoundaryPhaseV1,
} from "./e2b-broker-artifact-control"
import {
  withAuthenticatedE2bGuestBrokerDuplexSdkSession,
  type E2bGuestBrokerDuplexLimitsV1,
  type E2bOfficialBrokerCommandsV1,
} from "./sdk-broker-bridges"
import { E2bOfficialSdkControlBridgeV1 } from "./sdk-control-bridges"
import { validateWorkspacePath } from "./adapter"
import { AdapterContractError, adapterError } from "./errors"
import {
  DISPOSABLE_SANDBOX_TASK_EXECUTION_RECEIPT_SCHEMA_V1,
  disposableSandboxTaskExecutionReceiptSha256,
  disposableSandboxTaskRequestSha256,
  disposableTaskAbsenceEvidenceSha256,
  disposableTaskInputManifestSha256,
  consumeDisposableSandboxTaskExecutionContextV2,
  parseDisposableSandboxTaskRequestV1,
  type CheckpointHandoffPortV1,
  type CheckpointHandoffReceiptV1,
  type DisposableSandboxTaskExecutionContextV1,
  type DisposableSandboxTaskExecutionReceiptCoreV1,
  type DisposableSandboxTaskExecutionReceiptV1,
  type DisposableSandboxTaskRequestV1,
  type DisposableSandboxTaskRunnerV1,
} from "./disposable-task"
import type {
  AdapterProviderResourceV1,
  AdapterSandboxSpecV1,
  Digest,
  ManagedProviderIdV1,
  NetworkPolicyV1,
  ProviderCreateInertRequestV1,
  ProviderEffectTargetV1,
} from "./types"

const REQUEST_TIMEOUT_MS = 20_000
const SESSION_LIMITS: E2bGuestBrokerDuplexLimitsV1 = Object.freeze({
  request_timeout_ms: REQUEST_TIMEOUT_MS,
  session_timeout_ms: 90_000,
  receive_timeout_ms: REQUEST_TIMEOUT_MS,
  max_request_frame_bytes: 1024 * 1024,
  max_response_frame_bytes: 1024 * 1024,
  max_response_frames: 64,
  max_response_bytes: 1024 * 1024,
})

export type ManagedDisposableTaskFailurePhaseV1 =
  | "create_inert"
  | "mark_dispatched"
  | "activate"
  | "resource_access"
  | "cleanup"
  | E2bWorkspaceBootstrapPhaseV1
  | DaytonaMailboxBoundaryPhaseV1

/** Bounded failure evidence. It never retains the provider error object or text. */
export class ManagedDisposableTaskBoundaryErrorV1 extends AdapterContractError {
  constructor(
    readonly phase: ManagedDisposableTaskFailurePhaseV1,
    readonly safe_cause_code: AdapterContractError["code"],
  ) {
    super("provider_state_unknown", { quarantineRequired: true })
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      phase: this.phase,
      safe_cause_code: this.safe_cause_code,
    }
  }
}

function disposableTaskBoundaryError(
  phase: ManagedDisposableTaskFailurePhaseV1,
  failure?: unknown,
): ManagedDisposableTaskBoundaryErrorV1 {
  if (failure instanceof E2bWorkspaceBootstrapBoundaryErrorV1 ||
    failure instanceof DaytonaMailboxBoundaryErrorV1) {
    return new ManagedDisposableTaskBoundaryErrorV1(failure.phase, failure.code)
  }
  return new ManagedDisposableTaskBoundaryErrorV1(
    phase,
    failure instanceof AdapterContractError ? failure.code : "provider_state_unknown",
  )
}

export interface E2bDisposableResourceSurfaceV1 {
  files: E2bGuestBrokerArtifactControlPortV1["files"]
  commands: E2bGuestBrokerArtifactControlPortV1["commands"] & E2bOfficialBrokerCommandsV1
}

/** Credential-bound exact resource access; credentials never enter request/receipt/env/guest. */
export interface E2bDisposableResourceAccessPortV1 {
  withResource<T>(opaqueResourceId: string, use: (surface: E2bDisposableResourceSurfaceV1) => Promise<T>): Promise<T>
}

type E2bDisposableControlReadPortV1 = Pick<
  E2bOfficialSdkControlBridgeV1,
  "createInert" | "findByCreationToken" | "inspectResource"
>

export interface E2bDisposableControlPortV1 extends E2bDisposableControlReadPortV1 {
  activateResource(
    opaqueResourceId: string,
    target: ProviderEffectTargetV1,
    expectedOwnershipNonceSha256: Digest,
  ): Promise<AdapterProviderResourceV1>
  destroyResource(
    opaqueResourceId: string,
    expectedVersion: string,
    target: ProviderEffectTargetV1,
    expectedOwnershipNonceSha256: Digest,
  ): Promise<void>
}

export interface E2bDisposableBrokerPortV1 {
  loadArtifact(): Promise<Uint8Array>
  install(
    control: E2bGuestBrokerArtifactControlPortV1,
    artifact: Uint8Array,
    requestTimeoutMs: number,
  ): Promise<E2bGuestBrokerArtifactAttestationV1>
  withSession(
    commands: E2bOfficialBrokerCommandsV1,
    destruction: E2bSandboxDestroyAndProveAbsentPortV1,
    attestation: E2bGuestBrokerArtifactAttestationV1,
    sessionBindingSha256: Digest,
    macKey: Uint8Array,
    use: (session: E2bGuestBrokerAuthenticatedLineExchangePortV1, startup: E2bGuestBrokerResponseFrameV1) => Promise<void>,
  ): Promise<void>
  exchange(
    session: E2bGuestBrokerAuthenticatedLineExchangePortV1,
    input: E2bGuestBrokerRequestInputV1,
    macKey: Uint8Array,
  ): Promise<E2bGuestBrokerResponseFrameV1>
}

export interface ManagedDisposableRunnerConfigV1 {
  provider: ManagedProviderIdV1
  control: E2bDisposableControlPortV1
  resource_access: E2bDisposableResourceAccessPortV1
  checkpoint_handoff: CheckpointHandoffPortV1
  template_mapping_attested: true
  installation_id: string
  provider_scope_ref: string
  implementation_sha256: Digest
  architecture: "arm64" | "amd64"
  resources: Readonly<{
    cpu_millis: number
    memory_bytes: number
    disk_bytes: number
    pids: number
    open_files: number
    output_bytes: number
  }>
}

export interface ManagedDisposableRunnerTestConfigV1 extends ManagedDisposableRunnerConfigV1 {
  broker: E2bDisposableBrokerPortV1
  random_bytes: (length: number) => Uint8Array
}

function directDigest(bytes: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function safeId(value: string): string {
  return `disposable-${value.slice(7, 31)}`
}

function providerOwnershipBinding(
  provider: ManagedProviderIdV1,
  context: DisposableSandboxTaskExecutionContextV1,
): string {
  return canonicalJson({
    schema_version: `sandboxes.${provider}-disposable-provider-ownership/v1`,
    effect_claim_sha256: context.effect_claim_sha256,
    dispatch_intent_anchor_sha256: context.dispatch_intent_anchor_sha256,
    authorization_consumption_receipt_sha256: context.authorization_consumption_receipt_sha256,
    provider_effect_lease_epoch: context.journal_lease_epoch,
    provider_effect_ownership_nonce_sha256: context.ownership_nonce_sha256,
  })
}

function providerOwnershipBindingSha256(
  provider: ManagedProviderIdV1,
  context: DisposableSandboxTaskExecutionContextV1,
): Digest {
  return canonicalSha256(providerOwnershipBinding(provider, context))
}

function exactDataRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every((key) => typeof key === "string" && keys.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
    "value" in (Object.getOwnPropertyDescriptor(value, key) ?? {}))
}

function outputPathAllowed(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => prefix === "." || path === prefix || path.startsWith(`${prefix}/`))
}

function verifyCheckpointPostState(
  value: Record<string, unknown>,
  request: DisposableSandboxTaskRequestV1,
  expectedProcessQuiescenceSha256: unknown,
): Readonly<{
  files: Array<{ path: string; size: number; sha256: Digest; content_base64: string }>
  manifest: Array<{ path: string; size: number; mode: number; sha256: Digest }>
  checkpoint_sha256: Digest
  manifest_sha256: Digest
  output_manifest_sha256: Digest
  output_diff_sha256: Digest
  output_diff: Array<{
    kind: "added" | "modified" | "deleted"
    path: string
    before_sha256: Digest | null
    after_sha256: Digest | null
    before_mode: number | null
    after_mode: number | null
  }>
  file_count: number
  total_bytes: number
}> {
  if (!exactDataRecord(value, [
    "checkpoint_sha256", "file_count", "files", "manifest", "manifest_sha256",
    "process_baseline_sha256", "process_quiescence_sha256", "provider_snapshot_is_canonical",
    "total_bytes", "unexpected_process_count",
  ]) || !isDigest(value.checkpoint_sha256) || !isDigest(value.manifest_sha256) ||
    !isDigest(value.process_baseline_sha256) || !isDigest(value.process_quiescence_sha256) ||
    !isDigest(expectedProcessQuiescenceSha256) ||
    value.process_baseline_sha256 !== expectedProcessQuiescenceSha256 ||
    value.process_quiescence_sha256 !== expectedProcessQuiescenceSha256 ||
    value.unexpected_process_count !== 0 ||
    value.provider_snapshot_is_canonical !== false || !Number.isSafeInteger(value.file_count) ||
    !Number.isSafeInteger(value.total_bytes) || !Array.isArray(value.files) || !Array.isArray(value.manifest) ||
    (value.file_count as number) < 0 || (value.file_count as number) > request.checkpoint.max_files ||
    value.files.length !== value.file_count || value.manifest.length !== value.file_count ||
    (value.total_bytes as number) < 0 || (value.total_bytes as number) > request.checkpoint.max_total_bytes) {
    throw adapterError("integrity_failed")
  }
  const files: Array<{ path: string; size: number; sha256: Digest; content_base64: string }> = []
  const manifest: Array<{ path: string; size: number; mode: number; sha256: Digest }> = []
  let total = 0
  let priorPath: string | undefined
  const initial = new Map(request.files.map((file) => [file.path, file]))
  const changes: Array<{
    kind: "added" | "modified" | "deleted"
    path: string
    before_sha256: Digest | null
    after_sha256: Digest | null
    before_mode: number | null
    after_mode: number | null
  }> = []
  for (let index = 0; index < value.files.length; index += 1) {
    const file = value.files[index]
    const entry = value.manifest[index]
    if (!exactDataRecord(file, ["content_base64", "path", "sha256", "size"]) ||
      !exactDataRecord(entry, ["mode", "path", "sha256", "size"]) || typeof file.path !== "string" ||
      typeof file.content_base64 !== "string" || !isDigest(file.sha256) || !Number.isSafeInteger(file.size) ||
      (file.size as number) < 0 || (file.size as number) > request.checkpoint.max_file_bytes ||
      entry.path !== file.path || entry.sha256 !== file.sha256 || entry.size !== file.size ||
      ![0o600, 0o644, 0o700, 0o755].includes(entry.mode as number)) throw adapterError("integrity_failed")
    validateWorkspacePath(file.path)
    if (!outputPathAllowed(file.path, request.checkpoint.allowed_path_prefixes) ||
      (priorPath !== undefined && Buffer.compare(Buffer.from(priorPath), Buffer.from(file.path)) >= 0)) {
      throw adapterError("integrity_failed")
    }
    priorPath = file.path
    // Match the guest walk's semantics: a root file has directory depth 0,
    // and each slash adds one directory level.
    if (file.path.split("/").length - 1 > request.checkpoint.max_depth) {
      throw adapterError("integrity_failed")
    }
    const content = Buffer.from(file.content_base64, "base64")
    if (content.byteLength !== file.size || content.toString("base64") !== file.content_base64 || directDigest(content) !== file.sha256) {
      throw adapterError("integrity_failed")
    }
    for (const marker of request.checkpoint.forbidden_content_markers_base64) {
      if (content.includes(Buffer.from(marker, "base64"))) throw adapterError("integrity_failed")
    }
    total += content.byteLength
    const before = initial.get(file.path)
    if (before === undefined) changes.push({
      kind: "added", path: file.path,
      before_sha256: null, after_sha256: file.sha256,
      before_mode: null, after_mode: entry.mode as number,
    })
    else {
      initial.delete(file.path)
      if (before.content_sha256 !== file.sha256 || before.mode !== entry.mode) {
        changes.push({
          kind: "modified", path: file.path,
          before_sha256: before.content_sha256, after_sha256: file.sha256,
          before_mode: before.mode, after_mode: entry.mode as number,
        })
      }
    }
    files.push({ path: file.path, size: file.size as number, sha256: file.sha256, content_base64: file.content_base64 })
    manifest.push({ path: file.path, size: file.size as number, mode: entry.mode as number, sha256: file.sha256 })
  }
  for (const file of initial.values()) {
    changes.push({
      kind: "deleted", path: file.path,
      before_sha256: file.content_sha256, after_sha256: null,
      before_mode: file.mode, after_mode: null,
    })
  }
  changes.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
  if (total !== value.total_bytes || changes.length > request.checkpoint.max_changed_files ||
    (!request.checkpoint.allow_file_addition && changes.some((item) => item.kind === "added")) ||
    (!request.checkpoint.allow_file_modification && changes.some((item) => item.kind === "modified")) ||
    (!request.checkpoint.allow_file_deletion && changes.some((item) => item.kind === "deleted"))) {
    throw adapterError("integrity_failed")
  }
  const fileBasis = files.map(({ path, sha256, size }) => ({ path, sha256, size }))
  const brokerHashes = e2bGuestBrokerCheckpointHashesV1(manifest, fileBasis)
  if (brokerHashes.manifest_sha256 !== value.manifest_sha256 ||
    brokerHashes.checkpoint_sha256 !== value.checkpoint_sha256) {
    throw adapterError("integrity_failed")
  }
  return Object.freeze({
    files, manifest,
    checkpoint_sha256: value.checkpoint_sha256,
    manifest_sha256: value.manifest_sha256,
    output_manifest_sha256: canonicalSha256({ schema_version: "sandboxes.disposable-task-output-manifest/v1", files: manifest }),
    output_diff_sha256: canonicalSha256({ schema_version: "sandboxes.disposable-task-output-diff/v1", changes }),
    output_diff: changes,
    file_count: value.file_count as number,
    total_bytes: value.total_bytes as number,
  })
}

function target(
  request: DisposableSandboxTaskRequestV1,
  context: DisposableSandboxTaskExecutionContextV1,
  step: string,
): ProviderEffectTargetV1 {
  return Object.freeze({
    operation_id: `${safeId(request.operation_digest)}-${step}`,
    operation_digest: request.operation_digest,
    operation_step_id: `${safeId(request.operation_digest)}-${step}`,
    resource_id: safeId(context.immutable_fingerprint_sha256),
    resource_lifecycle_generation: 1n,
    provider_idempotency_token_sha256: canonicalSha256({
      request_sha256: disposableSandboxTaskRequestSha256(request), step,
    }),
    provider_creation_token_sha256: context.provider_creation_token_sha256,
    immutable_fingerprint_sha256: context.immutable_fingerprint_sha256,
    authorization_consumption_receipt_sha256: context.authorization_consumption_receipt_sha256,
  })
}

function createRequest(
  request: DisposableSandboxTaskRequestV1,
  context: DisposableSandboxTaskExecutionContextV1,
  config: ManagedDisposableRunnerConfigV1,
): ProviderCreateInertRequestV1 {
  const operationTarget = target(request, context, "create")
  const initialNetworkPolicy: NetworkPolicyV1 = {
    mode: "deny_all",
    policy_sha256: canonicalSha256({ mode: "deny_all", authority: request.authority_envelope_sha256 }),
  }
  const spec: AdapterSandboxSpecV1 = {
    schema_version: "sandboxes.runtime/v1",
    run_id: safeId(request.authority_envelope_sha256),
    attempt_id: safeId(request.idempotency_key_sha256),
    source: {
      repository_ref: request.source_manifest_sha256,
      commit_sha: request.source_manifest_sha256.slice(7, 47),
      source_bundle_sha256: request.task_bundle_sha256,
    },
    environment: {
      image_or_snapshot_sha256: request.environment_image_sha256,
      toolchain_manifest_sha256: request.source_manifest_sha256,
    },
    runtime_class: "strong_vm",
    architecture: config.architecture,
    workspace_root: "/workspace",
    network_policy: {
      mode: "deny_all",
      policy_sha256: canonicalSha256({ mode: "deny_all", authority: request.authority_envelope_sha256 }),
    },
    resources: { ...config.resources },
    exec_concurrency: 1,
    max_runtime_ms: request.max_runtime_ms,
    expires_at: context.journal_lease_expires_at,
    data_class: "internal_non_sensitive",
    input_bundle_refs: request.files.map((file) => ({
      sha256: file.content_sha256,
      size_bytes: Buffer.from(file.content_base64, "base64").byteLength,
    })),
  }
  return Object.freeze({
    target: operationTarget,
    spec,
    allocation_key_sha256: request.idempotency_key_sha256,
    ownership: {
      installation_id: config.installation_id,
      provider_scope_ref: config.provider_scope_ref,
      ownership_nonce: providerOwnershipBinding(config.provider, context),
    },
    initial_network_policy: initialNetworkPolicy,
  })
}

class Destruction implements E2bSandboxDestroyAndProveAbsentPortV1 {
  #promise: Promise<void> | undefined
  #known: AdapterProviderResourceV1 | undefined
  runs = 0
  getAbsent = false
  listAbsent = false
  providerFingerprint: Digest | undefined
  conflictingScopedMatches = 0

  constructor(
    private readonly control: E2bDisposableControlPortV1,
    private readonly operationTarget: ProviderEffectTargetV1,
    private readonly creationToken: Digest,
    private readonly expectedOwnershipNonceSha256: Digest,
    private readonly expectedProviderFingerprintSha256?: Digest,
  ) {}

  #fingerprint(resource: AdapterProviderResourceV1): Digest {
    return canonicalSha256({
      opaque_resource_id: resource.opaque_resource_id,
      immutable_fingerprint_sha256: resource.immutable_fingerprint_sha256,
      provider_created_at: resource.provider_created_at,
    })
  }

  #isExact(resource: AdapterProviderResourceV1): boolean {
    const fingerprint = this.#fingerprint(resource)
    return resource.owned &&
      resource.provider_creation_token_sha256 === this.creationToken &&
      resource.immutable_fingerprint_sha256 === this.operationTarget.immutable_fingerprint_sha256 &&
      resource.ownership.ownership_nonce_sha256 === this.expectedOwnershipNonceSha256 &&
      (this.expectedProviderFingerprintSha256 === undefined || fingerprint === this.expectedProviderFingerprintSha256)
  }

  setKnown(resource: AdapterProviderResourceV1): void {
    if (!this.#isExact(resource)) throw adapterError("provider_state_unknown", { quarantineRequired: true })
    this.#known = resource
    this.providerFingerprint = this.#fingerprint(resource)
  }

  destroyAndProveAbsent(): Promise<void> {
    this.#promise ??= this.#execute()
    return this.#promise
  }

  async #execute(): Promise<void> {
    this.runs += 1
    const resources = new Map<string, AdapterProviderResourceV1>()
    if (this.#known !== undefined) resources.set(this.#known.opaque_resource_id, this.#known)
    let cursor: string | undefined
    for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
      const page = await this.control.findByCreationToken(this.creationToken, cursor)
      for (const item of page.items) {
        if (this.#isExact(item)) resources.set(item.opaque_resource_id, item)
        else this.conflictingScopedMatches += 1
      }
      cursor = page.next_cursor
      if (cursor === undefined) break
      if (pageNumber === 3) throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
    const multiple = resources.size > 1
    for (const resource of resources.values()) {
      await this.control.destroyResource(
        resource.opaque_resource_id,
        resource.provider_resource_version,
        this.operationTarget,
        this.expectedOwnershipNonceSha256,
      )
    }
    this.getAbsent = true
    for (const resource of resources.values()) {
      if (await this.control.inspectResource(resource.opaque_resource_id) !== "absent") this.getAbsent = false
    }
    const after = await this.control.findByCreationToken(this.creationToken)
    const exactAfter = after.items.filter((resource) => this.#isExact(resource))
    const conflictsAfter = after.items.filter((resource) => !this.#isExact(resource))
    this.conflictingScopedMatches += conflictsAfter.length
    this.listAbsent = exactAfter.length === 0 && after.next_cursor === undefined
    if (!this.getAbsent || !this.listAbsent || multiple || this.conflictingScopedMatches !== 0) {
      throw adapterError("provider_state_unknown", { quarantineRequired: true })
    }
  }
}

const productionBroker: E2bDisposableBrokerPortV1 = Object.freeze({
  loadArtifact: loadE2bGuestBrokerArtifactV1,
  install: installExactE2bGuestBrokerArtifactV1,
  withSession(
    commands: E2bOfficialBrokerCommandsV1,
    destruction: E2bSandboxDestroyAndProveAbsentPortV1,
    attestation: E2bGuestBrokerArtifactAttestationV1,
    sessionBindingSha256: Digest,
    macKey: Uint8Array,
    use: (session: E2bGuestBrokerAuthenticatedLineExchangePortV1, startup: E2bGuestBrokerResponseFrameV1) => Promise<void>,
  ) {
    return withAuthenticatedE2bGuestBrokerDuplexSdkSession(
      commands,
      destruction,
      attestation,
      SESSION_LIMITS,
      sessionBindingSha256,
      macKey,
      use,
    )
  },
  exchange: exchangeE2bGuestBrokerRequestV1,
})

const daytonaProductionBroker: E2bDisposableBrokerPortV1 = Object.freeze({
  ...productionBroker,
  install(
    control: E2bGuestBrokerArtifactControlPortV1,
    artifact: Uint8Array,
    requestTimeoutMs: number,
  ) {
    return installExactDaytonaGuestBrokerArtifactV1(control, artifact, requestTimeoutMs)
  },
})

class E2bDisposableTaskRunner implements DisposableSandboxTaskRunnerV1 {
  readonly provider: ManagedProviderIdV1
  constructor(
    private readonly config: ManagedDisposableRunnerConfigV1,
    private readonly broker: E2bDisposableBrokerPortV1,
    private readonly random: (length: number) => Uint8Array,
  ) {
    this.provider = config.provider
  }

  describe() {
    const handoff = this.config.checkpoint_handoff.describe()
    return Object.freeze({
      provider: this.provider,
      implementation_sha256: this.config.implementation_sha256,
      checkpoint_handoff_durability: handoff.durability,
      checkpoint_readback_verified: handoff.readback_verified,
    })
  }

  async run(
    requestValue: Readonly<DisposableSandboxTaskRequestV1>,
    context: Readonly<DisposableSandboxTaskExecutionContextV1>,
  ): Promise<DisposableSandboxTaskExecutionReceiptV1> {
    const request = parseDisposableSandboxTaskRequestV1(requestValue)
    const requestSha256 = disposableSandboxTaskRequestSha256(request)
    if (context.dispatch_id.startsWith("dt2_") || "journal_version" in context ||
      "materialized_request_sha256" in context || "canonical_intent_sha256" in context ||
      "sandbox_prepare_anchor_sha256" in context) {
      consumeDisposableSandboxTaskExecutionContextV2(context, requestSha256)
    }
    if (request.provider !== this.provider) throw adapterError("validation_failed")
    const create = createRequest(request, context, this.config)
    const destroyTarget = target(request, context, "destroy")
    const destruction = new Destruction(
      this.config.control,
      destroyTarget,
      context.provider_creation_token_sha256,
      providerOwnershipBindingSha256(this.provider, context),
    )
    let failure: unknown
    let failurePhase: ManagedDisposableTaskFailurePhaseV1 = "create_inert"
    let cleanupFailure: unknown
    let resource: AdapterProviderResourceV1 | undefined
    let preCleanup: Omit<DisposableSandboxTaskExecutionReceiptCoreV1,
      "schema_version" | "allocation_count" | "destroy_execution_count" | "get_absent" | "list_absent" | "deletion_proven" | "absence_evidence_sha256"> | undefined
    try {
      resource = await this.config.control.createInert(create)
      destruction.setKnown(resource)
      if (resource.immutable_fingerprint_sha256 !== context.immutable_fingerprint_sha256 ||
        resource.provider_creation_token_sha256 !== context.provider_creation_token_sha256 || !resource.owned ||
        resource.ownership.ownership_nonce_sha256 !== providerOwnershipBindingSha256(this.provider, context) ||
        resource.source_attached || resource.credential_attached || resource.state !== "inert" ||
        resource.network_policy.mode !== "deny_all" || !resource.network_policy.enforced_outside_guest ||
        resource.network_policy.public_ingress || !resource.network_policy.dns_denied) {
        throw adapterError("integrity_failed")
      }
      const providerFingerprint = destruction.providerFingerprint
      if (providerFingerprint === undefined) throw adapterError("integrity_failed")
      failurePhase = "mark_dispatched"
      await context.markDispatched(providerFingerprint)
      failurePhase = "activate"
      const activated = await this.config.control.activateResource(
        resource.opaque_resource_id,
        target(request, context, "activate"),
        providerOwnershipBindingSha256(this.provider, context),
      )
      if (activated.state !== "active" || activated.immutable_fingerprint_sha256 !== context.immutable_fingerprint_sha256 ||
        !activated.owned || activated.provider_creation_token_sha256 !== context.provider_creation_token_sha256 ||
        activated.ownership.ownership_nonce_sha256 !== providerOwnershipBindingSha256(this.provider, context) ||
        activated.source_attached || activated.credential_attached || activated.network_policy.mode !== "deny_all" ||
        !activated.network_policy.enforced_outside_guest || activated.network_policy.public_ingress ||
        !activated.network_policy.dns_denied) {
        throw adapterError("provider_state_unknown", { quarantineRequired: true })
      }
      failurePhase = "resource_access"
      preCleanup = await this.config.resource_access.withResource(resource.opaque_resource_id, (surface) =>
        this.#executeGuest(request, context, requestSha256, providerFingerprint, surface, destruction))
    } catch (cause) {
      failure = cause
    } finally {
      try {
        await destruction.destroyAndProveAbsent()
      } catch (cleanupCause) {
        cleanupFailure = cleanupCause
      }
    }
    if (cleanupFailure !== undefined || destruction.runs !== 1 ||
      !destruction.getAbsent || !destruction.listAbsent) {
      throw disposableTaskBoundaryError("cleanup", cleanupFailure)
    }
    if (failure !== undefined) throw disposableTaskBoundaryError(failurePhase, failure)
    if (preCleanup === undefined) throw disposableTaskBoundaryError("resource_access")
    const core: DisposableSandboxTaskExecutionReceiptCoreV1 = {
      schema_version: DISPOSABLE_SANDBOX_TASK_EXECUTION_RECEIPT_SCHEMA_V1,
      ...preCleanup,
      allocation_count: 1,
      destroy_execution_count: 1,
      get_absent: true,
      list_absent: true,
      deletion_proven: true,
      absence_evidence_sha256: disposableTaskAbsenceEvidenceSha256({
        dispatch_id_sha256: context.journal_dispatch_id_sha256,
        request_sha256: requestSha256,
        provider: this.provider,
        provider_creation_token_sha256: context.provider_creation_token_sha256,
        immutable_fingerprint_sha256: context.immutable_fingerprint_sha256,
        provider_fingerprint_sha256: preCleanup.provider_fingerprint_sha256,
        provider_effect_claim_fence_sha256: preCleanup.journal_claim_fence_sha256,
        provider_effect_lease_epoch: context.journal_lease_epoch,
        provider_effect_ownership_nonce_sha256: preCleanup.provider_effect_ownership_nonce_sha256,
        provider_ownership_binding_sha256: preCleanup.provider_ownership_binding_sha256,
        effect_claim_sha256: context.effect_claim_sha256,
        dispatch_intent_anchor_sha256: context.dispatch_intent_anchor_sha256,
        destroy_execution_count: 1,
        get_absent: true,
        list_absent: true,
        conflicting_scoped_matches: 0,
      }),
    }
    return Object.freeze({ ...core, execution_receipt_core_sha256: disposableSandboxTaskExecutionReceiptSha256(core) })
  }

  async reconcile(
    requestValue: Readonly<DisposableSandboxTaskRequestV1>,
    context: Readonly<DisposableSandboxTaskExecutionContextV1 & { prior_state: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED" }>,
  ): Promise<DisposableSandboxTaskExecutionReceiptV1 | "quarantined"> {
    const request = parseDisposableSandboxTaskRequestV1(requestValue)
    const requestSha256 = disposableSandboxTaskRequestSha256(request)
    const handoff = await this.config.checkpoint_handoff.lookupVerified({
      dispatch_id: context.dispatch_id,
      request_sha256: requestSha256,
      expected_result_bundle_sha256: context.recovery_expected_result_bundle_sha256,
      expected_checkpoint_handoff_sha256: context.recovery_expected_checkpoint_handoff_sha256,
    })
    const destruction = new Destruction(
      this.config.control,
      target(request, context, "destroy"),
      context.provider_creation_token_sha256,
      providerOwnershipBindingSha256(this.provider, context),
      context.recovery_expected_provider_fingerprint_sha256 ??
        (handoff === "absent" ? undefined : handoff.provider_fingerprint_sha256),
    )
    try {
      await destruction.destroyAndProveAbsent()
    } catch {
      return "quarantined"
    }
    if (handoff === "absent") return "quarantined"
    return this.#receiptFromHandoff(request, context, handoff, destruction)
  }

  async contain(
    requestValue: Readonly<DisposableSandboxTaskRequestV1>,
    context: Readonly<DisposableSandboxTaskExecutionContextV1 & { prior_state: "PREPARED" | "DISPATCH_INTENT" | "DISPATCHED" | "RESULT_PERSISTED" }>,
  ) {
    const request = parseDisposableSandboxTaskRequestV1(requestValue)
    const requestSha256 = disposableSandboxTaskRequestSha256(request)
    const expectedProviderFingerprint = context.recovery_expected_provider_fingerprint_sha256 ?? canonicalSha256({
      schema_version: "sandboxes.disposable-task-no-provider-effect/v1",
      dispatch_id: context.dispatch_id,
      request_sha256: requestSha256,
      immutable_fingerprint_sha256: context.immutable_fingerprint_sha256,
    })
    const destruction = new Destruction(
      this.config.control,
      target(request, context, "contain"),
      context.provider_creation_token_sha256,
      providerOwnershipBindingSha256(this.provider, context),
      context.recovery_expected_provider_fingerprint_sha256 ?? undefined,
    )
    try {
      await destruction.destroyAndProveAbsent()
    } catch {
      return "quarantined" as const
    }
    return Object.freeze({
      absence_evidence_sha256: disposableTaskAbsenceEvidenceSha256({
        dispatch_id_sha256: context.journal_dispatch_id_sha256,
        request_sha256: requestSha256,
        provider: this.provider,
        provider_creation_token_sha256: context.provider_creation_token_sha256,
        immutable_fingerprint_sha256: context.immutable_fingerprint_sha256,
        provider_fingerprint_sha256: expectedProviderFingerprint,
        provider_effect_claim_fence_sha256: context.journal_claim_fence_sha256,
        provider_effect_lease_epoch: context.journal_lease_epoch,
        provider_effect_ownership_nonce_sha256: context.ownership_nonce_sha256,
        provider_ownership_binding_sha256: providerOwnershipBindingSha256(this.provider, context),
        effect_claim_sha256: context.effect_claim_sha256,
        dispatch_intent_anchor_sha256: context.dispatch_intent_anchor_sha256,
        destroy_execution_count: 1,
        get_absent: true,
        list_absent: true,
        conflicting_scoped_matches: 0,
      }),
      get_absent: true as const,
      list_absent: true as const,
      conflicting_scoped_matches: 0 as const,
    })
  }

  async #executeGuest(
    request: DisposableSandboxTaskRequestV1,
    context: DisposableSandboxTaskExecutionContextV1,
    requestSha256: Digest,
    providerFingerprint: Digest,
    surface: E2bDisposableResourceSurfaceV1,
    destruction: Destruction,
  ): Promise<Omit<DisposableSandboxTaskExecutionReceiptCoreV1,
    "schema_version" | "allocation_count" | "destroy_execution_count" | "get_absent" | "list_absent" | "deletion_proven" | "absence_evidence_sha256">> {
    const artifact = await this.broker.loadArtifact()
    const destructionPort = Object.freeze({
      destroyAndProveAbsent: (): Promise<void> => destruction.destroyAndProveAbsent(),
    })
    const attestation = await this.broker.install(
      { ...surface, destruction: destructionPort },
      artifact,
      REQUEST_TIMEOUT_MS,
    )
    artifact.fill(0)
    const bindingBytes = this.random(32)
    const key = this.random(32)
    if (bindingBytes.byteLength !== 32 || key.byteLength !== 32) throw adapterError("integrity_failed")
    const sessionBinding = directDigest(bindingBytes)
    bindingBytes.fill(0)
    let sequence = 0
    const exchange = (session: E2bGuestBrokerAuthenticatedLineExchangePortV1, operation: E2bGuestBrokerRequestInputV1["operation"], payload: Record<string, unknown>) => {
      const current = sequence++
      return this.broker.exchange(session, {
        session_binding_sha256: sessionBinding,
        request_id: `disposable-${current}`,
        sequence: current,
        nonce_sha256: canonicalSha256({
          request_sha256: requestSha256,
          claim_fence_sha256: context.journal_claim_fence_sha256,
          lease_epoch: context.journal_lease_epoch,
          sequence: current,
        }),
        operation,
        payload,
      }, key)
    }
    try {
      let output: Omit<DisposableSandboxTaskExecutionReceiptCoreV1,
        "schema_version" | "allocation_count" | "destroy_execution_count" | "get_absent" | "list_absent" | "deletion_proven" | "absence_evidence_sha256"> | undefined
      await this.broker.withSession(surface.commands, destructionPort, attestation, sessionBinding, key, async (session, startup) => {
        if (startup.ok !== true || startup.result?.uid !== 0 || startup.result?.gid !== 0 ||
          startup.result?.verified_fd !== true || startup.result?.artifact_sha256 !== E2B_GUEST_BROKER_ARTIFACT_SHA256_V1 ||
          startup.result?.production_admission !== false) throw adapterError("integrity_failed")
        for (const file of request.files) {
          const result = await exchange(session, "file_write", {
            path: file.path,
            content_base64: file.content_base64,
            max_bytes: Buffer.from(file.content_base64, "base64").byteLength,
            mode: file.mode,
            if_absent: true,
          })
          if (result.ok !== true || result.result?.sha256 !== file.content_sha256) throw adapterError("integrity_failed")
        }
        const readbacks: Array<{ path: string; content_sha256: Digest; size_bytes: number; mode: number }> = []
        for (const file of request.files) {
          const bytes = Buffer.from(file.content_base64, "base64")
          const read = await exchange(session, "file_read", {
            path: file.path, offset: 0, length: bytes.byteLength, max_bytes: bytes.byteLength,
          })
          if (read.ok !== true || read.result?.sha256 !== file.content_sha256 ||
            read.result?.content_base64 !== file.content_base64 || read.result?.size !== bytes.byteLength) {
            throw adapterError("integrity_failed")
          }
          readbacks.push({ path: file.path, content_sha256: file.content_sha256, size_bytes: bytes.byteLength, mode: file.mode })
        }
        if (disposableTaskInputManifestSha256(request.files) !== request.input_manifest_sha256) throw adapterError("integrity_failed")
        const workspaceReadbackSha256 = canonicalSha256({
          schema_version: "sandboxes.disposable-task-workspace-readback/v1", files: readbacks,
        })
        const exec = await exchange(session, "exec", {
          argv: request.exec.argv,
          cwd: request.exec.cwd,
          exec_id: safeId(request.operation_digest),
          wall_timeout_ms: request.exec.wall_timeout_ms,
          idle_timeout_ms: request.exec.idle_timeout_ms,
          output_limit_bytes: request.exec.output_limit_bytes,
          pids_limit: request.exec.pids_limit,
        })
        if (exec.ok !== true || exec.result?.status !== "exited" || exec.result?.exit_code !== 0 ||
          exec.result?.output_truncated !== false || exec.result?.destroy_required !== false ||
          exec.result?.checkpoint_eligible !== true) throw adapterError("provider_state_unknown", { quarantineRequired: true })
        const checkpoint = await exchange(session, "checkpoint", {
          max_depth: request.checkpoint.max_depth,
          max_duration_ms: request.checkpoint.max_duration_ms,
          max_file_bytes: request.checkpoint.max_file_bytes,
          max_files: request.checkpoint.max_files,
          max_total_bytes: request.checkpoint.max_total_bytes,
        })
        const result = checkpoint.result
        if (checkpoint.ok !== true || result === undefined) throw adapterError("integrity_failed")
        const postState = verifyCheckpointPostState(
          result,
          request,
          exec.result.process_quiescence_sha256,
        )
        const executionReceiptSha256 = canonicalSha256({
          request_sha256: requestSha256,
          status: exec.result.status,
          exit_code: exec.result.exit_code,
          stdout_sha256: directDigest(Buffer.from(String(exec.result.stdout_base64 ?? ""), "base64")),
          stderr_sha256: directDigest(Buffer.from(String(exec.result.stderr_base64 ?? ""), "base64")),
          process_quiescence_sha256: exec.result.process_quiescence_sha256,
        })
        const authenticatedSessionSha256 = canonicalSha256({
          session_binding_sha256: sessionBinding,
          broker_artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
          broker_protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
          claim_fence_sha256: context.journal_claim_fence_sha256,
          lease_epoch: context.journal_lease_epoch,
        })
        const checkpointBytes = new TextEncoder().encode(canonicalJson({
          schema_version: "sandboxes.disposable-task-checkpoint-bundle/v1",
          output_mode: "delta_from_input",
          input_manifest_sha256: request.input_manifest_sha256,
          input_manifest: request.files
            .map((file) => ({
              path: file.path,
              content_sha256: file.content_sha256,
              size_bytes: Buffer.from(file.content_base64, "base64").byteLength,
              mode: file.mode,
            }))
            .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
          checkpoint_sha256: postState.checkpoint_sha256,
          manifest_sha256: postState.manifest_sha256,
          output_manifest_sha256: postState.output_manifest_sha256,
          output_diff_sha256: postState.output_diff_sha256,
          output_diff: postState.output_diff,
          files: postState.files,
          manifest: postState.manifest,
          file_count: postState.file_count,
          total_bytes: postState.total_bytes,
        }))
        const handoff = await this.config.checkpoint_handoff.putAndReadback({
          dispatch_id: context.dispatch_id,
          request_sha256: requestSha256,
          input_manifest_sha256: request.input_manifest_sha256,
          effect_claim_sha256: context.effect_claim_sha256,
          dispatch_intent_anchor_sha256: context.dispatch_intent_anchor_sha256,
          journal_claim_fence_sha256: context.journal_claim_fence_sha256,
          journal_lease_epoch: context.journal_lease_epoch,
          provider_effect_ownership_nonce_sha256: context.ownership_nonce_sha256,
          provider_ownership_binding_sha256: providerOwnershipBindingSha256(this.provider, context),
          authorization_consumption_receipt_sha256: context.authorization_consumption_receipt_sha256,
          provider_fingerprint_sha256: providerFingerprint,
          broker_artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
          broker_protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
          authenticated_session_sha256: authenticatedSessionSha256,
          execution_receipt_sha256: executionReceiptSha256,
          workspace_readback_sha256: workspaceReadbackSha256,
          output_manifest_sha256: postState.output_manifest_sha256,
          output_diff_sha256: postState.output_diff_sha256,
          checkpoint_sha256: postState.checkpoint_sha256,
          checkpoint_manifest_sha256: postState.manifest_sha256,
          file_count: postState.file_count,
          total_bytes: postState.total_bytes,
          checkpoint_bytes: checkpointBytes,
        })
        this.#validateHandoff(handoff, context, request, postState.checkpoint_sha256, postState.manifest_sha256,
          postState.output_manifest_sha256, postState.output_diff_sha256)
        await context.markResultPersisted({
          result_bundle_sha256: handoff.result_bundle_sha256,
          checkpoint_handoff_sha256: handoff.handoff_receipt_sha256,
        })
        output = {
          provider: this.provider,
          request_sha256: requestSha256,
          idempotency_key_sha256: request.idempotency_key_sha256,
          operation_digest: request.operation_digest,
          authority_envelope_sha256: request.authority_envelope_sha256,
          source_manifest_sha256: request.source_manifest_sha256,
          input_manifest_sha256: request.input_manifest_sha256,
          authorization_consumption_receipt_sha256: context.authorization_consumption_receipt_sha256,
          effect_claim_sha256: context.effect_claim_sha256,
          dispatch_intent_anchor_sha256: context.dispatch_intent_anchor_sha256,
          journal_dispatch_id_sha256: context.journal_dispatch_id_sha256,
          journal_dispatch_anchor_sha256: context.journal_dispatch_anchor_sha256,
          journal_claim_fence_sha256: context.journal_claim_fence_sha256,
          journal_lease_epoch: context.journal_lease_epoch.toString(10),
          provider_effect_ownership_nonce_sha256: context.ownership_nonce_sha256,
          provider_ownership_binding_sha256: providerOwnershipBindingSha256(this.provider, context),
          network_policy: "deny_all" as const,
          provider_fingerprint_sha256: providerFingerprint,
          broker_artifact_sha256: E2B_GUEST_BROKER_ARTIFACT_SHA256_V1,
          broker_protocol_sha256: E2B_GUEST_BROKER_PROTOCOL_SHA256_V1,
          authenticated_session_sha256: authenticatedSessionSha256,
          execution_receipt_sha256: executionReceiptSha256,
          workspace_readback_sha256: workspaceReadbackSha256,
          output_manifest_sha256: postState.output_manifest_sha256,
          output_diff_sha256: postState.output_diff_sha256,
          checkpoint_sha256: postState.checkpoint_sha256,
          checkpoint_manifest_sha256: postState.manifest_sha256,
          checkpoint_readback_sha256: handoff.checkpoint_readback_sha256,
          checkpoint_handoff_sha256: handoff.handoff_receipt_sha256,
          result_bundle_sha256: handoff.result_bundle_sha256,
          checkpoint_file_count: handoff.file_count,
          checkpoint_total_bytes: handoff.total_bytes,
        }
      })
      if (output === undefined) throw adapterError("integrity_failed")
      return output
    } finally {
      key.fill(0)
    }
  }

  #validateHandoff(
    value: CheckpointHandoffReceiptV1,
    context: DisposableSandboxTaskExecutionContextV1,
    request: DisposableSandboxTaskRequestV1,
    checkpointSha256: unknown,
    manifestSha256: unknown,
    outputManifestSha256: unknown,
    outputDiffSha256: unknown,
  ): void {
    const requestSha256 = disposableSandboxTaskRequestSha256(request)
    if (!exactDataRecord(value, [
      "authenticated_session_sha256", "authorization_consumption_receipt_sha256", "broker_artifact_sha256",
      "broker_protocol_sha256", "checkpoint_manifest_sha256",
      "checkpoint_readback_sha256", "checkpoint_sha256", "dispatch_id", "dispatch_intent_anchor_sha256",
      "effect_claim_sha256", "execution_receipt_sha256", "file_count", "input_manifest_sha256",
      "handoff_receipt_sha256", "journal_claim_fence_sha256", "journal_lease_epoch", "output_diff_sha256",
      "output_manifest_sha256", "provider_effect_ownership_nonce_sha256", "provider_fingerprint_sha256",
      "provider_ownership_binding_sha256", "request_sha256", "result_bundle_sha256", "result_signature_sha256",
      "schema_version", "total_bytes", "workspace_readback_sha256",
    ]) || value.schema_version !== "sandboxes.checkpoint-handoff-receipt/v1" ||
      value.dispatch_id !== context.dispatch_id || value.request_sha256 !== requestSha256 ||
      value.input_manifest_sha256 !== request.input_manifest_sha256 ||
      value.authorization_consumption_receipt_sha256 !== context.authorization_consumption_receipt_sha256 ||
      value.effect_claim_sha256 !== context.effect_claim_sha256 ||
      value.dispatch_intent_anchor_sha256 !== context.dispatch_intent_anchor_sha256 ||
      value.journal_claim_fence_sha256 !== context.journal_claim_fence_sha256 ||
      value.journal_lease_epoch !== context.journal_lease_epoch.toString(10) ||
      value.provider_effect_ownership_nonce_sha256 !== context.ownership_nonce_sha256 ||
      value.provider_ownership_binding_sha256 !== providerOwnershipBindingSha256(this.provider, context) ||
      value.checkpoint_sha256 !== checkpointSha256 || value.checkpoint_readback_sha256 !== checkpointSha256 ||
      value.checkpoint_manifest_sha256 !== manifestSha256 ||
      value.output_manifest_sha256 !== outputManifestSha256 || value.output_diff_sha256 !== outputDiffSha256 ||
      !Number.isSafeInteger(value.file_count) || value.file_count < 0 || value.file_count > request.checkpoint.max_files ||
      !Number.isSafeInteger(value.total_bytes) || value.total_bytes < 0 || value.total_bytes > request.checkpoint.max_total_bytes ||
      ![value.handoff_receipt_sha256, value.result_bundle_sha256, value.result_signature_sha256,
        value.provider_fingerprint_sha256, value.broker_artifact_sha256, value.broker_protocol_sha256,
        value.authenticated_session_sha256, value.execution_receipt_sha256,
        value.workspace_readback_sha256, value.authorization_consumption_receipt_sha256,
        value.provider_effect_ownership_nonce_sha256, value.provider_ownership_binding_sha256,
        value.output_manifest_sha256, value.output_diff_sha256, value.effect_claim_sha256,
        value.dispatch_intent_anchor_sha256].every(isDigest) ||
      (context.recovery_expected_result_bundle_sha256 !== null &&
        value.result_bundle_sha256 !== context.recovery_expected_result_bundle_sha256) ||
      (context.recovery_expected_provider_fingerprint_sha256 !== null &&
        value.provider_fingerprint_sha256 !== context.recovery_expected_provider_fingerprint_sha256) ||
      (context.recovery_expected_checkpoint_handoff_sha256 !== null &&
        value.handoff_receipt_sha256 !== context.recovery_expected_checkpoint_handoff_sha256)) throw adapterError("integrity_failed")
  }

  #receiptFromHandoff(
    request: DisposableSandboxTaskRequestV1,
    context: DisposableSandboxTaskExecutionContextV1,
    handoff: CheckpointHandoffReceiptV1,
    destruction: Destruction,
  ): DisposableSandboxTaskExecutionReceiptV1 | "quarantined" {
    const requestSha256 = disposableSandboxTaskRequestSha256(request)
    try {
      this.#validateHandoff(handoff, context, request, handoff.checkpoint_sha256, handoff.checkpoint_manifest_sha256,
        handoff.output_manifest_sha256, handoff.output_diff_sha256)
    } catch {
      return "quarantined"
    }
    const core: DisposableSandboxTaskExecutionReceiptCoreV1 = {
      schema_version: DISPOSABLE_SANDBOX_TASK_EXECUTION_RECEIPT_SCHEMA_V1,
      provider: this.provider,
      request_sha256: requestSha256,
      idempotency_key_sha256: request.idempotency_key_sha256,
      operation_digest: request.operation_digest,
      authority_envelope_sha256: request.authority_envelope_sha256,
      source_manifest_sha256: request.source_manifest_sha256,
      input_manifest_sha256: request.input_manifest_sha256,
      authorization_consumption_receipt_sha256: context.authorization_consumption_receipt_sha256,
      effect_claim_sha256: context.effect_claim_sha256,
      dispatch_intent_anchor_sha256: context.dispatch_intent_anchor_sha256,
      journal_dispatch_id_sha256: context.journal_dispatch_id_sha256,
      journal_dispatch_anchor_sha256: context.journal_dispatch_anchor_sha256,
      journal_claim_fence_sha256: context.journal_claim_fence_sha256,
      journal_lease_epoch: context.journal_lease_epoch.toString(10),
      provider_effect_ownership_nonce_sha256: context.ownership_nonce_sha256,
      provider_ownership_binding_sha256: providerOwnershipBindingSha256(this.provider, context),
      allocation_count: 1,
      network_policy: "deny_all",
      provider_fingerprint_sha256: handoff.provider_fingerprint_sha256,
      broker_artifact_sha256: handoff.broker_artifact_sha256,
      broker_protocol_sha256: handoff.broker_protocol_sha256,
      authenticated_session_sha256: handoff.authenticated_session_sha256,
      execution_receipt_sha256: handoff.execution_receipt_sha256,
      workspace_readback_sha256: handoff.workspace_readback_sha256,
      output_manifest_sha256: handoff.output_manifest_sha256,
      output_diff_sha256: handoff.output_diff_sha256,
      checkpoint_sha256: handoff.checkpoint_sha256,
      checkpoint_manifest_sha256: handoff.checkpoint_manifest_sha256,
      checkpoint_readback_sha256: handoff.checkpoint_readback_sha256,
      checkpoint_handoff_sha256: handoff.handoff_receipt_sha256,
      result_bundle_sha256: handoff.result_bundle_sha256,
      checkpoint_file_count: handoff.file_count,
      checkpoint_total_bytes: handoff.total_bytes,
      destroy_execution_count: 1,
      get_absent: destruction.getAbsent as true,
      list_absent: destruction.listAbsent as true,
      deletion_proven: true,
      absence_evidence_sha256: disposableTaskAbsenceEvidenceSha256({
        dispatch_id_sha256: context.journal_dispatch_id_sha256,
        request_sha256: requestSha256,
        provider: this.provider,
        provider_creation_token_sha256: context.provider_creation_token_sha256,
        immutable_fingerprint_sha256: context.immutable_fingerprint_sha256,
        provider_fingerprint_sha256: handoff.provider_fingerprint_sha256,
        provider_effect_claim_fence_sha256: context.journal_claim_fence_sha256,
        provider_effect_lease_epoch: context.journal_lease_epoch,
        provider_effect_ownership_nonce_sha256: context.ownership_nonce_sha256,
        provider_ownership_binding_sha256: providerOwnershipBindingSha256(this.provider, context),
        effect_claim_sha256: context.effect_claim_sha256,
        dispatch_intent_anchor_sha256: context.dispatch_intent_anchor_sha256,
        destroy_execution_count: 1,
        get_absent: true,
        list_absent: true,
        conflicting_scoped_matches: 0,
      }),
    }
    return Object.freeze({ ...core, execution_receipt_core_sha256: disposableSandboxTaskExecutionReceiptSha256(core) })
  }
}

/** Production constructor requires the reviewed official lifecycle bridge class. */
export function createE2bDisposableSandboxTaskRunnerV1(
  config: Omit<ManagedDisposableRunnerConfigV1, "provider">,
): DisposableSandboxTaskRunnerV1 {
  if (!(config.control instanceof E2bOfficialSdkControlBridgeV1) || config.template_mapping_attested !== true) {
    throw adapterError("integrity_failed")
  }
  return new E2bDisposableTaskRunner(
    { ...config, provider: "e2b" },
    productionBroker,
    (length) => new Uint8Array(randomBytes(length)),
  )
}

/** Package-internal hermetic constructor; intentionally omitted from package exports. */
export function __testOnlyCreateE2bDisposableSandboxTaskRunnerV1(
  config: Omit<ManagedDisposableRunnerTestConfigV1, "provider">,
): DisposableSandboxTaskRunnerV1 {
  return new E2bDisposableTaskRunner(
    { ...config, provider: "e2b" },
    config.broker,
    config.random_bytes,
  )
}

/** Package-internal candidate constructor shared by provider-specific adapters. */
export function __testOnlyCreateManagedDisposableSandboxTaskRunnerV1(
  config: ManagedDisposableRunnerTestConfigV1,
): DisposableSandboxTaskRunnerV1 {
  return new E2bDisposableTaskRunner(config, config.broker, config.random_bytes)
}

/** Provider-specific candidate constructor; public dispatch remains closed by the V2 admission gate. */
export function createManagedDisposableSandboxTaskRunnerCandidateV1(
  config: ManagedDisposableRunnerConfigV1,
): DisposableSandboxTaskRunnerV1 {
  return new E2bDisposableTaskRunner(
    config,
    config.provider === "daytona_cloud" ? daytonaProductionBroker : productionBroker,
    (length) => new Uint8Array(randomBytes(length)),
  )
}

void AdapterContractError
