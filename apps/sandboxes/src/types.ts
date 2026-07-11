import type { Digest } from "./canonical.js";

export const SCHEMA_VERSION = "sandboxes.runtime/v1" as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

export type SandboxState =
  | "reserved"
  | "creating_inert"
  | "inert"
  | "activating"
  | "active"
  | "expiring"
  | "failed"
  | "lost"
  | "quarantined"
  | "destroying"
  | "cleanup_failed"
  | "destroyed";

export type SandboxStateReason =
  | "reserved_by_authority"
  | "inert_create_dispatched"
  | "inert_receipt_committed"
  | "activation_dispatched"
  | "activation_receipt_committed"
  | "sandbox_expired"
  | "ambiguous_provider_state"
  | "provider_identity_mismatch"
  | "provider_operation_failed"
  | "cleanup_authorized"
  | "cleanup_terminal_absence"
  | "cleanup_unverified";

export interface SandboxSpecV1 {
  schema_version: SchemaVersion;
  run_id: string;
  attempt_id: string;
  source: {
    repository_ref: string;
    commit_sha: string;
    source_bundle_sha256: Digest;
  };
  environment: {
    image_or_snapshot_sha256: Digest;
    toolchain_manifest_sha256: Digest;
  };
  runtime_class: "strong_vm";
  architecture: "arm64" | "amd64";
  workspace_root: "/workspace";
  network_policy: NetworkPolicyV1;
  resources: ResourcePolicyV1;
  exec_concurrency: number;
  max_runtime_ms: number;
  expires_at: string;
  data_class: "public" | "internal_non_sensitive" | "restricted";
  input_bundle_refs: Array<{ sha256: Digest; size_bytes: number }>;
}

export interface NetworkPolicyV1 {
  mode: "deny_all" | "broker_only";
  policy_sha256: Digest;
}

export interface ResourcePolicyV1 {
  cpu_millis: number;
  memory_bytes: number;
  disk_bytes: number;
  pids: number;
  open_files: number;
  output_bytes: number;
}

export interface CanonicalSandboxEffectFenceV1 {
  authority_epoch: bigint;
  route_lineage_id: string;
  route_id: string;
  route_epoch: bigint;
  run_id: string;
  attempt_id: string;
  attempt_lease_id: string;
  lease_epoch: bigint;
  resource_lease_id: string;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  operation_id: string;
  operation_digest: Digest;
  operation_execution_epoch: bigint;
  actor_principal: string;
  lease_holder_principal: string;
  operation_executor_principal: string;
  audience: SchemaVersion;
  issued_at: string;
  lease_expires_at: string;
  operation_execution_expires_at: string;
}

export type SandboxOperation =
  | "begin_create_inert"
  | "record_inert"
  | "begin_activate"
  | "record_active"
  | "expire"
  | "quarantine"
  | "record_failed"
  | "record_lost"
  | "begin_destroy"
  | "record_cleanup_failed"
  | "resume_destroy"
  | "record_destroyed";

/**
 * Provider-neutral task operations authorized by Infinity. Sandboxes consumes
 * these capabilities but never mints their fence, lease, epoch, or nonce.
 */
export type SandboxDataPlaneOperationV1 =
  | "exec.start"
  | "exec.frames.read"
  | "exec.result.read"
  | "exec.cancel"
  | "file.read"
  | "file.write"
  | "file.list"
  | "checkpoint.export_bundle";

export type SandboxAuthorityOperationV1 = SandboxOperation | SandboxDataPlaneOperationV1;

export type ProviderMutationOperationV1 = "create_inert" | "activate" | "expire" | "quarantine" | "destroy";

export interface LifecycleTransitionBindingV1 {
  expected_resource_lifecycle_generation: bigint;
  successor_resource_lifecycle_generation: bigint;
}

export interface SignedEffectJournalAnchorV1<RecordV1> {
  anchor_schema_version: "infinity.effect-journal-anchor/v1";
  journal_sequence: bigint;
  prior_frontier_digest: Digest;
  record_digest: Digest;
  frontier_digest: Digest;
  signer_principal: string;
  signing_key_id: string;
  signature: string;
  record: RecordV1;
}

export interface DispatchedJournalRecordV1 {
  schema_version: SchemaVersion;
  state: "dispatched";
  record_kind: "DISPATCHED";
  outcome_schema_version: "infinity.effect-journal-outcome/v1";
  outcome_schema_digest: Digest;
  operation_id: string;
  operation_step_id: string;
  operation_execution_epoch: bigint;
  operation_digest: Digest;
  resource_id: string;
  authority_epoch: bigint;
  expected_resource_lifecycle_generation: bigint;
  successor_resource_lifecycle_generation: bigint;
  recorded_at: string;
  expires_at: string;
  provider_idempotency_token_sha256: Digest;
  provider_creation_token_sha256: Digest;
  immutable_fingerprint_sha256: Digest;
  authorization_consumption_receipt_sha256: Digest;
  fence: CanonicalSandboxEffectFenceV1;
}

export type DispatchedJournalAnchorV1 =
  SignedEffectJournalAnchorV1<DispatchedJournalRecordV1>;

export interface ReadProbeJournalRecordV1 {
  schema_version: SchemaVersion;
  state: "read_probe";
  operation_id: string;
  operation_step_id: string;
  operation_digest: Digest;
  resource_id: string;
  recorded_at: string;
  expires_at: string;
  fence: CanonicalSandboxEffectFenceV1;
  target: ProviderEffectTargetV1;
  discovery_scope: ProviderDiscoveryScopeV1;
}

export type ReadProbeJournalAnchorV1 =
  SignedEffectJournalAnchorV1<ReadProbeJournalRecordV1>;

export interface ProviderOutcomeRecordFactsV1 {
  schema_version: SchemaVersion;
  record_kind: "OUTCOME";
  outcome_schema_version: "infinity.effect-journal-outcome/v1";
  outcome_schema_digest: Digest;
  operation_id: string;
  operation_step_id: string;
  operation_execution_epoch: bigint;
  dispatch_anchor_sha256: Digest;
  outcome_sha256: Digest;
  recorded_at: string;
  fence: CanonicalSandboxEffectFenceV1;
  target: ProviderEffectTargetV1;
}

export type ProviderOutcomeRecordV1 = ProviderOutcomeRecordFactsV1 & (
  | {
      outcome_kind: "failed_no_effect";
      provider_no_effect_verification_receipt_sha256: Digest;
    }
  | {
      outcome_kind: Exclude<
        import("./effect-journal.js").EffectJournalOutcomeKindV1,
        "failed_no_effect"
      >;
      provider_no_effect_verification_receipt_sha256?: never;
    }
);

export type ProviderOutcomeAnchorV1 =
  SignedEffectJournalAnchorV1<ProviderOutcomeRecordV1>;

export type EffectJournalEnvelopeV1 =
  | DispatchedJournalAnchorV1
  | ProviderOutcomeAnchorV1
  | ReadProbeJournalAnchorV1;

export interface EffectJournalRecoveryRangeV1 {
  schema_version: "infinity.effect-journal-recovery-range/v1";
  operation_id: string;
  operation_step_id: string;
  requested_from_sequence: bigint;
  signed_head_sequence: bigint;
  signed_head_frontier_digest: Digest;
  signer_principal: string;
  signing_key_id: string;
  signature: string;
  complete_operation_envelopes: EffectJournalEnvelopeV1[];
  completeness_proof_sha256: Digest;
}

interface ExternalOperationAnchorRecordBaseV1 {
  schema_version: SchemaVersion;
  operation_id: string;
  operation_step_id: string;
  operation_execution_epoch: bigint;
  journal_sequence: bigint;
  prior_frontier_digest: Digest;
  record_digest: Digest;
  frontier_digest: Digest;
  envelope_digest: Digest;
  recorded_at: string;
}

export type ExternalMutationAnchorRecordV1 =
  | (ExternalOperationAnchorRecordBaseV1 & {
      record_kind: "DISPATCHED";
      outcome_schema_version: "infinity.effect-journal-outcome/v1";
      outcome_schema_digest: Digest;
    })
  | (ExternalOperationAnchorRecordBaseV1 & {
      record_kind: "OUTCOME";
      outcome_schema_version: "infinity.effect-journal-outcome/v1";
      outcome_schema_digest: Digest;
      outcome_kind: ProviderOutcomeAnchorV1["record"]["outcome_kind"];
    });

export type ExternalReadProbeAnchorRecordV1 =
  ExternalOperationAnchorRecordBaseV1 & {
    anchor_kind: "READ_PROBE";
  };

export type ExternalOperationAnchorRecordV1 =
  | ExternalMutationAnchorRecordV1
  | ExternalReadProbeAnchorRecordV1;

export interface CapabilitySenderProofV1 {
  schema_version: "infinity.capability-sender-proof/v1";
  sender_principal: string;
  confirmation_key_id: string;
  transport_session_sha256: Digest;
  proof_nonce_sha256: Digest;
  issued_at: string;
  proof_sha256: Digest;
  signature: string;
}

export interface CapabilityTargetV1 {
  schema_version: "infinity.capability-target/v1";
  operation: SandboxAuthorityOperationV1;
  operation_id: string;
  operation_step_id: string;
  resource_id: string;
  request_sha256: Digest;
  idempotency_key_sha256: Digest;
  expected_revision: number;
  handle_sha256: Digest | null;
  fence_sha256: Digest;
  target_sha256: Digest;
}

export interface CapabilityConstraintsV1 {
  schema_version: "infinity.capability-constraints/v1";
  not_before: string;
  expires_at: string;
  use_mode: "once";
  max_uses: 1;
  constraints_sha256: Digest;
}

export interface AuthorizationConsumptionReceiptV1 {
  schema_version: "infinity.authorization-consumption-receipt/v1";
  receipt_id: string;
  capability_sha256: Digest;
  use_nonce_sha256: Digest;
  operation_id: string;
  operation_step_id: string;
  target_sha256: Digest;
  fence_sha256: Digest;
  consumer_principal: string;
  transaction_id: string;
  commit_sequence: bigint;
  use_ordinal: 1;
  max_uses: 1;
  committed_at: string;
  issuer_principal: string;
  signing_key_id: string;
  receipt_sha256: Digest;
  signature: string;
}

export interface AuthorizationConsumptionReceiptSetV1 {
  schema_version: "infinity.authorization-consumption-set/v1";
  capability_sha256: Digest;
  operation_id: string;
  operation_step_id: string;
  target_sha256: Digest;
  fence_sha256: Digest;
  consumer_principal: string;
  first_commit_sequence: bigint;
  last_commit_sequence: bigint;
  receipts: [AuthorizationConsumptionReceiptV1];
  set_sha256: Digest;
  issuer_principal: string;
  signing_key_id: string;
  signature: string;
}

export interface CapabilityClaimsV1 {
  schema_version: SchemaVersion;
  capability_id: string;
  use_nonce_sha256: Digest;
  operation: SandboxAuthorityOperationV1;
  target_resource_id: string;
  request_sha256: Digest;
  idempotency_key_sha256: Digest;
  expected_revision: number;
  /** Required for bounded data-plane calls; forbidden for lifecycle calls. */
  handle_sha256?: Digest;
  fence: CanonicalSandboxEffectFenceV1;
  not_before: string;
  expires_at: string;
  issuer_principal: string;
  subject_principal: string;
  audience: SchemaVersion;
  sender_proof: CapabilitySenderProofV1;
  target: CapabilityTargetV1;
  constraints: CapabilityConstraintsV1;
  use_mode: "once";
  max_uses: 1;
  authorization_consumption_set: AuthorizationConsumptionReceiptSetV1;
  capability_sha256: Digest;
  signing_key_id: string;
  signature: string;
}

export interface LifecycleCommandContextV1 {
  operation_id: string;
  idempotency_key_sha256: Digest;
  request_sha256: Digest;
  expected_revision: number;
  transition: LifecycleTransitionBindingV1;
  fence: CanonicalSandboxEffectFenceV1;
  capability: CapabilityClaimsV1;
}

export interface MutationContextV1 extends LifecycleCommandContextV1 {
  dispatch_journal: DispatchedJournalAnchorV1;
}

export interface PendingProviderOutcomeV1 {
  source_operation_id: string;
  target_state: "inert" | "active" | "failed" | "cleanup_failed" | "destroyed";
  evidence_sha256: Digest;
  provider_receipt_sha256: Digest;
  observed_at: string;
  terminal_disposition?:
    | "destroyed_after_checkpoint"
    | "destroyed_after_promotion"
    | "discarded_uncheckpointed";
}

export interface SafetyFenceObservationV1 {
  schema_version: "sandboxes.safety-fence/v1";
  resource_id: string;
  resource_lifecycle_generation: bigint;
  reason:
    | "lease_uncertain"
    | "deadline"
    | "cost_alarm"
    | "provider_ambiguous"
    | "containment_failure";
  installed_policy_sha256: Digest;
  process_stop_evidence_sha256: Digest;
  network_close_evidence_sha256: Digest;
  observed_at: string;
  signer_principal: string;
}

export interface StoredSafetyFenceObservationV1 {
  schema_version: SchemaVersion;
  observation_id: string;
  resource_id: string;
  observation_sha256: Digest;
  observation: SafetyFenceObservationV1;
  recorded_at: string;
}

export interface SandboxDestroyTombstoneV1 {
  schema_version: "sandboxes.destroy-tombstone/v1";
  tombstone_id: string;
  resource_id: string;
  destroy_operation_id: string;
  record_operation_id: string;
  expected_resource_lifecycle_generation: bigint;
  destroy_resource_lifecycle_generation: bigint;
  terminal_resource_lifecycle_generation: bigint;
  adapter_descriptor_sha256: Digest;
  provider_handle_sha256: Digest;
  cleanup_grant_sha256: Digest;
  cleanup_basis_kind: CleanupBasisV1["kind"];
  cleanup_basis_receipt_sha256: Digest;
  provider_outcome_anchor_sha256: Digest;
  provider_receipt_sha256: Digest;
  terminal_disposition:
    | "destroyed_after_checkpoint"
    | "destroyed_after_promotion"
    | "discarded_uncheckpointed";
  destroy_fence: CanonicalSandboxEffectFenceV1;
  record_fence: CanonicalSandboxEffectFenceV1;
  destroyed_at: string;
  tombstone_sha256: Digest;
}

export interface CreateSandboxV1 {
  schema_version: SchemaVersion;
  resource_id: string;
  allocation_key_sha256: Digest;
  spec: SandboxSpecV1;
}

export interface ActivationGrantV1 {
  schema_version: SchemaVersion;
  grant_id: string;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  successor_resource_lifecycle_generation: bigint;
  operation_id: string;
  operation_digest: Digest;
  network_policy_sha256: Digest;
  expires_at: string;
  one_use_nonce_sha256: Digest;
}

export interface CleanupBasisV1 {
  kind: "checkpoint_durable" | "git_promotion" | "discard_uncheckpointed";
  receipt_sha256: Digest;
  recovery_checkpoint_attempted?: true;
  promotion_grants_revoked?: true;
  permanent_outcome?: "discarded_uncheckpointed";
}

export interface InfinityCleanupGrantV1 {
  schema_version: SchemaVersion;
  grant_id: string;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  successor_resource_lifecycle_generation: bigint;
  provider_handle_sha256: Digest;
  operation_id: string;
  operation_digest: Digest;
  cleanup_executor_principal: string;
  basis: CleanupBasisV1;
  expires_at: string;
  one_use_nonce_sha256: Digest;
}

export interface CheckpointDurabilityReceiptV1 {
  schema_version: SchemaVersion;
  receipt_id: string;
  checkpoint_id: string;
  checkpoint_root_sha256: Digest;
  storage_version: string;
  resource_id: string;
  run_id: string;
  attempt_id: string;
  fence: CanonicalSandboxEffectFenceV1;
  durable_at: string;
  issuer_principal: string;
  receipt_sha256: Digest;
}

export interface GitPromotionReceiptRefV1 {
  schema_version: SchemaVersion;
  receipt_id: string;
  resource_id: string;
  run_id: string;
  attempt_id: string;
  resource_lifecycle_generation: bigint;
  fence: CanonicalSandboxEffectFenceV1;
  receipt_sha256: Digest;
  checkpoint_root_sha256: Digest;
  expected_base_sha256: Digest;
  promoted_at: string;
}

export interface SandboxV1 {
  schema_version: SchemaVersion;
  id: string;
  resource_id: string;
  revision: number;
  spec_sha256: Digest;
  spec: SandboxSpecV1;
  state: SandboxState;
  state_reason_code: SandboxStateReason;
  physical_safety_state: "clear" | "fenced";
  physical_safety_reason?:
    | "ttl_expired"
    | "provider_ambiguous"
    | "provider_identity_mismatch"
    | "provider_loss";
  safety_observation_id?: string;
  safety_fence_receipt_sha256?: Digest;
  canonical_transition_required?: "quarantined";
  authority_epoch: bigint;
  route_lineage_id: string;
  route_id: string;
  route_epoch: bigint;
  run_id: string;
  attempt_id: string;
  attempt_lease_id: string;
  lease_epoch: bigint;
  resource_lease_id: string;
  resource_lifecycle_generation: bigint;
  operation_execution_epoch: bigint;
  actor_principal: string;
  lease_holder_principal: string;
  operation_executor_principal: string;
  audience: SchemaVersion;
  runtime_class: "strong_vm";
  adapter_descriptor_sha256: Digest;
  /** Exact closed descriptor bytes admitted before the first durable intent. */
  adapter_descriptor: AdapterDescriptorV1;
  adapter_admission_receipt_sha256: Digest;
  provider_creation_token_sha256: Digest;
  provider_identity_sha256?: Digest;
  provider_handle_sha256?: Digest;
  create_inert_operation_id: string;
  activation_operation_id?: string;
  immutable_fingerprint_sha256?: Digest;
  pending_provider_outcome?: PendingProviderOutcomeV1;
  durable_checkpoint_receipt_sha256: Digest[];
  git_promotion_receipt_sha256: Digest[];
  created_at: string;
  allocated_at?: string;
  expires_at: string;
  destroyed_at?: string;
  terminal_disposition?: "destroyed_after_checkpoint" | "destroyed_after_promotion" | "discarded_uncheckpointed";
}

/** Safe public reference to the exact sealed provider incarnation. */
export interface SandboxHandleRefV1 {
  schema_version: "sandboxes.handle-ref/v1";
  resource_id: string;
  resource_lease_id: string;
  resource_lifecycle_generation: bigint;
  provider_handle_sha256: Digest;
  provider_identity_sha256: Digest;
  immutable_fingerprint_sha256: Digest;
}

/**
 * Caller-supplied operation context. The verifier authenticates the protected
 * principals; the repository atomically consumes the one-use capability.
 */
export interface BoundedOperationContextV1 {
  operation_id: string;
  idempotency_key_sha256: Digest;
  request_sha256: Digest;
  expected_revision: number;
  fence: CanonicalSandboxEffectFenceV1;
  capability: CapabilityClaimsV1;
}

export interface AuthorizedBoundedCallContextV1 {
  schema_version: "sandboxes.authorized-bounded-call/v1";
  operation: SandboxDataPlaneOperationV1;
  operation_id: string;
  request_sha256: Digest;
  authorization_consumption_set_sha256: Digest;
  handle: SandboxHandleRefV1;
  fence: CanonicalSandboxEffectFenceV1;
  deadline: string;
}

export interface ExecStartRequestV1 {
  schema_version: "sandboxes.exec-start-request/v1";
  handle: SandboxHandleRefV1;
  exec_id: string;
  executable: string;
  argv: string[];
  cwd: "/workspace";
  environment_profile_id: "minimal-v1" | "build-v1" | "test-v1";
  timeout_ms: number;
  max_output_bytes: number;
  tty: false;
}

export interface ExecStartReceiptV1 {
  schema_version: "sandboxes.exec-start-receipt/v1";
  resource_id: string;
  resource_lifecycle_generation: bigint;
  exec_id: string;
  request_sha256: Digest;
  state: "running";
  initial_cursor: string;
  initial_cursor_sha256: Digest;
  stream_root_sha256: Digest;
  adapter_exec_fingerprint_sha256: Digest;
  started_at: string;
  receipt_sha256: Digest;
}

export interface ExecFrameReadRequestV1 {
  schema_version: "sandboxes.exec-frame-read-request/v1";
  handle: SandboxHandleRefV1;
  exec_id: string;
  cursor: string;
  max_frames: number;
  max_bytes: number;
  wait_ms: number;
}

export interface ExecFrameV1 {
  schema_version: "sandboxes.exec-frame/v1";
  exec_id: string;
  sequence: bigint;
  prior_frame_sha256: Digest;
  kind: "stdout" | "stderr" | "status" | "heartbeat" | "terminal" | "error";
  payload_base64url: string;
  payload_length: number;
  payload_sha256: Digest;
  observed_at: string;
  frame_sha256: Digest;
}

export interface ExecFramePageV1 {
  schema_version: "sandboxes.exec-frame-page/v1";
  exec_id: string;
  from_cursor_sha256: Digest;
  prior_stream_root_sha256: Digest;
  frames: ExecFrameV1[];
  page_frames_root_sha256: Digest;
  next_cursor: string;
  next_cursor_sha256: Digest;
  resume_token_sha256: Digest;
  next_stream_root_sha256: Digest;
  has_more: boolean;
  terminal: boolean;
  gap_detected: false;
  gap_proof_sha256: Digest;
  returned_frames: number;
  returned_bytes: number;
  receipt_sha256: Digest;
}

export interface ExecResultRequestV1 {
  schema_version: "sandboxes.exec-result-request/v1";
  handle: SandboxHandleRefV1;
  exec_id: string;
}

export interface ExecResultV1 {
  schema_version: "sandboxes.exec-result/v1";
  resource_id: string;
  resource_lifecycle_generation: bigint;
  exec_id: string;
  state: "running" | "succeeded" | "failed" | "canceled" | "timed_out" | "output_limited";
  exit_code: number | null;
  stdout_sha256: Digest;
  stderr_sha256: Digest;
  output_bytes: number;
  final_stream_root_sha256: Digest;
  terminal_at: string | null;
  receipt_sha256: Digest;
}

export interface ExecCancelRequestV1 {
  schema_version: "sandboxes.exec-cancel-request/v1";
  handle: SandboxHandleRefV1;
  exec_id: string;
  reason: "explicit" | "wall_deadline" | "idle_deadline" | "output_limit" | "lease_loss";
  grace_ms: number;
}

export interface ExecCancelReceiptV1 {
  schema_version: "sandboxes.exec-cancel-receipt/v1";
  resource_id: string;
  resource_lifecycle_generation: bigint;
  exec_id: string;
  state: "canceled" | "already_terminal";
  whole_scope_terminated: boolean;
  process_stop_evidence_sha256: Digest;
  observed_at: string;
  receipt_sha256: Digest;
}

export interface FileReadRequestV1 {
  schema_version: "sandboxes.file-read-request/v1";
  handle: SandboxHandleRefV1;
  path: string;
  offset_bytes: number;
  length_bytes: number;
  expected_file_sha256: Digest;
}

export interface FileReadReceiptV1 {
  schema_version: "sandboxes.file-read-receipt/v1";
  resource_id: string;
  resource_lifecycle_generation: bigint;
  workspace_revision: bigint;
  path: string;
  offset_bytes: number;
  content_base64url: string;
  returned_bytes: number;
  content_sha256: Digest;
  total_file_sha256: Digest;
  range_proof_sha256: Digest;
  file_revision_sha256: Digest;
  receipt_sha256: Digest;
}

export interface FileWriteRequestV1 {
  schema_version: "sandboxes.file-write-request/v1";
  handle: SandboxHandleRefV1;
  path: string;
  expected_prior_sha256: Digest | null;
  content_base64url: string;
  content_sha256: Digest;
  max_bytes: number;
}

export interface FileWriteReceiptV1 {
  schema_version: "sandboxes.file-write-receipt/v1";
  resource_id: string;
  resource_lifecycle_generation: bigint;
  workspace_revision_before: bigint;
  workspace_revision_after: bigint;
  path: string;
  prior_sha256: Digest | null;
  content_sha256: Digest;
  byte_length: number;
  file_revision_sha256: Digest;
  receipt_sha256: Digest;
}

export interface FileListRequestV1 {
  schema_version: "sandboxes.file-list-request/v1";
  handle: SandboxHandleRefV1;
  root: string;
  recursive: boolean;
  cursor: string | null;
  limit: number;
}

export interface FileListEntryV1 {
  path: string;
  type: "file";
  size_bytes: number;
  content_sha256: Digest;
  file_revision_sha256: Digest;
}

export interface FileListPageV1 {
  schema_version: "sandboxes.file-list-page/v1";
  resource_id: string;
  resource_lifecycle_generation: bigint;
  workspace_revision: bigint;
  snapshot_sha256: Digest;
  entries: FileListEntryV1[];
  next_cursor: string | null;
  receipt_sha256: Digest;
}

export interface CheckpointExportRequestV1 {
  schema_version: "sandboxes.checkpoint-export-request/v1";
  handle: SandboxHandleRefV1;
  checkpoint_id: string;
  expected_workspace_revision: bigint;
  allowed_paths: string[];
  maximum_bundle_bytes: number;
  sink_descriptor_sha256: Digest;
  capture_mode: "quiesced";
  capture_grant: CheckpointCaptureGrantV1;
}

export interface CheckpointCaptureGrantV1 {
  schema_version: "sandboxes.checkpoint-capture-grant/v1";
  grant_id: string;
  checkpoint_id: string;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  operation_id: string;
  handle_sha256: Digest;
  expected_workspace_revision: bigint;
  allowed_paths_sha256: Digest;
  maximum_bundle_bytes: number;
  sink_descriptor_sha256: Digest;
  not_before: string;
  expires_at: string;
  one_use_nonce_sha256: Digest;
  issuer_principal: string;
  signing_key_id: string;
  grant_sha256: Digest;
  signature: string;
}

export interface CheckpointQuiescenceReceiptV1 {
  schema_version: "sandboxes.checkpoint-quiescence-receipt/v1";
  checkpoint_id: string;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  workspace_revision: bigint;
  active_exec_count: 0;
  capture_grant_sha256: Digest;
  final_authorization_receipt_sha256: Digest;
  quiesced_at: string;
  receipt_sha256: Digest;
}

export interface CheckpointSinkCommitReceiptV1 {
  schema_version: "sandboxes.checkpoint-sink-commit-receipt/v1";
  checkpoint_id: string;
  sink_descriptor_sha256: Digest;
  manifest_blob_sha256: Digest;
  bundle_sha256: Digest;
  bundle_byte_length: number;
  storage_version: string;
  committed_at: string;
  issuer_principal: string;
  signing_key_id: string;
  receipt_sha256: Digest;
  signature: string;
}

/** Candidate bytes only; Infinity separately seals durable checkpoint policy. */
export interface CheckpointExportHandoffV1 {
  schema_version: "sandboxes.checkpoint-export-handoff/v1";
  handoff_id: string;
  checkpoint_id: string;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  workspace_revision: bigint;
  manifest_sha256: Digest;
  workspace_root_sha256: Digest;
  checkpoint_root_sha256: Digest;
  bundle_sha256: Digest;
  bundle_byte_length: number;
  file_count: number;
  fence_sha256: Digest;
  final_authorization_receipt_sha256: Digest;
  capture_grant_sha256: Digest;
  quiescence_receipt: CheckpointQuiescenceReceiptV1;
  quiescence_receipt_sha256: Digest;
  manifest_blob_sha256: Digest;
  sink_descriptor_sha256: Digest;
  sink_commit_receipt: CheckpointSinkCommitReceiptV1;
  sink_commit_receipt_sha256: Digest;
  durability_state: "durable";
  exported_at: string;
  handoff_sha256: Digest;
}

export type BoundedOperationResultV1 =
  | ExecStartReceiptV1
  | ExecFramePageV1
  | ExecResultV1
  | ExecCancelReceiptV1
  | FileReadReceiptV1
  | FileWriteReceiptV1
  | FileListPageV1
  | CheckpointExportHandoffV1;

export interface SandboxesBoundedOperationsV1 {
  startExec(request: ExecStartRequestV1, ctx: BoundedOperationContextV1): Promise<ExecStartReceiptV1>;
  readExecFrames(request: ExecFrameReadRequestV1, ctx: BoundedOperationContextV1): Promise<ExecFramePageV1>;
  readExecResult(request: ExecResultRequestV1, ctx: BoundedOperationContextV1): Promise<ExecResultV1>;
  cancelExec(request: ExecCancelRequestV1, ctx: BoundedOperationContextV1): Promise<ExecCancelReceiptV1>;
  readFile(request: FileReadRequestV1, ctx: BoundedOperationContextV1): Promise<FileReadReceiptV1>;
  writeFile(request: FileWriteRequestV1, ctx: BoundedOperationContextV1): Promise<FileWriteReceiptV1>;
  listFiles(request: FileListRequestV1, ctx: BoundedOperationContextV1): Promise<FileListPageV1>;
  exportCheckpoint(
    request: CheckpointExportRequestV1,
    ctx: BoundedOperationContextV1,
  ): Promise<CheckpointExportHandoffV1>;
}

export interface OwnedProviderHandleV1 {
  schema_version: SchemaVersion;
  adapter_id: "fake" | "e2b" | "daytona_cloud";
  adapter_version: string;
  installation_id: string;
  provider_scope_ref: string;
  resource_kind: string;
  opaque_resource_id: string;
  ownership_nonce: string;
  create_inert_operation_id: string;
  provider_creation_token_sha256: Digest;
  creation_receipt_sha256: Digest;
  provider_created_at: string;
  provider_resource_version: string;
  provider_identity_sha256: Digest;
  immutable_fingerprint_sha256: Digest;
  resource_lease_id: string;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  spec_sha256: Digest;
}

export interface SealedProviderHandleV1 {
  schema_version: "sandboxes.sealed-provider-handle/v1";
  resource_id: string;
  sealed_handle: string;
  provider_handle_sha256: Digest;
  binding_sha256: Digest;
}

export interface ProviderHandleBindingV1 {
  adapter_id: AdapterDescriptorV1["adapter_id"];
  adapter_version: string;
  installation_id: string;
  provider_scope_ref: string;
  resource_id: string;
  resource_lease_id: string;
  resource_lifecycle_generation: bigint;
  provider_creation_token_sha256: Digest;
  immutable_fingerprint_sha256: Digest;
  provider_identity_sha256: Digest;
  spec_sha256: Digest;
}

export interface ProviderOperationV1 {
  operation: ProviderMutationOperationV1 | "inspect";
  target: ProviderEffectTargetV1;
  fence: CanonicalSandboxEffectFenceV1;
  generation_transition?: LifecycleTransitionBindingV1;
  request_sha256: Digest;
  idempotency_key_sha256: Digest;
  external_anchor_kind: "DISPATCHED" | "READ_PROBE";
  external_anchor_receipt_sha256: Digest;
  read_probe_no_effect_receipt_sha256?: Digest;
  deadline: string;
}

export interface ProviderEffectTargetV1 {
  operation_id: string;
  operation_digest: Digest;
  operation_step_id: string;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  provider_idempotency_token_sha256: Digest;
  provider_creation_token_sha256: Digest;
  immutable_fingerprint_sha256: Digest;
  authorization_consumption_receipt_sha256: Digest;
}

export interface ProviderDiscoveryScopeV1 {
  schema_version: "sandboxes.provider-discovery-scope/v1";
  read_kind: "exact_operation_and_owned_resource";
  installation_id: string;
  provider_scope_ref: string;
  resource_id: string;
  provider_creation_token_sha256: Digest;
  immutable_fingerprint_sha256: Digest;
  max_pages: number;
  scope_sha256: Digest;
}

export interface ReadProbeNoEffectReceiptV1 {
  schema_version: "sandboxes.read-probe-no-effect-receipt/v1";
  read_probe_anchor_sha256: Digest;
  operation_id: string;
  operation_step_id: string;
  target_sha256: Digest;
  discovery_scope_sha256: Digest;
  proof_kind: "independent_read_only_no_effect";
  observed_at: string;
  expires_at: string;
  issuer_principal: string;
  signing_key_id: string;
  receipt_sha256: Digest;
  signature: string;
}

export interface ProviderLifecycleLockBindingV1 {
  schema_version: "sandboxes.provider-lifecycle-lock/v1";
  lock_key_sha256: Digest;
  installation_id: string;
  adapter_id: AdapterDescriptorV1["adapter_id"];
  provider_scope_ref: string;
  resource_id: string;
  resource_lease_id: string;
  provider_creation_token_sha256: Digest;
  bound_provider_identity?: {
    opaque_resource_id: string;
    ownership_nonce: string;
    immutable_fingerprint_sha256: Digest;
    provider_resource_version: string;
  };
}

export interface AdapterDescriptorFactsV1 {
  schema_version: SchemaVersion;
  adapter_version: string;
  build_sha256: Digest;
  descriptor_sha256: Digest;
  installation_id: string;
  provider_scope_ref: string;
  runtime_class: "strong_vm";
  supported_architectures: ReadonlyArray<"x86_64" | "arm64">;
  isolation_evidence_sha256: Digest;
  guest_kernel_boundary_evidence_sha256: Digest;
  network_modes: ReadonlyArray<"deny_all" | "broker_only">;
  network_enforcement_evidence_sha256: Digest;
  exact_operation_lookup: boolean;
  inert_create: boolean;
  whole_scope_cancel: boolean;
  native_bounded_files: boolean;
  read_only_workspace_enforcement: "external_read_only_mount";
  atomic_incarnation_bound_delete: boolean;
  ownership_reconciliation: "exact_token_and_incarnation";
  destructive_operation_semantics: "atomic_incarnation_bound_delete";
  provider_hard_ttl_semantics: "stop_only_no_delete";
  output_framing: "bounded_frames_v1";
  max_ttl_ms: number;
  resource_limits: {
    max_processes: number;
    max_memory_bytes: number;
    max_disk_bytes: number;
    max_output_bytes: number;
    max_file_bytes: number;
    max_page_entries: number;
  };
}

export type AdapterDescriptorV1 = AdapterDescriptorFactsV1 & (
  | { adapter_id: "fake"; status: "test_only" }
  | {
      adapter_id: "e2b" | "daytona_cloud";
      status: "pending_conformance" | "admitted";
    }
);

export interface AdapterAdmissionReceiptV1 {
  schema_version: "sandboxes.adapter-admission-receipt/v1";
  registry_id: "sandboxes.managed-v1";
  adapter_id: "e2b" | "daytona_cloud";
  adapter_version: string;
  build_sha256: Digest;
  descriptor_sha256: Digest;
  installation_id: string;
  provider_scope_ref: string;
  status: "admitted";
  conformance_manifest_sha256: Digest;
  issued_at: string;
  expires_at: string;
  issuer_principal: string;
  signing_key_id: string;
  receipt_sha256: Digest;
  signature: string;
}

export interface ProviderNonAcceptanceProofV1 {
  schema_version: "sandboxes.provider-no-effect-proof/v1";
  target: ProviderEffectTargetV1;
  operation_execution_epoch: bigint;
  request_sha256: Digest;
  provider_receipt_sha256: Digest;
  proof_kind: "token_not_accepted" | "conditional_precondition_rejected";
  observed_at: string;
  expires_at: string;
  issuer_principal: string;
  signing_key_id: string;
  proof_sha256: Digest;
  signature: string;
}

export interface ProviderNoEffectVerificationReceiptV1 {
  schema_version: "sandboxes.provider-no-effect-verification-receipt/v1";
  proof_sha256: Digest;
  target_sha256: Digest;
  operation_execution_epoch: bigint;
  request_sha256: Digest;
  provider_receipt_sha256: Digest;
  proof_kind: ProviderNonAcceptanceProofV1["proof_kind"];
  verified_at: string;
  expires_at: string;
  verifier_principal: string;
  signing_key_id: string;
  receipt_sha256: Digest;
}

export interface FinalCurrentnessBarrierReceiptV1 {
  schema_version: "sandboxes.final-currentness-barrier-receipt/v1";
  trace_id: string;
  deadline: string;
  constraints_sha256: Digest;
  fence_sha256: Digest;
  target_sha256: Digest;
  operation_id: string;
  operation_step_id: string;
  operation_execution_epoch: bigint;
  request_sha256: Digest;
  idempotency_key_sha256: Digest;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  dispatch_anchor_sha256: Digest;
  physical_safety_assertion_sha256: Digest;
  current_authorization_receipt_sha256: Digest;
  adapter_descriptor_sha256: Digest;
  adapter_admission_receipt_sha256: Digest;
  adapter_admission_expires_at: string | null;
  provider_handle_sha256: Digest | null;
  grant_expires_at: string | null;
  database_observed_at: string;
  receipt_sha256: Digest;
}

export interface ActivationReceiptV1 {
  schema_version: SchemaVersion;
  receipt_sha256: Digest;
  immutable_fingerprint_sha256: Digest;
  network_policy_sha256: Digest;
  activated_at: string;
}

export interface AdapterObservationV1 {
  state: "inert" | "active" | "absent" | "unknown";
  handle?: OwnedProviderHandleV1;
  immutable_fingerprint_sha256?: Digest;
  provider_resource_version?: string;
}

export interface ExpireObservationV1 {
  state: "inert" | "quarantined" | "unknown";
  receipt_sha256: Digest;
}

export interface DestroyObservationV1 {
  state: "absent" | "still_present" | "unknown";
  provider_receipt_sha256: Digest;
  observed_at: string;
}

export interface ProviderOperationObservationV1 {
  state: "not_sent" | "accepted" | "completed" | "not_found" | "unknown";
  handle?: OwnedProviderHandleV1;
  observation_sha256: Digest;
}

export interface OwnedResourcePageV1 {
  resources: Array<{
    resource_id: string;
    installation_id: string;
    provider_scope_ref: string;
    opaque_resource_id: string;
    ownership_nonce: string;
    provider_creation_token_sha256: Digest;
    immutable_fingerprint_sha256: Digest;
    state: "inert" | "active" | "absent" | "unknown";
  }>;
  next_cursor?: string;
}

export interface OperationRecordV1 {
  schema_version: SchemaVersion;
  operation_id: string;
  operation_step_id?: string;
  operation: SandboxAuthorityOperationV1;
  resource_id: string;
  actor_principal: string;
  idempotency_key_sha256: Digest;
  request_sha256: Digest;
  capability_use_sha256: Digest;
  authorization_consumption_set_sha256: Digest;
  authorization_consumption_set: AuthorizationConsumptionReceiptSetV1;
  dispatch_journal_anchor_sha256?: Digest;
  provider_target?: ProviderEffectTargetV1;
  cleanup_authorization?: {
    cleanup_grant_sha256: Digest;
    basis_kind: CleanupBasisV1["kind"];
    basis_receipt_sha256: Digest;
  };
  expected_resource_lifecycle_generation: bigint;
  successor_resource_lifecycle_generation: bigint;
  fence: CanonicalSandboxEffectFenceV1;
  expected_revision: number;
  prepared_resource_revision: number;
  cancellation_state: "open" | "suppressed";
  effect_phase:
    | "not_applicable"
    | "intent_committed"
    | "prepared"
    | "dispatched"
    | "succeeded"
    | "failed_effect"
    | "failed_no_effect"
    | "unknown";
  outcome_anchor_sha256?: Digest;
  state: "in_flight" | "committed" | "aborted" | "unknown";
  result_sha256?: Digest;
  bounded_result?: {
    schema_version: "sandboxes.bounded-operation-outcome/v1";
    operation: SandboxDataPlaneOperationV1;
    result_sha256: Digest;
    result_document: BoundedOperationResultV1;
    commit_sequence: bigint;
    committed_at: string;
  };
  error_code?: string;
  created_at: string;
  updated_at: string;
}

export interface SandboxEventV1 {
  schema_version: SchemaVersion;
  event_id: string;
  sequence: number;
  resource_id: string;
  operation_id: string;
  event_type: "operation_reserved" | "state_changed" | "operation_committed" | "operation_unknown";
  state: SandboxState;
  revision: number;
  resource_lifecycle_generation: bigint;
  recorded_at: string;
  payload_sha256: Digest;
}

export interface OperationResolutionV1 {
  schema_version: SchemaVersion;
  operation_id: string;
  state: "committed" | "in_flight" | "aborted" | "unknown";
  result_sha256?: Digest;
  error_code?: string;
}

export interface ReconcileFindingV1 {
  schema_version: SchemaVersion;
  finding_id: string;
  resource_id: string;
  kind: "ttl_expired" | "provider_missing" | "provider_identity_mismatch" | "ambiguous_operation" | "orphan_resource";
  disposition: "quarantined" | "operator_review";
  observed_at: string;
  evidence_sha256: Digest;
}
