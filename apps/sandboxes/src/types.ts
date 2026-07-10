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

export type SandboxOperation = "create_inert" | "activate" | "expire" | "quarantine" | "destroy";

export interface LifecycleTransitionBindingV1 {
  expected_resource_lifecycle_generation: bigint;
  post_resource_lifecycle_generation: bigint;
}

export interface DispatchedJournalAnchorV1 {
  schema_version: SchemaVersion;
  journal_anchor_id: string;
  state: "dispatched";
  operation_id: string;
  operation_digest: Digest;
  resource_id: string;
  authority_epoch: bigint;
  expected_resource_lifecycle_generation: bigint;
  post_resource_lifecycle_generation: bigint;
  recorded_at: string;
  expires_at: string;
  issuer_principal: string;
  anchor_sha256: Digest;
}

export interface CapabilityClaimsV1 {
  schema_version: SchemaVersion;
  capability_id: string;
  use_nonce_sha256: Digest;
  operation: SandboxOperation;
  target_resource_id: string;
  request_sha256: Digest;
  dispatch_journal_anchor_sha256: Digest;
  fence: CanonicalSandboxEffectFenceV1;
  not_before: string;
  expires_at: string;
}

export interface MutationContextV1 {
  operation_id: string;
  idempotency_key_sha256: Digest;
  request_sha256: Digest;
  expected_revision: number;
  transition: LifecycleTransitionBindingV1;
  dispatch_journal: DispatchedJournalAnchorV1;
  fence: CanonicalSandboxEffectFenceV1;
  capability: CapabilityClaimsV1;
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
  post_resource_lifecycle_generation: bigint;
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
  post_resource_lifecycle_generation: bigint;
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
  provider_handle_sha256?: Digest;
  create_inert_operation_id: string;
  activation_operation_id?: string;
  immutable_fingerprint_sha256?: Digest;
  durable_checkpoint_receipt_sha256: Digest[];
  git_promotion_receipt_sha256: Digest[];
  created_at: string;
  allocated_at?: string;
  expires_at: string;
  destroyed_at?: string;
  terminal_disposition?: "destroyed_after_checkpoint" | "destroyed_after_promotion" | "discarded_uncheckpointed";
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
  immutable_fingerprint_sha256: Digest;
  resource_lease_id: string;
  resource_id: string;
  resource_lifecycle_generation: bigint;
  spec_sha256: Digest;
}

export interface SealedProviderHandleV1 {
  schema_version: SchemaVersion;
  resource_id: string;
  sealed_handle: string;
  provider_handle_sha256: Digest;
}

export interface ProviderOperationV1 {
  operation: SandboxOperation | "inspect";
  fence: CanonicalSandboxEffectFenceV1;
  request_sha256: Digest;
  idempotency_key_sha256: Digest;
  deadline: string;
}

export interface AdapterDescriptorV1 {
  schema_version: SchemaVersion;
  adapter_id: "fake" | "e2b" | "daytona_cloud";
  adapter_version: string;
  build_sha256: Digest;
  descriptor_sha256: Digest;
  status: "test_only" | "pending_conformance" | "admitted";
  runtime_class: "strong_vm";
  network_modes: ReadonlyArray<"deny_all" | "broker_only">;
  exact_operation_lookup: boolean;
  inert_create: boolean;
  whole_scope_cancel: boolean;
  native_bounded_files: boolean;
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
    immutable_fingerprint_sha256: Digest;
    state: "inert" | "active" | "absent" | "unknown";
  }>;
  next_cursor?: string;
}

export interface OperationRecordV1 {
  schema_version: SchemaVersion;
  operation_id: string;
  operation: SandboxOperation;
  resource_id: string;
  actor_principal: string;
  idempotency_key_sha256: Digest;
  request_sha256: Digest;
  capability_use_sha256: Digest;
  state: "in_flight" | "committed" | "aborted" | "unknown";
  result_sha256?: Digest;
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
