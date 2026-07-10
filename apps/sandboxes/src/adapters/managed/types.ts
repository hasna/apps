export type Digest = `sha256:${string}`

export type ManagedProviderIdV1 = "e2b" | "daytona_cloud"

export type ProviderOperationNameV1 =
  | "create_inert"
  | "activate"
  | "inspect"
  | "exec_start"
  | "exec_stream"
  | "exec_cancel"
  | "file_stat"
  | "file_read"
  | "file_write"
  | "file_list"
  | "checkpoint_hint"
  | "expire"
  | "quarantine"
  | "destroy"

export interface CanonicalSandboxEffectFenceV1 {
  authority_epoch: bigint
  route_lineage_id: string
  route_id: string
  route_epoch: bigint
  run_id: string
  attempt_id: string
  attempt_lease_id: string
  lease_epoch: bigint
  resource_lease_id: string
  resource_id: string
  resource_lifecycle_generation: bigint
  operation_id: string
  operation_digest: Digest
  operation_execution_epoch: bigint
  actor_principal: string
  lease_holder_principal: string
  operation_executor_principal: string
  audience: "sandboxes.runtime/v1"
  issued_at: string
  lease_expires_at: string
  operation_execution_expires_at: string
}

export interface ResourceGenerationTransitionV1 {
  expected_resource_lifecycle_generation: bigint
  successor_resource_lifecycle_generation: bigint
}

export interface ProviderEffectTargetV1 {
  operation_id: string
  operation_digest: Digest
  operation_step_id: string
  resource_id: string
  resource_lifecycle_generation: bigint
  provider_idempotency_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  authorization_consumption_receipt_sha256: Digest
}

export interface ProviderOperationV1 {
  operation: ProviderOperationNameV1
  target: ProviderEffectTargetV1
  fence: CanonicalSandboxEffectFenceV1
  generation_transition?: ResourceGenerationTransitionV1
  request_sha256: Digest
  idempotency_key_sha256: Digest
  external_anchor_kind: "DISPATCHED" | "READ_PROBE"
  external_anchor_receipt_sha256: Digest
  deadline: string
}

export interface JournalRecordV1 {
  schema_version: "sandboxes.effect-journal/v1"
  semantic_step: ProviderOperationNameV1
  operation_id: string
  operation_step_id: string
  operation_execution_epoch: bigint
  record_kind: "INTENT" | "DISPATCHED" | "READ_PROBE" | "OUTCOME"
  resource_id: string
  resource_lifecycle_generation: bigint
  provider_idempotency_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  operation_digest: Digest
  request_sha256: Digest
  target_sha256: Digest
  fence_sha256: Digest
  payload_sha256: Digest
}

export interface JournalAnchorReceiptV1 {
  record: JournalRecordV1
  record_sha256: Digest
  signer_principal: string
  anchored_at: string
  duplicate: boolean
}

export interface FailedNoEffectAuthorizationV1 {
  schema_version: "sandboxes.failed-no-effect/v1"
  previous_operation_execution_epoch: bigint
  successor_operation_execution_epoch: bigint
  target_sha256: Digest
  resource_id: string
  provider_idempotency_token_sha256: Digest
  operation_digest: Digest
  evidence_sha256: Digest
}

export interface OutcomeJournalPortV1 {
  appendOutcome(record: JournalRecordV1): Promise<JournalAnchorReceiptV1>
}

export type DispatchAttemptAuthorizationV1 =
  | {
      kind: "initial"
      operation_execution_epoch: bigint
    }
  | {
      kind: "exact_duplicate"
      operation_execution_epoch: bigint
      prior_record_sha256: Digest
    }
  | {
      kind: "higher_epoch_after_failed_no_effect"
      previous_operation_execution_epoch: bigint
      authorization: FailedNoEffectAuthorizationV1
    }

export interface AdapterCallContextV1 {
  fence: CanonicalSandboxEffectFenceV1
  target: ProviderEffectTargetV1
  request_sha256: Digest
  deadline: string
  trace_id: string
  intent_anchor: JournalAnchorReceiptV1
  invocation_anchor: JournalAnchorReceiptV1
  outcome_journal: OutcomeJournalPortV1
  dispatch_attempt: DispatchAttemptAuthorizationV1
  signal?: AbortSignal
}

export interface DestroyContextV1 extends AdapterCallContextV1 {
  cleanup_grant_sha256: Digest
  cleanup_basis_sha256: Digest
}

export interface ReconcileContextV1 extends AdapterCallContextV1 {
  continuation_grant_sha256: Digest
  authorization_consumption_receipt_sha256: Digest
}

export interface NetworkPolicyV1 {
  mode: "deny_all" | "broker_only"
  policy_sha256: Digest
}

export interface NetworkPolicyObservationV1 extends NetworkPolicyV1 {
  enforced_outside_guest: boolean
  public_ingress: boolean
  dns_denied: boolean
  observed_at: string
}

export interface AdapterSandboxSpecV1 {
  schema_version: "sandboxes.runtime/v1"
  spec_sha256: Digest
  environment_image_or_snapshot_sha256: Digest
  architecture: "arm64" | "amd64"
  workspace_root: "/workspace"
  network_policy: NetworkPolicyV1
  max_runtime_ms: number
}

export interface ProviderCreateInertRequestV1 {
  target: ProviderEffectTargetV1
  spec: AdapterSandboxSpecV1
  allocation_key_sha256: Digest
  ownership: {
    installation_id: string
    provider_scope_ref: string
    ownership_nonce: string
  }
  initial_network_policy: NetworkPolicyV1
}

export type ProviderResourcePhysicalStateV1 = "inert" | "active" | "transitioning" | "unknown"

export interface AdapterProviderResourceV1 {
  opaque_resource_id: string
  provider_creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  provider_created_at: string
  provider_resource_version: string
  state: ProviderResourcePhysicalStateV1
  network_policy: NetworkPolicyObservationV1
  auto_delete_disabled: boolean
  ephemeral: boolean
  owned: boolean
}

export interface ProviderResourcePageV1 {
  items: AdapterProviderResourceV1[]
  next_cursor?: string
}

export interface ProviderCapabilitiesV1 {
  exact_creation_token_lookup: boolean
  create_stopped: boolean
  network_policy_readback: boolean
  typed_argv_exec: boolean
  native_bounded_files: boolean
  atomic_file_write: boolean
  whole_guest_cancel: boolean
  non_destructive_pause: boolean
  stop_preserves_filesystem: boolean
  conditional_destroy: boolean
  provider_snapshot_hint: boolean
  ownership_inventory: boolean
}

export interface ExecSpecV1 {
  executable: string
  argv: string[]
  cwd: WorkspacePath | ""
  environment_profile_sha256: Digest
  environment: Readonly<Record<string, string>>
  stdin_sha256: Digest
  wall_deadline: string
  idle_timeout_ms: number
  output_limit_bytes: number
  process_limit: number
  tty: false
}

export interface ProviderExecHandleV1 {
  opaque_exec_id: string
  immutable_exec_fingerprint_sha256: Digest
  started_at: string
}

export interface AdapterExecHandleV1 extends ProviderExecHandleV1 {
  adapter_id: ManagedProviderIdV1
  resource_id: string
  resource_lifecycle_generation: bigint
  start_operation_id: string
  start_request_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export type ProviderExecStreamEventV1 =
  | { stream: "stdout" | "stderr"; sequence: bigint; bytes: Uint8Array }
  | { stream: "terminal"; sequence: bigint; exit_code: number }

export type AdapterExecStreamFrameV1 = ProviderExecStreamEventV1

export interface CancelObservationV1 {
  observation: "whole_guest_scope_terminated"
  exec_fingerprint_sha256: Digest
  provider_receipt_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export type WorkspacePath = string & { readonly __workspacePath: unique symbol }

export interface FileStatV1 {
  path: WorkspacePath
  type: "file" | "directory" | "symlink"
  size_bytes: number
  sha256?: Digest
  revision: bigint
  mode: number
  symlink_target?: WorkspacePath
}

export interface FileReadV1 {
  path: WorkspacePath
  offset: number
  length: number
}

export interface ByteChunkV1 {
  offset: number
  bytes: Uint8Array
  sha256: Digest
}

export interface FileWriteV1 {
  path: WorkspacePath
  bytes: Uint8Array
  if_absent?: boolean
  expected_prior_sha256?: Digest
  expected_prior_revision?: bigint
}

export interface FileWriteReceiptV1 {
  path: WorkspacePath
  size_bytes: number
  sha256: Digest
  revision: bigint
  provider_outcome_anchor_sha256?: Digest
}

export interface FileListV1 {
  path: WorkspacePath
  cursor?: string
  limit: number
}

export interface FilePageV1 {
  items: Array<{
    path: WorkspacePath
    type: "file" | "directory" | "symlink"
  }>
  next_cursor?: string
}

export interface ProviderSnapshotHintV1 {
  opaque_snapshot_id: string
  created_at: string
  provider_receipt_sha256: Digest
}

export interface CheckpointHintObservationV1 {
  canonical_checkpoint: false
  cleanup_authority: false
  provider_snapshot_id_sha256: Digest
  provider_receipt_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export type ProviderMutationOutcomeV1 = "not_sent" | "accepted" | "completed" | "not_found" | "unknown"

export interface ProviderOperationObservationV1 {
  observation: ProviderMutationOutcomeV1
  target_sha256: Digest
  provider_idempotency_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export interface AdapterObservationV1 {
  observation: "inert" | "active" | "transitioning" | "unknown" | "absent"
  immutable_fingerprint_sha256: Digest
  network_policy?: NetworkPolicyObservationV1
  provider_receipt_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export interface ActivationDispatchAuthorizationV1 {
  activation_grant_sha256: Digest
  authorization_consumption_receipt_sha256: Digest
  network_policy: NetworkPolicyV1
}

export interface ActivationReceiptV1 {
  observation: "active"
  immutable_fingerprint_sha256: Digest
  network_policy: NetworkPolicyObservationV1
  activation_grant_sha256: Digest
  provider_receipt_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export interface ExpireObservationV1 {
  observation: "safety_stopped"
  immutable_fingerprint_sha256: Digest
  provider_receipt_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export type QuarantineObservationV1 = ExpireObservationV1

export interface DestroyObservationV1 {
  terminal_condition: "verified_absent"
  immutable_fingerprint_sha256: Digest
  provider_receipt_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export interface OwnedProviderHandleV1 {
  adapter_id: ManagedProviderIdV1
  adapter_version: string
  installation_id: string
  provider_scope_ref: string
  resource_kind: "managed_sandbox"
  opaque_resource_id: string
  ownership_nonce: string
  create_inert_operation_id: string
  provider_creation_token_sha256: Digest
  creation_receipt_sha256: Digest
  provider_created_at: string
  provider_resource_version: string
  immutable_fingerprint_sha256: Digest
  resource_lease_id: string
  resource_id: string
  resource_lifecycle_generation: bigint
  spec_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export interface AdapterDescriptorV1 {
  adapter_id: ManagedProviderIdV1
  adapter_version: string
  adapter_build_sha256: Digest
  sdk_package: string
  sdk_version: string
  runtime_class: "strong_vm"
  architecture: ReadonlyArray<"arm64" | "amd64">
  admission: "enabled" | "disabled"
  admission_evidence_sha256: Digest
  provider_results_are_canonical_state: false
  provider_snapshot_is_canonical_checkpoint: false
}

export interface ProviderAdmissionV1 {
  admitted: boolean
  evidence_sha256: Digest
  exact_sdk_version: string
}

export interface ReadRetryPolicyV1 {
  max_attempts: number
  base_delay_ms: number
  max_delay_ms: number
}

export interface ManagedAdapterDependenciesV1 {
  credential_port: ManagedProviderCredentialPortV1
  installation_id: string
  provider_scope_ref: string
  adapter_version: string
  adapter_build_sha256: Digest
  admission: ProviderAdmissionV1
  read_retry_policy: ReadRetryPolicyV1
}

export interface ManagedProviderControlPortV1 {
  readonly provider_id: ManagedProviderIdV1
  readonly capabilities: ProviderCapabilitiesV1
  findByCreationToken(token: Digest, cursor?: string): Promise<ProviderResourcePageV1>
  createInert(request: ProviderCreateInertRequestV1): Promise<AdapterProviderResourceV1>
  inspectResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1 | "absent">
  applyNetworkPolicy(opaqueResourceId: string, policy: NetworkPolicyV1): Promise<NetworkPolicyObservationV1>
  activateResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1>
  pauseOrStopResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1>
  destroyResource(opaqueResourceId: string, expectedVersion: string): Promise<void>
  startExec(opaqueResourceId: string, spec: ExecSpecV1): Promise<ProviderExecHandleV1>
  streamExec(exec: ProviderExecHandleV1): AsyncIterable<ProviderExecStreamEventV1>
  cancelExec(exec: ProviderExecHandleV1): Promise<{ whole_guest_scope_terminated: boolean }>
  statFile(path: WorkspacePath): Promise<FileStatV1>
  readFile(request: FileReadV1): AsyncIterable<Uint8Array>
  writeFileAtomic(request: FileWriteV1): Promise<FileWriteReceiptV1>
  listFiles(request: FileListV1): Promise<FilePageV1>
  createSnapshotHint(opaqueResourceId: string): Promise<ProviderSnapshotHintV1>
  lookupOperation(target: ProviderEffectTargetV1): Promise<ProviderMutationOutcomeV1>
  listOwnedResources(cursor?: string): Promise<ProviderResourcePageV1>
}

export interface ManagedProviderCredentialPortV1 {
  withAuthenticatedClient<T>(
    provider: ManagedProviderIdV1,
    use: (client: ManagedProviderControlPortV1) => Promise<T>,
  ): Promise<T>
}

export interface InventoryFindingV1 {
  provider_resource_sha256: Digest
  immutable_fingerprint_sha256: Digest
  disposition: "known" | "quarantine_required"
  resource_id?: string
}

export interface InventoryReconciliationV1 {
  findings: InventoryFindingV1[]
  complete: boolean
}

export interface OwnedResourcePageV1 {
  items: Array<{
    provider_resource_sha256: Digest
    immutable_fingerprint_sha256: Digest
    state: ProviderResourcePhysicalStateV1
  }>
  next_cursor?: string
}

export interface ManagedProviderAdapterV1 {
  descriptor(): Promise<AdapterDescriptorV1>
  create_inert(
    ctx: AdapterCallContextV1,
    spec: AdapterSandboxSpecV1,
    op: ProviderOperationV1,
    allocationKey: Digest,
  ): Promise<OwnedProviderHandleV1>
  activate(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    authorization: ActivationDispatchAuthorizationV1,
    op: ProviderOperationV1,
  ): Promise<ActivationReceiptV1>
  inspect(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<AdapterObservationV1>
  start_exec(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    spec: ExecSpecV1,
    op: ProviderOperationV1,
  ): Promise<AdapterExecHandleV1>
  stream_exec(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    exec: AdapterExecHandleV1,
    op: ProviderOperationV1,
    maxBytes: number,
  ): AsyncIterable<AdapterExecStreamFrameV1>
  cancel_exec(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    exec: AdapterExecHandleV1,
    op: ProviderOperationV1,
  ): Promise<CancelObservationV1>
  stat_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    path: WorkspacePath,
    op: ProviderOperationV1,
  ): Promise<FileStatV1>
  read_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileReadV1,
    op: ProviderOperationV1,
  ): AsyncIterable<ByteChunkV1>
  write_file(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileWriteV1,
    op: ProviderOperationV1,
  ): Promise<FileWriteReceiptV1>
  list_files(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    request: FileListV1,
    op: ProviderOperationV1,
  ): Promise<FilePageV1>
  checkpoint_hint(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<CheckpointHintObservationV1>
  expire(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<ExpireObservationV1>
  quarantine(
    ctx: AdapterCallContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<QuarantineObservationV1>
  destroy(
    ctx: DestroyContextV1,
    handle: OwnedProviderHandleV1,
    op: ProviderOperationV1,
  ): Promise<DestroyObservationV1>
  lookup_operation(
    ctx: ReconcileContextV1,
    target: ProviderEffectTargetV1,
    handle?: OwnedProviderHandleV1,
  ): Promise<ProviderOperationObservationV1>
  list_owned_resources(ctx: ReconcileContextV1, cursor?: string): Promise<OwnedResourcePageV1>
  reconcile_inventory(
    ctx: AdapterCallContextV1,
    knownFingerprints: ReadonlyMap<Digest, string>,
  ): Promise<InventoryReconciliationV1>
}
