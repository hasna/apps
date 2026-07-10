import {
  INERT_DENY_ALL_POLICY,
  adapterError,
  capabilityAuthorizationBinding,
  canonicalSha256,
  type AdapterCallContextV1,
  type AdapterEffectGuardPortV1,
  type AdapterProviderResourceV1,
  type CanonicalSandboxEffectFenceV1,
  type Digest,
  type ExecSpecV1,
  type FailedNoEffectAuthorizationV1,
  type FileListV1,
  type FilePageV1,
  type FileReadV1,
  type FileStatV1,
  type FileWriteReceiptV1,
  type FileWriteV1,
  type JournalAnchorReceiptV1,
  type JournalRecordV1,
  type ManagedProviderControlPortV1,
  type ManagedProviderCredentialPortV1,
  type ManagedProviderIdV1,
  type NetworkPolicyObservationV1,
  type NetworkPolicyV1,
  type ProviderCreateInertRequestV1,
  type ProviderEffectTargetV1,
  type ProviderExecHandleV1,
  type ProviderExecStreamEventV1,
  type ProviderEffectGuardPhaseV1,
  type ProviderOperationNameV1,
  type ProviderOperationV1,
  type ResourceGenerationTransitionV1,
  type ProviderResourcePageV1,
  type ProviderSnapshotHintV1,
  type ProviderMutationOutcomeV1,
  type ReadRetryPolicyV1,
  type WorkspacePath,
} from "../../src/adapters/managed/index"

export const digest = (hex: string): Digest => `sha256:${hex.padStart(64, "0").slice(-64)}` as Digest

export const DENY_ALL_POLICY: NetworkPolicyV1 = INERT_DENY_ALL_POLICY
export const BROKER_ONLY_POLICY: NetworkPolicyV1 = {
  mode: "broker_only",
  policy_sha256: digest("12"),
}

export const FENCE: CanonicalSandboxEffectFenceV1 = {
  authority_epoch: 7n,
  route_lineage_id: "lineage-1",
  route_id: "route-1",
  route_epoch: 4n,
  run_id: "run-1",
  attempt_id: "attempt-1",
  attempt_lease_id: "attempt-lease-1",
  lease_epoch: 9n,
  resource_lease_id: "resource-lease-1",
  resource_id: "resource-1",
  resource_lifecycle_generation: 2n,
  operation_id: "operation-1",
  operation_digest: digest("21"),
  operation_execution_epoch: 3n,
  actor_principal: "actor-1",
  lease_holder_principal: "holder-1",
  operation_executor_principal: "executor-1",
  audience: "sandboxes.runtime/v1",
  issued_at: "2026-07-10T10:00:00.000Z",
  lease_expires_at: "2026-07-10T11:00:00.000Z",
  operation_execution_expires_at: "2026-07-10T10:30:00.000Z",
}

type OperationOverrides = Partial<Omit<ProviderOperationV1, "generation_transition">> & {
  generation_transition?: ResourceGenerationTransitionV1 | undefined
}

export function makeOperation(operation: ProviderOperationNameV1, overrides: OperationOverrides = {}): ProviderOperationV1 {
  const generationChanging = new Set<ProviderOperationNameV1>([
    "create_inert",
    "activate",
    "expire",
    "quarantine",
    "destroy",
  ])
  const generationWasOverridden = Object.prototype.hasOwnProperty.call(overrides, "generation_transition")
  const { generation_transition: generationTransition, ...otherOverrides } = overrides
  const result: ProviderOperationV1 = {
    operation,
    target: {
      operation_id: FENCE.operation_id,
      operation_digest: FENCE.operation_digest,
      operation_step_id: `${operation}-step-1`,
      resource_id: FENCE.resource_id,
      resource_lifecycle_generation: FENCE.resource_lifecycle_generation,
      provider_idempotency_token_sha256: digest("31"),
      immutable_fingerprint_sha256: digest("32"),
      authorization_consumption_receipt_sha256: digest("33"),
    },
    fence: FENCE,
    ...(!generationWasOverridden && generationChanging.has(operation)
      ? {
          generation_transition: {
            expected_resource_lifecycle_generation: 1n,
            successor_resource_lifecycle_generation: 2n,
          },
        }
      : {}),
    request_sha256: digest("34"),
    idempotency_key_sha256: digest("35"),
    external_anchor_kind: operation === "inspect" || operation.startsWith("file_") ? "READ_PROBE" : "DISPATCHED",
    external_anchor_receipt_sha256: digest("36"),
    deadline: "2026-07-10T10:20:00.000Z",
    ...otherOverrides,
  }
  if (generationTransition !== undefined) result.generation_transition = generationTransition
  return result
}

function anchorRecord(
  operation: ProviderOperationV1,
  recordKind: JournalRecordV1["record_kind"],
  operationExecutionEpoch = operation.fence.operation_execution_epoch,
): JournalRecordV1 {
  return {
    schema_version: "sandboxes.effect-journal/v1",
    semantic_step: operation.operation,
    operation_id: operation.target.operation_id,
    operation_step_id: operation.target.operation_step_id,
    operation_execution_epoch: operationExecutionEpoch,
    record_kind: recordKind,
    resource_id: operation.target.resource_id,
    resource_lifecycle_generation: operation.target.resource_lifecycle_generation,
    provider_idempotency_token_sha256: operation.target.provider_idempotency_token_sha256,
    immutable_fingerprint_sha256: operation.target.immutable_fingerprint_sha256,
    operation_digest: operation.target.operation_digest,
    request_sha256: operation.request_sha256,
    target_sha256: canonicalSha256(operation.target),
    fence_sha256: canonicalSha256({
      ...operation.fence,
      operation_execution_epoch: operationExecutionEpoch,
    }),
    generation_transition_sha256: canonicalSha256(
      operation.generation_transition ?? { kind: "no_generation_transition" },
    ),
    authorization_binding_sha256: capabilityAuthorizationBinding(operation.target),
    payload_sha256: digest(recordKind === "INTENT" ? "41" : recordKind === "OUTCOME" ? "43" : "42"),
  }
}

export function makeAnchorReceipt(record: JournalRecordV1): JournalAnchorReceiptV1 {
  return {
    record,
    record_sha256: canonicalSha256(record),
    signer_principal: "journal-1",
    anchored_at: "2026-07-10T10:00:01.000Z",
    duplicate: false,
  }
}

export function makeContext(
  operation: ProviderOperationV1,
  journal: FakeJournal,
  options: {
    operationExecutionEpoch?: bigint
    failedNoEffect?: FailedNoEffectAuthorizationV1
  } = {},
): AdapterCallContextV1 {
  const epoch = options.operationExecutionEpoch ?? operation.fence.operation_execution_epoch
  const fence = { ...operation.fence, operation_execution_epoch: epoch }
  const op = { ...operation, fence }
  const intent = anchorRecord(op, "INTENT", epoch)
  const invocation = anchorRecord(
    op,
    operation.external_anchor_kind === "READ_PROBE" ? "READ_PROBE" : "DISPATCHED",
    epoch,
  )
  const invocationReceipt = makeAnchorReceipt(invocation)
  // ProviderOperationV1 carries the protected anchor receipt digest. The helper
  // fills it only after constructing the canonical record to avoid fake values.
  operation.external_anchor_receipt_sha256 = invocationReceipt.record_sha256
  return {
    fence,
    target: operation.target,
    request_sha256: operation.request_sha256,
    deadline: operation.deadline,
    trace_id: "trace-1",
    intent_anchor: makeAnchorReceipt(intent),
    invocation_anchor: invocationReceipt,
    outcome_journal: journal,
    authorization_binding_sha256: capabilityAuthorizationBinding(operation.target),
    dispatch_attempt:
      epoch === operation.fence.operation_execution_epoch
        ? { kind: "initial", operation_execution_epoch: epoch }
        : {
            kind: "higher_epoch_after_failed_no_effect",
            previous_operation_execution_epoch: operation.fence.operation_execution_epoch,
            authorization:
              options.failedNoEffect ??
              {
                schema_version: "sandboxes.failed-no-effect/v1",
                previous_operation_execution_epoch: operation.fence.operation_execution_epoch,
                successor_operation_execution_epoch: epoch + 1n,
                target_sha256: canonicalSha256(operation.target),
                resource_id: operation.target.resource_id,
                provider_idempotency_token_sha256: operation.target.provider_idempotency_token_sha256,
                operation_digest: operation.target.operation_digest,
                evidence_sha256: digest("missing-proof"),
              },
          },
  }
}

export function bindAuthorization(
  ctx: AdapterCallContextV1,
  operation: ProviderOperationV1,
  authorizationBindingSha256: Digest,
): AdapterCallContextV1 {
  const intent = makeAnchorReceipt({
    ...ctx.intent_anchor.record,
    authorization_binding_sha256: authorizationBindingSha256,
  })
  const invocation = makeAnchorReceipt({
    ...ctx.invocation_anchor.record,
    authorization_binding_sha256: authorizationBindingSha256,
  })
  operation.external_anchor_receipt_sha256 = invocation.record_sha256
  return {
    ...ctx,
    authorization_binding_sha256: authorizationBindingSha256,
    intent_anchor: intent,
    invocation_anchor: invocation,
  }
}

export class FakeJournal {
  readonly outcomes: JournalRecordV1[] = []
  failAppend = false

  async appendOutcome(record: JournalRecordV1): Promise<JournalAnchorReceiptV1> {
    this.outcomes.push(record)
    if (this.failAppend) throw new Error("journal unavailable with provider details")
    return makeAnchorReceipt(record)
  }
}

export class FakeCredentialPort implements ManagedProviderCredentialPortV1 {
  acquisitions = 0

  constructor(readonly client: ManagedProviderControlPortV1) {}

  async withAuthenticatedClient<T>(
    provider: ManagedProviderIdV1,
    use: (client: ManagedProviderControlPortV1) => Promise<T>,
  ): Promise<T> {
    if (provider !== this.client.provider_id) throw new Error("wrong fake provider")
    this.acquisitions += 1
    return use(this.client)
  }
}

export class FakeEffectGuard implements AdapterEffectGuardPortV1 {
  readonly calls: ProviderEffectGuardPhaseV1[] = []
  rejectPhase: ProviderEffectGuardPhaseV1 | undefined

  async assertCurrent(
    _ctx: AdapterCallContextV1,
    _operation: ProviderOperationV1,
    phase: ProviderEffectGuardPhaseV1,
  ): Promise<void> {
    this.calls.push(phase)
    if (this.rejectPhase === phase) throw adapterError("stale_operation_execution_epoch")
  }
}

export class FakeProviderClient implements ManagedProviderControlPortV1 {
  readonly capabilities = {
    exact_creation_token_lookup: true,
    create_stopped: true,
    network_policy_readback: true,
    typed_argv_exec: true,
    native_bounded_files: true,
    atomic_file_write: true,
    whole_guest_cancel: true,
    non_destructive_pause: true,
    stop_preserves_filesystem: true,
    conditional_destroy: true,
    provider_snapshot_hint: true,
    ownership_inventory: true,
  }
  readonly resources = new Map<string, AdapterProviderResourceV1>()
  readonly files = new Map<string, Uint8Array>()
  createCalls = 0
  activateCalls = 0
  pauseCalls = 0
  destroyCalls = 0
  cancelCalls = 0
  lookupCalls = 0
  startExecCalls: ExecSpecV1[] = []
  createError: Error | undefined
  createThenThrow = false
  networkMismatch = false
  cancelProof = true
  keepPresentAfterDestroy = false
  transientLookupFailures = 0
  readonly provider_id: ManagedProviderIdV1

  constructor(provider: ManagedProviderIdV1) {
    this.provider_id = provider
  }

  makeResource(target: ProviderEffectTargetV1, suffix = "1"): AdapterProviderResourceV1 {
    return {
      opaque_resource_id: `${this.provider_id}-native-${suffix}`,
      provider_creation_token_sha256: target.provider_idempotency_token_sha256,
      immutable_fingerprint_sha256: target.immutable_fingerprint_sha256,
      provider_created_at: "2026-07-10T10:00:02.000Z",
      provider_resource_version: `version-${suffix}`,
      state: "inert",
      network_policy: this.networkObservation(DENY_ALL_POLICY),
      auto_delete_disabled: true,
      ephemeral: false,
      owned: true,
    }
  }

  seed(resource: AdapterProviderResourceV1): void {
    this.resources.set(resource.opaque_resource_id, resource)
  }

  networkObservation(policy: NetworkPolicyV1): NetworkPolicyObservationV1 {
    return {
      mode: policy.mode,
      policy_sha256: this.networkMismatch ? digest("99") : policy.policy_sha256,
      enforced_outside_guest: true,
      public_ingress: false,
      dns_denied: policy.mode === "deny_all",
      observed_at: "2026-07-10T10:00:03.000Z",
    }
  }

  async findByCreationToken(token: Digest): Promise<ProviderResourcePageV1> {
    this.lookupCalls += 1
    if (this.transientLookupFailures > 0) {
      this.transientLookupFailures -= 1
      throw new Error("transient list outage")
    }
    return {
      items: [...this.resources.values()].filter((resource) => resource.provider_creation_token_sha256 === token),
    }
  }

  async createInert(request: ProviderCreateInertRequestV1): Promise<AdapterProviderResourceV1> {
    this.createCalls += 1
    const resource = this.makeResource(request.target)
    resource.network_policy = this.networkObservation(request.initial_network_policy)
    if (this.createThenThrow) {
      this.seed(resource)
      throw new Error("response vanished after provider accepted create")
    }
    if (this.createError !== undefined) throw this.createError
    this.seed(resource)
    return resource
  }

  async inspectResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1 | "absent"> {
    return this.resources.get(opaqueResourceId) ?? "absent"
  }

  async applyNetworkPolicy(opaqueResourceId: string, policy: NetworkPolicyV1): Promise<NetworkPolicyObservationV1> {
    const resource = this.resources.get(opaqueResourceId)
    if (resource === undefined) throw new Error("missing")
    const observation = this.networkObservation(policy)
    resource.network_policy = observation
    return observation
  }

  async activateResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1> {
    this.activateCalls += 1
    const resource = this.resources.get(opaqueResourceId)
    if (resource === undefined) throw new Error("missing")
    resource.state = "active"
    return resource
  }

  async pauseOrStopResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1> {
    this.pauseCalls += 1
    const resource = this.resources.get(opaqueResourceId)
    if (resource === undefined) throw new Error("missing")
    resource.state = "inert"
    return resource
  }

  async destroyResource(opaqueResourceId: string, expectedVersion: string): Promise<void> {
    this.destroyCalls += 1
    const resource = this.resources.get(opaqueResourceId)
    if (resource === undefined) return
    if (resource.provider_resource_version !== expectedVersion) throw new Error("conditional version mismatch")
    if (!this.keepPresentAfterDestroy) this.resources.delete(opaqueResourceId)
  }

  async startExec(_opaqueResourceId: string, spec: ExecSpecV1): Promise<ProviderExecHandleV1> {
    this.startExecCalls.push(spec)
    return {
      opaque_exec_id: "provider-exec-1",
      immutable_exec_fingerprint_sha256: digest("51"),
      started_at: "2026-07-10T10:00:04.000Z",
    }
  }

  async *streamExec(_exec: ProviderExecHandleV1): AsyncIterable<ProviderExecStreamEventV1> {
    yield { stream: "stdout", sequence: 1n, bytes: new TextEncoder().encode("hello") }
    yield { stream: "stderr", sequence: 2n, bytes: new TextEncoder().encode("warn") }
    yield { stream: "terminal", sequence: 3n, exit_code: 0 }
  }

  async cancelExec(_exec: ProviderExecHandleV1): Promise<{ whole_guest_scope_terminated: boolean }> {
    this.cancelCalls += 1
    return { whole_guest_scope_terminated: this.cancelProof }
  }

  async statFile(path: WorkspacePath): Promise<FileStatV1> {
    const bytes = this.files.get(path)
    if (bytes === undefined) throw new Error("not found")
    return {
      path,
      type: "file",
      size_bytes: bytes.byteLength,
      sha256: canonicalSha256(bytes),
      revision: 1n,
      mode: 0o600,
    }
  }

  async *readFile(request: FileReadV1): AsyncIterable<Uint8Array> {
    const bytes = this.files.get(request.path)
    if (bytes === undefined) throw new Error("not found")
    const end = Math.min(bytes.byteLength, request.offset + request.length)
    yield bytes.slice(request.offset, end)
  }

  async writeFileAtomic(request: FileWriteV1): Promise<FileWriteReceiptV1> {
    this.files.set(request.path, request.bytes.slice())
    return {
      path: request.path,
      size_bytes: request.bytes.byteLength,
      sha256: canonicalSha256(request.bytes),
      revision: 1n,
    }
  }

  async listFiles(request: FileListV1): Promise<FilePageV1> {
    return {
      items: [...this.files.keys()].sort().map((path) => ({ path: path as WorkspacePath, type: "file" as const })),
      ...(request.cursor === undefined ? {} : { next_cursor: request.cursor }),
    }
  }

  async createSnapshotHint(_opaqueResourceId: string): Promise<ProviderSnapshotHintV1> {
    return {
      opaque_snapshot_id: "provider-snapshot-secret-id",
      created_at: "2026-07-10T10:00:05.000Z",
      provider_receipt_sha256: digest("61"),
    }
  }

  async lookupOperation(_target: ProviderEffectTargetV1): Promise<ProviderMutationOutcomeV1> {
    return "accepted"
  }

  async listOwnedResources(cursor?: string): Promise<ProviderResourcePageV1> {
    return {
      items: [...this.resources.values()],
      ...(cursor === undefined ? {} : { next_cursor: cursor }),
    }
  }
}

export const READ_RETRY_POLICY: ReadRetryPolicyV1 = {
  max_attempts: 3,
  base_delay_ms: 0,
  max_delay_ms: 0,
}
