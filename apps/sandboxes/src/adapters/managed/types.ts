export type Digest = `sha256:${string}`

export type ManagedProviderIdV1 = "e2b" | "daytona_cloud"

export type ProviderOperationNameV1 =
  | "create_inert"
  | "activate"
  | "inspect"
  | "exec_start"
  | "exec_cancel"
  | "file_stat"
  | "file_read"
  | "file_write"
  | "file_list"
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
  provider_creation_token_sha256: Digest
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

export type ProviderOutcomeKindV1 = "succeeded" | "failed_effect" | "failed_no_effect" | "reconciliation_blocked"

export interface JournalRecordV1 {
  schema_version: "sandboxes.effect-journal/v1"
  outcome_schema_version: "infinity.effect-journal-outcome/v1"
  outcome_schema_sha256: Digest
  outcome_kind: ProviderOutcomeKindV1 | null
  provider_receipt_sha256: Digest | null
  semantic_step: ProviderOperationNameV1
  operation_id: string
  operation_step_id: string
  operation_execution_epoch: bigint
  record_kind: "DISPATCHED" | "READ_PROBE" | "OUTCOME"
  resource_id: string
  resource_lifecycle_generation: bigint
  provider_idempotency_token_sha256: Digest
  provider_creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  operation_digest: Digest
  request_sha256: Digest
  idempotency_key_sha256: Digest
  deadline: string
  target_sha256: Digest
  fence_sha256: Digest
  generation_transition_sha256: Digest
  authorization_binding_sha256: Digest
  payload_sha256: Digest
}

export interface JournalAnchorReceiptV1 {
  anchor_schema_version: "infinity.effect-journal-anchor/v1"
  journal_sequence: bigint
  prior_frontier_digest: Digest
  record_digest: Digest
  frontier_digest: Digest
  signer_principal: string
  signing_key_id: string
  signature: string
  record: JournalRecordV1
}

export interface FailedNoEffectAuthorizationV1 {
  schema_version: "sandboxes.failed-no-effect/v1"
  outcome_kind: "failed_no_effect"
  previous_operation_execution_epoch: bigint
  successor_operation_execution_epoch: bigint
  target_sha256: Digest
  request_sha256: Digest
  resource_id: string
  provider_idempotency_token_sha256: Digest
  provider_creation_token_sha256: Digest
  operation_digest: Digest
  prior_outcome_anchor_sha256: Digest
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
  invocation_anchor: JournalAnchorReceiptV1
  authorization_binding_sha256: Digest
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
  generation_transition?: ResourceGenerationTransitionV1
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

export interface SandboxSpecV1 {
  schema_version: "sandboxes.runtime/v1"
  run_id: string
  attempt_id: string
  source: {
    repository_ref: string
    commit_sha: string
    source_bundle_sha256: Digest
  }
  environment: {
    image_or_snapshot_sha256: Digest
    toolchain_manifest_sha256: Digest
  }
  runtime_class: "strong_vm"
  architecture: "arm64" | "amd64"
  workspace_root: "/workspace"
  network_policy: NetworkPolicyV1
  resources: {
    cpu_millis: number
    memory_bytes: number
    disk_bytes: number
    pids: number
    open_files: number
    output_bytes: number
  }
  exec_concurrency: number
  max_runtime_ms: number
  expires_at: string
  data_class: "public" | "internal_non_sensitive" | "restricted"
  input_bundle_refs: Array<{ sha256: Digest; size_bytes: number }>
}

export type AdapterSandboxSpecV1 = SandboxSpecV1

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

export type ProviderRuntimeStateV1 = "paused" | "stopped" | "active" | "unknown"

export interface ProviderOwnershipObservationV1 {
  installation_id_sha256: Digest
  provider_scope_ref_sha256: Digest
  ownership_nonce_sha256: Digest
}

export interface AdapterProviderResourceV1 {
  opaque_resource_id: string
  provider_creation_token_sha256: Digest
  immutable_fingerprint_sha256: Digest
  provider_created_at: string
  provider_resource_version: string
  state: ProviderResourcePhysicalStateV1
  provider_runtime_state: ProviderRuntimeStateV1
  network_policy: NetworkPolicyObservationV1
  auto_delete_disabled: boolean
  ephemeral: boolean
  owned: boolean
  source_attached: boolean
  credential_attached: boolean
  guest_broker_bootstrapped: boolean
  ownership: ProviderOwnershipObservationV1
}

export interface ProviderResourcePageV1 {
  items: AdapterProviderResourceV1[]
  next_cursor?: string
}

export interface ProviderCapabilitiesV1 {
  exact_creation_token_lookup: boolean
  create_stopped: boolean
  creation_metadata_labels: boolean
  network_policy_readback: boolean
  typed_argv_exec: boolean
  fixed_bootstrap_broker: boolean
  typed_broker_frames: boolean
  idempotent_activation_continuation: boolean
  native_bounded_files: boolean
  atomic_file_write: boolean
  whole_guest_cancel: boolean
  non_destructive_pause: boolean
  stop_preserves_filesystem: boolean
  conditional_destroy: boolean
  locked_destroy_compensation: boolean
  ownership_inventory: boolean
}

export interface ExecInputObjectV1 {
  object_sha256: Digest
  object_version: string
  size_bytes: number
  resource_scope_sha256: Digest
  input_authorization_receipt_sha256: Digest
}

export interface ExecSpecV1 {
  schema_version: "sandboxes.exec-spec/v1"
  executable: string
  argv: string[]
  cwd: WorkspacePath | ""
  workspace_access: "read_only" | "write"
  stdin_object?: ExecInputObjectV1
  environment_profile_id: "minimal-v1" | "build-v1" | "test-v1"
  environment_profile_sha256: Digest
  wall_deadline: string
  idle_timeout_ms: number
  output_limit_bytes: number
  process_limit: number
  tty: false
}

export type ManagedGuestBrokerBootstrapCommandV1 = "/opt/hasna/bin/sandboxes-broker-v1 --stdio"

export interface GuestBrokerAttestationV1 {
  schema_version: "sandboxes.guest-broker-attestation/v1"
  immutable_fingerprint_sha256: Digest
  bootstrap_command_sha256: Digest
  protocol_sha256: Digest
  provider_session_binding_sha256: Digest
  attested_at: string
}

export interface ProviderActivationOutcomeV1 {
  resource: AdapterProviderResourceV1
  network_policy: NetworkPolicyObservationV1
  guest_broker: GuestBrokerAttestationV1
}

export type GuestBrokerRequestV1 =
  | { operation: "exec_start"; spec: ExecSpecV1 }
  | { operation: "exec_cancel"; exec: ProviderExecHandleV1 }
  | { operation: "file_stat"; path: WorkspacePath }
  | { operation: "file_read"; request: FileReadV1 }
  | { operation: "file_write"; request: FileWriteV1 }
  | { operation: "file_list"; request: FileListV1 }

export interface GuestBrokerRequestFrameV1 {
  schema_version: "sandboxes.guest-broker-frame/v1"
  operation: GuestBrokerRequestV1["operation"]
  immutable_fingerprint_sha256: Digest
  target_sha256: Digest
  fence_sha256: Digest
  request_sha256: Digest
  provider_idempotency_token_sha256: Digest
  operation_execution_epoch: bigint
  protocol_sha256: Digest
  provider_session_binding_sha256: Digest
  frame_nonce_sha256: Digest
  payload_sha256: Digest
  frame_sha256: Digest
  authentication_tag_sha256: Digest
  payload_bytes: Uint8Array
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
  total_file_sha256: Digest
  file_revision: bigint
}

export interface ProviderFileReadChunkV1 {
  bytes: Uint8Array
  total_file_sha256: Digest
  file_revision: bigint
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

export type ManagedProviderRequestV1 =
  | { operation: "create_inert"; spec: AdapterSandboxSpecV1; allocation_key_sha256: Digest }
  | { operation: "activate"; authorization: ActivationDispatchAuthorizationV1 }
  | { operation: "inspect" }
  | { operation: "exec_start"; spec: ExecSpecV1 }
  | { operation: "exec_cancel"; exec_fingerprint_sha256: Digest }
  | { operation: "file_stat"; path: WorkspacePath }
  | { operation: "file_read"; request: FileReadV1 }
  | { operation: "file_write"; request: FileWriteV1 }
  | { operation: "file_list"; request: FileListV1 }
  | { operation: "expire" }
  | { operation: "quarantine" }
  | { operation: "destroy"; cleanup_grant_sha256: Digest; cleanup_basis_sha256: Digest }

export interface FilePageV1 {
  items: Array<{
    path: WorkspacePath
    type: "file" | "directory" | "symlink"
  }>
  next_cursor?: string
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
  guest_broker_attestation_sha256: Digest
  generation_transition_sha256: Digest
  provider_receipt_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export interface ExpireObservationV1 {
  observation: "safety_stopped"
  immutable_fingerprint_sha256: Digest
  generation_transition_sha256: Digest
  provider_receipt_sha256: Digest
  provider_outcome_anchor_sha256: Digest
}

export type QuarantineObservationV1 = ExpireObservationV1

export interface DestroyObservationV1 {
  terminal_condition: "verified_absent"
  immutable_fingerprint_sha256: Digest
  generation_transition_sha256: Digest
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
  live_capability_evidence_verified: boolean
  mandatory_capability_claims: {
    strong_vm: boolean
    outside_guest_network_enforcement: boolean
    whole_guest_cancel: boolean
    atomic_bounded_files: boolean
    ownership_reconciliation: boolean
    destructive_semantics: boolean
  }
  provider_results_are_canonical_state: false
  provider_snapshot_is_canonical_checkpoint: false
}

export interface ProviderAdmissionV1 {
  admitted: boolean
  evidence_sha256: Digest
  exact_sdk_version: string
  evidence_kind: "live_conformance" | "hermetic_conformance"
}

export interface ReadRetryPolicyV1 {
  max_attempts: number
  base_delay_ms: number
  max_delay_ms: number
}

export type ProviderEffectGuardPhaseV1 =
  | "after_anchor"
  | "before_provider_read"
  | "before_provider_mutation"

export interface AdapterEffectGuardPortV1 {
  assertCurrent(
    ctx: AdapterCallContextV1,
    operation: ProviderOperationV1,
    phase: ProviderEffectGuardPhaseV1,
  ): Promise<void>
}

/** Trusted distributed serialization for one immutable sandbox lifecycle. */
export interface AdapterLifecycleLockPortV1 {
  withLock<T>(lifecycleKeySha256: Digest, use: () => Promise<T>): Promise<T>
}

/** Trusted cryptographic/frontier verification for externally anchored records. */
export interface AdapterJournalAnchorVerifierPortV1 {
  /** Includes signature, contiguous frontier, and any prior failed-no-effect outcome proof. */
  assertVerified(ctx: AdapterCallContextV1, operation: ProviderOperationV1): Promise<void>
}

/** Independent signature/frontier verification for a just-appended OUTCOME envelope. */
export interface AdapterOutcomeAnchorVerifierPortV1 {
  assertVerified(receipt: JournalAnchorReceiptV1, expected: JournalRecordV1): Promise<void>
}

export interface AdapterAdmissionVerifierPortV1 {
  assertAdmitted(request: {
    provider: ManagedProviderIdV1
    sdk_version: string
    adapter_build_sha256: Digest
    evidence_sha256: Digest
    evidence_kind: ProviderAdmissionV1["evidence_kind"]
  }): Promise<void>
}

export type PhysicalSafetyFenceReasonV1 =
  | "provider_effect_ambiguous"
  | "output_limit"
  | "whole_guest_cancel_unproven"

export interface AdapterPhysicalSafetyGatePortV1 {
  assertOpen(ctx: AdapterCallContextV1, operation: ProviderOperationV1): Promise<void>
  contain(
    ctx: AdapterCallContextV1,
    operation: ProviderOperationV1,
    reason: PhysicalSafetyFenceReasonV1,
  ): Promise<void>
}

export interface AdapterNetworkPolicyVerifierPortV1 {
  assertAuthorized(
    ctx: AdapterCallContextV1,
    operation: ProviderOperationV1,
    observation: NetworkPolicyObservationV1,
  ): Promise<void>
}

/** Trusted holder of a broker-session MAC key; key bytes never enter DTOs or the guest task. */
export interface AdapterGuestBrokerAuthenticatorPortV1 {
  authenticate(input: {
    frame_sha256: Digest
    protocol_sha256: Digest
    provider_session_binding_sha256: Digest
    frame_nonce_sha256: Digest
  }): Digest
}

export interface ManagedAdapterDependenciesV1 {
  credential_port: ManagedProviderCredentialPortV1
  installation_id: string
  provider_scope_ref: string
  adapter_version: string
  adapter_build_sha256: Digest
  admission: ProviderAdmissionV1
  read_retry_policy: ReadRetryPolicyV1
  effect_guard: AdapterEffectGuardPortV1
  lifecycle_lock: AdapterLifecycleLockPortV1
  journal_anchor_verifier: AdapterJournalAnchorVerifierPortV1
  outcome_journal: OutcomeJournalPortV1
  outcome_anchor_verifier: AdapterOutcomeAnchorVerifierPortV1
  admission_verifier: AdapterAdmissionVerifierPortV1
  physical_safety_gate: AdapterPhysicalSafetyGatePortV1
  network_policy_verifier: AdapterNetworkPolicyVerifierPortV1
  guest_broker_authenticator: AdapterGuestBrokerAuthenticatorPortV1
}

export interface ManagedProviderControlPortV1 {
  readonly provider_id: ManagedProviderIdV1
  readonly capabilities: ProviderCapabilitiesV1
  findByCreationToken(token: Digest, cursor?: string): Promise<ProviderResourcePageV1>
  createInert(request: ProviderCreateInertRequestV1): Promise<AdapterProviderResourceV1>
  inspectResource(opaqueResourceId: string): Promise<AdapterProviderResourceV1 | "absent">
  applyNetworkPolicy(opaqueResourceId: string, policy: NetworkPolicyV1, target: ProviderEffectTargetV1): Promise<NetworkPolicyObservationV1>
  activateResource(opaqueResourceId: string, target: ProviderEffectTargetV1): Promise<AdapterProviderResourceV1>
  pauseOrStopResource(opaqueResourceId: string, target: ProviderEffectTargetV1): Promise<AdapterProviderResourceV1>
  destroyResource(opaqueResourceId: string, expectedVersion: string, target: ProviderEffectTargetV1): Promise<void>
  bootstrapGuestBroker(
    opaqueResourceId: string,
    command: ManagedGuestBrokerBootstrapCommandV1,
    expectedFingerprint: Digest,
    target: ProviderEffectTargetV1,
  ): Promise<GuestBrokerAttestationV1>
  inspectGuestBroker(opaqueResourceId: string): Promise<GuestBrokerAttestationV1 | "absent">
  activateCompensated(
    opaqueResourceId: string,
    policy: NetworkPolicyV1,
    command: ManagedGuestBrokerBootstrapCommandV1,
    expectedFingerprint: Digest,
    target: ProviderEffectTargetV1,
  ): Promise<ProviderActivationOutcomeV1>
  startExec(
    opaqueResourceId: string,
    broker: GuestBrokerAttestationV1,
    frame: GuestBrokerRequestFrameV1,
    target: ProviderEffectTargetV1,
  ): Promise<ProviderExecHandleV1>
  cancelExec(
    opaqueResourceId: string,
    broker: GuestBrokerAttestationV1,
    frame: GuestBrokerRequestFrameV1,
    target: ProviderEffectTargetV1,
  ): Promise<{ whole_guest_scope_terminated: boolean }>
  statFile(opaqueResourceId: string, broker: GuestBrokerAttestationV1, frame: GuestBrokerRequestFrameV1): Promise<FileStatV1>
  readFile(opaqueResourceId: string, broker: GuestBrokerAttestationV1, frame: GuestBrokerRequestFrameV1): AsyncIterable<ProviderFileReadChunkV1>
  writeFileAtomic(opaqueResourceId: string, broker: GuestBrokerAttestationV1, frame: GuestBrokerRequestFrameV1, target: ProviderEffectTargetV1): Promise<FileWriteReceiptV1>
  listFiles(opaqueResourceId: string, broker: GuestBrokerAttestationV1, frame: GuestBrokerRequestFrameV1): Promise<FilePageV1>
  lookupOperation(target: ProviderEffectTargetV1): Promise<ProviderMutationOutcomeV1>
  listOwnedResources(cursor?: string): Promise<ProviderResourcePageV1>
}

export interface ManagedProviderCredentialPortV1 {
  withAuthenticatedClient<T>(
    provider: ManagedProviderIdV1,
    use: (client: ManagedProviderControlPortV1) => Promise<T>,
  ): Promise<T>
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
}
